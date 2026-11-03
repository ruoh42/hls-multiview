import { mountGrid } from '../renderer/grid/player';
import type { UiCommand } from '../shared/ipc';
import { toggleScope } from '../core/groups';
import { chatTab, displayName, ICON, iconButton, soundButton, STATUS_LABEL, streamText, tabButton } from '../renderer/common/ui';
import type { Settings, StreamInfo } from '../shared/types';
import { MobileController, type MobileState } from './controller';
import { loadState } from './store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LONG_PRESS_MS = 500;
const QUALITY_SCALE = 1.5;

let controller!: MobileController;
let current: MobileState | null = null;

function onLongPress(el: HTMLElement, cb: () => void): void {
  let timer = 0;
  let fired = false;
  el.addEventListener('pointerdown', () => {
    fired = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      fired = true;
      cb();
    }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(type, () => clearTimeout(timer));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener(
    'click',
    (e) => {
      if (!fired) return;
      fired = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}

const toast = $<HTMLDivElement>('toast');
let toastTimer = 0;
function notice(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), Math.max(2500, message.length * 110));
}

let openDialogs = 0;
function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  openDialogs++;
  controller.setOverlayBlocked(true);
  dialog.showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    openDialogs = Math.max(0, openDialogs - 1);
    if (openDialogs === 0) controller.setOverlayBlocked(false);
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  for (const btn of dialog.querySelectorAll('[data-close]')) btn.addEventListener('click', () => dialog.close());
}

function withOverlayHidden<T>(fn: () => T): T {
  controller.setOverlayBlocked(true);
  try {
    return fn();
  } finally {
    if (openDialogs === 0) controller.setOverlayBlocked(false);
  }
}

type SheetItem = { label: string; run: () => void; danger?: boolean; checked?: boolean } | 'separator';

const sheet = $<HTMLDialogElement>('sheet');
function showSheet(title: string, items: SheetItem[]): void {
  $('sheet-title').textContent = title;
  $('sheet-items').replaceChildren(
    ...items.map((item) => {
      if (item === 'separator') return document.createElement('hr');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label;
      if (item.danger) btn.className = 'danger';
      if (item.checked !== undefined) {
        btn.setAttribute('role', 'menuitemcheckbox');
        btn.setAttribute('aria-checked', String(item.checked));
      }
      btn.addEventListener('click', () => {
        sheet.close();
        item.run();
      });
      return btn;
    }),
  );
  openDialog(sheet);
}

function showStreamMenu(channelId: string): void {
  const s = current?.streams.find((x) => x.channelId === channelId);
  if (!s) return;
  showSheet(displayName(s), [
    { label: '메인으로 크게 보기', run: () => controller.streamAction('promote', channelId) },
    { label: '채팅 보기', run: () => controller.selectChat(channelId, true) },
    { label: s.muted ? '소리 켜기' : '소리 끄기', run: () => controller.streamAction(s.muted ? 'unmute' : 'mute', channelId) },
    { label: '새로고침', run: () => controller.streamAction('reload', channelId) },
    'separator',
    ...controller.groups.map((g) => ({
      label: `그룹: ${g.name}`,
      checked: g.channelIds.includes(channelId),
      run: () => controller.setMembership(channelId, g.id, !g.channelIds.includes(channelId)),
    })),
    'separator',
    { label: '방송 닫기', danger: true, run: () => controller.streamAction('remove', channelId) },
  ]);
}

function renameGroup(groupId: string): void {
  const group = controller.groups.find((g) => g.id === groupId);
  if (!group) return;
  const name = withOverlayHidden(() => window.prompt('그룹 이름', group.name));
  if (name?.trim()) controller.renameGroup(groupId, name);
}

function showGroupMenu(groupId: string): void {
  const group = controller.groups.find((g) => g.id === groupId);
  if (!group || !current) return;
  const scope = current.scope;
  showSheet(group.name, [
    { label: '이름 변경', run: () => renameGroup(groupId) },
    {
      label: '지금 화면에 함께 보기',
      checked: scope.kind === 'groups' && scope.groupIds.includes(groupId),
      run: () => controller.selectScope(toggleScope(scope, groupId)),
    },
    'separator',
    {
      label: '그룹 삭제',
      danger: true,
      run: () => {
        if (controller.groups.length <= 1) return notice('마지막 그룹은 삭제할 수 없습니다');
        const ok =
          group.channelIds.length === 0 ||
          withOverlayHidden(() =>
            window.confirm(`'${group.name}' 그룹을 삭제할까요?\n방송 ${group.channelIds.length}개가 이 그룹에서 빠집니다.`),
          );
        if (ok) controller.deleteGroup(groupId);
      },
    },
  ]);
}

const tabs = $<HTMLElement>('scope-tabs');
const list = $<HTMLUListElement>('stream-list');
const chatTabs = $<HTMLElement>('chat-tabs');
const audioFollow = $<HTMLInputElement>('audio-follow');
const layoutBtn = $<HTMLButtonElement>('layout-btn');
const panelBtn = $<HTMLButtonElement>('panel-btn');
const panelTabButtons = [...document.querySelectorAll<HTMLButtonElement>('.panel-tabs button')];

function renderTabs(state: MobileState): void {
  const { scope } = state;
  const all = tabButton('전체', scope.kind === 'all', () => controller.selectScope({ kind: 'all' }));
  const groups = state.groups.map((g) => {
    const btn = tabButton(g.name, scope.kind === 'groups' && scope.groupIds.includes(g.id), () =>
      controller.selectScope({ kind: 'groups', groupIds: [g.id] }),
    );
    onLongPress(btn, () => showGroupMenu(g.id));
    return btn;
  });
  const add = tabButton('+', false, () => renameGroup(controller.newGroup()));
  add.className = 'new-group';
  add.removeAttribute('aria-pressed');
  add.setAttribute('aria-label', '새 그룹');
  tabs.replaceChildren(all, ...groups, add);
}

function row(s: StreamInfo, waiting: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'stream' + (s.isMain ? ' is-main' : '') + (waiting ? ' waiting' : '');
  const sound = soundButton(s, () => controller.streamAction(s.muted ? 'unmute' : 'mute', s.channelId));
  sound.disabled = waiting;
  const actions = document.createElement('div');
  actions.className = 'stream-actions';
  actions.append(sound, iconButton(ICON.close, '방송 닫기', () => controller.streamAction('remove', s.channelId)));
  li.append(waiting ? streamText(s, 'waiting', '대기') : streamText(s, s.status, STATUS_LABEL[s.status]), actions);
  li.addEventListener('click', () => controller.selectChat(s.channelId, true));
  onLongPress(li, () => showStreamMenu(s.channelId));
  return li;
}

const settingsForm = $<HTMLFormElement>('settings-form');
const field = <T extends HTMLElement>(name: keyof Settings) => settingsForm.elements.namedItem(name) as T;

function renderSettings({ settings }: MobileState): void {
  field<HTMLInputElement>('audioFollowsChat').checked = settings.audioFollowsChat;
  field<HTMLSelectElement>('maxQuality').value = String(settings.maxQuality);
  const keepAlive = field<HTMLInputElement>('chatKeepAlive');
  if (document.activeElement !== keepAlive) keepAlive.value = String(settings.chatKeepAlive);
}

function render(state: MobileState): void {
  current = state;
  document.body.dataset.panel = state.panelOpen ? 'open' : 'closed';
  document.body.dataset.tab = state.panelTab;
  renderTabs(state);
  layoutBtn.textContent = state.layout === 'focus' ? '1+N' : '그리드';
  panelBtn.setAttribute('aria-pressed', String(state.panelOpen));
  for (const btn of panelTabButtons) btn.setAttribute('aria-selected', String(btn.dataset.tab === state.panelTab));
  audioFollow.checked = state.settings.audioFollowsChat;

  list.replaceChildren(...state.streams.map((s, i) => row(s, i >= state.maxStreams)));
  $('list-empty').hidden = state.streams.length > 0;
  chatTabs.replaceChildren(
    ...state.streams.map((s) => chatTab(s, s.channelId === state.chatChannel, () => controller.selectChat(s.channelId, true))),
  );
  chatTabs.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  renderSettings(state);
  scheduleMeasure();
}

const gridEl = $<HTMLElement>('grid');
const chatSlot = $<HTMLElement>('chat-slot');
let measureFrame = 0;
function scheduleMeasure(): void {
  measureFrame ||= requestAnimationFrame(() => {
    measureFrame = 0;
    controller.setGridSize(gridEl.clientWidth, gridEl.clientHeight);
    const r = chatSlot.getBoundingClientRect();
    controller.setChatRect(
      r.width > 0 && r.height > 0 ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null,
    );
  });
}

function handleGridCommand(cmd: UiCommand): void {
  switch (cmd.type) {
    case 'stream':
      return cmd.action === 'menu' ? showStreamMenu(cmd.channelId) : controller.streamAction(cmd.action, cmd.channelId);
    case 'select-chat':
      return controller.selectChat(cmd.channelId, cmd.open);
    case 'player-problem':
      return controller.playerProblem(cmd.channelId);
  }
}

function wireControls(): void {
  const addDialog = $<HTMLDialogElement>('add-dialog');
  const input = $<HTMLInputElement>('channel-input');
  $('add-btn').addEventListener('click', () => {
    input.value = '';
    openDialog(addDialog);
    input.focus();
  });
  $<HTMLFormElement>('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (controller.addChannel(value)) addDialog.close();
  });

  layoutBtn.addEventListener('click', () => controller.setLayout(current?.layout === 'focus' ? 'grid' : 'focus'));
  panelBtn.addEventListener('click', () => controller.togglePanel());
  for (const btn of panelTabButtons) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'list' || tab === 'chat') controller.setPanelTab(tab);
    });
  }
  audioFollow.addEventListener('change', () => controller.setSettings({ audioFollowsChat: audioFollow.checked }));

  const settingsDialog = $<HTMLDialogElement>('settings-dialog');
  $('more-btn').addEventListener('click', () =>
    showSheet('HLS Multiview', [
      current?.loggedIn
        ? { label: '로그아웃', run: () => void controller.logout() }
        : { label: '로그인', run: () => void controller.login() },
      { label: '설정', run: () => openDialog(settingsDialog) },
    ]),
  );
  settingsForm.addEventListener('change', () =>
    controller.setSettings({
      audioFollowsChat: field<HTMLInputElement>('audioFollowsChat').checked,
      maxQuality: Number(field<HTMLSelectElement>('maxQuality').value) as Settings['maxQuality'],
      chatKeepAlive: Math.round(Number(field<HTMLInputElement>('chatKeepAlive').value)),
    }),
  );
  settingsForm.addEventListener('submit', (e) => e.preventDefault());

  const observer = new ResizeObserver(scheduleMeasure);
  for (const el of [document.body, gridEl, chatSlot]) observer.observe(el);
  window.addEventListener('resize', scheduleMeasure);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') controller.flush();
  });
}

async function start(): Promise<void> {
  const renderTiles = mountGrid({ container: $('tiles'), empty: $('empty'), send: handleGridCommand, qualityScale: QUALITY_SCALE });
  const saved = await loadState();
  controller = new MobileController({ state: render, tiles: renderTiles, notice }, saved);
  wireControls();
  scheduleMeasure();
}

void start();
