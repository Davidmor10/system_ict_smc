// Reading and writing the payment_requests queue. Server only — every function
// here uses the service-role client, which bypasses RLS by design, so the
// scoping in each query IS the access control.

import { createServerSupabaseClient, isSupabaseConfigured } from '../supabase/server';
import { logger } from '../logger';
import { clockInZone } from '../time/zone';
import {
  isPlanKey, isRequestStatus, type PaymentRequest, type PlanKey, type RequestStatus,
} from './plans';

interface Row {
  id: string;
  clerk_id: string;
  full_name: string;
  email: string;
  plan: string;
  amount: number;
  status: string;
  created_at: string;
}

/** A row as the panel and the status card render it.
 *
 *  `time` is formatted here rather than in the browser: the row is server
 *  rendered, and a client formatting it from its own clock would show a
 *  different minute than the one the owner reads on their screen. */
function toRequest(row: Row): PaymentRequest | null {
  if (!isPlanKey(row.plan) || !isRequestStatus(row.status)) return null;
  const at = new Date(row.created_at);
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    plan: row.plan,
    amount: row.amount,
    status: row.status,
    time: Number.isNaN(at.getTime()) ? '—' : clockInZone(undefined, at),
  };
}

/** Every request, newest first. Callers must have checked admin already —
 *  this function does not, because a data helper that also authorises is a
 *  helper somebody calls from the wrong place. */
export async function listAllRequests(limit = 100): Promise<PaymentRequest[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createServerSupabaseClient()
      .from('payment_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(toRequest).filter((r): r is PaymentRequest => r !== null);
  } catch (err) {
    logger.error('payment requests list failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** The signed-in trader's own latest request, for the status card. Scoped by
 *  clerk_id, so it can never return somebody else's. */
export async function latestRequestFor(clerkId: string): Promise<PaymentRequest | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await createServerSupabaseClient()
      .from('payment_requests')
      .select('*')
      .eq('clerk_id', clerkId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = (data ?? [])[0] as Row | undefined;
    return row ? toRequest(row) : null;
  } catch (err) {
    logger.error('payment request lookup failed', { clerkId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export type CreateResult =
  | { ok: true; request: PaymentRequest }
  | { ok: false; reason: 'duplicate' | 'unavailable' | 'failed' };

/** Record a declared transfer.
 *
 *  A trader with a request already pending gets `duplicate` rather than a
 *  second row: two claims for one transfer leave the owner unable to tell
 *  whether they were paid once or twice. The unique partial index in the
 *  migration is what actually guarantees it — this check just turns the race
 *  into a clean answer instead of a 500. */
export async function createRequest(input: {
  clerkId: string;
  fullName: string;
  email: string;
  plan: PlanKey;
  amount: number;
}): Promise<CreateResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: 'unavailable' };
  const supabase = createServerSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('payment_requests')
      .insert({
        clerk_id: input.clerkId,
        full_name: input.fullName,
        email: input.email,
        plan: input.plan,
        amount: input.amount,
      })
      .select('*')
      .single();

    if (error) {
      // 23505 is a unique violation — the partial index above.
      if (error.code === '23505') return { ok: false, reason: 'duplicate' };
      throw error;
    }
    const request = toRequest(data as Row);
    return request ? { ok: true, request } : { ok: false, reason: 'failed' };
  } catch (err) {
    logger.error('payment request create failed', {
      clerkId: input.clerkId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'failed' };
  }
}

/** Apply a decision and, on approval, open the plan.
 *
 *  Returns the row's owner and plan so the caller can act on them. Only moves
 *  a request that is still pending: a second click, or a stale panel, must not
 *  re-grant access or overturn a decision already made. */
export async function decideRequest(
  id: string,
  status: Exclude<RequestStatus, 'pending'>,
  decidedBy: string,
): Promise<{ ok: boolean; clerkId?: string; plan?: PlanKey; alreadyDecided?: boolean }> {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = createServerSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('payment_requests')
      .update({ status, decided_at: new Date().toISOString(), decided_by: decidedBy })
      .eq('id', id)
      .eq('status', 'pending')
      .select('clerk_id, plan')
      .maybeSingle();
    if (error) throw error;

    if (data) {
      const plan = (data as { plan: string }).plan;
      return { ok: true, clerkId: (data as { clerk_id: string }).clerk_id, plan: isPlanKey(plan) ? plan : undefined };
    }

    // No pending row moved. Either somebody decided it already, or — the case
    // this branch exists for — a previous approval marked it and then FAILED
    // to open the access. That left the owner with a row reading "approved",
    // a customer with nothing, and a retry that could only ever return 409,
    // because the row it was looking for was no longer pending. The only way
    // out was a hand-written SQL statement.
    //
    // So a repeat of the same decision reports the row rather than refusing:
    // the caller can run the access grant again, which is idempotent.
    const { data: existing } = await supabase
      .from('payment_requests')
      .select('clerk_id, plan, status')
      .eq('id', id)
      .maybeSingle();

    if (!existing || (existing as { status: string }).status !== status) return { ok: false };
    const plan = (existing as { plan: string }).plan;
    return {
      ok: true,
      alreadyDecided: true,
      clerkId: (existing as { clerk_id: string }).clerk_id,
      plan: isPlanKey(plan) ? plan : undefined,
    };
  } catch (err) {
    logger.error('payment request decision failed', { id, error: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}
