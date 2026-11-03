import type { UiState } from '../../shared/ipc';
import type { StreamAction, StreamInfo } from '../../shared/types';
import { api } from '../common/api';
import { chatTab, ICON, iconButton, soundButton, STATUS_LABEL, streamText } from '../common/ui';

const list = document.getElementById('stream-list') as HTMLUListElement;
const empty = document.getElementById('empty') as HTMLParagraphElement;

const send = (action: StreamAction, channelId: string) => () => api.send({ type: 'stream', action, channelId });
const openChat = (channelId: string) => () => api.send({ type: 'select-chat', channelId, open: true });

function row(s: StreamInfo): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'stream' + (s.isMain ? ' is-main' : '');

  const main = iconButton(ICON.main, '메인으로 크게 보기', send('promote', s.channelId));
  main.setAttribute('aria-pressed', String(s.isMain));
  const close = iconButton(ICON.close, '방송 닫기', send('remove', s.channelId));
  close.classList.add('danger');
  const actions = document.createElement('div');
  actions.className = 'stream-actions';
  actions.append(
    soundButton(s, send(s.muted ? 'unmute' : 'mute', s.channelId)),
    main,
    iconButton(ICON.reload, '새로고침', send('reload', s.channelId)),
    close,
  );

  li.append(streamText(s, s.status, STATUS_LABEL[s.status]), actions);
  li.title = '클릭하면 이 방송의 채팅을 엽니다';
  li.addEventListener('click', openChat(s.channelId));
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.send({ type: 'stream', action: 'menu', channelId: s.channelId });
  });
  return li;
}

function render(state: UiState) {
  document.body.dataset.tab = state.panelTab;
  for (const btn of tabButtons) btn.setAttribute('aria-selected', String(btn.dataset.tab === state.panelTab));
  audioFollow.checked = state.settings.audioFollowsChat;

  list.replaceChildren(...state.streams.map(row));
  empty.hidden = state.streams.length > 0;

  chatTabs.replaceChildren(...state.streams.map((s) => chatTab(s, s.channelId === state.chatChannel, openChat(s.channelId))));
  chatTabs.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('.panel-tabs button')];
for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'list' || tab === 'chat') api.send({ type: 'panel-tab', tab });
  });
}
const audioFollow = document.getElementById('audio-follow') as HTMLInputElement;
audioFollow.addEventListener('change', () => api.send({ type: 'set-settings', settings: { audioFollowsChat: audioFollow.checked } }));

const chatTabs = document.getElementById('chat-tabs') as HTMLElement;
chatTabs.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    chatTabs.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

const handle = document.getElementById('resize-handle') as HTMLDivElement;
handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  api.send({ type: 'panel-resize', phase: 'start', screenX: e.screenX });
});
handle.addEventListener('pointermove', (e) => {
  if (handle.hasPointerCapture(e.pointerId)) api.send({ type: 'panel-resize', phase: 'move', screenX: e.screenX });
});
const endResize = (e: PointerEvent) => {
  if (!document.body.classList.contains('resizing')) return;
  document.body.classList.remove('resizing');
  api.send({ type: 'panel-resize', phase: 'end', screenX: e.screenX });
};
handle.addEventListener('pointerup', endResize);
handle.addEventListener('dblclick', () => api.send({ type: 'panel-reset-width' }));
handle.addEventListener('lostpointercapture', endResize);

api.onState(render);
void api.getState().then((s) => s && render(s));
