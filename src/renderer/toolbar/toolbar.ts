import type { UiState } from '../../shared/ipc';
import { toggleScope } from '../../core/groups';
import { api } from '../common/api';
import { tabButton } from '../common/ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = $<HTMLElement>('scope-tabs');
const addForm = $<HTMLFormElement>('add-form');
const channelInput = $<HTMLInputElement>('channel-input');
const layoutToggle = $<HTMLElement>('layout-toggle');
const panelBtn = $<HTMLButtonElement>('panel-btn');
const loginBtn = $<HTMLButtonElement>('login-btn');
const settingsBtn = $<HTMLButtonElement>('settings-btn');

let current: UiState | null = null;
let editingGroupId: string | null = null;

function renderTabs(state: UiState) {
  const { scope } = state;
  tabs.replaceChildren(
    tabButton('전체', scope.kind === 'all', () =>
      api.send({ type: 'select-scope', scope: { kind: 'all' } }),
    ),
    ...state.groups.map((g) => {
      const btn = tabButton(g.name, scope.kind === 'groups' && scope.groupIds.includes(g.id), (e) =>
        api.send({ type: 'select-scope', scope: e.metaKey || e.ctrlKey ? toggleScope(scope, g.id) : { kind: 'groups', groupIds: [g.id] } }),
      );
      btn.dataset.groupId = g.id;
      btn.title = 'Cmd/Ctrl+클릭: 여러 그룹 함께 보기 · 우클릭: 이름 변경/삭제 · 더블클릭: 이름 변경';
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        api.send({ type: 'group-menu', groupId: g.id });
      });
      btn.addEventListener('dblclick', () => startEdit(g.id));
      return btn;
    }),
  );
  const newGroup = tabButton('+', false, () => api.send({ type: 'new-group' }));
  newGroup.className = 'new-group';
  newGroup.title = '새 그룹';
  newGroup.removeAttribute('aria-pressed');
  tabs.append(newGroup);
}

function startEdit(groupId: string) {
  const btn = tabs.querySelector<HTMLButtonElement>(`[data-group-id="${CSS.escape(groupId)}"]`);
  if (!btn || editingGroupId) return;
  editingGroupId = groupId;
  const input = document.createElement('input');
  input.className = 'group-name-input';
  input.value = btn.textContent ?? '';
  input.maxLength = 30;
  input.size = Math.max(4, input.value.length + 2);
  input.setAttribute('aria-label', '그룹 이름');
  btn.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) api.send({ type: 'rename-group', groupId, name });
    editingGroupId = null;
    if (current) renderTabs(current);
  };
  input.addEventListener('input', () => (input.size = Math.max(4, input.value.length + 2)));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function render(state: UiState) {
  current = state;
  if (!editingGroupId) renderTabs(state);

  for (const btn of layoutToggle.querySelectorAll<HTMLButtonElement>('button')) {
    btn.setAttribute('aria-checked', String(btn.dataset.layout === state.layout));
  }

  panelBtn.setAttribute('aria-pressed', String(state.panelOpen));
  loginBtn.textContent = state.loggedIn ? '로그아웃' : '로그인';
}

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = channelInput.value.trim();
  if (!input) return;
  api.send({ type: 'add-channel', input });
  channelInput.value = '';
});

layoutToggle.addEventListener('click', (e) => {
  const layout = (e.target as HTMLElement).closest('button')?.dataset.layout;
  if (layout === 'grid' || layout === 'focus') api.send({ type: 'set-layout', layout });
});

loginBtn.addEventListener('click', () =>
  api.send({ type: current?.loggedIn ? 'logout' : 'login' }),
);
panelBtn.addEventListener('click', () => api.send({ type: 'toggle-panel' }));
settingsBtn.addEventListener('click', () => api.send({ type: 'open-settings' }));

let noticeTimer = 0;
const defaultPlaceholder = channelInput.placeholder;
api.onNotice((message) => {
  channelInput.placeholder = message;
  channelInput.classList.add('error');
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    channelInput.placeholder = defaultPlaceholder;
    channelInput.classList.remove('error');
  }, Math.max(2500, message.length * 120));
});

api.onEditGroup((groupId) => {
  requestAnimationFrame(() => startEdit(groupId));
});

api.onState(render);
void api.getState().then((s) => s && render(s));
