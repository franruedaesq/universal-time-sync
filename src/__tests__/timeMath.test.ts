import { describe, it, expect } from 'vitest';
import {
  calculateRTT,
  calculateOffset,
  calculateMean,
  calculateStdDev,
  filterOutliers,
} from '../timeMath.js';

describe('calculateRTT', () => {
  it('calculates RTT with normal values', () => {
    // t0=100, t1=110, t2=120, t3=140 => RTT = (140-100)-(120-110) = 40-10 = 30
    expect(calculateRTT(100, 110, 120, 140)).toBe(30);
  });

  it('returns 0 for zero latency (t0=t1=t2=t3)', () => {
    expect(calculateRTT(100, 100, 100, 100)).toBe(0);
  });

  it('handles high latency', () => {
    // t0=0, t1=500, t2=510, t3=1000 => RTT = 1000 - 10 = 990
    expect(calculateRTT(0, 500, 510, 1000)).toBe(990);
  });
});

describe('calculateOffset', () => {
  it('returns 0 offset with symmetric latency', () => {
    // t0=100, t1=110, t2=110, t3=120 => offset = ((110-100)+(110-120))/2 = (10-10)/2 = 0
    expect(calculateOffset(100, 110, 110, 120)).toBe(0);
  });

  it('calculates positive offset when server is ahead', () => {
    // t0=100, t1=200, t2=200, t3=120 => offset = ((200-100)+(200-120))/2 = (100+80)/2 = 90
    expect(calculateOffset(100, 200, 200, 120)).toBe(90);
  });

  it('calculates negative offset when server is behind', () => {
    // t0=200, t1=100, t2=100, t3=220 => offset = ((100-200)+(100-220))/2 = (-100-120)/2 = -110
    expect(calculateOffset(200, 100, 100, 220)).toBe(-110);
  });
});

describe('calculateMean', () => {
  it('calculates mean of normal values', () => {
    expect(calculateMean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns the value itself for a single value', () => {
    expect(calculateMean([42])).toBe(42);
  });

  it('returns 0 for an empty array', () => {
    expect(calculateMean([])).toBe(0);
  });
});

describe('calculateStdDev', () => {
  it('calculates standard deviation of basic values', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] => mean=5, variance=4, stddev=2
    expect(calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it('returns 0 when all values are the same', () => {
    expect(calculateStdDev([5, 5, 5, 5])).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(calculateStdDev([])).toBe(0);
  });
});

describe('filterOutliers', () => {
  it('removes spike values above threshold', () => {
    // Normal values around 10, one spike at 1000
    const values = [10, 11, 9, 10, 12, 1000];
    const filtered = filterOutliers(values, 2);
    expect(filtered).not.toContain(1000);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('keeps all values when no outliers exist', () => {
    const values = [10, 11, 9, 10, 12];
    const filtered = filterOutliers(values, 2);
    expect(filtered.length).toBe(values.length);
  });

  it('returns empty array for empty input', () => {
    expect(filterOutliers([], 2)).toEqual([]);
  });

  it('returns all values when stddev is 0', () => {
    const values = [5, 5, 5, 5];
    expect(filterOutliers(values, 2)).toEqual([5, 5, 5, 5]);
  });
});
