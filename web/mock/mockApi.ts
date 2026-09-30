import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { Analysis, AnalysisState, CreateVideoRequest, Detection, Video } from '../src/api/types.ts';

/**
 * Dev-only stand-in for the Python API and GCS (`pnpm dev:mock`), so the frontend can be exercised
 * before the backend exists. Processing is simulated: queued → processing → done, with fake boxes.
 * A filename containing "nohotdog" finishes without detections; one containing "fail" fails.
 */

const MAX_BYTES = 200 * 1024 * 1024;
const SAMPLE_FPS = 2;
const FINISHED: ReadonlySet<AnalysisState> = new Set(['done', 'failed']);

/** What the mock keeps per video: the API's view of it, the stored file, the boxes and the open streams. */
interface VideoRecord {
  video: Video;
  size: number;
  bytes: Buffer | null;
  detections: Detection[];
  streams: Set<ServerResponse>;
  /** Goes up with every simulated job, so a job that Reprocess started over stops reporting. */
  job: number;
}

export function mockApi(): Plugin {
  const videos = new Map<string, VideoRecord>();
  return {
    name: 'hotdog-mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        route(videos, req, res).then(
          (handled) => {
            if (!handled) next();
          },
          (error: unknown) => sendJson(res, 500, { detail: String(error) }),
        );
      });
    },
  };
}

async function route(videos: Map<string, VideoRecord>, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (req.method === 'POST' && path === '/api/videos') {
    const body = JSON.parse((await readBody(req)).toString()) as CreateVideoRequest;
    if (!(body.declared_size > 0 && body.declared_size <= MAX_BYTES) || !body.original_filename.toLowerCase().endsWith('.mp4')) {
      sendJson(res, 400, { detail: 'Only MP4 files up to 200 MB.' });
      return true;
    }
    if (!videos.has(body.id)) {
      videos.set(body.id, {
        video: {
          id: body.id,
          original_filename: body.original_filename,
          duration_s: null,
          codec: null,
          analysis: blankAnalysis('awaiting_upload'),
        },
        size: body.declared_size,
        bytes: null,
        detections: [],
        streams: new Set(),
        job: 0,
      });
    }
    sendJson(res, 201, {
      id: body.id,
      upload: {
        method: 'PUT',
        url: `/mock-storage/${body.id}`,
        headers: {
          'Content-Type': 'video/mp4',
          'x-goog-content-length-range': `${body.declared_size},${body.declared_size}`,
          'x-goog-if-generation-match': '0',
        },
      },
    });
    return true;
  }

  const storage = /^\/mock-storage\/([^/]+)$/.exec(path);
  if (storage?.[1]) {
    const record = videos.get(storage[1]);
    if (!record) return notFound(res);
    if (req.method === 'PUT') {
      const bytes = await readBody(req);
      // Like GCS with the signed headers: exact size, video/mp4, and never overwrite.
      if (req.headers['x-goog-content-length-range'] !== `${record.size},${record.size}` || bytes.length !== record.size) {
        sendJson(res, 400, { detail: 'Size does not match the signed range.' });
      } else if (req.headers['content-type'] !== 'video/mp4') {
        sendJson(res, 403, { detail: 'Signature does not match.' });
      } else if (record.bytes) {
        sendJson(res, 412, { detail: 'The object already exists.' });
      } else {
        record.bytes = bytes;
        res.statusCode = 200;
        res.end();
        setTimeout(() => runJob(record), 800); // the storage notification takes a moment
      }
      return true;
    }
    if (req.method === 'GET' && record.bytes) {
      sendVideo(req, res, record.bytes);
      return true;
    }
    return notFound(res);
  }

  const one = /^\/api\/videos\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && one?.[1]) {
    const record = videos.get(one[1]);
    if (!record) return notFound(res);
    sendJson(res, 200, record.video);
    return true;
  }

  const api = /^\/api\/videos\/([^/]+)\/(events|playback|detections|reprocess)$/.exec(path);
  if (!api?.[1]) return false;
  const record = videos.get(api[1]);
  if (!record) return notFound(res);

  switch (api[2]) {
    case 'events':
      openStream(record, res);
      return true;
    case 'playback':
      sendJson(res, 200, { url: `/mock-storage/${record.video.id}` });
      return true;
    case 'detections':
      sendJson(res, 200, { sample_fps: SAMPLE_FPS, display_threshold: 0.4, detections: record.detections });
      return true;
    case 'reprocess':
      // Like the real API (design doc D3a): delete the results and start over, unless it is processing.
      if (record.video.analysis.state === 'processing') {
        sendJson(res, 409, { detail: 'This video is still being processed.' });
        return true;
      }
      record.detections = [];
      runJob(record);
      sendJson(res, 202, record.video); // its analysis is queued again
      return true;
  }
  return false;
}

/** An analysis with nothing to report yet. */
function blankAnalysis(state: AnalysisState): Analysis {
  return { state, progress: null, error: null, attempts: 0, frames_sampled: null, detection_count: null };
}

/** Simulates the worker, after the upload or a Reprocess: queued for a moment, ten progress steps, then a result. */
function runJob(record: VideoRecord) {
  const job = ++record.job;
  const update = (analysis: Partial<Analysis>, fields: Partial<Omit<Video, 'analysis'>> = {}) => {
    if (record.job !== job) return false; // a Reprocess started the analysis over
    record.video = { ...record.video, ...fields, analysis: { ...record.video.analysis, ...analysis } };
    publish(record);
    return true;
  };

  update(blankAnalysis('queued'));
  setTimeout(() => {
    const started = update(
      { state: 'processing', progress: 0, attempts: record.video.analysis.attempts + 1 },
      { codec: 'h264' },
    );
    if (!started) return;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      if (step < 10) {
        if (!update({ progress: step / 10 })) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      const name = record.video.original_filename.toLowerCase();
      if (name.includes('fail')) {
        update({ state: 'failed', error: 'Not a valid MP4 (simulated failure).' });
        return;
      }
      record.detections = name.includes('nohotdog') ? [] : fakeDetections();
      update(
        { state: 'done', progress: 1, frames_sampled: 16, detection_count: record.detections.length },
        { duration_s: 8 },
      );
    }, 2_000); // about 20 s in total: slow enough to reload the page mid-job
  }, 1500);
}

/** A box sliding left to right from 1 s to 6 s, plus one below the display threshold at 7 s. */
function fakeDetections(): Detection[] {
  const detections: Detection[] = [];
  for (let t = 1; t <= 6; t += 1 / SAMPLE_FPS) {
    const x1 = 0.1 + (t - 1) * 0.08;
    detections.push({ t_seconds: t, x1, y1: 0.35, x2: x1 + 0.3, y2: 0.65, confidence: 0.85 });
  }
  detections.push({ t_seconds: 7, x1: 0.6, y1: 0.1, x2: 0.8, y2: 0.3, confidence: 0.3 });
  return detections;
}

/** Like the real API: the video on connect and on every change, closed after 60 s or once the analysis is finished. */
function openStream(record: VideoRecord, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  writeVideo(res, record.video);
  if (FINISHED.has(record.video.analysis.state)) {
    res.end();
    return;
  }
  record.streams.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  const lifetime = setTimeout(() => res.end(), 60_000);
  res.on('close', () => {
    clearInterval(ping);
    clearTimeout(lifetime);
    record.streams.delete(res);
  });
}

function publish(record: VideoRecord) {
  for (const stream of record.streams) {
    writeVideo(stream, record.video);
    if (FINISHED.has(record.video.analysis.state)) stream.end();
  }
}

function writeVideo(res: ServerResponse, video: Video) {
  res.write(`data: ${JSON.stringify(video)}\n\n`);
}

/** Serves the stored file with byte-range support, which <video> needs for seeking. */
function sendVideo(req: IncomingMessage, res: ServerResponse, bytes: Buffer) {
  const total = bytes.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!range) {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': total, 'Accept-Ranges': 'bytes' });
    res.end(bytes);
    return;
  }
  const [, from = '', to = ''] = range;
  const start = from === '' ? Math.max(0, total - Number(to)) : Number(from);
  const end = from !== '' && to !== '' ? Math.min(Number(to), total - 1) : total - 1;
  if (start > end || start >= total) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
  });
  res.end(bytes.subarray(start, end + 1));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): true {
  sendJson(res, 404, { detail: 'Not found.' });
  return true;
}
