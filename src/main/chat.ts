import { BrowserWindow, WebContentsView, type BaseWindow } from 'electron';
import type { Rect } from '../core/layout';
import { CHZZK_PARTITION, isNaverUrl, openExternal } from './session';

const chatUrl = (channelId: string) => `https://chzzk.naver.com/live/${channelId}/chat`;

export class ChatManager {
  private views = new Map<string, WebContentsView>();
  private recent: string[] = [];
  private active: string | null = null;
  private visible = false;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private keepAlive = 3;

  constructor(private win: BaseWindow) {}

  show(channelId: string | null): void {
    this.active = channelId;
    if (channelId) {
      if (!this.views.has(channelId)) this.views.set(channelId, this.create(channelId));
      this.recent = [channelId, ...this.recent.filter((id) => id !== channelId)];
      this.trim();
    }
    this.apply();
  }

  setKeepAlive(n: number): void {
    this.keepAlive = Math.max(1, n);
    this.trim();
  }

  private trim(): void {
    for (const id of this.recent.slice(this.keepAlive)) if (id !== this.active) this.close(id);
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
    for (const id of [...this.views.keys()]) if (!channelIds.includes(id)) this.close(id);
    if (this.active && !channelIds.includes(this.active)) this.active = null;
    this.apply();
  }

  reloadAll(): void {
    for (const view of this.views.values()) view.webContents.reload();
  }

  private apply(): void {
    for (const [id, view] of this.views) {
      const show = this.visible && id === this.active;
      view.setVisible(show);
      if (show) view.setBounds(this.bounds);
    }
  }

  private create(channelId: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: CHZZK_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#141517');
    const wc = view.webContents;
    wc.setAudioMuted(true);
    const home = chatUrl(channelId);

    wc.on('will-navigate', (e) => {
      if (!e.url.startsWith(home)) {
        e.preventDefault();
        openExternal(e.url);
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (!isNaverUrl(url)) {
        openExternal(url);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.win as BrowserWindow,
          autoHideMenuBar: true,
          webPreferences: { partition: CHZZK_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    });

    view.setVisible(false);
    this.win.contentView.addChildView(view);
    void wc.loadURL(home);
    return view;
  }

  private close(channelId: string): void {
    const view = this.views.get(channelId);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(channelId);
    this.recent = this.recent.filter((id) => id !== channelId);
  }
}
