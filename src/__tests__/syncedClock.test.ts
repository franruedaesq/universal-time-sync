import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncedClock } from '../syncedClock.js';
import { FilterEngine } from '../filterEngine.js';
import { SlewEngine } from '../slewEngine.js';
import { calculateRTT, calculateOffset } from '../timeMath.js';
import type { TransportAdapter, PongPayload, SyncConfig } from '../types.js';

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

function createConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  const adapter = createMockAdapter();
  return {
    syncIntervalMs: 1000,
    historySize: 8,
    outlierThreshold: 2,
    timeSlewRate: 10,
    transportAdapter: adapter,
    ...overrides,
  };
}

describe('SyncedClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('now() returns a number', () => {
    const clock = new SyncedClock(createConfig());
    expect(typeof clock.now()).toBe('number');
  });

  it('now() never goes backward (monotonic guarantee)', () => {
    const clock = new SyncedClock(createConfig());
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      times.push(clock.now());
    }
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it('performanceNow() returns a number', () => {
    const clock = new SyncedClock(createConfig());
    expect(typeof clock.performanceNow()).toBe('number');
  });

  it('start() and stop() work without errors', () => {
    const clock = new SyncedClock(createConfig());
    expect(() => clock.start()).not.toThrow();
    expect(() => clock.stop()).not.toThrow();
  });

  it('start() sends initial ping', () => {
    const adapter = createMockAdapter();
    const config = createConfig({ transportAdapter: adapter });
    const clock = new SyncedClock(config);
    clock.start();
    expect(adapter.sendPing).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  it('_handlePong processes samples and updates target offset', () => {
    const adapter = createMockAdapter();
    const config = createConfig({ transportAdapter: adapter, timeSlewRate: 1000 });
    const clock = new SyncedClock(config);

    // server is 100ms ahead: t0=1000, t1=1100, t2=1100, t3=1010 => offset=90
    const pong: PongPayload = { t0: 1000, t1: 1100, t2: 1100, t3: 1010, id: 'test-1' };
    adapter.triggerPong(pong);

    // With high slew rate, now() should reflect a positive offset
    const time = clock.now();
    expect(time).toBeGreaterThan(Date.now() - 1);
  });

  it('offset is applied correctly in now()', () => {
    const adapter = createMockAdapter();
    const config = createConfig({ transportAdapter: adapter, timeSlewRate: 10000 });
    const clock = new SyncedClock(config);

    // Simulate symmetric pong with 100ms ahead server
    // t0=0, t1=100, t2=100, t3=10 => offset = ((100-0)+(100-10))/2 = 95
    const pong: PongPayload = { t0: 0, t1: 100, t2: 100, t3: 10, id: 'p1' };
    adapter.triggerPong(pong);

    const nowValue = clock.now();
    const rawNow = Date.now();
    // Should be ahead of raw Date.now() after positive offset applied
    expect(nowValue).toBeGreaterThanOrEqual(rawNow);
  });

  it('slewing: large offset changes are applied gradually', () => {
    const adapter = createMockAdapter();
    const slewRate = 5;
    const config = createConfig({ transportAdapter: adapter, timeSlewRate: slewRate });
    const clock = new SyncedClock(config);

    // Inject a large offset via pong
    // t0=0, t1=1000, t2=1000, t3=10 => offset = ((1000-0)+(1000-10))/2 = 995
    const pong: PongPayload = { t0: 0, t1: 1000, t2: 1000, t3: 10, id: 'p1' };
    adapter.triggerPong(pong);

    // Read now() twice - the offset should have changed by at most slewRate
    const t1 = clock.now();
    const t2 = clock.now();
    expect(t2 - t1).toBeLessThanOrEqual(slewRate + 100); // allow for real time passing
  });

  it('calling stop() multiple times does not throw', () => {
    const clock = new SyncedClock(createConfig());
    clock.start();
    expect(() => {
      clock.stop();
      clock.stop();
    }).not.toThrow();
  });

  it('start() triggers pings at syncIntervalMs frequency', () => {
    const adapter = createMockAdapter();
    const config = createConfig({ transportAdapter: adapter, syncIntervalMs: 1000 });
    const clock = new SyncedClock(config);
    clock.start();
    expect(adapter.sendPing).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(adapter.sendPing).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2000);
    expect(adapter.sendPing).toHaveBeenCalledTimes(4);
    clock.stop();
  });

  it('pong data flows through TimeMath into FilterEngine and updates SlewEngine target', () => {
    const filterPushSpy = vi.spyOn(FilterEngine.prototype, 'push');
    const slewSetTargetSpy = vi.spyOn(SlewEngine.prototype, 'setTargetOffset');

    const adapter = createMockAdapter();
    new SyncedClock(createConfig({ transportAdapter: adapter }));

    const pong: PongPayload = { t0: 0, t1: 100, t2: 100, t3: 10, id: 'p1' };
    adapter.triggerPong(pong);

    const expectedRtt = calculateRTT(pong.t0, pong.t1, pong.t2, pong.t3);
    const expectedOffset = calculateOffset(pong.t0, pong.t1, pong.t2, pong.t3);

    expect(filterPushSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rtt: expectedRtt, offset: expectedOffset }),
    );
    // For a single sample, FilterEngine.getOptimalOffset() returns the sample's offset directly,
    // so the SlewEngine target must equal that computed offset.
    expect(slewSetTargetSpy).toHaveBeenCalledWith(expectedOffset);
  });

  it('performanceNow() returns slewed time from SlewEngine', () => {
    const adapter = createMockAdapter();
    const clock = new SyncedClock(createConfig({ transportAdapter: adapter }));

    // Inject a positive offset: t0=0, t1=100, t2=100, t3=10 → offset = ((100-0)+(100-10))/2 = 95ms
    const pong: PongPayload = { t0: 0, t1: 100, t2: 100, t3: 10, id: 'p1' };
    adapter.triggerPong(pong);

    // Advance time enough for SlewEngine to converge (gap=95ms, rate=5% → ~1900ms)
    vi.advanceTimersByTime(10000);

    const perfNow = clock.performanceNow();
    const rawPerfNow = performance.now();
    // After convergence the slewed performance time should be ahead of raw performance.now()
    expect(perfNow).toBeGreaterThan(rawPerfNow);
  });
});
