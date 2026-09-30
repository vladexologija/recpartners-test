// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { Video } from '../../api/types';
import { deferred, FakeEventSource, video } from '../../test/fakes';
import { SLOW_RECONNECT_MS, useVideo } from './useVideo';

const server = () => FakeEventSource.latest;
/** Lets the video's GET settle, and React apply what it brought. */
const settle = () => act(async () => {});

beforeEach(() => {
  FakeEventSource.install();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(api, 'video').mockResolvedValue(video({ state: 'queued' }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Requirements: processing is asynchronous and the UI shows the job state (queued, processing,
// done, failed), recovering correctly when the page is reloaded mid-job.
describe('useVideo', () => {
  it('loads the video with a plain GET, as after a reload mid-job', async () => {
    vi.mocked(api.video).mockResolvedValue(video({ state: 'processing', progress: 0.7 }));
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();

    expect(api.video).toHaveBeenCalledWith('vid-1');
    expect(result.current.video?.analysis).toMatchObject({ state: 'processing', progress: 0.7 });
    expect(result.current.connection).toBe('open');
  });

  it('follows the analysis over server-sent events while it runs', async () => {
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();
    expect(server().url).toBe('/api/videos/vid-1/events');

    act(() => server().emitVideo(video({ state: 'processing', progress: 0.4 })));
    expect(result.current.video?.analysis).toMatchObject({ state: 'processing', progress: 0.4 });
  });

  it.each(['done', 'failed'] as const)('opens no stream for a video whose analysis is already %s', async (state) => {
    vi.mocked(api.video).mockResolvedValue(video({ state }));
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();

    expect(result.current.video?.analysis.state).toBe(state);
    expect(result.current.connection).toBe('closed');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it.each(['done', 'failed'] as const)('closes the stream once the analysis is %s, so the browser does not reconnect', async (state) => {
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();
    act(() => server().emitVideo(video({ state })));

    expect(server().readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current.connection).toBe('closed');
    act(() => {
      server().fail();
      vi.advanceTimersByTime(60_000);
    });
    expect(api.video).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('says so when the video does not exist, instead of retrying', async () => {
    vi.mocked(api.video).mockRejectedValue(new ApiError(404, 'Not found.'));
    const { result } = renderHook(() => useVideo('nope'));
    await settle();

    expect(result.current.notFound).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(api.video).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('loads again with a growing backoff, capped at 30 s, while the server fails', async () => {
    vi.mocked(api.video).mockRejectedValue(new ApiError(503, 'Unavailable.'));
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const loads = vi.mocked(api.video).mock.calls.length;
      expect(result.current.connection).toBe('reconnecting');
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(api.video).toHaveBeenCalledTimes(loads);
      act(() => vi.advanceTimersByTime(1));
      expect(api.video).toHaveBeenCalledTimes(loads + 1);
      await settle();
    }
  });

  it('reconnects with a growing backoff, capped at 30 s, when the server refuses the stream', async () => {
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const opened = FakeEventSource.instances.length;
      act(() => server().fail());
      expect(result.current.connection).toBe('reconnecting');
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeEventSource.instances).toHaveLength(opened);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeEventSource.instances).toHaveLength(opened + 1);
    }
    expect(api.video).toHaveBeenCalledTimes(1);
  });

  it('starts the backoff again once the stream delivers', async () => {
    renderHook(() => useVideo('vid-1'));
    await settle();
    act(() => server().fail());
    act(() => vi.advanceTimersByTime(1_000));
    act(() => server().fail());
    act(() => vi.advanceTimersByTime(2_000));
    act(() => server().emitVideo(video({ state: 'processing' })));

    act(() => server().fail());
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it("stays quiet about the server's planned stream end, which the browser reconnects by itself", async () => {
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();

    act(() => server().drop());
    act(() => vi.advanceTimersByTime(SLOW_RECONNECT_MS - 1));
    expect(result.current.connection).toBe('open');

    act(() => server().emitVideo(video({ state: 'processing' })));
    act(() => vi.advanceTimersByTime(SLOW_RECONNECT_MS));
    expect(result.current.connection).toBe('open');
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(api.video).toHaveBeenCalledTimes(1);
  });

  it('reports a lost connection that drags on', async () => {
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();
    act(() => server().drop());
    act(() => vi.advanceTimersByTime(SLOW_RECONNECT_MS));
    expect(result.current.connection).toBe('reconnecting');
  });

  it('ignores a malformed event', async () => {
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();
    act(() => server().emitVideo(video({ state: 'processing', progress: 0.3 })));
    act(() => server().emitRaw('{not json'));
    expect(result.current.video?.analysis.progress).toBe(0.3);
  });

  it('follows the analysis again once it runs anew, as after Reprocess', async () => {
    vi.mocked(api.video).mockResolvedValue(video({ state: 'done' }));
    const { result } = renderHook(() => useVideo('vid-1'));
    await settle();
    expect(FakeEventSource.instances).toHaveLength(0);

    act(() => result.current.setVideo(video({ state: 'queued' })));
    expect(server().url).toBe('/api/videos/vid-1/events');
    act(() => server().emitVideo(video({ state: 'processing', progress: 0.1 })));
    expect(result.current.video?.analysis).toMatchObject({ state: 'processing', progress: 0.1 });
    expect(api.video).toHaveBeenCalledTimes(1);
  });

  it('opens no stream when the page went away before the video loaded', async () => {
    const pending = deferred<Video>();
    vi.mocked(api.video).mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useVideo('vid-1'));
    unmount();
    await act(async () => pending.resolve(video()));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('closes the stream when the page goes away', async () => {
    const { unmount } = renderHook(() => useVideo('vid-1'));
    await settle();
    unmount();
    expect(server().readyState).toBe(FakeEventSource.CLOSED);
  });
});
