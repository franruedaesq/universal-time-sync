import { describe, it, expect, vi, afterEach } from 'vitest';
import { SyncedClock } from '../syncedClock.js';
import type { TransportAdapter, PingPayload, PongPayload } from '../types.js';

describe('End-to-End Integration: Client converges to Server time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('SyncedClock.now() converges on server time and never goes backward', () => {
    vi.useFakeTimers();

    const SERVER_AHEAD_MS = 5000;
    const SYNC_INTERVAL_MS = 1000;
    const NUM_ROUNDS = 10;

    // Predefined variable one-way latencies [clientToServer, serverToClient] in ms.
    // Asymmetry is intentional to simulate realistic network jitter.
    const latencyPairs: [number, number][] = [
      [20, 25],
      [35, 28],
      [48, 22],
      [25, 45],
      [30, 30],
      [42, 20],
      [22, 38],
      [38, 26],
      [28, 32],
      [45, 18],
    ];
    let pingIndex = 0;

    // Mock transport: responds synchronously with a pong whose timestamps reflect
    // a server clock that is SERVER_AHEAD_MS ahead of the client, plus variable latency.
    let pongHandler: ((payload: PongPayload) => void) | null = null;
    const transport: TransportAdapter = {
      sendPing({ t0, id }: PingPayload): void {
        const [lat1, lat2] = latencyPairs[pingIndex % latencyPairs.length];
        pingIndex++;
        // t1 = server receive time; t2 = server send time (equal here: zero server processing delay).
        // Both are in server clock units (SERVER_AHEAD_MS ahead of client + one-way latency).
        // t3 is back in client time (t0 + full round-trip latency).
        pongHandler?.({
          t0,
          t1: t0 + SERVER_AHEAD_MS + lat1,
          t2: t0 + SERVER_AHEAD_MS + lat1,
          t3: t0 + lat1 + lat2,
          id,
        });
      },
      onPong(callback: (payload: PongPayload) => void): void {
        pongHandler = callback;
      },
    };

    // High timeSlewRate (500 ms per now() call) so the test converges within NUM_ROUNDS.
    const clock = new SyncedClock({
      syncIntervalMs: SYNC_INTERVAL_MS,
      historySize: 8,
      outlierThreshold: 2,
      timeSlewRate: 500,
      transportAdapter: transport,
    });

    clock.start();

    const readings: number[] = [];
    readings.push(clock.now()); // baseline reading before any interval fires

    for (let round = 0; round < NUM_ROUNDS; round++) {
      vi.advanceTimersByTime(SYNC_INTERVAL_MS);
      readings.push(clock.now());
    }

    clock.stop();

    // 1. Monotonicity: every reading must be >= the previous one (no backward jumps).
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThanOrEqual(readings[i - 1]);
    }

    // 2. Convergence: after NUM_ROUNDS the synced clock should be close to
    //    Date.now() + SERVER_AHEAD_MS (within ±500 ms tolerance).
    const lastReading = readings[readings.length - 1];
    const rawNow = Date.now();
    expect(lastReading).toBeGreaterThanOrEqual(rawNow + SERVER_AHEAD_MS - 500);
    expect(lastReading).toBeLessThanOrEqual(rawNow + SERVER_AHEAD_MS + 500);
  });
});
