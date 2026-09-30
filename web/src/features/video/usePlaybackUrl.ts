import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { errorText } from '../../lib/errors';

/** A new signed URL is fetched after a playback error, but at most this often. */
export const PLAYBACK_REFRESH_MS = 30_000;

/**
 * The signed GCS URL the player streams from. It is fetched once the server has recorded the upload:
 * the browser's PUT finishes a moment before GCS's notification reaches the API, and until then the
 * API has nothing to sign (409). A playback error is how an expired URL shows up, so it triggers a
 * fresh one.
 */
export function usePlaybackUrl(id: string, uploaded: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastFetch = useRef(0);

  const fetchUrl = useCallback(() => {
    lastFetch.current = Date.now();
    api.playback(id).then(
      (response) => {
        setUrl(response.url);
        setError(null);
      },
      (failure: unknown) => setError(errorText(failure)),
    );
  }, [id]);

  useEffect(() => {
    if (uploaded) fetchUrl();
  }, [uploaded, fetchUrl]);

  const onPlaybackError = useCallback(() => {
    if (Date.now() - lastFetch.current > PLAYBACK_REFRESH_MS) fetchUrl();
  }, [fetchUrl]);

  return { url, error, onPlaybackError };
}
