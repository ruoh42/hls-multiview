import type { ChzzkApi } from '../../preload/ui';

declare global {
  interface Window {
    chzzk: ChzzkApi;
  }
}

export const api = window.chzzk;
