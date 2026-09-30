import { useParams } from 'react-router';
import { VideoDetails } from '../features/video/VideoDetails';

/** The `/videos/:id` route. The video comes from the URL, so a reload mid-job lands back on it. */
export function VideoPage() {
  const { id = '' } = useParams();
  return <VideoDetails key={id} id={id} />; // another video starts with fresh state
}
