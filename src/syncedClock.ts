import type { SyncConfig, SyncSample, PongPayload, PingPayload } from './types.js';
import { calculateRTT, calculateOffset, filterOutliers, calculateMean } from './timeMath.js';

export class SyncedClock {
  private readonly _config: SyncConfig;
  private readonly _samples: SyncSample[] = [];
  private _offset: number = 0;
  private _targetOffset: number = 0;
  private _lastNow: number = 0;
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _msgCounter: number = 0;

  constructor(config: SyncConfig) {
    this._config = config;
    config.transportAdapter.onPong((pong) => this._handlePong(pong));
  }

  now(): number {
    const real = Date.now();
    const slew = Math.min(
      Math.abs(this._targetOffset - this._offset),
      this._config.timeSlewRate,
    ) * Math.sign(this._targetOffset - this._offset);
    this._offset += slew;
    const candidate = real + this._offset;
    if (candidate <= this._lastNow) {
      return this._lastNow;
    }
    this._lastNow = candidate;
    return this._lastNow;
  }

  performanceNow(): number {
    return performance.now() + this._offset;
  }

  start(): void {
    if (this._intervalId !== null) return;
    this._sendPing();
    this._intervalId = setInterval(() => {
      this._applySlew();
      this._sendPing();
    }, this._config.syncIntervalMs);
  }

  stop(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  private _sendPing(): void {
    const id = `ping-${++this._msgCounter}`;
    const payload: PingPayload = { t0: Date.now(), id };
    this._config.transportAdapter.sendPing(payload);
  }

  private _applySlew(): void {
    const diff = this._targetOffset - this._offset;
    const slew = Math.min(Math.abs(diff), this._config.timeSlewRate) * Math.sign(diff);
    this._offset += slew;
  }

  private _handlePong(pong: PongPayload): void {
    const rtt = calculateRTT(pong.t0, pong.t1, pong.t2, pong.t3);
    const offset = calculateOffset(pong.t0, pong.t1, pong.t2, pong.t3);

    const sample: SyncSample = {
      rtt,
      offset,
      timestamp: Date.now(),
    };

    this._samples.push(sample);
    if (this._samples.length > this._config.historySize) {
      this._samples.shift();
    }

    const offsets = this._samples.map((s) => s.offset);
    const filtered = filterOutliers(offsets, this._config.outlierThreshold);
    if (filtered.length > 0) {
      this._targetOffset = calculateMean(filtered);
    }
  }
}
