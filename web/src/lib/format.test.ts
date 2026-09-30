import { describe, expect, it } from 'vitest';
import { formatDuration, formatMegabytes, formatPercent } from './format';

describe('format', () => {
  it('shows durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(8)).toBe('0:08');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(599.6)).toBe('10:00');
  });

  it('shows sizes in whole megabytes', () => {
    expect(formatMegabytes(200 * 1024 * 1024)).toBe('200 MB');
    expect(formatMegabytes(1.4 * 1024 * 1024)).toBe('1 MB');
  });

  it('shows fractions as whole percentages', () => {
    expect(formatPercent(0.4)).toBe('40%');
    expect(formatPercent(0.855)).toBe('86%');
  });
});
