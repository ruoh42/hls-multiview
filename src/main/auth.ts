import { BrowserWindow, session, type BaseWindow } from 'electron';
import { CHZZK_PARTITION, isNaverUrl, openExternal } from './session';

const HOME = 'https://chzzk.naver.com/';
const LOGIN_URL = `https://nid.naver.com/nidlogin.login?url=${encodeURIComponent(HOME)}`;
const LOGIN_COOKIE = 'NID_AUT';

export class Auth {
  loggedIn = false;
  private window: BrowserWindow | null = null;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(private onChange: (loggedIn: boolean, persistent: boolean) => void) {
    const ses = session.fromPartition(CHZZK_PARTITION);
    ses.cookies.on('changed', (_e, cookie) => {
      if (cookie.name === LOGIN_COOKIE) this.scheduleCheck();
    });
    void this.check();
  }

  openLoginWindow(parent: BaseWindow): void {
    if (this.window) {
      this.window.focus();
      return;
    }
    const win = new BrowserWindow({
      parent,
      width: 960,
      height: 760,
      title: '치지직 로그인',
      autoHideMenuBar: true,
      webPreferences: {
        partition: CHZZK_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = win;
    win.on('closed', () => (this.window = null));

    const wc = win.webContents;
    wc.on('will-navigate', (e) => {
      if (!isNaverUrl(e.url)) {
        e.preventDefault();
        openExternal(e.url);
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (isNaverUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true } };
      openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-navigate', (_e, url) => {
      if (this.loggedIn && new URL(url).hostname === 'chzzk.naver.com') setTimeout(() => win.close(), 800);
    });

    void wc.loadURL(LOGIN_URL);
  }

  async logout(): Promise<void> {
    const ses = session.fromPartition(CHZZK_PARTITION);
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    });
    await this.check();
  }

  private scheduleCheck(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.check(), 300);
  }

  private async check(): Promise<void> {
    this.checkTimer = null;
    const cookies = await session.fromPartition(CHZZK_PARTITION).cookies.get({ name: LOGIN_COOKIE });
    const login = cookies.filter((c) => c.domain?.endsWith('naver.com'));
    const loggedIn = login.length > 0;
    if (loggedIn === this.loggedIn) return;
    this.loggedIn = loggedIn;
    this.onChange(loggedIn, login.some((c) => !c.session));
    if (loggedIn && this.window && new URL(this.window.webContents.getURL() || HOME).hostname === 'chzzk.naver.com') {
      setTimeout(() => this.window?.close(), 800);
    }
  }
}
