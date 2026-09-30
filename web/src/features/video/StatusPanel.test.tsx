// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { analysis } from '../../test/fakes';
import { StatusPanel } from './StatusPanel';

afterEach(cleanup);

const status = () => screen.getByRole('status').textContent;

// Requirement: the interface shows job state: queued, processing, done, failed.
describe('StatusPanel', () => {
  it.each([
    ['queued', 'Queued'],
    ['processing', 'Processing'],
    ['done', 'Done'],
    ['failed', 'Failed'],
  ] as const)('names the %s state as the brief does', (state, label) => {
    render(<StatusPanel analysis={analysis({ state })} connection="open" />);
    expect(screen.getByRole('status').querySelector('strong')?.textContent).toBe(label);
  });

  it('shows how far processing has got', () => {
    render(<StatusPanel analysis={analysis({ state: 'processing', progress: 0.4 })} connection="open" />);
    expect(status()).toContain('Processing: looking for hot dogs… 40%');
    expect(screen.getByRole('progressbar')).toHaveProperty('value', 0.4);
  });

  it('shows why a job failed', () => {
    render(<StatusPanel analysis={analysis({ state: 'failed', error: 'Not a valid MP4.' })} connection="closed" />);
    expect(status()).toContain('Not a valid MP4.');
  });

  it('waits for storage to confirm a finished upload', () => {
    render(<StatusPanel analysis={analysis({ state: 'awaiting_upload' })} connection="open" />);
    expect(status()).toContain('Uploaded: waiting for storage to confirm');
  });

  it('shows when a job had to restart after a worker crash', () => {
    render(<StatusPanel analysis={analysis({ state: 'processing', attempts: 2 })} connection="open" />);
    expect(status()).toContain('started 2×');
  });

  it('shows a lost connection', () => {
    render(<StatusPanel analysis={analysis()} connection="reconnecting" />);
    expect(status()).toContain('Connection lost, reconnecting');
  });

  it('shows that it is connecting before the video has loaded', () => {
    render(<StatusPanel analysis={null} connection="connecting" />);
    expect(status()).toBe('Connecting…');
  });

  it('shows that it is reconnecting before the video has loaded', () => {
    render(<StatusPanel analysis={null} connection="reconnecting" />);
    expect(status()).toBe('Reconnecting…');
  });
});
