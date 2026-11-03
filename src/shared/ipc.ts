import type { Group, LayoutMode, PanelTab, Settings, StreamAction, StreamInfo, Tile, ViewScope } from './types';

export const IPC = {
  getState: 'ui:get-state',
  state: 'ui:state',
  command: 'ui:command',
  notice: 'ui:notice',
  tiles: 'ui:tiles',
  getTiles: 'ui:get-tiles',
  editGroup: 'ui:edit-group',
} as const;

export interface UiState {
  groups: Pick<Group, 'id' | 'name'>[];
  scope: ViewScope;
  layout: LayoutMode;
  loggedIn: boolean;
  streams: StreamInfo[];
  panelOpen: boolean;
  panelTab: PanelTab;
  chatChannel: string | null;
  settings: Settings;
}

export type TilesPayload = Tile[];

export type UiCommand =
  | { type: 'add-channel'; input: string }
  | { type: 'select-scope'; scope: ViewScope }
  | { type: 'set-layout'; layout: LayoutMode }
  | { type: 'stream'; action: StreamAction; channelId: string }
  | { type: 'player-problem'; channelId: string }
  | { type: 'toggle-panel' }
  | { type: 'panel-tab'; tab: PanelTab }
  | { type: 'select-chat'; channelId: string; open: boolean }
  | { type: 'set-settings'; settings: Partial<Settings> }
  | { type: 'panel-resize'; phase: 'start' | 'move' | 'end'; screenX: number }
  | { type: 'panel-reset-width' }
  | { type: 'new-group' }
  | { type: 'group-menu'; groupId: string }
  | { type: 'rename-group'; groupId: string; name: string }
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'open-settings' };
