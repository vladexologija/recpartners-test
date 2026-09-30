import { Link } from 'react-router';
import { routes } from '../routes';

export function NotFoundPage() {
  return (
    <section className="card">
      <h2>Page not found</h2>
      <p>
        <Link to={routes.upload}>Upload a video</Link>
      </p>
    </section>
  );
}
