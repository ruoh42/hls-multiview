import type { StreamInfo, StreamStatus } from '../../shared/types';

export const STATUS_LABEL: Record<StreamStatus, string> = {
  live: 'LIVE',
  offline: '오프라인',
  loading: '로딩',
  restricted: '제한',
  error: '오류',
  sleeping: '휴면',
};

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
export const ICON = {
  soundOn: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  soundOff: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
  main: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M15 12h6"/>'),
  reload: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

export const displayName = (s: Pick<StreamInfo, 'name' | 'channelId'>) => s.name ?? s.channelId.slice(0, 8) + '…';

export function tabButton(label: string, pressed: boolean, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute('aria-pressed', String(pressed));
  btn.addEventListener('click', onClick);
  return btn;
}

export function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = icon;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function streamText(s: StreamInfo, badgeStatus: string, badgeLabel: string): HTMLDivElement {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.dataset.status = badgeStatus;
  badge.textContent = badgeLabel;
  const nameText = document.createElement('span');
  nameText.textContent = displayName(s);
  const name = document.createElement('div');
  name.className = 'stream-name';
  name.append(badge, nameText);
  const title = document.createElement('div');
  title.className = 'stream-title';
  title.textContent = s.title ?? '';
  title.title = s.title ?? '';
  const text = document.createElement('div');
  text.className = 'stream-text';
  text.append(name, title);
  return text;
}

export function chatTab(s: StreamInfo, selected: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', String(selected));
  btn.dataset.status = s.status;
  btn.textContent = displayName(s);
  btn.title = s.title ?? '';
  btn.addEventListener('click', onClick);
  return btn;
}

export function soundButton(s: StreamInfo, onClick: () => void): HTMLButtonElement {
  const btn = iconButton(s.muted ? ICON.soundOff : ICON.soundOn, s.muted ? '소리 켜기' : '소리 끄기', onClick);
  btn.setAttribute('aria-pressed', String(!s.muted));
  return btn;
}
