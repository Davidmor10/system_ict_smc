import JournalWorkspace from '../../components/JournalWorkspace';
import { requirePro } from '../../lib/withRoleCheck';

// 🔒 PROTECTED — Pro-only page. requirePro() resolves the role from Supabase
// server-side and redirects non-pro users to /checkout before any client code
// loads, so the gate cannot be bypassed from the browser. Defaults to 'free'
// (i.e. denied) if the role lookup fails, keeping access fail-closed.
export default async function JournalPage() {
  await requirePro();
  return <JournalWorkspace />;
}
