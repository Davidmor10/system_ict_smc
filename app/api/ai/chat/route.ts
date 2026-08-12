import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { answerCoachQuestion, type ChatTurn } from '../../../lib/ai/chat';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logSecurityEvent } from '../../../lib/securityLog';
import { requirePlanApi } from '../../../lib/withRoleCheck';

// Vercel's default function timeout is 10 seconds. This route reads the
// trader's whole history, re-runs the intelligence refresh, and then waits on a
// model — comfortably past 10s on a real account, which surfaces as a 504 the
// client cannot distinguish from a broken feature. 60 is the Hobby ceiling.
export const maxDuration = 60;


const chatSchema = z.object({
  question: z.string().min(1).max(1000),
  lang: z.enum(['he', 'en']).optional(),
  chatId: z.string().uuid().nullish(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    logSecurityEvent('auth_failed', { route: '/api/ai/chat' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkRateLimit(`ai:chat:${userId}`, 30, 60_000);
  if (!limited.ok) {
    logSecurityEvent('rate_limited', { route: '/api/ai/chat', userId });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } });
  }

  // The coach is a Deluxe surface — enforce it at the API, not only in the
  // page layout, so a direct fetch can't use paid AI on a free plan.
  const denied = await requirePlanApi('deluxe', '/api/ai/chat');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (body === null) {
    logSecurityEvent('validation_failed', { route: '/api/ai/chat', userId, reason: 'invalid_json' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    logSecurityEvent('validation_failed', { route: '/api/ai/chat', userId });
    return NextResponse.json({ error: 'Invalid chat payload' }, { status: 400 });
  }

  const lang = parsed.data.lang === 'en' ? 'en' : 'he';
  const history = (parsed.data.history ?? []) as ChatTurn[];

  try {
    const result = await answerCoachQuestion(userId, parsed.data.question, lang, parsed.data.chatId ?? null, history);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[AI Chat]', err);
    return NextResponse.json({ answer: null, reason: 'ai_unavailable' }, { status: 500 });
  }
}
