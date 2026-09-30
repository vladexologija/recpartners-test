import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { AnalysisState, Video } from '../../api/types';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'closed';

const FINISHED: ReadonlySet<AnalysisState> = new Set(['done', 'failed']);
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
/** The server ends every stream after 60 s; a quick reconnect after that isn't worth reporting. */
export const SLOW_RECONNECT_MS = 5_000;

/**
 * A video and its analysis (design doc D7). The video is loaded with a plain GET, which also tells
 * an unknown id apart, and followed over server-sent events whenever its analysis is running: after
 * the load, and again after `setVideo` with the video a Reprocess returns. Every (re)connect starts
 * with the whole video, so nothing depends on events missed while away.
 */
export function useVideo(id: string) {
  const [video, setVideo] = useState<Video | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [notFound, setNotFound] = useState(false);
  const running = video !== null && !FINISHED.has(video.analysis.state);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = FIRST_RETRY_MS;

    const load = () => {
      api.video(id).then(
        (loaded) => {
          if (cancelled) return;
          setVideo(loaded);
          setConnection(FINISHED.has(loaded.analysis.state) ? 'closed' : 'open');
        },
        (error: unknown) => {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 404) {
            setNotFound(true);
            return;
          }
          setConnection('reconnecting');
          retryTimer = setTimeout(load, retryMs);
          retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        },
      );
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [id]);

  useEffect(() => {
    if (!running) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = FIRST_RETRY_MS;
    let finished = false;

    const connect = () => {
      source = new EventSource(api.eventsUrl(id));
      source.addEventListener('message', (event) => {
        const next = parseVideo((event as MessageEvent<string>).data);
        if (!next) return;
        clearTimeout(slowTimer);
        retryMs = FIRST_RETRY_MS;
        setVideo(next);
        setConnection('open');
        if (FINISHED.has(next.analysis.state)) {
          // Nothing more to follow. Closing now also stops the browser from reconnecting before
          // this effect is cleaned up.
          finished = true;
          source?.close();
          setConnection('closed');
        }
      });
      source.onerror = () => {
        if (finished) return;
        if (source?.readyState === EventSource.CLOSED) {
          // A non-200 response (a 429 or 503 during a deploy, say): the browser has given up for
          // good, so reconnect with backoff. The first message then says where the analysis stands.
          setConnection('reconnecting');
          retryTimer = setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        } else {
          // A dropped stream: the browser retries by itself. Report it only if it drags on.
          clearTimeout(slowTimer);
          slowTimer = setTimeout(() => setConnection('reconnecting'), SLOW_RECONNECT_MS);
        }
      };
    };

    connect();
    return () => {
      finished = true;
      source?.close();
      clearTimeout(retryTimer);
      clearTimeout(slowTimer);
    };
  }, [id, running]);

  return { video, setVideo, connection, notFound };
}

function parseVideo(data: string): Video | null {
  try {
    return JSON.parse(data) as Video;
  } catch {
    return null; // a malformed event is ignored; the next one replaces it anyway
  }
}
