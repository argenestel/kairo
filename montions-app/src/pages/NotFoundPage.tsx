import { useCopy } from '../copy';
import { Link } from '../state/route';

export default function NotFoundPage() {
  const copy = useCopy();
  return (
    <div className="page page--404">
      <p className="page--404__code">404</p>
      <h1 className="title">{copy.notfound.title}</h1>
      <p className="subtitle">{copy.notfound.sub}</p>
      <div className="page--404__links">
        <Link to="/" className="continue-btn" style={{ width: 'auto', padding: '0 22px' }}>{copy.notfound.home}</Link>
        <Link to="/markets" className="glass-btn">{copy.nav.markets}</Link>
        <Link to="/predictions" className="glass-btn">{copy.nav.predictions}</Link>
      </div>
    </div>
  );
}
