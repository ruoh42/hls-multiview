import type { Group, PanelTab, Settings, ViewScope } from '../shared/types';
import { isChannelId } from './channel';
import type { GroupsSnapshot } from './groups';
import { sanitizeSettings } from './settings';

export const STATE_VERSION = 1;

interface PanelState {
  open: boolean;
  width: number;
  tab: PanelTab;
}

export interface CommonState extends GroupsSnapshot {
  panel: PanelState;
  chatChannel: string | null;
  settings: Settings;
}

export interface LoadedCommonState extends Partial<Omit<CommonState, 'settings'>> {
  settings?: Partial<Settings>;
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
export const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseGroups(v: unknown): Group[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const groups: Group[] = [];
  for (const g of v) {
    if (!isObj(g) || typeof g.id !== 'string' || typeof g.name !== 'string' || seen.has(g.id)) continue;
    seen.add(g.id);
    const channelIds = Array.isArray(g.channelIds)
      ? [...new Set(g.channelIds.filter((id): id is string => typeof id === 'string' && isChannelId(id)))]
      : [];
    groups.push({ id: g.id, name: g.name.slice(0, 30) || '그룹', channelIds });
  }
  return groups;
}

function parseScope(v: unknown): ViewScope {
  if (isObj(v) && v.kind === 'groups' && Array.isArray(v.groupIds)) {
    const ids = v.groupIds.filter((id): id is string => typeof id === 'string');
    if (ids.length) return { kind: 'groups', groupIds: ids };
  }
  return { kind: 'all' };
}

export function parseCommonState(raw: Record<string, unknown>): LoadedCommonState {
  const panel = isObj(raw.panel) ? raw.panel : {};
  const chatChannel = typeof raw.chatChannel === 'string' && isChannelId(raw.chatChannel) ? raw.chatChannel : null;
  const mainChannel = typeof raw.mainChannel === 'string' && isChannelId(raw.mainChannel) ? raw.mainChannel : null;
  return {
    groups: parseGroups(raw.groups),
    scope: parseScope(raw.scope),
    layout: raw.layout === 'focus' ? 'focus' : 'grid',
    mainChannel,
    panel: {
      open: panel.open !== false,
      width: num(panel.width) ? panel.width : 0,
      tab: panel.tab === 'chat' ? 'chat' : 'list',
    },
    chatChannel,
    settings: sanitizeSettings(raw.settings),
  };
}
