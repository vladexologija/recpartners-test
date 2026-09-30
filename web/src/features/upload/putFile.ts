import type { UploadTarget } from '../../api/types';

/**
 * Uploads the file straight to storage with the signed request the API returned. Uses XHR
 * because fetch() cannot report upload progress.
 */
export function putFile(
  target: UploadTarget,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    // The signature covers these headers, so they must be sent exactly as given.
    for (const [name, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`The upload was rejected (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('The upload failed: network error.'));
    xhr.send(file);
  });
}
