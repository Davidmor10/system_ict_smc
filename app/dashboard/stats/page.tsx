import StatsView from '../../components/StatsView';

// /dashboard/stats — the performance statistics screen.
//
// A thin server shell: everything is derived on the client from the same
// journal cache the rest of the dashboard reads, so this page adds no network
// round-trip of its own and stays correct the moment a trade is logged.
export default function StatsPage() {
  return <StatsView />;
}
