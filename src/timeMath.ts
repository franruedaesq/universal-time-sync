export function calculateRTT(t0: number, t1: number, t2: number, t3: number): number {
  return (t3 - t0) - (t2 - t1);
}

export function calculateOffset(t0: number, t1: number, t2: number, t3: number): number {
  return ((t1 - t0) + (t2 - t3)) / 2;
}

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = calculateMean(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function filterOutliers(values: number[], threshold: number): number[] {
  if (values.length === 0) return [];
  const mean = calculateMean(values);
  const stddev = calculateStdDev(values);
  if (stddev === 0) return [...values];
  return values.filter((v) => Math.abs(v - mean) <= threshold * stddev);
}
