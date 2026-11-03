import { app } from 'electron';
import { execFile } from 'node:child_process';
import os from 'node:os';

export type Pressure = 'high' | 'normal' | 'low';

export interface ResourceSample {
  memAvailablePct: number;
  memPressureLevel: number;
  cpuPct: number;
}

const SAMPLE_MS = 5000;
const HIGH = { memAvailablePct: 15, cpuPct: 75 };
const LOW = { memAvailablePct: 30, cpuPct: 50 };
const CPU_HIGH_STREAK = 2;

function sysctl(name: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('sysctl', ['-n', name], (err, out) => resolve(err ? null : Number(out.trim())));
  });
}

async function memoryStatus(): Promise<{ availablePct: number; pressureLevel: number }> {
  if (process.platform === 'darwin') {
    const [level, pressure] = await Promise.all([
      sysctl('kern.memorystatus_level'),
      sysctl('kern.memorystatus_vm_pressure_level'),
    ]);
    if (level !== null) return { availablePct: level, pressureLevel: pressure ?? 1 };
  }
  const info = process.getSystemMemoryInfo();
  const available = (info as { available?: number }).available ?? info.free;
  return { availablePct: (available / info.total) * 100, pressureLevel: 1 };
}

export class ResourceMonitor {
  private cpuHighStreak = 0;
  private timer: NodeJS.Timeout;

  constructor(private onSample: (pressure: Pressure, sample: ResourceSample) => void) {
    this.timer = setInterval(() => void this.tick(), SAMPLE_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const cores = os.cpus().length || 1;
    const cpuTotal = app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    const mem = await memoryStatus();
    const sample: ResourceSample = {
      memAvailablePct: Math.round(mem.availablePct),
      memPressureLevel: mem.pressureLevel,
      cpuPct: Math.round(cpuTotal / cores),
    };
    this.cpuHighStreak = sample.cpuPct > HIGH.cpuPct ? this.cpuHighStreak + 1 : 0;
    const high =
      sample.memAvailablePct < HIGH.memAvailablePct ||
      sample.memPressureLevel >= 4 ||
      this.cpuHighStreak >= CPU_HIGH_STREAK;
    const low =
      sample.memAvailablePct > LOW.memAvailablePct && sample.memPressureLevel < 4 && sample.cpuPct < LOW.cpuPct;

    this.onSample(high ? 'high' : low ? 'low' : 'normal', sample);
  }
}
