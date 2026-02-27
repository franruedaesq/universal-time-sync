import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlewEngine } from '../slewEngine.js';

describe('SlewEngine', () => {
  let fakeNow: number;

  beforeEach(() => {
    fakeNow = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('now() returns a number', () => {
    const engine = new SlewEngine();
    expect(typeof engine.now()).toBe('number');
  });

  it('scaleFactor is 1.0 when no offset is set', () => {
    const engine = new SlewEngine(0.05);
    expect(engine.scaleFactor).toBe(1.0);
  });

  it('now() never returns a value smaller than a previous call when offset is -100ms (monotonic guarantee)', () => {
    const engine = new SlewEngine(0.05);
    engine.setTargetOffset(-100);

    const results: number[] = [];
    for (let i = 0; i < 50; i++) {
      fakeNow += 1;
      results.push(engine.now());
    }

    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]);
    }
  });

  it('ticks at 0.95x rate (1 real ms = 0.95 synced ms) when offset is -100ms', () => {
    const engine = new SlewEngine(0.05);
    engine.setTargetOffset(-100);

    expect(engine.scaleFactor).toBe(0.95);

    const t0 = engine.now();
    fakeNow += 10;
    const t1 = engine.now();

    expect(t1 - t0).toBeCloseTo(9.5, 5);
  });

  it('ticks at 1.05x rate (1 real ms = 1.05 synced ms) when offset is +100ms', () => {
    const engine = new SlewEngine(0.05);
    engine.setTargetOffset(100);

    expect(engine.scaleFactor).toBe(1.05);

    const t0 = engine.now();
    fakeNow += 10;
    const t1 = engine.now();

    expect(t1 - t0).toBeCloseTo(10.5, 5);
  });

  it('resets scaleFactor to 1.0 after converging on a negative offset', () => {
    const engine = new SlewEngine(0.05);
    engine.setTargetOffset(-100);

    // convergence after 100 / 0.05 = 2000 ms of real time
    fakeNow += 2500;
    engine.now();

    expect(engine.scaleFactor).toBe(1.0);
  });

  it('resets scaleFactor to 1.0 after converging on a positive offset', () => {
    const engine = new SlewEngine(0.05);
    engine.setTargetOffset(100);

    // convergence after 100 / 0.05 = 2000 ms of real time
    fakeNow += 2500;
    engine.now();

    expect(engine.scaleFactor).toBe(1.0);
  });

  it('re-anchors correctly when setTargetOffset is called mid-slew', () => {
    const engine = new SlewEngine(0.05);
    engine.setTargetOffset(-100);

    // advance partway through slewing
    fakeNow += 500;
    engine.now();

    // switch target offset direction
    engine.setTargetOffset(50);
    expect(engine.scaleFactor).toBe(1.05);
  });
});
