/**
 * Upload limits. The API and the worker enforce them; the browser checks them only to give
 * instant feedback before any bytes are sent (design doc D9, layer 1).
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * The longest video the worker can process inside its deadline (design doc D3).
 * Provisional until processing speed is measured; keep it in sync with the backend.
 */
export const MAX_DURATION_SECONDS = 15 * 60;

/**
 * Clips for visitors without a hot-dog video of their own. They ship with the app (public/samples/)
 * and go through the normal upload. From Pexels, free to use; the credit links to each source.
 */
export const SAMPLE_VIDEOS = [
  {
    file: 'hotdog-lake.mp4',
    title: 'Hot dog by the lake',
    seconds: 18,
    source: 'https://www.pexels.com/video/man-enjoying-hot-dog-by-lake-michigan-32304961/',
  },
  {
    file: 'hotdog-closeup.mp4',
    title: 'Hot dog close-up',
    seconds: 10,
    source: 'https://www.pexels.com/video/close-up-of-holding-a-hot-dog-outdoors-32304951/',
  },
] as const;

export type SampleVideo = (typeof SAMPLE_VIDEOS)[number];

/** Accepted MP4 brands (the `ftyp` box's major brand). A renamed QuickTime .mov has `qt  `. */
export const MP4_BRANDS: ReadonlySet<string> = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
]);
