import { BaseWindow, screen, WebContentsView, type WebContents } from 'electron';
import path from 'node:path';
import type { PanelTab } from '../shared/types';
import { GAP, type Rect } from '../core/layout';
import { openExternal } from './session';
import type { WindowState } from './store';

const TOOLBAR_HEIGHT = 44;
const PANEL_HEADER_HEIGHT = 88;
const RESIZE_HANDLE_WIDTH = 6;
const PANEL_MIN_WIDTH = 260;
export const PANEL_DEFAULT_WIDTH = 380;
const BG = '#141517';

export interface MainWindow {
  win: BaseWindow;
  toolbar: WebContentsView;
  panel: WebContentsView;
  grid: WebContentsView;
}

interface PanelLayout {
  open: boolean;
  width: number;
  tab: PanelTab;
}

function lockDownLocalView(wc: WebContents): void {
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

function createUiView(win: BaseWindow, name: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.setBackgroundColor(BG);
  lockDownLocalView(view.webContents);
  win.contentView.addChildView(view);
  void view.webContents.loadFile(path.join(__dirname, `../renderer/${name}/index.html`));
  return view;
}

function isOnScreen(s: WindowState): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(s.x + s.width, a.x + a.width) - Math.max(s.x, a.x);
    const h = Math.min(s.y + s.height, a.y + a.height) - Math.max(s.y, a.y);
    return w >= 200 && h >= 100;
  });
}

export function createMainWindow(saved: WindowState | null): MainWindow {
  const bounds = saved && isOnScreen(saved) ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1600, height: 900 };
  const win = new BaseWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    title: 'HLS Multiview',
    backgroundColor: BG,
  });

  if (saved?.maximized) win.maximize();
  return { win, grid: createUiView(win, 'grid'), toolbar: createUiView(win, 'toolbar'), panel: createUiView(win, 'panel') };
}

export function windowState(win: BaseWindow): WindowState {
  const b = win.getNormalBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
}

export function clampPanelWidth(win: BaseWindow, width: number): number {
  const [windowWidth] = win.getContentSize();
  return Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(width, windowWidth * 0.5)));
}

export function layoutChrome(
  { win, toolbar, panel, grid }: MainWindow,
  p: PanelLayout,
): { streams: Rect; chat: Rect | null } {
  const [width, height] = win.getContentSize();
  const bodyHeight = Math.max(0, height - TOOLBAR_HEIGHT);
  toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });

  panel.setVisible(p.open);
  const panelWidth = p.open ? clampPanelWidth(win, p.width) : 0;
  let chat: Rect | null = null;
  if (p.open) {
    const x = width - panelWidth;
    panel.setBounds({ x, y: TOOLBAR_HEIGHT, width: panelWidth, height: bodyHeight });
    if (p.tab === 'chat') {
      chat = {
        x: x + RESIZE_HANDLE_WIDTH,
        y: TOOLBAR_HEIGHT + PANEL_HEADER_HEIGHT,
        width: panelWidth - RESIZE_HANDLE_WIDTH,
        height: Math.max(0, bodyHeight - PANEL_HEADER_HEIGHT),
      };
    }
  }
  const streams = { x: 0, y: TOOLBAR_HEIGHT, width: Math.max(0, width - panelWidth - (p.open ? GAP : 0)), height: bodyHeight };
  grid.setBounds(streams);
  return { streams, chat };
}
