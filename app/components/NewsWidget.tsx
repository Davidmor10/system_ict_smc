import { fetchAllMacroEvents } from '../lib/news';
import { getWeeklyRange } from '../lib/dateUtils';
import NewsWidgetClient from './NewsWidgetClient';

// Async Server Component — fetches the full week calendar and delegates
// rendering + client-side filtering to NewsWidgetClient.
export default async function NewsWidget() {
  const week = getWeeklyRange();
  const { status, events } = await fetchAllMacroEvents(week);

  return (
    <NewsWidgetClient
      events={events}
      weekLabel={week.label}
      startISO={week.startISO}
      status={status}
    />
  );
}
