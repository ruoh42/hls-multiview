import { Preferences } from '@capacitor/preferences';
import { isObj, parseCommonState, STATE_VERSION, type CommonState, type LoadedCommonState } from '../core/state';

const KEY = 'state';
const SAVE_DELAY_MS = 500;

export async function loadState(): Promise<LoadedCommonState> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    const raw: unknown = value ? JSON.parse(value) : null;
    return isObj(raw) && raw.version === STATE_VERSION ? parseCommonState(raw) : {};
  } catch {
    return {};
  }
}

export class StateSaver {
  private timer = 0;
  private pending: string | null = null;
  private lastWritten = '';

  schedule(state: CommonState): void {
    const json = JSON.stringify({ version: STATE_VERSION, ...state });
    if (json === this.lastWritten && !this.pending) return;
    this.pending = json;
    this.timer ||= window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = 0;
    const json = this.pending;
    if (!json) return;
    this.pending = null;
    try {
      await Preferences.set({ key: KEY, value: json });
      this.lastWritten = json;
    } catch (err) {
      console.error('[store] 저장 실패', err);
    }
  }
}
