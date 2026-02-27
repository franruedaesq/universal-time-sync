const CONVERGENCE_THRESHOLD_MS = 0.001;

/**
 * Applies clock corrections incrementally ("slewing") using a scale-factor
 * approach so that the synced clock never jumps backward.
 *
 * Instead of instantly jumping to a new offset, the engine stretches or
 * compresses the perceived passage of time until the target is reached:
 * - A positive target offset → scale > 1 (time runs slightly faster).
 * - A negative target offset → scale < 1 (time runs slightly slower).
 */
export class SlewEngine {
  private readonly _slewRate: number;
  private _epochRealTime: number;
  private _epochSlewedTime: number;
  private _targetOffset: number = 0;
  private _scaleFactor: number = 1.0;
  private _lastNow: number = -Infinity;

  /**
   * @param slewRate - Fractional rate of clock adjustment per real millisecond
   *   (default `0.05`, meaning the clock runs at most 5 % faster or slower
   *   than real time).
   */
  constructor(slewRate: number = 0.05) {
    this._slewRate = slewRate;
    const t = performance.now();
    this._epochRealTime = t;
    this._epochSlewedTime = t;
  }

  /**
   * Updates the target offset and recalculates the internal scale factor.
   * The current slewed position is re-anchored so that mid-slew direction
   * changes are handled correctly.
   *
   * @param newTargetOffset - The new desired offset in milliseconds
   *   (positive = slewed clock should be ahead of `performance.now()`).
   */
  setTargetOffset(newTargetOffset: number): void {
    const realNow = performance.now();
    this._epochSlewedTime = this._computeSlewed(realNow);
    this._epochRealTime = realNow;
    this._targetOffset = newTargetOffset;
    this._recomputeScaleFactor(realNow);
  }

  /**
   * Returns the current slewed time in milliseconds (relative to the
   * `performance` origin), guaranteed to be monotonically non-decreasing.
   *
   * @returns A monotonically increasing timestamp in milliseconds.
   */
  now(): number {
    const realNow = performance.now();
    let slewed = this._computeSlewed(realNow);

    const target = realNow + this._targetOffset;
    if (
      (this._scaleFactor > 1.0 && slewed >= target) ||
      (this._scaleFactor < 1.0 && slewed <= target)
    ) {
      slewed = target;
      this._epochSlewedTime = target;
      this._epochRealTime = realNow;
      this._scaleFactor = 1.0;
    }

    const result = Math.max(slewed, this._lastNow);
    this._lastNow = result;
    return result;
  }

  /**
   * The current time-dilation factor.
   * - `1.0` = real time (converged or no offset set)
   * - `> 1.0` = running fast (catching up to a positive target offset)
   * - `< 1.0` = running slow (catching up to a negative target offset)
   */
  get scaleFactor(): number {
    return this._scaleFactor;
  }

  private _computeSlewed(realNow: number): number {
    return this._epochSlewedTime + (realNow - this._epochRealTime) * this._scaleFactor;
  }

  private _recomputeScaleFactor(realNow: number): void {
    const target = realNow + this._targetOffset;
    const gap = target - this._epochSlewedTime;
    if (Math.abs(gap) < CONVERGENCE_THRESHOLD_MS) {
      this._scaleFactor = 1.0;
    } else if (gap > 0) {
      this._scaleFactor = 1 + this._slewRate;
    } else {
      this._scaleFactor = 1 - this._slewRate;
    }
  }
}
