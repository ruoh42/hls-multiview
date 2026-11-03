import type { Rect } from '../core/layout';
import { ChzzkNative } from './native';

const chatUrl = (channelId: string) => `https://chzzk.naver.com/live/${channelId}/chat`;

export class ChatManager {
  private open = new Set<string>();
  private recent: string[] = [];
  private active: string | null = null;
  private visible = false;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private keepAlive = 3;
  private lastShown = '';

  show(channelId: string | null): void {
    this.active = channelId;
    if (channelId) {
      if (!this.open.has(channelId)) {
        this.open.add(channelId);
        void ChzzkNative.chatOpen({ id: channelId, url: chatUrl(channelId) });
      }
      this.recent = [channelId, ...this.recent.filter((id) => id !== channelId)];
      this.trim();
    }
    this.apply();
  }

  setKeepAlive(n: number): void {
    this.keepAlive = Math.max(1, n);
    this.trim();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.apply();
  }

  setBounds(bounds: Rect): void {
    this.bounds = bounds;
    this.apply();
  }

  retain(channelIds: string[]): void {
    for (const id of [...this.open]) if (!channelIds.includes(id)) this.close(id);
    if (this.active && !channelIds.includes(this.active)) this.active = null;
    this.apply();
  }

  reloadAll(): void {
    void ChzzkNative.chatReloadAll();
  }

  private trim(): void {
    for (const id of this.recent.slice(this.keepAlive)) if (id !== this.active) this.close(id);
  }

  private close(channelId: string): void {
    if (!this.open.delete(channelId)) return;
    this.recent = this.recent.filter((id) => id !== channelId);
    void ChzzkNative.chatClose({ id: channelId });
  }

  private apply(): void {
    const id = this.visible && this.bounds.width > 0 && this.bounds.height > 0 ? this.active : null;
    const b = this.bounds;
    const key = id ? `${id}@${b.x},${b.y},${b.width},${b.height}` : '';
    if (key === this.lastShown) return;
    this.lastShown = key;
    void ChzzkNative.chatShow({ id, ...b });
  }
}
