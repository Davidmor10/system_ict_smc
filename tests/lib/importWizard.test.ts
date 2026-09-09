// The import screen's contract, as opposed to the parser's.
//
// The parser is tested against the trader's real file. What this covers is the
// promises the screen makes: that nothing is written before the last button,
// that the timezone is asked rather than assumed, and that a second import of
// the same file cannot overwrite work the trader has done since the first.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const wizard = readFileSync('app/components/ImportWizard.tsx', 'utf8');
const view   = readFileSync('app/components/PortfoliosView.tsx', 'utf8');

describe('nothing is written before the last button', () => {
  it('parses and maps without saving', () => {
    // An importer that writes first and reports afterwards leaves the trader
    // undoing it by hand, and this one is aimed at people with a hundred
    // trades. saveTrades appears once, inside commit().
    expect(wizard.match(/saveTrades\(/g)).toHaveLength(1);
    expect(wizard).toContain('async function commit()');
    expect(wizard.indexOf('async function commit()')).toBeLessThan(wizard.indexOf('saveTrades('));
  });

  it('shows the trades, the duplicates and the rejects before committing', () => {
    expect(wizard).toContain('splitAgainstExisting');
    expect(wizard).toContain('mapped.skipped');
    expect(wizard).toContain('<tbody>');
  });
});

describe('the timezone is asked, not assumed', () => {
  it('shows the file\'s own first timestamp back to the trader', () => {
    // The export carries no zone. Read in the wrong one it does not fail — it
    // files every trade under the wrong session, silently.
    expect(wizard).toContain('העסקה הראשונה בקובץ רשומה');
    expect(wizard).toContain('firstRaw');
  });

  it('re-computes the whole preview when the answer changes', () => {
    // The mapping is a memo over fileZone, so the table moves with the answer
    // rather than the trader being asked to trust it.
    expect(wizard).toContain('}, [parsed, fileZone, existing, portfolio, newId]);');
  });

  it('names the session each trade would land in', () => {
    expect(wizard).toContain('sessionLabel(');
    expect(wizard).toContain('מחוץ לסשנים שהגדרת');
  });
});

describe('a second import', () => {
  it('appends and never replaces', () => {
    // The trader may have spent an evening filling in setups and rules on the
    // trades already there. An "update" that overwrote those answers would be
    // the most expensive bug in this feature.
    expect(wizard).toContain('saveTrades([...existing, ...mapped.fresh])');
    expect(wizard).toContain('עסקאות שכבר ביומן לא ייגעו');
  });

  it('has nothing to do when every trade is already there', () => {
    expect(wizard).toContain('אין מה לייבא');
    expect(wizard).toContain('mapped.fresh.length === 0');
  });

  it('answers duplicates against the cloud, not just this device', () => {
    expect(wizard).toContain('hydrateTradesFromCloud()');
  });
});

describe('the file it will not accept', () => {
  it('separates "wrong export" from "no trades in it"', () => {
    // A trader told the second when the first is true will keep re-uploading.
    expect(wizard).toContain('UnrecognisedExport');
    expect(wizard).toContain('חסרות עמודות');
    expect(wizard).toContain('לא נמצאו עסקאות בקובץ');
  });
});

describe('where it is reached from', () => {
  it('hangs off the portfolio it imports into', () => {
    expect(view).toContain('<ImportWizard');
    expect(view).toContain('portfolio={importing}');
  });

  it('stamps the portfolio only after the trades are saved', () => {
    expect(view).toContain('lastImportAt: now');
    expect(view).toContain('onImported');
  });
});

describe('adding a trading account', () => {
  it('asks for the account and its file on one screen', () => {
    // These were two screens. A trader who had just created an account had no
    // reason to know a second step existed — they had said what the account
    // was and it sat there empty, which is what the report was about.
    expect(wizard).toContain("useState<Stage>(creating ? 'account' : 'file')");
    expect(wizard).toContain('function AccountStep(');
    expect(wizard).toContain('קובץ העסקאות');
    expect(wizard).toContain('שם החשבון');
    expect(wizard).toContain('יתרת פתיחה');
  });

  it('writes out where the file comes from', () => {
    // The export is four menus deep in TradingView and the path is not
    // guessable. A trader who cannot find it does not come back for a help
    // page — the trader who asked for this could not find it either.
    expect(wizard).toContain('EXPORT_STEPS');
    expect(wizard).toContain('Export data');
    expect(wizard.match(/^\s+'.*',$/gm)?.length).toBeGreaterThan(4);
  });

  it('fixes the account id before the preview maps against it', () => {
    // Generating a second id at save time would leave every mapped trade
    // pointing at an account that does not exist.
    expect(wizard).toContain("useState(() => newPortfolio('', 0, 'Asia/Jerusalem').id)");
    expect(wizard).toContain("accountId: portfolio?.id ?? newId");
  });

  it('writes the account before its trades', () => {
    // The other order leaves trades pointing at a portfolio that does not
    // exist if the second write fails — invisible on every screen, since
    // nothing would scope to it.
    expect(wizard.indexOf('await onCreate(')).toBeLessThan(wizard.indexOf('saveTrades('));
  });

  it('does not close itself mid-commit', () => {
    // It did. upsert cleared the creating flag, which unmounted the modal
    // while the save was still running: the trades landed, and the trader
    // watched the dialog vanish with no confirmation, which reads as failure.
    expect(view).toContain('do NOT close');
    expect(view).not.toContain('onCreate={async p => { await upsert(p); }}');
  });

  it('is reachable from the switcher, not only from the list', () => {
    const sw = readFileSync('app/components/PortfolioSwitcher.tsx', 'utf8');
    expect(sw).toContain('+ הוספת חשבון מסחר');
    expect(sw).toContain('?add=1');
    expect(view).toContain("get('add') === '1'");
  });
});
