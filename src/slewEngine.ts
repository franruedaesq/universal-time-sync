const CONVERGENCE_THRESHOLD_MS = 0.001;

export class SlewEngine {
  private readonly _slewRate: number;
  private _epochRealTime: number;
  private _epochSlewedTime: number;
  private _targetOffset: number = 0;
  private _scaleFactor: number = 1.0;
  private _lastNow: number = -Infinity;

  constructor(slewRate: number = 0.05) {
    this._slewRate = slewRate;
    const t = performance.now();
    this._epochRealTime = t;
    this._epochSlewedTime = t;
  }

  setTargetOffset(newTargetOffset: number): void {
    const realNow = performance.now();
    this._epochSlewedTime = this._computeSlewed(realNow);
    this._epochRealTime = realNow;
    this._targetOffset = newTargetOffset;
    this._recomputeScaleFactor(realNow);
  }

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
