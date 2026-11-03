import { dialog, Menu, screen, type MenuItemConstructorOptions } from 'electron';
import { IPC, type TilesPayload, type UiCommand, type UiState } from '../shared/ipc';
import { DEFAULT_SETTINGS, type PanelTab, type Settings, type StreamAction } from '../shared/types';
import { Auth } from './auth';
import { parseChannelInput } from '../core/channel';
import { ChatManager } from './chat';
import { GroupsModel } from '../core/groups';
import { focusLayout, gridLayout, type Rect } from '../core/layout';
import { ResourceMonitor, type Pressure, type ResourceSample } from './resources';
import { sanitizeSettings } from '../core/settings';
import { SettingsWindow } from './settings';
import { fetchLiveJson } from './session';
import { StateSaver, type LoadedState } from './store';
import { StreamManager } from '../core/streams';
import { clampPanelWidth, layoutChrome, PANEL_DEFAULT_WIDTH, windowState, type MainWindow } from './window';

const RECOVER_INTERVAL_MS = 15000;
const DEGRADE_COOLDOWN_MS = 15000;
const MAX_QUALITY_PENALTY = 2;
const RESIZE_POLL_MS = 16;
const RESIZE_MAX_MS = 60_000;

export class Controller {
  private model = new GroupsModel();
  private streams: StreamManager;
  private auth: Auth;
  private monitor: ResourceMonitor;
  private chat: ChatManager;
  private panelOpen = true;
  private panelTab: PanelTab = 'list';
  private panelWidth = PANEL_DEFAULT_WIDTH;
  private chatChannel: string | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private settingsWindow: SettingsWindow;
  private settingsWc: Electron.WebContents | null = null;
  private resize: { startX: number; startWidth: number; poll: NodeJS.Timeout; startedAt: number } | null = null;
  private area: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private qualityPenalty = 0;
  private lastRecoverAt = 0;
  private lastDegradeAt = 0;
  private pushTimer: NodeJS.Timeout | null = null;
  private saver = new StateSaver();

  constructor(
    private main: MainWindow,
    saved: LoadedState = {},
  ) {
    this.restore(saved);
    this.streams = new StreamManager(fetchLiveJson, () => this.schedulePush());
    this.chat = new ChatManager(main.win);
    this.chat.setKeepAlive(this.settings.chatKeepAlive);
    this.settingsWindow = new SettingsWindow((wc) => (this.settingsWc = wc));
    this.auth = new Auth((loggedIn, persistent) => {
      console.info('[auth]', loggedIn ? `로그인됨 (재시작 후 유지: ${persistent})` : '로그아웃됨');
      if (loggedIn && !persistent) {
        this.notify("재시작 시 로그아웃됩니다 · '로그인 상태 유지'를 체크하세요");
      }
      this.streams.refreshAll();
      this.chat.reloadAll();
      this.pushState();
    });
    this.monitor = new ResourceMonitor((pressure, sample) => this.onPressure(pressure, sample));
    main.win.on('close', () => {
      this.save();
      this.saver.flush();
    });
    main.win.on('closed', () => {
      this.monitor.stop();
      this.streams.stop();
    });
    main.win.on('resize', () => {
      this.relayout();
      this.save();
    });
    main.win.on('move', () => this.save());
    this.refresh();
  }

  private restore(saved: LoadedState): void {
    this.model.restore(saved);
    if (saved.panel) {
      this.panelOpen = saved.panel.open;
      this.panelTab = saved.panel.tab;
      if (saved.panel.width > 0) this.panelWidth = saved.panel.width;
    }
    this.chatChannel = saved.chatChannel ?? null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  }

  private save(): void {
    this.saver.schedule({
      ...this.model.snapshot(),
      window: windowState(this.main.win),
      panel: { open: this.panelOpen, width: this.panelWidth, tab: this.panelTab },
      chatChannel: this.chatChannel,
      settings: this.settings,
    });
  }

  isAppUi(sender: Electron.WebContents): boolean {
    const { toolbar, panel, grid } = this.main;
    return [toolbar, panel, grid].some((v) => v.webContents === sender) || sender === this.settingsWc;
  }

  uiState(): UiState {
    const main = this.model.focusedMain();
    return {
      groups: this.model.groups.map(({ id, name }) => ({ id, name })),
      scope: this.model.scope,
      layout: this.model.layout,
      loggedIn: this.auth.loggedIn,
      streams: this.model.orderedChannels().map((channelId) => ({
        channelId,
        ...this.streams.info(channelId),
        isMain: channelId === main,
      })),
      panelOpen: this.panelOpen,
      panelTab: this.panelTab,
      chatChannel: this.chatChannel,
      settings: this.settings,
    };
  }

  handle(cmd: UiCommand): void {
    switch (cmd.type) {
      case 'add-channel': {
        const channelId = parseChannelInput(cmd.input);
        if (!channelId) return this.notify('채널 ID 또는 치지직 라이브 주소를 입력해 주세요');
        if (this.model.addChannel(channelId) === 'duplicate') return this.notify('이미 추가된 채널입니다');
        return this.refresh();
      }
      case 'select-scope':
        this.model.setScope(cmd.scope);
        return this.refresh();
      case 'set-layout':
        this.model.layout = cmd.layout;
        return this.refresh();
      case 'stream':
        return this.streamAction(cmd.action, cmd.channelId);
      case 'player-problem':
        return this.streams.playerProblem(cmd.channelId);
      case 'new-group': {
        const group = this.model.createGroup();
        this.model.setScope({ kind: 'groups', groupIds: [group.id] });
        this.refresh();
        return this.main.toolbar.webContents.send(IPC.editGroup, group.id);
      }
      case 'group-menu':
        return this.showGroupMenu(cmd.groupId);
      case 'rename-group':
        if (this.model.renameGroup(cmd.groupId, cmd.name)) this.pushState();
        return;
      case 'login':
        return this.auth.openLoginWindow(this.main.win);
      case 'logout':
        return void this.auth.logout();
      case 'toggle-panel':
        this.panelOpen = !this.panelOpen;
        return this.refresh();
      case 'panel-tab':
        this.panelTab = cmd.tab;
        if (cmd.tab === 'chat' && !this.chatChannel) this.chatChannel = this.model.orderedChannels()[0] ?? null;
        this.applyAudio();
        return this.relayout();
      case 'select-chat':
        return this.selectChat(cmd.channelId, cmd.open);
      case 'set-settings':
        return this.applySettings(cmd.settings);
      case 'panel-resize':
        return this.onPanelResize(cmd.phase, cmd.screenX);
      case 'panel-reset-width':
        this.panelWidth = PANEL_DEFAULT_WIDTH;
        return this.relayout();
      case 'open-settings':
        return this.settingsWindow.open(this.main.win);
    }
  }

  private applySettings(partial: Partial<Settings>): void {
    const next = { ...this.settings, ...sanitizeSettings(partial) };
    const prev = this.settings;
    this.settings = next;
    if (next.audioFollowsChat && !prev.audioFollowsChat) this.applyAudio();
    if (next.chatKeepAlive !== prev.chatKeepAlive) this.chat.setKeepAlive(next.chatKeepAlive);
    if (!next.autoDegrade && prev.autoDegrade) {
      this.qualityPenalty = 0;
      while (this.streams.wakeOne(this.model.orderedChannels()));
    }
    this.pushState();
  }

  private selectChat(channelId: string, open: boolean): void {
    if (!this.model.visibleChannels().includes(channelId)) return;
    this.chatChannel = channelId;
    if (open) {
      this.panelOpen = true;
      this.panelTab = 'chat';
    }
    this.applyAudio();
    this.relayout();
  }

  private applyAudio(): void {
    if (this.settings.audioFollowsChat && this.chatChannel) this.streams.soloAudio(this.chatChannel);
  }

  private onPanelResize(phase: 'start' | 'move' | 'end', screenX: number): void {
    const stop = () => {
      if (!this.resize) return;
      clearInterval(this.resize.poll);
      this.resize = null;
    };
    if (phase === 'start') {
      stop();
      const poll = setInterval(() => {
        if (!this.resize || Date.now() - this.resize.startedAt > RESIZE_MAX_MS) return stop();
        this.resizeTo(screen.getCursorScreenPoint().x);
      }, RESIZE_POLL_MS);
      this.resize = { startX: screenX, startWidth: this.panelWidth, poll, startedAt: Date.now() };
      return;
    }
    if (!this.resize) return;
    this.resizeTo(screenX);
    if (phase === 'end') stop();
  }

  private resizeTo(screenX: number): void {
    if (!this.resize) return;
    const width = clampPanelWidth(this.main.win, this.resize.startWidth + (this.resize.startX - screenX));
    if (width === this.panelWidth) return;
    this.panelWidth = width;
    this.relayout();
  }

  private streamAction(action: StreamAction, channelId: string): void {
    if (!this.model.visibleChannels().includes(channelId)) return;
    switch (action) {
      case 'mute':
      case 'unmute':
        return this.streams.setMuted(channelId, action === 'mute');
      case 'reload':
        return this.streams.reload(channelId);
      case 'wake':
        return this.streams.wake(channelId);
      case 'promote':
        this.model.mainChannel = channelId;
        this.model.layout = 'focus';
        this.refresh();
        return this.streams.wake(channelId);
      case 'remove':
        this.model.removeChannel(channelId);
        return this.refresh();
      case 'menu':
        return this.showMenu(channelId);
    }
  }

  private showMenu(channelId: string): void {
    const groupItems: MenuItemConstructorOptions[] = this.model.groups.map((g) => ({
      label: g.name,
      type: 'checkbox',
      checked: g.channelIds.includes(channelId),
      click: (item) => {
        this.model.setMembership(channelId, g.id, item.checked);
        this.refresh();
      },
    }));
    Menu.buildFromTemplate([
      { label: '메인으로 크게 보기', click: () => this.streamAction('promote', channelId) },
      { label: '채팅 보기', click: () => this.selectChat(channelId, true) },
      { label: '새로고침', click: () => this.streamAction('reload', channelId) },
      { type: 'separator' },
      { label: '그룹', submenu: groupItems },
      { type: 'separator' },
      { label: '방송 닫기', click: () => this.streamAction('remove', channelId) },
    ]).popup({ window: this.main.win });
  }

  private showGroupMenu(groupId: string): void {
    const group = this.model.group(groupId);
    if (!group) return;
    Menu.buildFromTemplate([
      { label: '이름 변경', click: () => this.main.toolbar.webContents.send(IPC.editGroup, groupId) },
      {
        label: '그룹 삭제',
        enabled: this.model.groups.length > 1,
        click: () => void this.confirmDeleteGroup(groupId),
      },
    ]).popup({ window: this.main.win });
  }

  private async confirmDeleteGroup(groupId: string): Promise<void> {
    const group = this.model.group(groupId);
    if (!group) return;
    if (group.channelIds.length > 0) {
      const { response } = await dialog.showMessageBox(this.main.win, {
        type: 'warning',
        buttons: ['삭제', '취소'],
        defaultId: 1,
        cancelId: 1,
        message: `'${group.name}' 그룹을 삭제할까요?`,
        detail: `방송 ${group.channelIds.length}개가 이 그룹에서 빠집니다. 다른 그룹에도 들어 있는 방송은 그대로 남습니다.`,
      });
      if (response !== 0) return;
    }
    if (this.model.deleteGroup(groupId)) this.refresh();
  }

  private onPressure(pressure: Pressure, sample: ResourceSample): void {
    if (!this.settings.autoDegrade) return;
    const order = this.model.orderedChannels();
    if (pressure === 'high') {
      if (Date.now() - this.lastDegradeAt < DEGRADE_COOLDOWN_MS) return;
      this.lastDegradeAt = Date.now();
      if (this.qualityPenalty < MAX_QUALITY_PENALTY) {
        this.qualityPenalty++;
        console.info('[resources] 화질 낮춤 →', this.qualityPenalty, sample);
        this.schedulePush();
      } else {
        const main = this.model.focusedMain();
        if (this.streams.sleepOne(new Set(main ? [main] : []), order)) console.info('[resources] 휴면 1개', sample);
      }
      this.lastRecoverAt = Date.now();
      return;
    }
    if (pressure !== 'low' || Date.now() - this.lastRecoverAt < RECOVER_INTERVAL_MS) return;
    if (this.streams.sleepingCount() > 0) {
      if (this.streams.wakeOne(order)) console.info('[resources] 깨움 1개', sample);
    } else if (this.qualityPenalty > 0) {
      this.qualityPenalty--;
      console.info('[resources] 화질 되돌림 →', this.qualityPenalty, sample);
      this.schedulePush();
    } else {
      return;
    }
    this.lastRecoverAt = Date.now();
  }

  private refresh(): void {
    const visible = this.model.visibleChannels();
    this.streams.sync(visible);
    this.chat.retain(visible);
    if (this.chatChannel && !visible.includes(this.chatChannel)) this.chatChannel = null;
    if (this.panelTab === 'chat' && !this.chatChannel) this.chatChannel = this.model.orderedChannels()[0] ?? null;
    this.applyAudio();
    this.relayout();
  }

  private relayout(): void {
    const { streams, chat } = layoutChrome(this.main, { open: this.panelOpen, width: this.panelWidth, tab: this.panelTab });
    this.area = streams;
    if (chat) {
      this.chat.setBounds(chat);
      this.chat.show(this.chatChannel);
    }
    this.chat.setVisible(chat !== null);
    const ids = this.model.orderedChannels();
    const rects = this.model.layout === 'focus' ? focusLayout(ids.length, this.area) : gridLayout(ids.length, this.area);
    this.streams.layout(ids, rects);
    this.pushState();
  }

  private pushState(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.save();
    const state = this.uiState();
    for (const view of [this.main.toolbar, this.main.panel]) {
      view.webContents.send(IPC.state, state);
    }
    if (this.settingsWc && !this.settingsWc.isDestroyed()) this.settingsWc.send(IPC.state, state);
    this.main.grid.webContents.send(IPC.tiles, this.tilesPayload());
  }

  tilesPayload(): TilesPayload {
    return this.streams.tiles(this.model.orderedChannels(), {
      origin: this.area,
      mainChannel: this.model.focusedMain(),
      chatChannel: this.chatChannel,
      focusLayout: this.model.layout === 'focus',
      qualityPenalty: this.qualityPenalty,
      maxQuality: this.settings.maxQuality,
    });
  }

  private schedulePush(): void {
    this.pushTimer ??= setTimeout(() => this.pushState(), 100);
  }

  private notify(message: string): void {
    this.main.toolbar.webContents.send(IPC.notice, message);
  }
}
