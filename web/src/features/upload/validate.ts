import { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, MP4_BRANDS } from '../../config';
import { formatDuration, formatMegabytes } from '../../lib/format';

export class ValidationError extends Error {
  override name = 'ValidationError';
}

/**
 * Returns the MP4 major brand from a file's first 12 bytes, or null when the file
 * does not start with an `ftyp` box. Bytes 4–7 are the box type, bytes 8–11 the brand.
 */
export function mp4Brand(head: Uint8Array): string | null {
  if (head.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  return ascii(4, 8) === 'ftyp' ? ascii(8, 12) : null;
}

export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Checks a picked file before any bytes are uploaded: size, MP4 signature, and that this
 * browser can decode it within the duration limit. Nothing leaves the machine.
 */
export async function validateVideoFile(
  file: File,
  readInfo: (file: File) => Promise<VideoInfo> = readVideoInfo,
): Promise<VideoInfo> {
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `The file must be at most ${formatMegabytes(MAX_UPLOAD_BYTES)} (this one is ${formatMegabytes(file.size)}).`,
    );
  }

  const brand = mp4Brand(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (brand === null || !MP4_BRANDS.has(brand)) {
    throw new ValidationError('This is not an MP4 file.');
  }

  const info = await readInfo(file);
  if (info.width === 0) {
    throw new ValidationError('The file has no video track.');
  }
  // Some files don't declare a duration (Infinity or NaN); the worker's ffprobe decides those.
  if (Number.isFinite(info.durationSeconds) && info.durationSeconds > MAX_DURATION_SECONDS) {
    throw new ValidationError(
      `The video is too long to process (${formatDuration(info.durationSeconds)}; the limit is ${formatDuration(MAX_DURATION_SECONDS)}).`,
    );
  }
  return info;
}

/** Loads only the file's metadata into a detached <video>; nothing is uploaded. */
function readVideoInfo(file: File): Promise<VideoInfo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  return new Promise<VideoInfo>((resolve, reject) => {
    video.onloadedmetadata = () =>
      resolve({ durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new ValidationError("This browser can't play this video."));
    video.src = url;
  }).finally(() => {
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  });
}
