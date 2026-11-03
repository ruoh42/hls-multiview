export type LayoutMode = 'grid' | 'focus';

export type PanelTab = 'list' | 'chat';

export interface Settings {
  audioFollowsChat: boolean;
  autoDegrade: boolean;
  maxQuality: 0 | 1080 | 720 | 480 | 360;
  chatKeepAlive: number;
}

export const DEFAULT_SETTINGS: Settings = {
  audioFollowsChat: true,
  autoDegrade: true,
  maxQuality: 0,
  chatKeepAlive: 3,
};

export const QUALITY_OPTIONS = [0, 1080, 720, 480, 360] as const;
export const CHAT_KEEP_ALIVE_RANGE = { min: 1, max: 10 } as const;

export interface Group {
  id: string;
  name: string;
  channelIds: string[];
}

export type ViewScope = { kind: 'all' } | { kind: 'groups'; groupIds: string[] };

export type StreamStatus = 'loading' | 'live' | 'offline' | 'restricted' | 'error' | 'sleeping';

export interface StreamInfo {
  channelId: string;
  name: string | null;
  title: string | null;
  status: StreamStatus;
  muted: boolean;
  isMain: boolean;
}

export type StreamAction = 'mute' | 'unmute' | 'promote' | 'reload' | 'remove' | 'wake' | 'menu';

export interface Tile {
  channelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string | null;
  status: StreamStatus;
  url: string | null;
  seq: number;
  muted: boolean;
  isMain: boolean;
  selected: boolean;
  promoteOnClick: boolean;
  qualityPenalty: number;
  maxQuality: number;
}
