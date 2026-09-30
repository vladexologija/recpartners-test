import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { DetectionsResponse } from '../../api/types';
import { errorText } from '../../lib/errors';
import { toSamples, type Sample } from './overlay';

export interface Detections {
  response: DetectionsResponse;
  /** The boxes at or above the display threshold, grouped per sampled frame. */
  samples: Sample[];
}

type Result = { detections: Detections; error?: undefined } | { detections?: undefined; error: string };

/** The detections of a finished job, fetched each time the job reaches `done`. */
export function useDetections(id: string, done: boolean) {
  const [result, setResult] = useState<Result | null>(null);
  // A Reprocess starts the job over, so the old results go as soon as it is no longer done.
  if (!done && result) setResult(null);

  useEffect(() => {
    if (!done) return;
    let cancelled = false;
    api.detections(id).then(
      (response) => {
        if (!cancelled) {
          setResult({ detections: { response, samples: toSamples(response.detections, response.display_threshold) } });
        }
      },
      (error: unknown) => {
        if (!cancelled) setResult({ error: errorText(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, done]);

  return { detections: result?.detections ?? null, error: result?.error ?? null };
}
