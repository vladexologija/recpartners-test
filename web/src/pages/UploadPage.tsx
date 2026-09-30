import { useNavigate } from 'react-router';
import { Uploader } from '../features/upload/Uploader';
import { routes } from '../routes';

/** The `/` route: once the upload lands, the video's own page takes over. */
export function UploadPage() {
  const navigate = useNavigate();
  return <Uploader onUploaded={(id) => void navigate(routes.video(id))} />;
}
