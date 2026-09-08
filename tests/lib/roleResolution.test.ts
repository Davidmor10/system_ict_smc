// A role that could not be determined is not a free account.
//
// Production trace: four POSTs to /api/coach/daily-insight/answer logged
// plan_denied with role 'free', while five sibling routes behind the same
// 'pro' gate answered 200 for the same session three minutes later. The
// account was an owner's. Every failure path in getUserContext returned
// 'free' — indistinguishable from a real answer — so a momentary Clerk or
// Supabase fault was reported to the trader as "your plan is too low", and
// the answer they had written was thrown away.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { isOwnerEmail, OWNER_EMAILS } from '../../app/lib/coach-pipeline/auth/owners';

const roleSrc = readFileSync('app/lib/getUserRole.ts', 'utf8');
const guardSrc = readFileSync('app/lib/withRoleCheck.ts', 'utf8');

describe('the owner allowlist', () => {
  it('is one list, not two', () => {
    // owners.ts says outright that it is the only list in the codebase.
    // getUserRole.ts quietly held a second copy of the same addresses.
    expect(roleSrc).toContain("from './coach-pipeline/auth/owners'");
    expect(roleSrc).not.toMatch(/const OWNER_EMAILS\s*=/);
    expect(OWNER_EMAILS.length).toBeGreaterThan(0);
  });

  it('matches case-insensitively and ignores surrounding space', () => {
    expect(isOwnerEmail(` ${OWNER_EMAILS[0].toUpperCase()} `)).toBe(true);
    expect(isOwnerEmail('someone-else@example.com')).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
  });
});

describe('getUserContext', () => {
  it('reports whether the role was resolved at all', () => {
    expect(roleSrc).toContain('resolved: boolean');
    expect(roleSrc).toContain('function unresolved()');
  });

  it('does not answer "free" when a lookup failed', () => {
    // Each of these was a silent downgrade: a thrown auth(), a failed profiles
    // read, and a query that threw. All three returned a plain free context.
    for (const path of [
      "logger.warn('role lookup: clerk auth() failed'",
      "logger.warn('role lookup: profiles read failed'",
      "logger.warn('role lookup: profiles query threw'",
    ]) {
      expect(roleSrc).toContain(path);
    }
    // Three failure paths, three unresolved returns.
    expect(roleSrc.match(/return unresolved\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('still answers "free" for a visitor who is genuinely signed out', () => {
    // Not every free is a failure — this one is a real answer and must stay.
    expect(roleSrc).toContain("if (!userId) return { role: 'free', isOwner: false, resolved: true };");
  });

  it('recognises the owner from the profiles row, not only from Clerk', () => {
    // The second source of the same fact. currentUser() is a network call to
    // Clerk's backend that can fail on its own, and when it did the owner was
    // served whatever profiles.role said — free, since an owner never buys a
    // subscription. The nightly worker has always keyed off this email.
    expect(roleSrc).toContain('isOwnerEmail(row.email)');
    expect(roleSrc).toContain("select('role, access_until, email')");
  });
});

describe('the plan gates', () => {
  it('refuse on an unknown role — never grant', () => {
    // Failing closed is not negotiable; only the wording of the refusal changes.
    expect(guardSrc).toContain('if (!resolved)');
    expect(guardSrc).toContain('redirect(\'/checkout\')');
  });

  it('answer 503, not 403, when the plan could not be verified', () => {
    // 403 tells the trader their plan is too low. That was a false statement
    // about their account, and it is the one the UI repeated back to them.
    expect(guardSrc).toContain('status: 503');
    expect(guardSrc).toContain("'Retry-After': '2'");
    expect(guardSrc).toContain("logSecurityEvent('role_unresolved'");
  });

  it('keeps 403 for a real plan shortfall', () => {
    expect(guardSrc).toContain("logSecurityEvent('plan_denied', { route, role, required })");
    expect(guardSrc).toContain('status: 403');
  });
});

describe('the answer box', () => {
  const ui = readFileSync('app/components/dashboard/InsightSection.tsx', 'utf8');

  it('retries once on a 503 rather than dropping what was written', () => {
    expect(ui).toContain('r.status === 503');
  });

  it('does not blame the trader for a server fault', () => {
    expect(ui).toContain('תקלה אצלנו');
    expect(ui).not.toContain("'לא נשמר. נסה שוב.'");
  });
});
