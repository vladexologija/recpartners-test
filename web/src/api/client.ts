import createClient from 'openapi-fetch';
import type { paths } from './schema.gen';
import type { CreateVideoRequest } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Typed from the FastAPI app's OpenAPI schema (D10): a renamed route, parameter or field
 * breaks `tsc`, not the running page. `fetch` is looked up per request so tests can stub it.
 */
const client = createClient<paths>({
  baseUrl: globalThis.location?.origin,
  fetch: (request) => globalThis.fetch(request),
});

/** Resolves with the response body, or throws an ApiError carrying FastAPI's reason. */
async function body<T>(pending: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await pending;
  if (!response.ok) {
    throw new ApiError(response.status, reason(error) ?? `Request failed (HTTP ${response.status}).`);
  }
  return data as T;
}

/** FastAPI puts the reason in `detail`. */
function reason(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'detail' in error && typeof error.detail === 'string') {
    return error.detail;
  }
  return undefined;
}

const byId = (id: string) => ({ params: { path: { video_id: id } } });

export const api = {
  createVideo: (request: CreateVideoRequest) => body(client.POST('/api/videos', { body: request })),
  video: (id: string) => body(client.GET('/api/videos/{video_id}', byId(id))),
  playback: (id: string) => body(client.GET('/api/videos/{video_id}/playback', byId(id))),
  detections: (id: string) => body(client.GET('/api/videos/{video_id}/detections', byId(id))),
  /** Starts the analysis over; returns the video with its analysis queued again. */
  reprocess: (id: string) => body(client.POST('/api/videos/{video_id}/reprocess', byId(id))),
  /** The event stream (D7) is not part of OpenAPI: EventSource takes a plain URL. */
  eventsUrl: (id: string) => `/api/videos/${encodeURIComponent(id)}/events`,
};
