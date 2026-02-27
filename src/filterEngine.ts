import type { SyncSample } from './types.js';
import { calculateMean, calculateStdDev } from './timeMath.js';

/**
 * Maintains a rolling window of {@link SyncSample} objects and derives a
 * statistically robust clock-offset estimate by rejecting RTT outliers.
 */
export class FilterEngine {
  private readonly _historySize: number;
  private readonly _outlierThreshold: number;
  private readonly _history: SyncSample[] = [];

  /**
   * @param historySize - Maximum number of samples to retain (must be a
   *   positive integer).
   * @param outlierThreshold - Standard-deviation multiplier used to reject
   *   outliers (must be a positive number, e.g. `2` rejects samples whose RTT
   *   is more than 2σ from the mean).
   * @throws {RangeError} When `historySize` is not a positive integer.
   * @throws {RangeError} When `outlierThreshold` is not a positive number.
   */
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

  /**
   * Appends a new sample to the history, evicting the oldest entry when the
   * buffer exceeds `historySize`.
   *
   * @param sample - The sample to add.
   */
  push(sample: SyncSample): void {
    this._history.push(sample);
    if (this._history.length > this._historySize) {
      this._history.shift();
    }
  }

  /**
   * Empties the sample history.  Called on a detected sleep/wake cycle to
   * prevent stale samples from polluting the offset estimate.
   */
  flush(): void {
    this._history.length = 0;
  }

  /**
   * Returns a read-only view of the current sample history.
   *
   * @returns An immutable array of retained {@link SyncSample} objects.
   */
  getHistory(): ReadonlyArray<SyncSample> {
    return this._history;
  }

  /**
   * Computes the optimal clock-offset estimate from the current history.
   *
   * The algorithm:
   * 1. Calculates the mean and standard deviation of all RTTs.
   * 2. Discards samples whose RTT deviates more than
   *    `outlierThreshold × σ` from the mean.
   * 3. Returns the mean offset of the surviving samples.
   *
   * @returns The estimated offset in milliseconds, or `0` when history is
   *   empty.
   */
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
