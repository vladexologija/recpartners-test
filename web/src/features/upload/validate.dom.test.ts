// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setVideoState } from '../../test/fakes';
import { validateVideoFile, ValidationError } from './validate';

// The <video> probe behind validateVideoFile: jsdom plays no media, so the test plays the browser
// finishing (or failing) to read the file's metadata.
let video: HTMLVideoElement | undefined;
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:local-file', revokeObjectURL }));
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = createElement(tag);
    if (tag === 'video') video = element as HTMLVideoElement;
    return element;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  revokeObjectURL.mockReset();
  video = undefined;
});

const mp4 = () => new File([new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 105, 115, 111, 109])], 'clip.mp4');

async function probedVideo(): Promise<HTMLVideoElement> {
  await vi.waitFor(() => expect(video?.getAttribute('src')).toBe('blob:local-file'));
  return video as HTMLVideoElement;
}

describe('reading a picked file in the browser', () => {
  it('reads duration and size from the local file only, then releases it', async () => {
    const result = validateVideoFile(mp4());
    const probe = await probedVideo();
    expect(probe.preload).toBe('metadata');

    setVideoState(probe, { videoWidth: 1920, videoHeight: 1080 });
    Object.defineProperty(probe, 'duration', { value: 12.5 });
    probe.dispatchEvent(new Event('loadedmetadata'));

    await expect(result).resolves.toEqual({ durationSeconds: 12.5, width: 1920, height: 1080 });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-file');
  });

  it('rejects a file this browser cannot decode', async () => {
    const result = validateVideoFile(mp4());
    (await probedVideo()).dispatchEvent(new Event('error'));

    await expect(result).rejects.toThrow(ValidationError);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-file');
  });
});
