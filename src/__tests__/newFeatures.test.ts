import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncedClock } from '../syncedClock.js';
import { EventEmitter } from '../eventEmitter.js';
import { FilterEngine } from '../filterEngine.js';
import type { TransportAdapter, PingPayload, PongPayload, SyncConfig, SyncEventMap } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockAdapter = TransportAdapter & { triggerPong: (pong: PongPayload) => void };

function createMockAdapter(): MockAdapter {
  let pongCallback: ((payload: PongPayload) => void) | null = null;
  return {
    sendPing: vi.fn(),
    onPong(callback: (payload: PongPayload) => void): void {
      pongCallback = callback;
    },
    triggerPong(pong: PongPayload): void {
      pongCallback?.(pong);
    },
  };
}

function createConfig(overrides: Partial<SyncConfig> = {}): SyncConfig & { transportAdapter: MockAdapter } {
  const transportAdapter = createMockAdapter();
  return {
    syncIntervalMs: 1000,
    historySize: 8,
    outlierThreshold: 2,
    timeSlewRate: 10,
    transportAdapter,
    ...overrides,
  } as SyncConfig & { transportAdapter: MockAdapter };
}

function makePong(offsetMs = 100): PongPayload {
  // t0=0, t1=offsetMs, t2=offsetMs, t3=10 → offset ≈ offsetMs - 5
  return { t0: 0, t1: offsetMs, t2: offsetMs, t3: 10, id: 'p1' };
}

// ── EventEmitter ──────────────────────────────────────────────────────────────

describe('EventEmitter', () => {
  it('calls the registered listener when an event is emitted', () => {
    const emitter = new EventEmitter<{ ping: { value: number } }>();
    const cb = vi.fn();
    emitter.on('ping', cb);
    emitter.emit('ping', { value: 42 });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ value: 42 });
  });

  it('returns an unsubscribe function from on()', () => {
    const emitter = new EventEmitter<{ ping: { value: number } }>();
    const cb = vi.fn();
    const unsubscribe = emitter.on('ping', cb);
    unsubscribe();
    emitter.emit('ping', { value: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('off() removes a specific listener', () => {
    const emitter = new EventEmitter<{ ping: { value: number } }>();
    const cb = vi.fn();
    emitter.on('ping', cb);
    emitter.off('ping', cb);
    emitter.emit('ping', { value: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple listeners for the same event', () => {
    const emitter = new EventEmitter<{ ping: { value: number } }>();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    emitter.on('ping', cb1);
    emitter.on('ping', cb2);
    emitter.emit('ping', { value: 7 });
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('removeAllListeners() silences all events', () => {
    const emitter = new EventEmitter<{ ping: { value: number }; pong: { value: number } }>();
    const cb = vi.fn();
    emitter.on('ping', cb);
    emitter.on('pong', cb);
    emitter.removeAllListeners();
    emitter.emit('ping', { value: 1 });
    emitter.emit('pong', { value: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not throw when emitting an event with no listeners', () => {
    const emitter = new EventEmitter<{ ping: { value: number } }>();
    expect(() => emitter.emit('ping', { value: 1 })).not.toThrow();
  });
});

// ── FilterEngine.flush ────────────────────────────────────────────────────────

describe('FilterEngine.flush()', () => {
  it('empties the sample history', () => {
    const engine = new FilterEngine(10, 2);
    engine.push({ rtt: 20, offset: 50, timestamp: Date.now() });
    engine.push({ rtt: 22, offset: 55, timestamp: Date.now() });
    engine.flush();
    expect(engine.getHistory().length).toBe(0);
    expect(engine.getOptimalOffset()).toBe(0);
  });

  it('allows new samples after flush', () => {
    const engine = new FilterEngine(10, 2);
    engine.push({ rtt: 20, offset: 50, timestamp: Date.now() });
    engine.flush();
    engine.push({ rtt: 30, offset: 100, timestamp: Date.now() });
    expect(engine.getHistory().length).toBe(1);
    expect(engine.getOptimalOffset()).toBeCloseTo(100);
  });
});

// ── SyncedClock state machine ─────────────────────────────────────────────────

describe('SyncedClock state machine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts in UNSYNCED state', () => {
    const clock = new SyncedClock(createConfig());
    expect(clock.state).toBe('UNSYNCED');
  });

  it('transitions to SYNCING after start()', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();
    expect(clock.state).toBe('SYNCING');
    clock.stop();
  });

  it('transitions to SYNCED after receiving a pong', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();
    cfg.transportAdapter.triggerPong(makePong());
    expect(clock.state).toBe('SYNCED');
    clock.stop();
  });
});

// ── waitForInitialSync ────────────────────────────────────────────────────────

describe('SyncedClock.waitForInitialSync()', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves immediately when already SYNCED', async () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();
    cfg.transportAdapter.triggerPong(makePong());
    await expect(clock.waitForInitialSync()).resolves.toBeUndefined();
    clock.stop();
  });

  it('resolves after the first pong arrives', async () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();

    let resolved = false;
    const promise = clock.waitForInitialSync().then(() => { resolved = true; });

    expect(resolved).toBe(false);
    cfg.transportAdapter.triggerPong(makePong());
    await promise;
    expect(resolved).toBe(true);
    clock.stop();
  });

  it('resolves when destroy() is called while waiting', async () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();

    let resolved = false;
    const promise = clock.waitForInitialSync().then(() => { resolved = true; });

    clock.destroy();
    await promise;
    expect(resolved).toBe(true);
  });
});

// ── Events ────────────────────────────────────────────────────────────────────

describe('SyncedClock events', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits "sync_start" when a ping is sent', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    const handler = vi.fn();
    clock.events.on('sync_start', handler);
    clock.start();
    expect(handler).toHaveBeenCalledOnce();
    clock.stop();
  });

  it('emits "sync_success" when a pong is received', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    const handler = vi.fn<[SyncEventMap['sync_success']], void>();
    clock.events.on('sync_success', handler);
    clock.start();
    cfg.transportAdapter.triggerPong(makePong());
    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0];
    expect(typeof payload.offset).toBe('number');
    expect(typeof payload.rtt).toBe('number');
    clock.stop();
  });

  it('emits "drift_warning" when offset exceeds driftWarningThreshold', () => {
    const cfg = createConfig({ driftWarningThreshold: 50, timeSlewRate: 10000 });
    const clock = new SyncedClock(cfg);
    const handler = vi.fn();
    clock.events.on('drift_warning', handler);
    clock.start();
    // offset ≈ 495ms → exceeds 50ms threshold
    cfg.transportAdapter.triggerPong({ t0: 0, t1: 500, t2: 500, t3: 10, id: 'p1' });
    expect(handler).toHaveBeenCalledOnce();
    clock.stop();
  });

  it('does not emit "drift_warning" when offset is below threshold', () => {
    const cfg = createConfig({ driftWarningThreshold: 500 });
    const clock = new SyncedClock(cfg);
    const handler = vi.fn();
    clock.events.on('drift_warning', handler);
    clock.start();
    // offset ≈ 9ms (very small)
    cfg.transportAdapter.triggerPong({ t0: 0, t1: 10, t2: 10, t3: 2, id: 'p1' });
    expect(handler).not.toHaveBeenCalled();
    clock.stop();
  });

  it('emits "state_change" events when state transitions', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    const transitions: Array<{ from: string; to: string }> = [];
    clock.events.on('state_change', (e) => transitions.push(e));
    clock.start();
    cfg.transportAdapter.triggerPong(makePong());
    expect(transitions).toEqual([
      { from: 'UNSYNCED', to: 'SYNCING' },
      { from: 'SYNCING', to: 'SYNCED' },
    ]);
    clock.stop();
  });
});

// ── Sleep detection ───────────────────────────────────────────────────────────

describe('SyncedClock sleep detection', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits "sleep_detected" when interval fires much later than expected', () => {
    const cfg = createConfig({ syncIntervalMs: 1000, sleepDetectionThresholdMs: 5000 });
    const clock = new SyncedClock(cfg);
    const handler = vi.fn<[SyncEventMap['sleep_detected']], void>();
    clock.events.on('sleep_detected', handler);
    clock.start();

    // First interval fires normally — gap == 1000 ms, no sleep detected
    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();

    // Simulate a sleep/wake: jump the system clock forward 20 s without
    // firing any timers, then fire one interval tick.
    vi.setSystemTime(Date.now() + 20_000);
    vi.advanceTimersByTime(1000);

    expect(handler).toHaveBeenCalled();
    const payload = handler.mock.calls[0][0];
    expect(payload.gapMs).toBeGreaterThan(5000);
    clock.stop();
  });

  it('flushes sample history on sleep detection', () => {
    const cfg = createConfig({ syncIntervalMs: 1000, sleepDetectionThresholdMs: 5000 });
    const clock = new SyncedClock(cfg);
    clock.start();
    cfg.transportAdapter.triggerPong(makePong());
    cfg.transportAdapter.triggerPong(makePong(200));

    const flushSpy = vi.spyOn(FilterEngine.prototype, 'flush');

    // Normal tick first
    vi.advanceTimersByTime(1000);
    // Simulate sleep then wake
    vi.setSystemTime(Date.now() + 20_000);
    vi.advanceTimersByTime(1000);

    expect(flushSpy).toHaveBeenCalled();
    clock.stop();
  });

  it('uses 10 * syncIntervalMs as the default threshold', () => {
    const cfg = createConfig({ syncIntervalMs: 1000 }); // default threshold = 10_000 ms
    const clock = new SyncedClock(cfg);
    const handler = vi.fn();
    clock.events.on('sleep_detected', handler);
    clock.start();

    // First tick — normal gap
    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();

    // Jump just below the default threshold (9 s) — should NOT fire
    vi.setSystemTime(Date.now() + 8_999);
    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();

    // Normal tick resets _lastIntervalFire
    vi.advanceTimersByTime(1000);

    // Jump above the default threshold (11 s) — should fire
    vi.setSystemTime(Date.now() + 11_000);
    vi.advanceTimersByTime(1000);
    expect(handler).toHaveBeenCalled();
    clock.stop();
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('SyncedClock.destroy()', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops the sync interval', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();
    clock.destroy();
    const callsBeforeDestroy = (cfg.transportAdapter.sendPing as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(5000);
    // No additional pings should have been sent
    expect((cfg.transportAdapter.sendPing as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeDestroy);
  });

  it('flushes the sample history', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    clock.start();
    cfg.transportAdapter.triggerPong(makePong());
    const flushSpy = vi.spyOn(FilterEngine.prototype, 'flush');
    clock.destroy();
    expect(flushSpy).toHaveBeenCalled();
  });

  it('removes all event listeners', () => {
    const cfg = createConfig();
    const clock = new SyncedClock(cfg);
    const handler = vi.fn();
    clock.events.on('sync_start', handler);
    clock.destroy();
    // After destroy, emitting manually should not call the handler
    clock.events.emit('sync_start', { timestamp: Date.now() });
    expect(handler).not.toHaveBeenCalled();
  });

  it('calling destroy() multiple times does not throw', () => {
    const clock = new SyncedClock(createConfig());
    clock.start();
    expect(() => {
      clock.destroy();
      clock.destroy();
    }).not.toThrow();
  });
});
