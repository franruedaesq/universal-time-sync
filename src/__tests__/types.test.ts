import { describe, it, expect, vi } from 'vitest';
import type { TransportAdapter, SyncPayload, SyncManager, PongPayload } from '../types.js';

describe('TransportAdapter interface', () => {
  it('accepts an object with sendPing and onPong', () => {
    const adapter: TransportAdapter = {
      sendPing: vi.fn(),
      onPong: vi.fn(),
    };
    expect(typeof adapter.sendPing).toBe('function');
    expect(typeof adapter.onPong).toBe('function');
  });

  it('sendPing receives a payload with t0 and id', () => {
    let capturedT0: number | undefined;
    const adapter: TransportAdapter = {
      sendPing: (payload) => {
        capturedT0 = payload.t0;
      },
      onPong: vi.fn(),
    };
    adapter.sendPing({ t0: 1234, id: 'ping-1' });
    expect(capturedT0).toBe(1234);
  });
});

describe('SyncPayload interface', () => {
  it('holds t0, t1, t2 timestamps and an id', () => {
    const payload: SyncPayload = { t0: 100, t1: 110, t2: 120, id: 'sync-1' };
    expect(payload.t0).toBe(100);
    expect(payload.t1).toBe(110);
    expect(payload.t2).toBe(120);
    expect(payload.id).toBe('sync-1');
  });
});

describe('SyncManager interface', () => {
  it('accepts an object with onReceivePong callback', () => {
    const received: PongPayload[] = [];
    const manager: SyncManager = {
      onReceivePong(payload: PongPayload) {
        received.push(payload);
      },
    };
    const pong: PongPayload = { t0: 0, t1: 10, t2: 11, t3: 20, id: 'p-1' };
    manager.onReceivePong(pong);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(pong);
  });
});
