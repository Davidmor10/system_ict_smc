// GET /api/trade-review/[id] — poll a single review's status/report.
// Returns 404 if the review doesn't belong to the caller (silent 404 rather
// than 403 so we don't leak the existence of other users' review IDs).

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getReview } from '../../../lib/videoReview/reviewStore';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const review = await getReview(id, userId);
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ review });
}
