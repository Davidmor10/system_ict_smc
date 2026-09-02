import ProgressView from '../../components/ProgressView';

// /dashboard/progress — the journey.
//
// A thin server shell. Everything it shows comes from /api/coach/journey,
// which is read-only by design: opening this page must never advance the
// trader's behavioural state or spend a model call. The nightly run is the
// only thing allowed to write.
export default function ProgressPage() {
  return <ProgressView />;
}
