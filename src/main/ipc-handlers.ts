import { ipcMain } from 'electron';
import { IPC, type UiCommand } from '../shared/ipc';
import type { LayoutMode, StreamAction, ViewScope } from '../shared/types';
import { isChannelId } from '../core/channel';
import type { Controller } from './controller';
import { sanitizeSettings } from '../core/settings';

const LAYOUTS: readonly LayoutMode[] = ['grid', 'focus'];
const STREAM_ACTIONS: readonly StreamAction[] = ['mute', 'unmute', 'promote', 'reload', 'remove', 'wake', 'menu'];

function isScope(v: unknown): v is ViewScope {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.kind === 'all') return true;
  return (
    s.kind === 'groups' &&
    Array.isArray(s.groupIds) &&
    s.groupIds.length > 0 &&
    s.groupIds.every((id) => typeof id === 'string')
  );
}

function parseCommand(v: unknown): UiCommand | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  switch (c.type) {
    case 'add-channel':
      return typeof c.input === 'string' ? { type: 'add-channel', input: c.input } : null;
    case 'select-scope':
      return isScope(c.scope) ? { type: 'select-scope', scope: c.scope } : null;
    case 'set-layout':
      return LAYOUTS.includes(c.layout as LayoutMode)
        ? { type: 'set-layout', layout: c.layout as LayoutMode }
        : null;
    case 'stream':
      return STREAM_ACTIONS.includes(c.action as StreamAction) && typeof c.channelId === 'string' && isChannelId(c.channelId)
        ? { type: 'stream', action: c.action as StreamAction, channelId: c.channelId }
        : null;
    case 'player-problem':
      return typeof c.channelId === 'string' && isChannelId(c.channelId)
        ? { type: 'player-problem', channelId: c.channelId }
        : null;
    case 'panel-tab':
      return c.tab === 'list' || c.tab === 'chat' ? { type: 'panel-tab', tab: c.tab } : null;
    case 'select-chat':
      return typeof c.channelId === 'string' && isChannelId(c.channelId)
        ? { type: 'select-chat', channelId: c.channelId, open: c.open === true }
        : null;
    case 'set-settings':
      return { type: 'set-settings', settings: sanitizeSettings(c.settings) };
    case 'panel-resize':
      return (c.phase === 'start' || c.phase === 'move' || c.phase === 'end') && Number.isFinite(c.screenX)
        ? { type: 'panel-resize', phase: c.phase, screenX: c.screenX as number }
        : null;
    case 'group-menu':
      return typeof c.groupId === 'string' ? { type: 'group-menu', groupId: c.groupId } : null;
    case 'rename-group':
      return typeof c.groupId === 'string' && typeof c.name === 'string'
        ? { type: 'rename-group', groupId: c.groupId, name: c.name }
        : null;
    case 'toggle-panel':
    case 'panel-reset-width':
    case 'new-group':
    case 'login':
    case 'logout':
    case 'open-settings':
      return { type: c.type };
    default:
      return null;
  }
}

export function registerIpc(getController: () => Controller | null): void {
  ipcMain.handle(IPC.getState, (e) => {
    const c = getController();
    return c?.isAppUi(e.sender) ? c.uiState() : null;
  });

  ipcMain.handle(IPC.getTiles, (e) => {
    const c = getController();
    return c?.isAppUi(e.sender) ? c.tilesPayload() : [];
  });

  ipcMain.on(IPC.command, (e, raw: unknown) => {
    const c = getController();
    if (!c?.isAppUi(e.sender)) return;
    const cmd = parseCommand(raw);
    if (cmd) c.handle(cmd);
  });
}
