import { BrowserWindow, type BaseWindow } from 'electron';
import path from 'node:path';
import { openExternal } from './session';

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  constructor(private onWebContents: (wc: Electron.WebContents | null) => void) {}

  open(parent: BaseWindow): void {
    if (this.window) {
      this.window.focus();
      return;
    }
    const win = new BrowserWindow({
      parent,
      width: 440,
      height: 420,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: '설정',
      backgroundColor: '#141517',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/ui.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = win;
    const wc = win.webContents;
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.window = null;
      this.onWebContents(null);
    });
    this.onWebContents(wc);
    void wc.loadFile(path.join(__dirname, '../renderer/settings/index.html'));
  }
}
