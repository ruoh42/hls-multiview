import type { UiState } from '../../shared/ipc';
import type { Settings } from '../../shared/types';
import { api } from '../common/api';

const form = document.getElementById('form') as HTMLFormElement;
const field = <T extends HTMLElement>(name: keyof Settings) => form.elements.namedItem(name) as T;

const audioFollowsChat = field<HTMLInputElement>('audioFollowsChat');
const autoDegrade = field<HTMLInputElement>('autoDegrade');
const maxQuality = field<HTMLSelectElement>('maxQuality');
const chatKeepAlive = field<HTMLInputElement>('chatKeepAlive');

function render({ settings }: UiState) {
  audioFollowsChat.checked = settings.audioFollowsChat;
  autoDegrade.checked = settings.autoDegrade;
  maxQuality.value = String(settings.maxQuality);
  if (document.activeElement !== chatKeepAlive) chatKeepAlive.value = String(settings.chatKeepAlive);
}

form.addEventListener('change', () => {
  api.send({
    type: 'set-settings',
    settings: {
      audioFollowsChat: audioFollowsChat.checked,
      autoDegrade: autoDegrade.checked,
      maxQuality: Number(maxQuality.value) as Settings['maxQuality'],
      chatKeepAlive: Math.round(Number(chatKeepAlive.value)),
    },
  });
});
form.addEventListener('submit', (e) => e.preventDefault());

api.onState(render);
void api.getState().then((s) => s && render(s));
