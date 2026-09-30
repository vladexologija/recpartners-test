// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setVideoState, videoFrames } from '../../test/fakes';
import type { Sample } from './overlay';
import { Player } from './Player';

const STORAGE_URL = 'https://storage.googleapis.com/hotdog-uploads/videos/vid-1.mp4?X-Goog-Signature=abc';
const samples: Sample[] = [
  { t: 3, boxes: [{ x1: 0.25, y1: 0.5, x2: 0.75, y2: 1, confidence: 0.85 }] },
  { t: 5, boxes: [{ x1: 0.5, y1: 0, x2: 1, y2: 0.5, confidence: 0.6 }] },
];

beforeEach(() => {
  videoFrames.install();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const name of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) Reflect.deleteProperty(document, name);
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
});

/** A 1280×720 video whose metadata has loaded. */
function renderPlayer(props: Partial<ComponentProps<typeof Player>> = {}) {
  const onMediaError = vi.fn();
  const view = render(
    <Player src={STORAGE_URL} samples={samples} maxDeltaSeconds={0.25} onMediaError={onMediaError} {...props} />,
  );
  const video = view.container.querySelector('video');
  if (!video) throw new Error('no <video>');
  setVideoState(video, { videoWidth: 1280, videoHeight: 720, currentTime: 0, readyState: 4 });
  fireEvent.loadedMetadata(video);
  return { ...view, video, onMediaError };
}

/** The boxes drawn, in the video's own pixels. */
function drawnBoxes(container: HTMLElement) {
  return [...container.querySelectorAll('.box')].map((box) => {
    const rect = box.querySelector('rect');
    const at = (name: string) => Number(rect?.getAttribute(name));
    return { x: at('x'), y: at('y'), width: at('width'), height: at('height'), label: box.textContent };
  });
}

const boxAt3s = { x: 320, y: 360, width: 640, height: 360, label: 'hot dog 85%' };
const boxAt5s = { x: 640, y: 0, width: 640, height: 360, label: 'hot dog 60%' };

/** A browser with the Fullscreen API, as on desktop and iPad. jsdom has none, like an iPhone. */
function withFullscreenApi() {
  const requestFullscreen = vi.fn(async () => {});
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { value: requestFullscreen, configurable: true });
  return requestFullscreen;
}

// Requirements: play the uploaded file from storage; draw boxes in time with playback; keep them
// aligned when the viewer seeks, pauses and resizes the window.
describe('Player', () => {
  it('plays the uploaded file from its storage URL, not a local copy', () => {
    const { video } = renderPlayer();
    expect(video.getAttribute('src')).toBe(STORAGE_URL);
  });

  it('fits the boxes to the picture exactly as object-fit: contain fits the video, through any resize', () => {
    const { container } = renderPlayer();
    const overlay = container.querySelector('svg.overlay');
    // The viewBox is the picture's own size, and "meet" scales and centres it like "contain".
    expect(overlay?.getAttribute('viewBox')).toBe('0 0 1280 720');
    expect(overlay?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('draws nothing until the size of the picture is known', () => {
    const { container } = render(
      <Player src={STORAGE_URL} samples={samples} maxDeltaSeconds={0.25} onMediaError={() => {}} />,
    );
    act(() => videoFrames.presentFrame(3));
    expect(container.querySelector('.overlay')).toBeNull();
  });

  it('draws the boxes of the frame on screen', () => {
    const { container } = renderPlayer();
    act(() => videoFrames.presentFrame(3.02));
    expect(drawnBoxes(container)).toEqual([boxAt3s]);
  });

  it('follows the frames as the video plays', () => {
    const { container } = renderPlayer();
    act(() => videoFrames.presentFrame(3));
    expect(drawnBoxes(container)).toEqual([boxAt3s]);
    act(() => videoFrames.presentFrame(5.1));
    expect(drawnBoxes(container)).toEqual([boxAt5s]);
  });

  it('shows no box on frames far from any sample', () => {
    const { container } = renderPlayer();
    act(() => videoFrames.presentFrame(4));
    expect(drawnBoxes(container)).toEqual([]);
  });

  it('follows a seek', () => {
    const { container, video } = renderPlayer();
    setVideoState(video, { currentTime: 5.1 });
    fireEvent.seeked(video);
    expect(drawnBoxes(container)).toEqual([boxAt5s]);
  });

  it('shows the right box when paused', () => {
    const { container, video } = renderPlayer();
    setVideoState(video, { currentTime: 3.1 });
    fireEvent.pause(video);
    expect(drawnBoxes(container)).toEqual([boxAt3s]);
  });

  it('goes fullscreen with the whole stage, so the boxes come along', () => {
    const requestFullscreen = withFullscreenApi();
    const { video } = renderPlayer();

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));

    const target = requestFullscreen.mock.contexts[0] as HTMLElement;
    expect(target.classList.contains('stage')).toBe(true);
    // Native fullscreen would take only the <video> and leave the boxes behind.
    expect(video.getAttribute('controlslist')).toBe('nofullscreen');
  });

  it('offers to leave fullscreen once the stage is fullscreen', () => {
    withFullscreenApi();
    const exitFullscreen = vi.fn(async () => {});
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true });
    const { container } = renderPlayer();

    Object.defineProperty(document, 'fullscreenElement', { value: container.querySelector('.stage'), configurable: true });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));

    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('fills the window instead where the Fullscreen API is missing, as on iPhone', () => {
    const { container } = renderPlayer();
    const stage = container.querySelector('.stage');

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(stage?.classList.contains('filled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(stage?.classList.contains('filled')).toBe(false);
  });

  it('reports a playback error, so an expired signed URL can be replaced', () => {
    const { video, onMediaError } = renderPlayer();
    fireEvent.error(video);
    expect(onMediaError).toHaveBeenCalledOnce();
  });

  it('falls back to animation frames in browsers without requestVideoFrameCallback', () => {
    Reflect.deleteProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback');
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const nextFrame = () => {
      const pending = frames;
      frames = [];
      for (const callback of pending) callback(performance.now());
    };
    const { container, video, unmount } = renderPlayer();

    setVideoState(video, { currentTime: 3 });
    act(nextFrame);
    expect(drawnBoxes(container)).toEqual([boxAt3s]);

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('continues from the same position when the URL is replaced', () => {
    const { video, rerender } = renderPlayer();
    setVideoState(video, { currentTime: 42 });
    fireEvent.timeUpdate(video);

    rerender(
      <Player src={`${STORAGE_URL}&renewed=1`} samples={samples} maxDeltaSeconds={0.25} onMediaError={() => {}} />,
    );
    setVideoState(video, { currentTime: 0 });
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(42);
  });
});
