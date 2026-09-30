import { describe, expect, it } from 'vitest';
import { errorText } from './errors';

describe('errorText', () => {
  it("uses an error's message", () => {
    expect(errorText(new Error('The upload failed: network error.'))).toBe('The upload failed: network error.');
  });

  it('turns anything else that was thrown into text', () => {
    expect(errorText('boom')).toBe('boom');
  });
});
