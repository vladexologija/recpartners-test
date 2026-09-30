/** The app's URLs. The server answers every non-API path with index.html, so these survive a reload. */
export const routes = {
  upload: '/',
  video: (id: string) => `/videos/${encodeURIComponent(id)}`,
};
