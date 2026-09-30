import { vi } from 'vitest';
import type { Analysis, Video } from '../api/types';

/** An analysis as the API would send it; override only what a test cares about. */
export function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    state: 'queued',
    progress: null,
    error: null,
    attempts: 0,
    frames_sampled: null,
    detection_count: null,
    ...overrides,
  };
}

/** A video as the API would send it: the first argument overrides its analysis, the second the rest. */
export function video(analysisOverrides: Partial<Analysis> = {}, overrides: Partial<Omit<Video, 'analysis'>> = {}): Video {
  return {
    id: 'vid-1',
    original_filename: 'lunch.mp4',
    duration_s: null,
    codec: null,
    ...overrides,
    analysis: analysis(analysisOverrides),
  };
}

type Listener = (event: MessageEvent<string>) => void;

/** EventSource stand-in: tests play the server's part by hand. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  private readonly listeners: Listener[] = [];

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  static get latest(): FakeEventSource {
    const latest = FakeEventSource.instances.at(-1);
    if (!latest) throw new Error('No EventSource was opened');
    return latest;
  }

  static install() {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  }

  addEventListener(type: string, listener: Listener) {
    if (type === 'message') this.listeners.push(listener);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** The server sends the video as the event's data (a default `message` event). */
  emitVideo(video: Video) {
    this.emitRaw(JSON.stringify(video));
  }

  emitRaw(data: string) {
    this.readyState = FakeEventSource.OPEN;
    for (const listener of this.listeners) listener(new MessageEvent('message', { data }));
  }

  /** The stream dropped (for example the server's planned 60 s end); the browser retries by itself. */
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }

  /** A non-200 response (a 429 or 503, say): the browser gives up for good. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

type FrameCallback = (now: number, frame: { mediaTime: number }) => void;

/**
 * requestVideoFrameCallback stand-in. jsdom plays no media, so `presentFrame()` plays the
 * browser presenting a frame at a given media time.
 */
export const videoFrames = {
  pending: [] as FrameCallback[],
  install() {
    videoFrames.pending = [];
    Object.assign(HTMLVideoElement.prototype, {
      requestVideoFrameCallback(callback: FrameCallback) {
        videoFrames.pending.push(callback);
        return videoFrames.pending.length;
      },
      cancelVideoFrameCallback() {},
    });
  },
  presentFrame(mediaTime: number) {
    const callbacks = videoFrames.pending;
    videoFrames.pending = [];
    for (const callback of callbacks) callback(performance.now(), { mediaTime });
  },
};

interface VideoState {
  videoWidth?: number;
  videoHeight?: number;
  currentTime?: number;
  readyState?: number;
}

/** jsdom plays no media: set what a browser would report for the element. */
export function setVideoState(video: HTMLVideoElement, state: VideoState) {
  for (const [key, value] of Object.entries(state)) {
    Object.defineProperty(video, key, { value, configurable: true, writable: true });
  }
}

/** A promise the test resolves or rejects when it wants to. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
