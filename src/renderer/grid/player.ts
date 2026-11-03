import Hls, { type ErrorData } from 'hls.js';
import type { TilesPayload, UiCommand } from '../../shared/ipc';
import type { StreamStatus, Tile } from '../../shared/types';

export interface GridOptions {
  container: HTMLElement;
  empty: HTMLElement;
  send: (cmd: UiCommand) => void;
  qualityScale?: number;
}

const TIERS = [144, 360, 480, 720, 1080];
const LONG_PRESS_MS = 500;

const NATIVE_HLS = !Hls.isSupported() && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

function tierFor(tileHeight: number, penalty: number, max: number): number {
  const base = tileHeight < 170 ? 0 : tileHeight < 330 ? 1 : tileHeight < 520 ? 2 : tileHeight < 760 ? 3 : 4;
  const tier = TIERS[Math.max(0, base - penalty)];
  return max > 0 ? Math.min(tier, max) : tier;
}

const MESSAGE: Partial<Record<StreamStatus, string>> = {
  loading: '불러오는 중…',
  offline: '방송 중이 아닙니다',
  restricted: '시청할 수 없는 방송입니다 (로그인 · 성인 인증 필요)',
  error: '방송 정보를 가져오지 못했습니다',
  sleeping: '휴면 중 · 클릭하면 재생',
};

const HLS_CONFIG = {
  enableWorker: false,
  maxBufferLength: 6,
  maxMaxBufferLength: 10,
  backBufferLength: 0,
  lowLatencyMode: true,
  liveSyncDurationCount: 2,
  maxLiveSyncPlaybackRate: 1.5,
} as const;

const NATIVE_MAX_LAG_S = 4;
const NATIVE_TARGET_LAG_S = 1.5;

const RETRY_BASE_MS = 2000;
const MAX_NETWORK_RETRIES = 3;
const STALL_MS = 15000;
const MAX_STALL_RESTARTS = 2;

class TilePlayer {
  readonly el = document.createElement('div');
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private message = document.createElement('div');
  private name = document.createElement('div');
  private sound = document.createElement('div');
  private tile!: Tile;
  private playingKey = '';
  private retries = 0;
  private mediaRecoveries = 0;
  private retryTimer = 0;
  private stallTimer = 0;
  private stallRestarts = 0;
  private longPressTimer = 0;
  private longPressed = false;

  constructor(
    tile: Tile,
    private opts: GridOptions,
  ) {
    this.el.className = 'tile';
    this.message.className = 'tile-message';
    this.name.className = 'tile-name';
    this.sound.className = 'tile-sound';
    this.sound.textContent = '🔊';
    this.el.append(this.message, this.name, this.sound);

    const send = opts.send;
    this.el.addEventListener('click', () => {
      if (this.longPressed) return void (this.longPressed = false);
      const t = this.tile;
      if (t.status === 'sleeping') send({ type: 'stream', action: 'wake', channelId: t.channelId });
      else if (t.promoteOnClick) send({ type: 'stream', action: 'promote', channelId: t.channelId });
      else send({ type: 'select-chat', channelId: t.channelId, open: false });
    });
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      send({ type: 'stream', action: 'menu', channelId: this.tile.channelId });
    });
    this.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.longPressed = false;
      clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => {
        this.longPressed = true;
        send({ type: 'stream', action: 'menu', channelId: this.tile.channelId });
      }, LONG_PRESS_MS);
    });
    const cancelLongPress = () => clearTimeout(this.longPressTimer);
    this.el.addEventListener('pointerup', cancelLongPress);
    this.el.addEventListener('pointercancel', cancelLongPress);
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4)) cancelLongPress();
    });
    this.update(tile);
  }

  update(tile: Tile): void {
    const prev = this.tile as Tile | undefined;
    this.tile = tile;
    Object.assign(this.el.style, {
      left: `${tile.x}px`,
      top: `${tile.y}px`,
      width: `${tile.width}px`,
      height: `${tile.height}px`,
    });
    this.el.dataset.status = tile.status;
    this.el.classList.toggle('is-main', tile.isMain);
    this.el.classList.toggle('selected', tile.selected);
    this.el.classList.toggle('is-tiny', tile.height < 80);
    this.name.textContent = tile.name ?? '';
    this.sound.hidden = tile.muted;

    const key = tile.status === 'live' && tile.url ? `${tile.url}#${tile.seq}` : '';
    if (key !== this.playingKey) {
      if (!key && prev?.status === 'live' && tile.status === 'sleeping') this.keepLastFrame();
      this.stop();
      if (key) this.start(tile.url!);
      this.playingKey = key;
    }
    if (tile.status !== 'sleeping') this.el.style.backgroundImage = '';

    this.message.textContent = tile.status === 'live' ? '' : (MESSAGE[tile.status] ?? '');
    if (this.video) this.video.muted = tile.muted;
    this.applyQuality();
  }

  destroy(): void {
    clearTimeout(this.longPressTimer);
    this.stop();
    this.el.remove();
  }

  private start(url: string): void {
    const video = document.createElement('video');
    video.muted = this.tile.muted;
    video.playsInline = true;
    video.autoplay = true;
    this.el.prepend(video);
    this.video = video;
    this.el.classList.add('buffering');
    this.watchStall();
    video.addEventListener('playing', () => {
      this.el.classList.remove('buffering');
      clearTimeout(this.stallTimer);
      this.stallRestarts = 0;
    });
    video.addEventListener('waiting', () => {
      this.el.classList.add('buffering');
      this.watchStall();
    });

    if (NATIVE_HLS) {
      video.addEventListener('error', () => this.video === video && this.report());
      video.addEventListener('timeupdate', () => {
        const r = video.seekable;
        if (r.length === 0) return;
        const edge = r.end(r.length - 1);
        if (edge - video.currentTime > NATIVE_MAX_LAG_S) video.currentTime = edge - NATIVE_TARGET_LAG_S;
      });
      video.src = url;
      void video.play().catch(() => {});
      return;
    }

    const hls = new Hls(HLS_CONFIG);
    this.hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.applyQuality(true);
      void video.play().catch(() => {});
    });
    hls.on(Hls.Events.FRAG_LOADED, () => {
      this.retries = 0;
    });
    hls.on(Hls.Events.ERROR, (_e, data) => this.onError(data));
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  private watchStall(): void {
    clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => {
      if (!this.video || !this.tile.url) return;
      if (this.stallRestarts >= MAX_STALL_RESTARTS) {
        this.stallRestarts = 0;
        this.report();
        return;
      }
      this.stallRestarts++;
      const url = this.tile.url;
      this.stop();
      this.start(url);
    }, STALL_MS);
  }

  private stop(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.stallTimer);
    this.hls?.destroy();
    this.hls = null;
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
      this.video.remove();
      this.video = null;
    }
    this.retries = 0;
    this.mediaRecoveries = 0;
    this.el.classList.remove('buffering');
  }

  private applyQuality(initial = false): void {
    const hls = this.hls;
    if (!hls || hls.levels.length === 0) return;
    const want = tierFor(this.tile.height * (this.opts.qualityScale ?? 1), this.tile.qualityPenalty, this.tile.maxQuality);
    let index = -1;
    hls.levels.forEach((level, i) => {
      if (level.height <= want && (index === -1 || level.height > hls.levels[index].height)) index = i;
    });
    if (index === -1) index = hls.levels.reduce((lo, l, i) => (l.height < hls.levels[lo].height ? i : lo), 0);
    if (initial) hls.currentLevel = index;
    else if (hls.nextLevel !== index && hls.currentLevel !== index) hls.nextLevel = index;
  }

  private onError(data: ErrorData): void {
    if (!data.fatal || !this.hls) return;
    const hls = this.hls;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      const code = data.response?.code ?? 0;
      if (code === 403 || code === 404 || this.retries >= MAX_NETWORK_RETRIES) {
        this.report();
        return;
      }
      this.retries++;
      this.retryTimer = window.setTimeout(() => hls.startLoad(), RETRY_BASE_MS * 2 ** (this.retries - 1));
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.mediaRecoveries < 2) {
      this.mediaRecoveries++;
      if (this.mediaRecoveries === 1) hls.recoverMediaError();
      else {
        hls.swapAudioCodec();
        hls.recoverMediaError();
      }
      return;
    }
    this.report();
  }

  private report(): void {
    this.stop();
    this.playingKey = 'stopped';
    this.message.textContent = '다시 연결하는 중…';
    this.opts.send({ type: 'player-problem', channelId: this.tile.channelId });
  }

  private keepLastFrame(): void {
    const video = this.video;
    if (!video || !video.videoWidth) return;
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 480 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      this.el.style.backgroundImage = `url("${canvas.toDataURL('image/jpeg', 0.7)}")`;
    } catch {}
  }
}

export function mountGrid(opts: GridOptions): (tiles: TilesPayload) => void {
  const players = new Map<string, TilePlayer>();
  return (tiles) => {
    const seen = new Set<string>();
    for (const tile of tiles) {
      seen.add(tile.channelId);
      const player = players.get(tile.channelId);
      if (player) player.update(tile);
      else {
        const p = new TilePlayer(tile, opts);
        players.set(tile.channelId, p);
        opts.container.append(p.el);
      }
    }
    for (const [id, player] of players) {
      if (!seen.has(id)) {
        player.destroy();
        players.delete(id);
      }
    }
    opts.empty.hidden = tiles.length > 0;
  };
}
