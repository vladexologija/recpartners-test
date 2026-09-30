import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { errorText } from '../../lib/errors';
import { routes } from '../../routes';
import type { Sample } from './overlay';
import { Player } from './Player';
import { StatusPanel } from './StatusPanel';
import { useDetections } from './useDetections';
import { usePlaybackUrl } from './usePlaybackUrl';
import { useVideo } from './useVideo';
import { Verdict } from './Verdict';

/** One empty list for every render, so the player's frame sync is not re-subscribed until results arrive. */
const NO_SAMPLES: Sample[] = [];

/** Everything about one video: its live status, the player with the boxes, the result and Reprocess. */
export function VideoDetails({ id }: { id: string }) {
  const { video, setVideo, connection, notFound } = useVideo(id);
  const state = video?.analysis.state;
  const playback = usePlaybackUrl(id, state !== undefined && state !== 'awaiting_upload');
  const { detections, error: detectionsError } = useDetections(id, state === 'done');
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  // Reprocess deletes the results and starts the analysis over (design doc D3a).
  async function reprocess() {
    setReprocessError(null);
    setReprocessing(true);
    try {
      setVideo(await api.reprocess(id)); // queued again, so useVideo follows it
    } catch (error) {
      setReprocessError(errorText(error));
    } finally {
      setReprocessing(false);
    }
  }

  if (notFound) {
    return (
      <section className="card">
        <h2>Video not found</h2>
        <p>
          <Link to={routes.upload}>Upload a video</Link>
        </p>
      </section>
    );
  }

  const error = reprocessError ?? playback.error ?? detectionsError;
  const canReprocess = state === 'done' || state === 'failed';

  return (
    <section className="card">
      <div className="video-header">
        <h2>{video?.original_filename ?? 'Video'}</h2>
        <Link className="button-link" to={routes.upload}>
          Upload another video
        </Link>
      </div>

      <StatusPanel analysis={video?.analysis ?? null} connection={connection} />

      {video?.codec && video.codec !== 'h264' && (
        <p className="warning">
          This video is encoded as {video.codec.toUpperCase()}, which some browsers cannot play.
        </p>
      )}
      {video && detections && <Verdict video={video} detections={detections} />}

      {playback.url && (
        <Player
          src={playback.url}
          samples={detections?.samples ?? NO_SAMPLES}
          maxDeltaSeconds={detections ? 0.5 / detections.response.sample_fps : 0}
          onMediaError={playback.onPlaybackError}
        />
      )}

      {canReprocess && (
        <div>
          <button type="button" onClick={() => void reprocess()} disabled={reprocessing}>
            Reprocess
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
