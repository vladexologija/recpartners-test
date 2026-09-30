/**
 * The API contract, generated from the FastAPI app, which leads (design doc D10).
 * `make api-types` regenerates schema.gen.ts from api/'s OpenAPI schema; these are the
 * frontend's names for its models.
 */
import type { components } from './schema.gen';

type Schemas = components['schemas'];

/**
 * A video, as `GET /api/videos/{id}` returns it. While its analysis runs, the video's event
 * stream sends it again (as each event's data) on connect and on every change.
 */
export type Video = Schemas['VideoPublic'];

/** The hot-dog detection run on a video. Reprocess starts it over. */
export type Analysis = Schemas['AnalysisPublic'];

/** The job states the brief asks the UI to show, plus the time before the upload has landed. */
export type AnalysisState = Analysis['state'];

export type CreateVideoRequest = Schemas['VideoCreate'];
export type CreateVideoResponse = Schemas['VideoCreated'];

/** A signed upload straight to GCS. */
export type UploadTarget = Schemas['UploadTarget'];

/** One box, in coordinates normalized to the picture (0–1), `t_seconds` into the video. */
export type Detection = Schemas['DetectionPublic'];

export type DetectionsResponse = Schemas['DetectionsPublic'];
export type PlaybackResponse = Schemas['PlaybackPublic'];
