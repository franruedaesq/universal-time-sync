import type {
  SyncConfig,
  SyncSample,
  PongPayload,
  PingPayload,
  SyncState,
  SyncEventMap,
} from './types.js';
import { calculateRTT, calculateOffset } from './timeMath.js';
import { FilterEngine } from './filterEngine.js';
import { SlewEngine } from './slewEngine.js';
import { EventEmitter } from './eventEmitter.js';

/** Default offset magnitude (ms) above which a `"drift_warning"` event is emitted. */
const DEFAULT_DRIFT_WARNING_THRESHOLD_MS = 500;

/**
 * A high-level clock that synchronises its `now()` value with a remote time
 * server using NTP-style mathematics.
 *
 * Typical usage:
 * ```ts
 * const clock = new SyncedClock({ ...config });
 * clock.start();
 * await clock.waitForInitialSync();
 * console.log(clock.now()); // accurate, server-relative timestamp
 * ```
 *
 * @see {@link SyncConfig} for all configuration options.
 * @see {@link SyncEventMap} for all observable lifecycle events.
 */
export class SyncedClock {
  private readonly _config: SyncConfig;
  private readonly _filterEngine: FilterEngine;
  private readonly _slewEngine: SlewEngine;
  private _offset: number = 0;
  private _targetOffset: number = 0;
  private _lastNow: number = 0;
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _msgCounter: number = 0;

  // ── State machine ──────────────────────────────────────────────────────────
  private _state: SyncState = 'UNSYNCED';
  private _syncedResolvers: Array<() => void> = [];

  // ── Sleep detection ────────────────────────────────────────────────────────
  private _lastIntervalFire: number = 0;

  // ── Browser visibility ─────────────────────────────────────────────────────
  private _visibilityHandler: (() => void) | null = null;

  /**
   * Observable event emitter.  Subscribe to lifecycle events using
   * `clock.events.on(eventName, callback)`.
   *
   * @example
   * ```ts
   * clock.events.on('sync_success', ({ offset }) => console.log('offset:', offset));
   * clock.events.on('drift_warning', ({ offset }) => alert(`Drift: ${offset}ms`));
   * ```
   */
  readonly events: EventEmitter<SyncEventMap> = new EventEmitter();

  /**
   * @param config - Full configuration for the sync clock.
   */
  constructor(config: SyncConfig) {
    this._config = config;
    this._filterEngine = new FilterEngine(config.historySize, config.outlierThreshold);
    this._slewEngine = new SlewEngine();
    config.transportAdapter.onPong((pong) => this._handlePong(pong));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the current synced wall-clock time in milliseconds since the Unix
   * epoch, analogous to `Date.now()`.
   *
   * Guarantees:
   * - **Monotonic** — the return value never decreases between calls.
   * - **Slewed** — large offset corrections are applied gradually at most
   *   `timeSlewRate` ms per call, preventing backwards jumps.
   *
   * Before the first sync completes the method returns an un-corrected
   * `Date.now()`.  Use {@link waitForInitialSync} if you need a guaranteed
   * offset-corrected value.
   *
   * @returns Milliseconds since the Unix epoch.
   */
  now(): number {
    const real = Date.now();
    const slew =
      Math.min(Math.abs(this._targetOffset - this._offset), this._config.timeSlewRate) *
      Math.sign(this._targetOffset - this._offset);
    this._offset += slew;
    const candidate = real + this._offset;
    if (candidate <= this._lastNow) {
      return this._lastNow;
    }
    this._lastNow = candidate;
    return this._lastNow;
  }

  /**
   * Returns the current slewed time sourced from `performance.now()` — useful
   * when sub-millisecond monotonic precision matters more than an absolute
   * wall-clock timestamp.
   *
   * @returns Milliseconds since the performance origin.
   */
  performanceNow(): number {
    return this._slewEngine.now();
  }

  /**
   * The current synchronisation state.
   *
   * - `"UNSYNCED"` — no sync round-trip has completed.
   * - `"SYNCING"` — a ping has been sent; waiting for the first pong.
   * - `"SYNCED"` — at least one pong has been received and the offset applied.
   */
  get state(): SyncState {
    return this._state;
  }

  /**
   * Returns a `Promise` that resolves as soon as the clock transitions to the
   * `"SYNCED"` state.  If the clock is already synced the promise resolves
   * immediately on the next microtask.
   *
   * @returns A promise that resolves (with no value) once the initial sync is
   *   complete.
   *
   * @example
   * ```ts
   * clock.start();
   * await clock.waitForInitialSync();
   * displayTime(clock.now()); // guaranteed to carry a server offset
   * ```
   */
  waitForInitialSync(): Promise<void> {
    if (this._state === 'SYNCED') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._syncedResolvers.push(resolve);
    });
  }

  /**
   * Starts the periodic sync loop.  An initial ping is sent immediately, then
   * subsequent pings fire every `syncIntervalMs` milliseconds.
   *
   * Calling `start()` on an already-running clock is a no-op.
   */
  start(): void {
    if (this._intervalId !== null) return;

    this._lastIntervalFire = Date.now();
    this._sendPing();

    this._intervalId = setInterval(() => {
      this._checkForSleep();
      this._applySlew();
      this._sendPing();
    }, this._config.syncIntervalMs);

    // Browser: re-sync immediately when the tab becomes visible again.
    if (typeof document !== 'undefined') {
      this._visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this._sendPing();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  /**
   * Pauses the periodic sync loop without releasing resources.  The clock
   * retains its current offset and sample history.  Call {@link start} to
   * resume.
   *
   * To fully release all resources (intervals, listeners, history) use
   * {@link destroy} instead.
   */
  stop(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Fully tears down the clock, releasing every resource it holds:
   * - Clears the sync interval (equivalent to calling {@link stop}).
   * - Removes the `visibilitychange` DOM event listener (browser only).
   * - Flushes the sample history array.
   * - Removes all event-emitter listeners registered on `clock.events`.
   * - Resolves any pending {@link waitForInitialSync} promises immediately.
   *
   * After `destroy()` the instance should be discarded.  Calling any method on
   * a destroyed clock produces undefined behaviour.
   */
  destroy(): void {
    this.stop();

    if (typeof document !== 'undefined' && this._visibilityHandler !== null) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    this._filterEngine.flush();

    // Resolve any pending waitForInitialSync promises so callers are not
    // left hanging after the clock is destroyed.
    for (const resolve of this._syncedResolvers) {
      resolve();
    }
    this._syncedResolvers = [];

    this.events.removeAllListeners();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _transitionState(next: SyncState): void {
    if (this._state === next) return;
    const from = this._state;
    this._state = next;
    this.events.emit('state_change', { from, to: next });

    if (next === 'SYNCED') {
      for (const resolve of this._syncedResolvers) {
        resolve();
      }
      this._syncedResolvers = [];
    }
  }

  private _sendPing(): void {
    const id = `ping-${++this._msgCounter}`;
    const payload: PingPayload = { t0: Date.now(), id };
    this.events.emit('sync_start', { timestamp: payload.t0 });
    if (this._state === 'UNSYNCED') {
      this._transitionState('SYNCING');
    }
    this._config.transportAdapter.sendPing(payload);
  }

  private _applySlew(): void {
    const diff = this._targetOffset - this._offset;
    const slew = Math.min(Math.abs(diff), this._config.timeSlewRate) * Math.sign(diff);
    this._offset += slew;
  }

  /**
   * Detects a system sleep/wake cycle by comparing the wall-clock gap between
   * interval fires to the configured `syncIntervalMs`.  When the gap exceeds
   * `sleepDetectionThresholdMs` the sample history is flushed and a
   * `"sleep_detected"` event is emitted.
   */
  private _checkForSleep(): void {
    const now = Date.now();
    const gapMs = now - this._lastIntervalFire;
    const threshold =
      this._config.sleepDetectionThresholdMs ?? this._config.syncIntervalMs * 10;

    if (gapMs > threshold) {
      this._filterEngine.flush();
      this.events.emit('sleep_detected', { gapMs, timestamp: now });
    }
    this._lastIntervalFire = now;
  }

  private _handlePong(pong: PongPayload): void {
    const rtt = calculateRTT(pong.t0, pong.t1, pong.t2, pong.t3);
    const offset = calculateOffset(pong.t0, pong.t1, pong.t2, pong.t3);

    const sample: SyncSample = {
      rtt,
      offset,
      timestamp: Date.now(),
    };

    this._filterEngine.push(sample);
    this._targetOffset = this._filterEngine.getOptimalOffset();
    this._slewEngine.setTargetOffset(this._targetOffset);

    const now = Date.now();
    this.events.emit('sync_success', { offset: this._targetOffset, rtt, timestamp: now });

    const driftThreshold =
      this._config.driftWarningThreshold ?? DEFAULT_DRIFT_WARNING_THRESHOLD_MS;
    if (Math.abs(this._targetOffset) > driftThreshold) {
      this.events.emit('drift_warning', {
        offset: this._targetOffset,
        threshold: driftThreshold,
        timestamp: now,
      });
    }

    this._transitionState('SYNCED');
  }
}
