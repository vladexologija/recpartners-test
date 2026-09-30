// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { UploadTarget } from '../../api/types';
import { deferred } from '../../test/fakes';
import { putFile } from './putFile';
import { Uploader } from './Uploader';
import { validateVideoFile, ValidationError } from './validate';

vi.mock('./validate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./validate')>()),
  validateVideoFile: vi.fn(),
}));
vi.mock('./putFile', () => ({ putFile: vi.fn() }));

const target: UploadTarget = {
  method: 'PUT',
  url: 'https://storage.googleapis.com/hotdog-uploads/videos/vid.mp4?X-Goog-Signature=abc',
  headers: { 'Content-Type': 'video/mp4' },
};
const file = new File(['mp4 bytes'], 'lunch.mp4', { type: 'video/mp4' });

function pick(selected: File) {
  fireEvent.change(screen.getByLabelText('Choose an MP4 video'), { target: { files: [selected] } });
}

beforeEach(() => {
  vi.mocked(validateVideoFile).mockResolvedValue({ durationSeconds: 8, width: 1280, height: 720 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(validateVideoFile).mockReset();
  vi.mocked(putFile).mockReset();
});

// Requirements: choose a video file; it lands in GCS without passing through the API; the upload
// doesn't wait for detection.
describe('Uploader', () => {
  it('uploads a valid MP4 straight to storage, then opens its page without waiting for detection', async () => {
    const createVideo = vi.spyOn(api, 'createVideo').mockImplementation(async ({ id }) => ({ id, upload: target }));
    const upload = deferred<void>();
    vi.mocked(putFile).mockImplementation((_target, _file, onProgress) => {
      onProgress(0.5);
      return upload.promise;
    });
    const onUploaded = vi.fn();
    render(<Uploader onUploaded={onUploaded} />);

    pick(file);
    await screen.findByText('Uploading… 50%');

    const request = createVideo.mock.calls[0]?.[0];
    expect(request).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), original_filename: 'lunch.mp4', declared_size: file.size });
    expect(putFile).toHaveBeenCalledWith(target, file, expect.any(Function));
    expect(onUploaded).not.toHaveBeenCalled();

    // Done as soon as storage has the file: detection runs afterwards, on the video's page.
    await act(async () => upload.resolve());
    expect(onUploaded).toHaveBeenCalledWith(request?.id);
  });

  it('does nothing when the file picker is cancelled', () => {
    const createVideo = vi.spyOn(api, 'createVideo');
    render(<Uploader onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Choose an MP4 video'), { target: { files: [] } });
    expect(validateVideoFile).not.toHaveBeenCalled();
    expect(createVideo).not.toHaveBeenCalled();
  });

  it('offers only MP4 files in the file picker', () => {
    render(<Uploader onUploaded={vi.fn()} />);
    expect(screen.getByLabelText('Choose an MP4 video').getAttribute('accept')).toBe('video/mp4,.mp4');
  });

  it('explains why a file was rejected and uploads nothing', async () => {
    vi.mocked(validateVideoFile).mockRejectedValue(new ValidationError('This is not an MP4 file.'));
    const createVideo = vi.spyOn(api, 'createVideo');
    render(<Uploader onUploaded={vi.fn()} />);

    pick(file);

    expect((await screen.findByRole('alert')).textContent).toBe('This is not an MP4 file.');
    expect(createVideo).not.toHaveBeenCalled();
    expect(putFile).not.toHaveBeenCalled();
  });

  it('reports a failed upload and stays on the upload form', async () => {
    vi.spyOn(api, 'createVideo').mockResolvedValue({ id: 'vid-1', upload: target });
    vi.mocked(putFile).mockRejectedValue(new Error('The upload was rejected (HTTP 403).'));
    const onUploaded = vi.fn();
    render(<Uploader onUploaded={onUploaded} />);

    pick(file);

    expect((await screen.findByRole('alert')).textContent).toBe('The upload was rejected (HTTP 403).');
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Choose an MP4 video')).toHaveProperty('disabled', false);
  });

  it('warns before the page is left in the middle of an upload', async () => {
    vi.spyOn(api, 'createVideo').mockResolvedValue({ id: 'vid-1', upload: target });
    vi.mocked(putFile).mockReturnValue(new Promise(() => {}));
    render(<Uploader onUploaded={vi.fn()} />);

    pick(file);
    await screen.findByText(/Uploading/);

    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it('uploads a sample clip exactly like a picked file', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('mp4 bytes'));
    const createVideo = vi.spyOn(api, 'createVideo').mockImplementation(async ({ id }) => ({ id, upload: target }));
    vi.mocked(putFile).mockResolvedValue();
    const onUploaded = vi.fn();
    render(<Uploader onUploaded={onUploaded} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hot dog by the lake (18 s)' }));

    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/samples/hotdog-lake.mp4');
    const sent = vi.mocked(putFile).mock.calls[0]?.[1];
    expect(validateVideoFile).toHaveBeenCalledWith(sent);
    expect([sent?.name, sent?.size]).toEqual(['hotdog-lake.mp4', 9]);
    expect(createVideo.mock.calls[0]?.[0]).toMatchObject({ original_filename: 'hotdog-lake.mp4', declared_size: 9 });
  });

  it('reports a sample that cannot be loaded and uploads nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const createVideo = vi.spyOn(api, 'createVideo');
    render(<Uploader onUploaded={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hot dog close-up (10 s)' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The sample could not be loaded (HTTP 404).');
    expect(createVideo).not.toHaveBeenCalled();
  });
});
