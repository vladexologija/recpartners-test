// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api/client';
import { App } from './App';
import { putFile } from './features/upload/putFile';
import { validateVideoFile } from './features/upload/validate';
import { FakeEventSource, video, videoFrames } from './test/fakes';

vi.mock('./features/upload/validate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./features/upload/validate')>()),
  validateVideoFile: vi.fn(),
}));
vi.mock('./features/upload/putFile', () => ({ putFile: vi.fn() }));

beforeEach(() => {
  FakeEventSource.install();
  videoFrames.install();
  vi.spyOn(api, 'video').mockImplementation(async (id) => video({ state: 'processing' }, { id }));
  vi.spyOn(api, 'playback').mockResolvedValue({ url: 'https://storage.googleapis.com/b/v.mp4?sig=1' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Shows the router's current path, so tests can see where the app navigated. */
function CurrentPath() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  );
}

const currentPath = () => screen.getByTestId('path').textContent;
const status = () => screen.getByRole('status').textContent;
const emit = (...args: Parameters<typeof video>) => act(() => FakeEventSource.latest.emitVideo(video(...args)));

describe('App routes', () => {
  it('shows the upload form at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Upload a video' })).toBeTruthy();
    expect(api.video).not.toHaveBeenCalled();
  });

  // Requirement: the interface recovers correctly if the page is refreshed mid-job.
  it('opens the video at /videos/:id, so a reload mid-job comes back to it', async () => {
    vi.mocked(api.video).mockResolvedValue(video({ state: 'processing', progress: 0.6 }, { id: 'vid-9' }));
    renderAt('/videos/vid-9');
    await waitFor(() => expect(status()).toContain('Processing: looking for hot dogs… 60%'));
    expect(api.video).toHaveBeenCalledWith('vid-9');
  });

  // Requirements: upload, asynchronous processing that the upload does not wait for, and the job state.
  it('takes a video from upload to result, moving to /videos/:id once storage has the file', async () => {
    vi.spyOn(api, 'createVideo').mockImplementation(async ({ id }) => ({
      id,
      upload: { method: 'PUT', url: 'https://storage.googleapis.com/b/v.mp4?sig=1', headers: {} },
    }));
    vi.spyOn(api, 'detections').mockResolvedValue({ sample_fps: 2, display_threshold: 0.4, detections: [] });
    vi.mocked(api.video).mockImplementation(async (id) => video({ state: 'awaiting_upload' }, { id }));
    vi.mocked(validateVideoFile).mockResolvedValue({ durationSeconds: 8, width: 1280, height: 720 });
    vi.mocked(putFile).mockResolvedValue();
    renderAt('/');

    fireEvent.change(screen.getByLabelText('Choose an MP4 video'), {
      target: { files: [new File(['mp4'], 'picnic.mp4', { type: 'video/mp4' })] },
    });

    await waitFor(() => expect(currentPath()).toMatch(/^\/videos\/[0-9a-f-]{36}$/));
    const id = currentPath()?.split('/').at(-1);
    await waitFor(() => expect(status()).toContain('Uploaded: waiting for storage to confirm'));
    expect(FakeEventSource.latest.url).toBe(`/api/videos/${id}/events`);

    emit({ state: 'queued' });
    expect(status()).toContain('Queued');
    emit({ state: 'processing', progress: 0.5 });
    expect(status()).toContain('Processing');
    emit({ state: 'done', frames_sampled: 16 }, { duration_s: 8 });
    expect(await screen.findByText(/No hot dog in this video/)).toBeTruthy();
  });

  it('goes back to the upload form from a video', () => {
    renderAt('/videos/vid-9');
    fireEvent.click(screen.getByRole('link', { name: 'Upload another video' }));
    expect(currentPath()).toBe('/');
    expect(screen.getByRole('heading', { name: 'Upload a video' })).toBeTruthy();
  });

  it('starts fresh when moving from one video to another', async () => {
    vi.mocked(api.video).mockImplementation(async (id) =>
      id === 'vid-1' ? video({ state: 'failed', error: 'boom' }, { id }) : video({ state: 'queued' }, { id }),
    );
    function GoToSecondVideo() {
      const navigate = useNavigate();
      return <button onClick={() => void navigate('/videos/vid-2')}>second video</button>;
    }
    render(
      <MemoryRouter initialEntries={['/videos/vid-1']}>
        <App />
        <GoToSecondVideo />
      </MemoryRouter>,
    );
    expect(await screen.findByText('boom')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'second video' }));

    expect(screen.queryByText('boom')).toBeNull();
    await waitFor(() => expect(FakeEventSource.latest.url).toBe('/api/videos/vid-2/events'));
  });

  it('shows "Page not found" for an unknown path, with a way back to the upload form', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Upload a video' }));
    expect(currentPath()).toBe('/');
  });

  it('shows "Video not found" for an unknown video, instead of trying to reconnect', async () => {
    vi.mocked(api.video).mockRejectedValue(new ApiError(404, 'Not found.'));
    renderAt('/videos/nope');
    expect(await screen.findByRole('heading', { name: 'Video not found' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(FakeEventSource.instances).toHaveLength(0);

    fireEvent.click(screen.getByRole('link', { name: 'Upload a video' }));
    expect(currentPath()).toBe('/');
  });

  it('escapes the video id in the URL', async () => {
    renderAt(`/videos/${encodeURIComponent('a b')}`);
    await waitFor(() => expect(FakeEventSource.latest.url).toBe('/api/videos/a%20b/events'));
    expect(api.video).toHaveBeenCalledWith('a b');
  });
});
