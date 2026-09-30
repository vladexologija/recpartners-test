// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { video } from '../test/fakes';
import { api, ApiError } from './client';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** openapi-fetch hands fetch a Request object. */
function sent(): Request {
  const [request] = fetchMock.mock.calls[0] ?? [];
  if (!(request instanceof Request)) throw new Error('fetch was not called with a Request');
  return request;
}

describe('api client', () => {
  it('creates a video with only its metadata; the file itself goes to storage', async () => {
    const upload = { method: 'PUT', url: 'https://storage.googleapis.com/b/v.mp4?sig=1', headers: {} };
    fetchMock.mockResolvedValue(json(201, { id: 'vid-1', upload }));

    const created = await api.createVideo({ id: 'vid-1', original_filename: 'lunch.mp4', declared_size: 1234 });

    expect(sent().method).toBe('POST');
    expect(new URL(sent().url).pathname).toBe('/api/videos');
    expect(await sent().json()).toEqual({ id: 'vid-1', original_filename: 'lunch.mp4', declared_size: 1234 });
    expect(created.upload.url).toBe(upload.url);
  });

  it("passes on the API's reason for refusing a request", async () => {
    fetchMock.mockResolvedValue(json(409, { detail: 'Another video already uses this id' }));
    const request = api.createVideo({ id: 'vid-1', original_filename: 'big.mp4', declared_size: 1 });
    await expect(request).rejects.toThrow(new ApiError(409, 'Another video already uses this id'));
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }));
    await expect(api.playback('vid-1')).rejects.toThrow('Request failed (HTTP 502).');
  });

  it('falls back to a generic message when a JSON error has no reason', async () => {
    fetchMock.mockResolvedValue(json(500, { message: 'oops' }));
    await expect(api.playback('vid-1')).rejects.toThrow('Request failed (HTTP 500).');
  });

  it('reprocesses a video, getting it back with its analysis queued again', async () => {
    const reset = video({ state: 'queued' });
    fetchMock.mockResolvedValue(json(202, reset));
    await expect(api.reprocess('vid-1')).resolves.toEqual(reset);
    expect(sent().method).toBe('POST');
    expect(new URL(sent().url).pathname).toBe('/api/videos/vid-1/reprocess');
  });

  it('loads a video, reporting an unknown one as a 404', async () => {
    fetchMock.mockResolvedValue(json(404, { detail: 'Video not found' }));
    await expect(api.video('vid-1')).rejects.toThrow(new ApiError(404, 'Video not found'));
    expect(new URL(sent().url).pathname).toBe('/api/videos/vid-1');
  });

  it('escapes the video id in every URL', async () => {
    fetchMock.mockResolvedValue(json(200, { sample_fps: 2, display_threshold: 0.4, detections: [] }));
    await api.detections('a/b');
    expect(new URL(sent().url).pathname).toBe('/api/videos/a%2Fb/detections');
    expect(api.eventsUrl('a/b')).toBe('/api/videos/a%2Fb/events');
  });
});
