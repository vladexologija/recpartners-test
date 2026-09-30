import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadTarget } from '../../api/types';
import { putFile } from './putFile';

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const target: UploadTarget = {
  method: 'PUT',
  url: 'https://storage.googleapis.com/hotdog-uploads/videos/vid-1.mp4?X-Goog-Signature=abc',
  headers: {
    'Content-Type': 'video/mp4',
    'x-goog-content-length-range': '4,4',
    'x-goog-if-generation-match': '0',
  },
};
const file = new File(['abcd'], 'lunch.mp4', { type: 'video/mp4' });

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr));
afterEach(() => vi.unstubAllGlobals());

// Requirement: the file lands in GCS without being streamed through the API process.
describe('putFile', () => {
  it('sends the file straight to the signed storage URL, not to the API', () => {
    void putFile(target, file, () => {});
    expect(FakeXhr.last.method).toBe('PUT');
    expect(FakeXhr.last.url).toBe(target.url);
    expect(FakeXhr.last.url.startsWith('/api')).toBe(false);
    expect(FakeXhr.last.body).toBe(file);
  });

  it('sends exactly the signed headers, so storage enforces the size and type', () => {
    void putFile(target, file, () => {});
    expect(FakeXhr.last.headers).toEqual(target.headers);
  });

  it('reports upload progress', () => {
    const onProgress = vi.fn();
    void putFile(target, file, onProgress);
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    expect(onProgress).toHaveBeenCalledWith(0.25);
    FakeXhr.last.upload.onprogress?.({ lengthComputable: false, loaded: 60, total: 0 });
    expect(onProgress).toHaveBeenCalledOnce();
  });

  it('resolves when storage accepts the file', async () => {
    const upload = putFile(target, file, () => {});
    FakeXhr.last.respond(200);
    await expect(upload).resolves.toBeUndefined();
  });

  it('fails when storage refuses the file (a size outside the signed range, say)', async () => {
    const upload = putFile(target, file, () => {});
    FakeXhr.last.respond(400);
    await expect(upload).rejects.toThrow('HTTP 400');
  });

  it('fails on a network error', async () => {
    const upload = putFile(target, file, () => {});
    FakeXhr.last.onerror?.();
    await expect(upload).rejects.toThrow('network error');
  });
});
