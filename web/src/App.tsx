import { Route, Routes } from 'react-router';
import { NotFoundPage } from './pages/NotFoundPage';
import { UploadPage } from './pages/UploadPage';
import { VideoPage } from './pages/VideoPage';

export function App() {
  return (
    <main>
      <h1>Is there a hot dog in this video?</h1>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/videos/:id" element={<VideoPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </main>
  );
}
