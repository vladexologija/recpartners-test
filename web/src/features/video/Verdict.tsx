import type { Video } from '../../api/types';
import { formatDuration, formatPercent } from '../../lib/format';
import type { Detections } from './useDetections';

interface VerdictProps {
  video: Video;
  detections: Detections;
}

export function Verdict({ video, detections }: VerdictProps) {
  const { sample_fps: sampleFps, display_threshold: displayThreshold } = detections.response;
  const frames = video.analysis.frames_sampled ?? 0;
  if (detections.samples.length === 0) {
    const duration = video.duration_s === null ? '' : ` over ${formatDuration(video.duration_s)}`;
    return (
      <p className="verdict verdict-none">
        No hot dog in this video. Checked {frames} frames{duration} at {sampleFps} fps (confidence ≥{' '}
        {formatPercent(displayThreshold)}).
      </p>
    );
  }
  return (
    <p className="verdict verdict-found">
      Hot dog found in {detections.samples.length} of {frames} sampled frames. Play the video to see where.
    </p>
  );
}
