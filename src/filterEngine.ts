import type { SyncSample } from './types.js';
import { calculateMean, calculateStdDev } from './timeMath.js';

export class FilterEngine {
  private readonly _historySize: number;
  private readonly _outlierThreshold: number;
  private readonly _history: SyncSample[] = [];

  constructor(historySize: number, outlierThreshold: number) {
    if (!Number.isInteger(historySize) || historySize < 1) {
      throw new RangeError('historySize must be a positive integer');
    }
    if (typeof outlierThreshold !== 'number' || outlierThreshold <= 0) {
      throw new RangeError('outlierThreshold must be a positive number');
    }
    this._historySize = historySize;
    this._outlierThreshold = outlierThreshold;
  }

  push(sample: SyncSample): void {
    this._history.push(sample);
    if (this._history.length > this._historySize) {
      this._history.shift();
    }
  }

  getHistory(): ReadonlyArray<SyncSample> {
    return this._history;
  }

  getOptimalOffset(): number {
    if (this._history.length === 0) return 0;

    const rtts = this._history.map((s) => s.rtt);
    const meanRtt = calculateMean(rtts);
    const stddevRtt = calculateStdDev(rtts);

    const filtered = this._history.filter(
      (s) => stddevRtt === 0 || Math.abs(s.rtt - meanRtt) <= this._outlierThreshold * stddevRtt,
    );

    const offsets = filtered.map((s) => s.offset);
    const fallbackMean = calculateMean(this._history.map((s) => s.offset));
    return offsets.length > 0 ? calculateMean(offsets) : fallbackMean;
  }
}
