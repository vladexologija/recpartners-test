// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { Detection, DetectionsResponse, Video } from '../../api/types';
import { deferred, FakeEventSource, setVideoState, video, videoFrames } from '../../test/fakes';
import { PLAYBACK_REFRESH_MS } from './usePlaybackUrl';
import { VideoDetails } from './VideoDetails';

const STORAGE_URL = 'https://storage.googleapis.com/hotdog-uploads/videos/vid-1.mp4?X-Goog-Signature=abc';

function detections(...list: Detection[]): DetectionsResponse {
  return { sample_fps: 2, display_threshold: 0.4, detections: list };
}
const box = (t: number, confidence: number): Detection => ({ t_seconds: t, x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4, confidence });

/** The server sends the video on the stream the page opened for its running analysis. */
const emit = (...args: Parameters<typeof video>) => act(() => FakeEventSource.latest.emitVideo(video(...args)));

beforeEach(() => {
  FakeEventSource.install();
  videoFrames.install();
  vi.spyOn(api, 'video').mockResolvedValue(video({ state: 'processing', progress: 0.2 }));
  vi.spyOn(api, 'playback').mockResolvedValue({ url: STORAGE_URL });
  vi.spyOn(api, 'detections').mockResolvedValue(detections());
  vi.spyOn(api, 'reprocess').mockResolvedValue(video({ state: 'queued' }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Renders the page and lets the video's GET, which returns `loaded`, settle. A router is needed for the links. */
async function renderDetails(loaded?: Video) {
  if (loaded) vi.mocked(api.video).mockResolvedValue(loaded);
  const view = render(
    <MemoryRouter>
      <VideoDetails id="vid-1" />
    </MemoryRouter>,
  );
  await act(async () => {});
  return view;
}

describe('VideoDetails', () => {
  // Requirement: the player plays the uploaded file from storage, not a local copy.
  it('plays the uploaded video from storage, already while it is processed', async () => {
    const { container } = await renderDetails(video({ state: 'processing', progress: 0.2 }));
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe(STORAGE_URL));
    expect(api.playback).toHaveBeenCalledWith('vid-1');
  });

  // The browser's upload finishes a moment before GCS tells the API, which only signs a URL for a
  // recorded upload: asking earlier gets a 409 (found on the live deployment).
  it('asks for the video file only once the server has recorded the upload', async () => {
    const { container } = await renderDetails(video({ state: 'awaiting_upload' }));
    expect(api.playback).not.toHaveBeenCalled();

    emit({ state: 'queued' });

    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe(STORAGE_URL));
    expect(api.playback).toHaveBeenCalledTimes(1);
  });

  it('links back to the upload form', async () => {
    await renderDetails();
    expect(screen.getByRole('link', { name: 'Upload another video' }).getAttribute('href')).toBe('/');
  });

  // Requirement: if there is no hot dog in the video, the interface says so clearly.
  it('says clearly when there is no hot dog, ignoring boxes below the display threshold', async () => {
    vi.mocked(api.detections).mockResolvedValue(detections(box(7, 0.3)));
    await renderDetails(video({ state: 'done', frames_sampled: 16 }, { duration_s: 8 }));

    expect(
      await screen.findByText('No hot dog in this video. Checked 16 frames over 0:08 at 2 fps (confidence ≥ 40%).'),
    ).toBeTruthy();
  });

  // Requirement: boxes over the hot dogs, in time with playback.
  it('reports the hot dogs found and draws them in time with playback', async () => {
    vi.mocked(api.detections).mockResolvedValue(detections(box(1, 0.9), box(1.5, 0.8), box(4, 0.2)));
    const { container } = await renderDetails(video({ state: 'done', frames_sampled: 16 }, { duration_s: 8 }));

    expect(await screen.findByText('Hot dog found in 2 of 16 sampled frames. Play the video to see where.')).toBeTruthy();
    const element = container.querySelector('video');
    if (!element) throw new Error('no <video>');
    setVideoState(element, { videoWidth: 1280, videoHeight: 720 });
    fireEvent.loadedMetadata(element);

    act(() => videoFrames.presentFrame(1.5));
    expect(container.querySelectorAll('.box')).toHaveLength(1);
    act(() => videoFrames.presentFrame(3));
    expect(container.querySelectorAll('.box')).toHaveLength(0);
  });

  it('keeps following the frames while progress comes in, without re-subscribing', async () => {
    await renderDetails(video({ state: 'processing', progress: 0.2 }));
    await waitFor(() => expect(videoFrames.pending).toHaveLength(1));

    emit({ state: 'processing', progress: 0.5 });
    emit({ state: 'processing', progress: 0.8 });
    expect(videoFrames.pending).toHaveLength(1);
  });

  // Requirement: the interface recovers correctly if the page is refreshed mid-job.
  it('shows where the analysis stands as soon as the page opens, as after a reload mid-job', async () => {
    await renderDetails(video({ state: 'processing', progress: 0.4 }));
    expect(screen.getByRole('status').textContent).toContain('Processing: looking for hot dogs… 40%');
  });

  it('shows why a video failed and offers Reprocess', async () => {
    await renderDetails(video({ state: 'failed', error: 'Not a valid MP4.' }));
    expect(screen.getByRole('status').textContent).toContain('Not a valid MP4.');
    expect(screen.getByRole('button', { name: 'Reprocess' })).toBeTruthy();
  });

  // Requirement: processing the same video twice must not produce two sets of results.
  it('starts over on Reprocess: the old results go at once, the new ones come when the analysis is done', async () => {
    vi.mocked(api.detections).mockResolvedValue(detections(box(1, 0.9), box(2, 0.9)));
    await renderDetails(video({ state: 'done', frames_sampled: 16 }));
    await screen.findByText(/Hot dog found in 2 of 16/);
    expect(FakeEventSource.instances).toHaveLength(0); // a finished analysis needs no stream

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess' }));
    expect(await screen.findByText('Queued')).toBeTruthy(); // the video Reprocess returned
    expect(api.reprocess).toHaveBeenCalledWith('vid-1');
    expect(screen.queryByText(/Hot dog found/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprocess' })).toBeNull();
    expect(api.video).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1)); // following the new analysis
    vi.mocked(api.detections).mockResolvedValue(detections(box(3, 0.9)));
    emit({ state: 'done', frames_sampled: 16 });
    expect(await screen.findByText(/Hot dog found in 1 of 16/)).toBeTruthy();
    expect(api.detections).toHaveBeenCalledTimes(2);
  });

  it('never shows results fetched before a Reprocess, even when they arrive late', async () => {
    const late = deferred<DetectionsResponse>();
    vi.mocked(api.detections).mockReturnValueOnce(late.promise).mockResolvedValueOnce(detections(box(3, 0.9)));
    await renderDetails(video({ state: 'done', frames_sampled: 16 }));

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    emit({ state: 'done', frames_sampled: 16 });
    await screen.findByText(/Hot dog found in 1 of 16/);

    await act(async () => late.resolve(detections(box(1, 0.9), box(2, 0.9))));
    expect(screen.getByText(/Hot dog found in 1 of 16/)).toBeTruthy();
  });

  it('blocks a second Reprocess while the first is being sent', async () => {
    const request = deferred<Video>();
    vi.mocked(api.reprocess).mockReturnValue(request.promise);
    await renderDetails(video({ state: 'failed', error: 'boom' }));

    const button = screen.getByRole('button', { name: 'Reprocess' });
    fireEvent.click(button);
    expect(button).toHaveProperty('disabled', true);
    await act(async () => request.resolve(video({ state: 'queued' })));
  });

  it('offers no Reprocess while the analysis is queued or processing', async () => {
    await renderDetails(video({ state: 'queued' }));
    expect(screen.queryByRole('button', { name: 'Reprocess' })).toBeNull();
    emit({ state: 'processing', progress: 0.5 });
    expect(screen.queryByRole('button', { name: 'Reprocess' })).toBeNull();
  });

  it('replaces an expired signed URL after a playback error, at most every 30 seconds', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { container } = await renderDetails();
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe(STORAGE_URL));

    vi.mocked(api.playback).mockResolvedValue({ url: `${STORAGE_URL}&renewed=1` });
    now += PLAYBACK_REFRESH_MS + 1;
    fireEvent.error(container.querySelector('video') as HTMLVideoElement);
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe(`${STORAGE_URL}&renewed=1`));

    fireEvent.error(container.querySelector('video') as HTMLVideoElement);
    expect(api.playback).toHaveBeenCalledTimes(2);
  });

  it('shows an error when the playback URL cannot be fetched', async () => {
    vi.mocked(api.playback).mockRejectedValue(new Error('Request failed (HTTP 500).'));
    await renderDetails();
    expect((await screen.findByRole('alert')).textContent).toBe('Request failed (HTTP 500).');
  });

  it('shows an error when the detections cannot be fetched', async () => {
    vi.mocked(api.detections).mockRejectedValue(new Error('Request failed (HTTP 503).'));
    await renderDetails(video({ state: 'done', frames_sampled: 16 }));
    expect((await screen.findByRole('alert')).textContent).toBe('Request failed (HTTP 503).');
  });

  it("shows the API's reason when Reprocess is refused", async () => {
    vi.mocked(api.reprocess).mockRejectedValue(new Error('This video is still being processed.'));
    await renderDetails(video({ state: 'done', frames_sampled: 16 }));

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess' }));

    expect((await screen.findByRole('alert')).textContent).toBe('This video is still being processed.');
    expect(screen.getByRole('status').textContent).toContain('Done');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('warns when the video uses a codec some browsers cannot play', async () => {
    await renderDetails(video({ state: 'processing' }, { codec: 'hevc' }));
    expect(screen.getByText(/encoded as HEVC/)).toBeTruthy();
  });
});
