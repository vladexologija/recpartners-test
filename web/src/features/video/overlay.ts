import type { Detection } from '../../api/types';

export type Box = Omit<Detection, 't_seconds'>;

/** All boxes found in one sampled frame, `t` seconds into the video. */
export interface Sample {
  t: number;
  boxes: Box[];
}

/** Groups detections into samples ordered by time, keeping only boxes at or above `minConfidence`. */
export function toSamples(detections: readonly Detection[], minConfidence: number): Sample[] {
  const byTime = new Map<number, Sample>();
  for (const { t_seconds: t, ...box } of detections) {
    if (box.confidence < minConfidence) continue;
    const key = Math.round(t * 1000); // one key per sampled frame, immune to float noise
    const sample = byTime.get(key) ?? { t, boxes: [] };
    sample.boxes.push(box);
    byTime.set(key, sample);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/**
 * Index of the sample nearest to time `t`, or -1 when none is within `maxDelta` seconds.
 * `times` must be sorted ascending.
 */
export function nearestSampleIndex(times: readonly number[], t: number, maxDelta: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  // The nearest sample is the first one at or after `t`, or the one just before it.
  let best = -1;
  let bestDelta = Infinity;
  for (const i of [lo - 1, lo]) {
    const time = times[i];
    if (time === undefined) continue;
    const delta = Math.abs(time - t);
    if (delta < bestDelta) {
      best = i;
      bestDelta = delta;
    }
  }
  return bestDelta <= maxDelta ? best : -1;
}
