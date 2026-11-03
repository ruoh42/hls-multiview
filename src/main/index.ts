import { app } from 'electron';
import { Controller } from './controller';
import { registerIpc } from './ipc-handlers';
import { setupChzzkSession } from './session';
import { loadState } from './store';
import { createMainWindow, type MainWindow } from './window';

let main: MainWindow | null = null;
let controller: Controller | null = null;

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!main) return;
    if (main.win.isMinimized()) main.win.restore();
    main.win.focus();
  });

  void app.whenReady().then(() => {
    setupChzzkSession();
    registerIpc(() => controller);
    const saved = loadState();
    main = createMainWindow(saved.window ?? null);
    controller = new Controller(main, saved);
    main.win.on('closed', () => {
      main = null;
      controller = null;
    });
  });

  app.on('window-all-closed', () => app.quit());
}
