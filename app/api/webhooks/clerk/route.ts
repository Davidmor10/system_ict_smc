import { Webhook } from 'svix';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  isSupabaseConfigured,
} from '../../../lib/supabase/server';

// Clerk → Supabase profile provisioning. On `user.created` we insert a row in
// `profiles` defaulting to the 'free' role; on `user.deleted` we remove it.
// The endpoint is signature-verified with svix and never trusts an unsigned body.
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  // Verify against the RAW body — re-serializing JSON would break the signature.
  const payload = await req.text();

  let evt: WebhookEvent;
  try {
    evt = new Webhook(secret).verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('[clerk-webhook] signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    console.warn('[clerk-webhook] Supabase not configured — event acknowledged but not persisted');
    return NextResponse.json({ ok: true, persisted: false });
  }

  const supabase = createServerSupabaseClient();

  try {
    switch (evt.type) {
      case 'user.created': {
        const email = evt.data.email_addresses?.[0]?.email_address ?? null;
        const { error } = await supabase
          .from('profiles')
          .upsert({ clerk_id: evt.data.id, email, role: 'free' }, { onConflict: 'clerk_id' });
        if (error) throw error;
        break;
      }
      case 'user.deleted': {
        if (evt.data.id) {
          const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('clerk_id', evt.data.id);
          if (error) throw error;
        }
        break;
      }
      default:
        // Other event types are acknowledged without action.
        break;
    }
  } catch (err) {
    console.error('[clerk-webhook] persistence error', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: true });
}
