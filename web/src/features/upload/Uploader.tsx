import { Fragment, useEffect, useState, type ChangeEvent } from 'react';
import { api } from '../../api/client';
import { MAX_UPLOAD_BYTES, SAMPLE_VIDEOS, type SampleVideo } from '../../config';
import { errorText } from '../../lib/errors';
import { formatMegabytes, formatPercent } from '../../lib/format';
import { putFile } from './putFile';
import { validateVideoFile } from './validate';

type Phase =
  | { kind: 'idle'; error?: string }
  | { kind: 'loading' }
  | { kind: 'checking' }
  | { kind: 'uploading'; progress: number };

export function Uploader({ onUploaded }: { onUploaded: (id: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // A reload cancels the upload, so warn before leaving mid-upload.
  const uploading = phase.kind === 'uploading';
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  async function upload(file: File) {
    setPhase({ kind: 'checking' });
    try {
      await validateVideoFile(file);
      const id = crypto.randomUUID();
      const { upload: target } = await api.createVideo({ id, original_filename: file.name, declared_size: file.size });
      setPhase({ kind: 'uploading', progress: 0 });
      await putFile(target, file, (progress) => setPhase({ kind: 'uploading', progress }));
      onUploaded(id);
    } catch (error) {
      setPhase({ kind: 'idle', error: errorText(error) });
    }
  }

  /** A sample goes through exactly the same checks and upload as a picked file. */
  async function uploadSample(sample: SampleVideo) {
    setPhase({ kind: 'loading' });
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${sample.file}`);
      if (!response.ok) throw new Error(`The sample could not be loaded (HTTP ${response.status}).`);
      const file = new File([await response.arrayBuffer()], sample.file, { type: 'video/mp4' });
      await upload(file);
    } catch (error) {
      setPhase({ kind: 'idle', error: errorText(error) });
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // lets the same file be picked again after an error
    if (file) void upload(file);
  }

  return (
    <section className="card">
      <h2>Upload a video</h2>
      <p className="muted">
        An MP4 of up to {formatMegabytes(MAX_UPLOAD_BYTES)}. It goes straight to storage, then a worker looks
        for hot dogs in it.
      </p>
      <input
        type="file"
        accept="video/mp4,.mp4"
        aria-label="Choose an MP4 video"
        onChange={onPick}
        disabled={phase.kind !== 'idle'}
      />
      <div className="samples">
        <span className="muted">No video at hand? Try a sample:</span>
        {SAMPLE_VIDEOS.map((sample) => (
          <button
            key={sample.file}
            type="button"
            onClick={() => void uploadSample(sample)}
            disabled={phase.kind !== 'idle'}
          >
            {sample.title} ({sample.seconds} s)
          </button>
        ))}
      </div>
      {phase.kind === 'loading' && <p role="status">Loading the sample…</p>}
      {phase.kind === 'checking' && <p role="status">Checking the file…</p>}
      {phase.kind === 'uploading' && (
        <div role="status" className="progress">
          <progress value={phase.progress} max={1} />
          <span>Uploading… {formatPercent(phase.progress)}</span>
        </div>
      )}
      {phase.kind === 'idle' && phase.error && (
        <p className="error" role="alert">
          {phase.error}
        </p>
      )}
      <p className="muted credit">
        Sample clips from Pexels:{' '}
        {SAMPLE_VIDEOS.map((sample, index) => (
          <Fragment key={sample.file}>
            {index > 0 && ', '}
            <a href={sample.source} target="_blank" rel="noreferrer">
              {sample.title.toLowerCase()}
            </a>
          </Fragment>
        ))}
        .
      </p>
    </section>
  );
}
