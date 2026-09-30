import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatPercent } from '../../lib/format';
import { nearestSampleIndex, type Sample } from './overlay';

interface PlayerProps {
  src: string;
  samples: readonly Sample[];
  /** A sample's boxes show while playback is within this many seconds of it. */
  maxDeltaSeconds: number;
  onMediaError: () => void;
}

/** The picture's own size in pixels, known once the video's metadata has loaded. */
interface PictureSize {
  width: number;
  height: number;
}

/** Label text size, as a share of the picture's shorter side: labels scale with the picture. */
const LABEL_SIZE = 0.04;

/**
 * Plays the video from storage and draws boxes over it (design doc D8). The boxes are an SVG layer
 * whose viewBox is the picture's own size. With `preserveAspectRatio="xMidYMid meet"` the browser
 * scales and centres it exactly as `object-fit: contain` does the video, so the boxes stay on the
 * picture through resizes, letterboxing and fullscreen with nothing to measure. JavaScript only
 * picks which sample's boxes to show, following playback, seeks and pauses.
 */
export function Player({ src, samples, maxDeltaSeconds, onMediaError }: PlayerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [picture, setPicture] = useState<PictureSize | null>(null);
  const [activeSample, setActiveSample] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  // Where the Fullscreen API is missing, as on iPhone, the stage fills the window instead.
  const [filled, setFilled] = useState(false);

  usePlaybackSample(videoRef, samples, maxDeltaSeconds, setActiveSample);
  useKeepPositionAcrossSourceChanges(videoRef);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenEnabled) setFilled((value) => !value);
    else if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }

  const boxes = samples[activeSample]?.boxes ?? [];

  return (
    <div className={filled ? 'stage filled' : 'stage'} ref={stageRef}>
      <div className="frame">
        {/* Native fullscreen would take only the <video>, leaving the boxes behind. */}
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          controlsList="nofullscreen"
          onError={onMediaError}
          onLoadedMetadata={(event) =>
            setPicture({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
          }
        />
        {picture && (
          <svg
            className="overlay"
            viewBox={`0 0 ${picture.width} ${picture.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            {boxes.map((box, i) => (
              <g key={i} className="box">
                <rect
                  x={box.x1 * picture.width}
                  y={box.y1 * picture.height}
                  width={(box.x2 - box.x1) * picture.width}
                  height={(box.y2 - box.y1) * picture.height}
                />
                <text
                  x={box.x1 * picture.width}
                  y={box.y1 * picture.height}
                  dx="0.3em"
                  dy="1.1em"
                  fontSize={Math.min(picture.width, picture.height) * LABEL_SIZE}
                >
                  hot dog {formatPercent(box.confidence)}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      <div className="player-toolbar">
        <button type="button" onClick={toggleFullscreen}>
          {fullscreen || filled ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  );
}

/**
 * Picks the sample nearest to the frame on screen. requestVideoFrameCallback reports the exact
 * media time of each presented frame; state only changes when the nearest sample changes.
 */
function usePlaybackSample(
  videoRef: RefObject<HTMLVideoElement | null>,
  samples: readonly Sample[],
  maxDeltaSeconds: number,
  onSample: (index: number) => void,
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const times = samples.map((sample) => sample.t);
    const show = (mediaTime: number) => onSample(nearestSampleIndex(times, mediaTime, maxDeltaSeconds));
    const showCurrent = () => show(video.currentTime);

    let stopped = false;
    let handle = 0;
    const hasFrameCallback = 'requestVideoFrameCallback' in video;
    const next = () => {
      if (stopped) return;
      if (hasFrameCallback) {
        handle = video.requestVideoFrameCallback((_now, frame) => {
          show(frame.mediaTime);
          next();
        });
      } else {
        handle = requestAnimationFrame(() => {
          showCurrent();
          next();
        });
      }
    };
    next();

    // Frame callbacks don't fire while paused, so also update after seeks and pauses.
    const events = ['seeked', 'pause', 'loadeddata'] as const;
    for (const name of events) video.addEventListener(name, showCurrent);
    showCurrent();

    return () => {
      stopped = true;
      if (hasFrameCallback) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      for (const name of events) video.removeEventListener(name, showCurrent);
    };
  }, [videoRef, samples, maxDeltaSeconds, onSample]);
}

/** When the signed URL is replaced after an error, continue from the same position. */
function useKeepPositionAcrossSourceChanges(videoRef: RefObject<HTMLVideoElement | null>) {
  const resumeAt = useRef(0);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Loading a new source resets the position to 0 before metadata arrives; ignore that.
    const remember = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resumeAt.current = video.currentTime;
    };
    const restore = () => {
      if (resumeAt.current > 0) video.currentTime = resumeAt.current;
    };
    video.addEventListener('timeupdate', remember);
    video.addEventListener('loadedmetadata', restore);
    return () => {
      video.removeEventListener('timeupdate', remember);
      video.removeEventListener('loadedmetadata', restore);
    };
  }, [videoRef]);
}
