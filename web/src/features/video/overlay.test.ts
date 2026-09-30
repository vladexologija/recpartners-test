import { describe, expect, it } from 'vitest';
import { nearestSampleIndex, toSamples } from './overlay';

describe('nearestSampleIndex', () => {
  const times = [1, 1.5, 2, 5];
  const halfInterval = 0.25; // 2 fps

  it('finds the sample on or near the current time', () => {
    expect(nearestSampleIndex(times, 1.5, halfInterval)).toBe(1);
    expect(nearestSampleIndex(times, 1.6, halfInterval)).toBe(1);
    expect(nearestSampleIndex(times, 1.9, halfInterval)).toBe(2);
    expect(nearestSampleIndex(times, 5.25, halfInterval)).toBe(3);
  });

  it('shows nothing when no sample is within half the sampling interval', () => {
    expect(nearestSampleIndex(times, 3, halfInterval)).toBe(-1);
    expect(nearestSampleIndex(times, 0.7, halfInterval)).toBe(-1);
    expect(nearestSampleIndex(times, 5.3, halfInterval)).toBe(-1);
  });

  it('handles an empty list', () => {
    expect(nearestSampleIndex([], 1, halfInterval)).toBe(-1);
  });
});

describe('toSamples', () => {
  it('groups boxes by sampled frame, in time order, dropping low-confidence ones', () => {
    const detections = [
      { t_seconds: 2, x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, confidence: 0.9 },
      { t_seconds: 1, x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, confidence: 0.3 },
      { t_seconds: 1, x1: 0.3, y1: 0.3, x2: 0.4, y2: 0.4, confidence: 0.8 },
      { t_seconds: 2, x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.6, confidence: 0.7 },
    ];
    const samples = toSamples(detections, 0.4);
    expect(samples.map((s) => s.t)).toEqual([1, 2]);
    expect(samples.map((s) => s.boxes.length)).toEqual([1, 2]);
    expect(samples[0]?.boxes[0]?.confidence).toBe(0.8);
  });
});
