// Deleting an account deletes what the account wrote.
//
// The handler removed the `profiles` row and nothing else. Twenty-four tables
// are keyed by clerk_id, and account deletion cleared one of them — so every
// trade, notebook entry, embedding, daily insight, behaviour finding, coach
// conversation, rule and setup a trader had ever written stayed in the
// database after they asked for it to be gone.
//
// Found by tracing ten journal rows belonging to a clerk_id with no profile:
// an account somebody deleted, whose journal was still sitting there.
//
// THE LIST IS READ FROM THE SCHEMA, NOT WRITTEN DOWN HERE
//
// A hand-maintained copy of "every table holding user data" is wrong the day
// someone adds a table and does not think about deletion — which is exactly
// the day it matters, and exactly the mistake being fixed. So the migrations
// are the source: every `create table` carrying a clerk_id column must appear
// in the purge, and a new one fails this test the moment it is added.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { __testing } from '../../app/api/webhooks/clerk/route';

const TABLES = __testing.USER_TABLES as readonly string[];

/** Every table the migrations create, split by whether it belongs to a
 *  trader. A table with a clerk_id column holds somebody's data by
 *  definition; one without it is system state. */
function tablesFromSchema(): { scoped: string[]; system: string[] } {
  const root = join(__dirname, '..', '..');
  const scoped: string[] = [];
  const system: string[] = [];
  for (const f of readdirSync(root).filter(n => n.startsWith('supabase-migration') && n.endsWith('.sql'))) {
    const sql = readFileSync(join(root, f), 'utf8');
    const re = /create table (?:if not exists )?([a-z_]+)\s*\(([\s\S]*?)\n\)\s*;/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      const [, name, body] = m;
      (/\bclerk_id\b/.test(body) ? scoped : system).push(name);
    }
  }
  return { scoped: [...new Set(scoped)], system: [...new Set(system)].filter(t => !scoped.includes(t)) };
}

describe('the purge list', () => {
  const { scoped, system } = tablesFromSchema();

  it('reads a real schema', () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(scoped.length).toBeGreaterThan(15);
  });

  it('covers every table in the schema that carries a clerk_id', () => {
    const missing = scoped.filter(t => !TABLES.includes(t));
    expect(missing, `holds user data and is never purged: ${missing.join(', ')}`).toEqual([]);
  });

  it('leaves system tables alone', () => {
    // Feature flags and provider state are not anyone's data, and purging a
    // shared table on one account's deletion would take the product down.
    const wrongly = system.filter(t => TABLES.includes(t));
    expect(wrongly, `not user data: ${wrongly.join(', ')}`).toEqual([]);
  });

  it('names no table twice', () => {
    expect(new Set(TABLES).size).toBe(TABLES.length);
  });

  it('purges the journal and its mirror alike', () => {
    // Two tables hold the same trades. Clearing one would leave the analysis
    // layer holding a deleted trader's positions.
    expect(TABLES).toContain('journal_trades');
    expect(TABLES).toContain('intelligence_trades');
  });

  it('purges what the system wrote about them, not only what they wrote', () => {
    for (const t of ['daily_insights', 'behavior_findings', 'trader_profiles', 'coach_chats']) {
      expect(TABLES, t).toContain(t);
    }
  });

  it('purges the profile itself', () => {
    expect(TABLES).toContain('profiles');
  });
});

describe('the purge order', () => {
  const before = (a: string, b: string) => TABLES.indexOf(a) < TABLES.indexOf(b);

  it('deletes children before their parents', () => {
    // A cascade only fires when the parent goes, so an interrupted run that
    // took the parent first is fine — one that took it last strands the child.
    expect(before('notebook_chunks', 'notebook_entries')).toBe(true);
    expect(before('behavior_finding_events', 'behavior_findings')).toBe(true);
    expect(before('rule_violations', 'trading_rules')).toBe(true);
  });

  it('deletes the profile last', () => {
    // THE MARKER. While the profile exists the purge is unfinished, which is
    // what a retry recognises.
    expect(TABLES[TABLES.length - 1]).toBe('profiles');
  });
});
