import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isObj, num, parseCommonState, STATE_VERSION, type CommonState, type LoadedCommonState } from '../core/state';

const SAVE_DELAY_MS = 500;

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface LoadedState extends LoadedCommonState {
  window?: WindowState | null;
}

interface SavedState extends CommonState {
  window: WindowState | null;
}

const file = () => path.join(app.getPath('userData'), 'state.json');

function parseWindow(v: unknown): WindowState | null {
  if (!isObj(v) || !num(v.x) || !num(v.y) || !num(v.width) || !num(v.height)) return null;
  if (v.width < 400 || v.height < 300) return null;
  return { x: v.x, y: v.y, width: v.width, height: v.height, maximized: v.maximized === true };
}

export function loadState(): LoadedState {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
  if (!isObj(raw) || raw.version !== STATE_VERSION) return {};
  return { ...parseCommonState(raw), window: parseWindow(raw.window) };
}

export class StateSaver {
  private timer: NodeJS.Timeout | null = null;
  private pending: string | null = null;
  private lastWritten = '';

  schedule(state: SavedState): void {
    const json = JSON.stringify({ version: STATE_VERSION, ...state }, null, 2);
    if (json === this.lastWritten && !this.pending) return;
    this.pending = json;
    this.timer ??= setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const target = file();
    const tmp = target + '.tmp';
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(tmp, this.pending);
      renameSync(tmp, target);
      this.lastWritten = this.pending;
      this.pending = null;
    } catch (err) {
      console.error('[store] 저장 실패', err);
    }
  }
}
