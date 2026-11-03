import { parseChannelInput } from '../core/channel';
import { GroupsModel } from '../core/groups';
import { focusLayout, gridLayout, type Rect } from '../core/layout';
import { sanitizeSettings } from '../core/settings';
import type { LoadedCommonState } from '../core/state';
import { StreamManager } from '../core/streams';
import type { TilesPayload, UiState } from '../shared/ipc';
import { DEFAULT_SETTINGS, type LayoutMode, type PanelTab, type Settings, type StreamAction, type ViewScope } from '../shared/types';
import { ChatManager } from './chat';
import { ChzzkNative } from './native';
import { StateSaver } from './store';

const MAX_STREAMS = 9;

const HOME = 'https://chzzk.naver.com/';
const LOGIN_URL = `https://nid.naver.com/nidlogin.login?url=${encodeURIComponent(HOME)}`;

export interface MobileState extends UiState {
  maxStreams: number;
}

export interface ControllerView {
  state(state: MobileState): void;
  tiles(tiles: TilesPayload): void;
  notice(message: string): void;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await ChzzkNative.fetchText({ url });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.text);
}

export class MobileController {
  private model = new GroupsModel();
  private streams: StreamManager;
  private chat = new ChatManager();
  private saver = new StateSaver();
  private panelOpen = true;
  private panelTab: PanelTab = 'list';
  private chatChannel: string | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private loggedIn = false;
  private gridSize = { width: 0, height: 0 };
  private chatRect: Rect | null = null;
  private overlayBlocked = false;
  private pushTimer = 0;
  private overflowNoticeFor = '';

  constructor(
    private view: ControllerView,
    saved: LoadedCommonState,
  ) {
    this.restore(saved);
    this.streams = new StreamManager(fetchJson, () => this.schedulePush());
    this.chat.setKeepAlive(this.settings.chatKeepAlive);
    void ChzzkNative.addListener('auth', (s) => this.onAuth(s.loggedIn, s.persistent));
    void ChzzkNative.authState().then((s) => this.onAuth(s.loggedIn, s.persistent));
    this.refresh();
  }

  private restore(saved: LoadedCommonState): void {
    this.model.restore(saved);
    if (saved.panel) {
      this.panelOpen = saved.panel.open;
      this.panelTab = saved.panel.tab;
    }
    this.chatChannel = saved.chatChannel ?? null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  }

  private onAuth(loggedIn: boolean, persistent: boolean | null): void {
    if (loggedIn === this.loggedIn) return;
    this.loggedIn = loggedIn;
    if (loggedIn && persistent === false) this.view.notice("앱을 다시 열면 로그아웃됩니다 · '로그인 상태 유지'를 체크하세요");
    this.streams.refreshAll();
    this.chat.reloadAll();
    this.pushState();
  }

  flush(): void {
    this.save();
    void this.saver.flush();
  }

  private save(): void {
    this.saver.schedule({
      ...this.model.snapshot(),
      panel: { open: this.panelOpen, width: 0, tab: this.panelTab },
      chatChannel: this.chatChannel,
      settings: this.settings,
    });
  }

  get groups() {
    return this.model.groups;
  }

  private playing(): string[] {
    return this.model.orderedChannels().slice(0, MAX_STREAMS);
  }

  addChannel(input: string): boolean {
    const channelId = parseChannelInput(input);
    if (!channelId) return this.fail('채널 ID 또는 치지직 라이브 주소를 입력해 주세요');
    if (this.model.visibleChannels().includes(channelId)) return this.fail('이미 추가된 채널입니다');
    if (this.model.visibleChannels().length >= MAX_STREAMS) {
      return this.fail(`모바일에서는 한 화면에 최대 ${MAX_STREAMS}개까지 볼 수 있습니다 · 새 그룹을 만들어 나눠 보세요`);
    }
    this.model.addChannel(channelId);
    this.refresh();
    return true;
  }

  private fail(message: string): false {
    this.view.notice(message);
    return false;
  }

  selectScope(scope: ViewScope): void {
    this.model.setScope(scope);
    this.refresh();
  }

  setLayout(layout: LayoutMode): void {
    this.model.layout = layout;
    this.refresh();
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen;
    this.relayout();
  }

  setPanelTab(tab: PanelTab): void {
    this.panelTab = tab;
    if (tab === 'chat' && !this.chatChannel) this.chatChannel = this.playing()[0] ?? null;
    this.applyAudio();
    this.relayout();
  }

  selectChat(channelId: string, open: boolean): void {
    if (!this.model.visibleChannels().includes(channelId)) return;
    this.chatChannel = channelId;
    if (open) {
      this.panelOpen = true;
      this.panelTab = 'chat';
    }
    this.applyAudio();
    this.relayout();
  }

  streamAction(action: StreamAction, channelId: string): void {
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
        return this.refresh();
      case 'remove':
        this.model.removeChannel(channelId);
        return this.refresh();
    }
  }

  playerProblem(channelId: string): void {
    this.streams.playerProblem(channelId);
  }

  setMembership(channelId: string, groupId: string, member: boolean): void {
    this.model.setMembership(channelId, groupId, member);
    this.refresh();
  }

  newGroup(): string {
    const group = this.model.createGroup();
    this.model.setScope({ kind: 'groups', groupIds: [group.id] });
    this.refresh();
    return group.id;
  }

  renameGroup(groupId: string, name: string): void {
    if (this.model.renameGroup(groupId, name)) this.pushState();
  }

  deleteGroup(groupId: string): void {
    if (this.model.deleteGroup(groupId)) this.refresh();
  }

  setSettings(partial: Partial<Settings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...sanitizeSettings(partial) };
    if (this.settings.audioFollowsChat && !prev.audioFollowsChat) this.applyAudio();
    if (this.settings.chatKeepAlive !== prev.chatKeepAlive) this.chat.setKeepAlive(this.settings.chatKeepAlive);
    this.pushState();
  }

  async login(): Promise<void> {
    this.setOverlayBlocked(true);
    try {
      await ChzzkNative.login({ url: LOGIN_URL });
    } finally {
      this.setOverlayBlocked(false);
    }
  }

  async logout(): Promise<void> {
    await ChzzkNative.logout();
    this.onAuth(false, null);
  }

  setGridSize(width: number, height: number): void {
    if (width === this.gridSize.width && height === this.gridSize.height) return;
    this.gridSize = { width, height };
    this.relayout();
  }

  setChatRect(rect: Rect | null): void {
    this.chatRect = rect;
    this.applyChat();
  }

  setOverlayBlocked(blocked: boolean): void {
    this.overlayBlocked = blocked;
    this.applyChat();
  }

  private applyAudio(): void {
    if (this.settings.audioFollowsChat && this.chatChannel) this.streams.soloAudio(this.chatChannel);
  }

  private refresh(): void {
    const visible = this.model.visibleChannels();
    this.streams.sync(visible);
    this.chat.retain(visible);
    if (this.chatChannel && !visible.includes(this.chatChannel)) this.chatChannel = null;
    if (this.panelTab === 'chat' && !this.chatChannel) this.chatChannel = this.playing()[0] ?? null;
    this.noticeOverflow(visible.length);
    this.applyAudio();
    this.relayout();
  }

  private noticeOverflow(count: number): void {
    const key = count > MAX_STREAMS ? JSON.stringify(this.model.scope) : '';
    if (key && key !== this.overflowNoticeFor) {
      this.view.notice(`방송 ${count}개 중 ${MAX_STREAMS}개만 재생합니다 · 나머지는 목록에서 '대기'로 표시됩니다`);
    }
    this.overflowNoticeFor = key;
  }

  private applyChat(): void {
    const show = this.panelOpen && this.panelTab === 'chat' && !this.overlayBlocked && this.chatRect !== null;
    if (this.chatRect) this.chat.setBounds(this.chatRect);
    this.chat.show(show ? this.chatChannel : null);
    this.chat.setVisible(show);
  }

  private relayout(): void {
    const area = { x: 0, y: 0, ...this.gridSize };
    const ids = this.model.orderedChannels();
    const count = Math.min(ids.length, MAX_STREAMS);
    const rects = this.model.layout === 'focus' ? focusLayout(count, area) : gridLayout(count, area);
    this.streams.layout(ids, rects);
    this.applyChat();
    this.pushState();
  }

  private pushState(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = 0;
    this.save();
    this.view.state(this.uiState());
    this.view.tiles(this.tilesPayload());
  }

  private schedulePush(): void {
    this.pushTimer ||= window.setTimeout(() => this.pushState(), 100);
  }

  private uiState(): MobileState {
    const main = this.model.focusedMain();
    return {
      groups: this.model.groups.map(({ id, name }) => ({ id, name })),
      scope: this.model.scope,
      layout: this.model.layout,
      loggedIn: this.loggedIn,
      streams: this.model.orderedChannels().map((channelId) => ({
        channelId,
        ...this.streams.info(channelId),
        isMain: channelId === main,
      })),
      panelOpen: this.panelOpen,
      panelTab: this.panelTab,
      chatChannel: this.chatChannel,
      settings: this.settings,
      maxStreams: MAX_STREAMS,
    };
  }

  private tilesPayload(): TilesPayload {
    return this.streams.tiles(this.model.orderedChannels(), {
      origin: { x: 0, y: 0 },
      mainChannel: this.model.focusedMain(),
      chatChannel: this.chatChannel,
      focusLayout: this.model.layout === 'focus',
      qualityPenalty: 0,
      maxQuality: this.settings.maxQuality,
    });
  }
}
