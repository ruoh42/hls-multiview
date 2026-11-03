import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type TilesPayload, type UiCommand, type UiState } from '../shared/ipc';

const on =
  <T>(channel: string) =>
  (cb: (value: T) => void): void => {
    ipcRenderer.on(channel, (_e, value: T) => cb(value));
  };

const api = {
  getState: (): Promise<UiState> => ipcRenderer.invoke(IPC.getState),
  getTiles: (): Promise<TilesPayload> => ipcRenderer.invoke(IPC.getTiles),
  send: (cmd: UiCommand): void => ipcRenderer.send(IPC.command, cmd),
  onState: on<UiState>(IPC.state),
  onNotice: on<string>(IPC.notice),
  onEditGroup: on<string>(IPC.editGroup),
  onTiles: on<TilesPayload>(IPC.tiles),
};

contextBridge.exposeInMainWorld('chzzk', api);

export type ChzzkApi = typeof api;
