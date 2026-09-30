import { describe, expect, it, vi } from 'vitest';
import { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, MP4_BRANDS } from '../../config';
import { mp4Brand, validateVideoFile, ValidationError, type VideoInfo } from './validate';

/** The first 12 bytes of a file: a 4-byte box size, the box type, then the major brand. */
function head(boxType: string, brand: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0, 0, 0, 32, ...[...boxType, ...brand].map((c) => c.charCodeAt(0))]);
}

/** A File-like object of any size, without allocating that many bytes. */
function fakeFile(size: number, firstBytes: Uint8Array<ArrayBuffer> = head('ftyp', 'isom')): File {
  const blob = new Blob([firstBytes]);
  return { name: 'clip.mp4', type: 'video/mp4', size, slice: (start?: number, end?: number) => blob.slice(start, end) } as File;
}

const playable = (info: Partial<VideoInfo> = {}) =>
  vi.fn(async () => ({ durationSeconds: 60, width: 1280, height: 720, ...info }));

describe('mp4Brand', () => {
  it('reads the major brand of an MP4', () => {
    expect(mp4Brand(head('ftyp', 'isom'))).toBe('isom');
    expect(mp4Brand(head('ftyp', 'mp42'))).toBe('mp42');
  });

  it('reads a QuickTime brand, which the allowlist rejects', () => {
    const brand = mp4Brand(head('ftyp', 'qt  '));
    expect(brand).toBe('qt  ');
    expect(MP4_BRANDS.has(brand ?? '')).toBe(false);
  });

  it('returns null when the file does not start with an ftyp box', () => {
    expect(mp4Brand(head('moov', 'isom'))).toBeNull();
    expect(mp4Brand(new TextEncoder().encode('\x1aE\xdf\xa3 webm file'))).toBeNull();
  });

  it('returns null for a file shorter than 12 bytes', () => {
    expect(mp4Brand(new Uint8Array([0, 0, 0, 32, 102, 116]))).toBeNull();
  });
});

// Requirement: uploads accept MP4 up to 200 MB. These checks run in the browser before any
// bytes are sent; the API and worker enforce the same rules.
describe('validateVideoFile', () => {
  it('accepts an MP4 of exactly 200 MB', async () => {
    await expect(validateVideoFile(fakeFile(MAX_UPLOAD_BYTES), playable())).resolves.toMatchObject({ width: 1280 });
  });

  it('rejects a file over 200 MB without reading it', async () => {
    const readInfo = playable();
    await expect(validateVideoFile(fakeFile(MAX_UPLOAD_BYTES + 1), readInfo)).rejects.toThrow('at most 200 MB');
    expect(readInfo).not.toHaveBeenCalled();
  });

  it('rejects an empty file', async () => {
    await expect(validateVideoFile(fakeFile(0), playable())).rejects.toThrow(ValidationError);
  });

  it('rejects a file that is not an MP4', async () => {
    const text = new TextEncoder().encode('hello, not a video');
    await expect(validateVideoFile(fakeFile(18, text), playable())).rejects.toThrow('not an MP4');
  });

  it('rejects a QuickTime .mov renamed to .mp4', async () => {
    await expect(validateVideoFile(fakeFile(1000, head('ftyp', 'qt  ')), playable())).rejects.toThrow('not an MP4');
  });

  it('rejects a video this browser cannot play, since it must play it back', async () => {
    const unplayable = vi.fn(async (): Promise<VideoInfo> => {
      throw new ValidationError("This browser can't play this video.");
    });
    await expect(validateVideoFile(fakeFile(1000), unplayable)).rejects.toThrow("can't play");
  });

  it('rejects a file without a video track', async () => {
    await expect(validateVideoFile(fakeFile(1000), playable({ width: 0, height: 0 }))).rejects.toThrow(
      'no video track',
    );
  });

  it('rejects a video longer than the worker can process', async () => {
    const tooLong = playable({ durationSeconds: MAX_DURATION_SECONDS + 1 });
    await expect(validateVideoFile(fakeFile(1000), tooLong)).rejects.toThrow('too long');
  });

  it('accepts a video exactly at the duration limit', async () => {
    await expect(
      validateVideoFile(fakeFile(1000), playable({ durationSeconds: MAX_DURATION_SECONDS })),
    ).resolves.toBeDefined();
  });

  it('leaves an undeclared duration to the worker instead of rejecting it', async () => {
    await expect(
      validateVideoFile(fakeFile(1000), playable({ durationSeconds: Number.POSITIVE_INFINITY })),
    ).resolves.toBeDefined();
  });
});
