import { requirePro } from '../../lib/withRoleCheck';
import StatsWorkspace from '../../components/StatsWorkspace';

export default async function StatsPage() {
  await requirePro();
  return <StatsWorkspace />;
}
