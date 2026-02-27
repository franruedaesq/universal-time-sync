import { describe, it, expect } from 'vitest';
import { FilterEngine } from '../filterEngine.js';
import type { SyncSample } from '../types.js';

function makeSample(rtt: number, offset: number): SyncSample {
  return { rtt, offset, timestamp: Date.now() };
}

describe('FilterEngine', () => {
  describe('constructor validation', () => {
    it('throws RangeError for non-positive historySize', () => {
      expect(() => new FilterEngine(0, 2)).toThrow(RangeError);
    });

    it('throws RangeError for non-integer historySize', () => {
      expect(() => new FilterEngine(1.5, 2)).toThrow(RangeError);
    });

    it('throws RangeError for non-positive outlierThreshold', () => {
      expect(() => new FilterEngine(10, 0)).toThrow(RangeError);
    });
  });

  describe('history size limit', () => {
    it('enforces historySize by removing the oldest entry when limit is exceeded', () => {
      const engine = new FilterEngine(10, 2);
      for (let i = 1; i <= 11; i++) {
        engine.push(makeSample(20, i));
      }
      const history = engine.getHistory();
      expect(history.length).toBe(10);
      // The oldest sample (offset=1) should have been evicted; newest (offset=11) should be present
      expect(history[0].offset).toBe(2);
      expect(history[history.length - 1].offset).toBe(11);
    });

    it('does not evict entries when below the limit', () => {
      const engine = new FilterEngine(10, 2);
      for (let i = 0; i < 5; i++) {
        engine.push(makeSample(20, i));
      }
      expect(engine.getHistory().length).toBe(5);
    });
  });

  describe('standard deviation via getOptimalOffset', () => {
    it('returns the mean offset when all RTTs are identical (stddev=0)', () => {
      const engine = new FilterEngine(10, 2);
      engine.push(makeSample(20, 100));
      engine.push(makeSample(20, 200));
      engine.push(makeSample(20, 300));
      // stddev of RTTs is 0, so all samples are kept → mean offset = 200
      expect(engine.getOptimalOffset()).toBeCloseTo(200);
    });

    it('returns 0 when history is empty', () => {
      const engine = new FilterEngine(10, 2);
      expect(engine.getOptimalOffset()).toBe(0);
    });
  });

  describe('outlier rejection in getOptimalOffset', () => {
    it('discards the RTT outlier and returns mean of remaining offsets', () => {
      const engine = new FilterEngine(20, 2);
      // Push 9 normal samples with RTT ~20ms and offset=10
      for (let i = 0; i < 9; i++) {
        engine.push(makeSample(20, 10));
      }
      // Push one massive outlier: RTT=2000ms, offset=9999
      engine.push(makeSample(2000, 9999));

      const optimal = engine.getOptimalOffset();
      // The outlier offset (9999) should be excluded; result should be close to 10
      expect(optimal).toBeCloseTo(10);
    });

    it('keeps all samples when no outliers are present', () => {
      const engine = new FilterEngine(10, 2);
      engine.push(makeSample(18, 5));
      engine.push(makeSample(20, 15));
      engine.push(makeSample(22, 25));
      // All RTTs within normal range → mean offset = (5+15+25)/3 = 15
      expect(engine.getOptimalOffset()).toBeCloseTo(15);
    });
  });
});
