import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Rect } from '../core/layout';

export interface AuthState {
  loggedIn: boolean;
  persistent: boolean | null;
}

export interface ChzzkNativePlugin {
  fetchText(options: { url: string }): Promise<{ status: number; text: string }>;
  chatOpen(options: { id: string; url: string }): Promise<void>;
  chatShow(options: { id: string | null } & Rect): Promise<void>;
  chatClose(options: { id: string }): Promise<void>;
  chatReloadAll(): Promise<void>;
  authState(): Promise<AuthState>;
  login(options: { url: string }): Promise<void>;
  logout(): Promise<void>;
  addListener(event: 'auth', cb: (state: AuthState) => void): Promise<PluginListenerHandle>;
}

class ChzzkNativeWeb extends WebPlugin {
  async fetchText({ url }: { url: string }) {
    const res = await fetch(url);
    return { status: res.status, text: await res.text() };
  }
  async chatOpen() {}
  async chatShow() {}
  async chatClose() {}
  async chatReloadAll() {}
  async authState(): Promise<AuthState> {
    return { loggedIn: false, persistent: null };
  }
  async login() {}
  async logout() {}
}

export const ChzzkNative = registerPlugin<ChzzkNativePlugin>('ChzzkNative', { web: () => new ChzzkNativeWeb() });
