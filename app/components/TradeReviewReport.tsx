'use client';

// The 9-section trade-review report. Renders in the order the model returns.
// Every claim shows its confidence level (🟢🟡⚪) and its evidence chips so the
// trader can audit every conclusion. This is a read-only presentation — no
// logic other than sorting/formatting.

import type {
  TradeReviewReport as ReportT,
  ReviewClaim,
  EvidencePointer,
  Confidence,
  EvidenceSource,
} from '../lib/videoReview/types';

const CONF_MARK: Record<Confidence, string> = { high: '🟢', medium: '🟡', low: '⚪' };
const CONF_LABEL: Record<Confidence, string> = { high: 'ביטחון גבוה', medium: 'ביטחון בינוני', low: 'ביטחון נמוך' };

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  'video-frame': 'פריים',
  transcript: 'תמלול',
  'trade-record': 'יומן',
  rule: 'חוק',
  setup: 'סטאפ',
  stats: 'סטטיסטיקה',
  'pattern-memory': 'דפוס',
};

function fmtTime(sec?: number): string {
  if (typeof sec !== 'number' || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function EvidenceChip({ e }: { e: EvidencePointer }) {
  const t = fmtTime(e.timestampSec);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] py-1 px-2 rounded-sm border border-[#2a2a2d] bg-white/[0.02] text-white/70">
      <span className="font-mono text-[10px] font-bold text-[#d4af37]">{SOURCE_LABEL[e.source]}</span>
      <span className="text-white/50">·</span>
      <span>{e.label}</span>
      {t && <span className="font-mono text-white/40">@{t}</span>}
    </span>
  );
}

function Claim({ c }: { c: ReviewClaim }) {
  return (
    <li className="rounded-[10px] border border-[#1c1c1e] bg-[#0d0d0f] p-4">
      <div className="flex items-start gap-2.5 mb-2.5">
        <span title={CONF_LABEL[c.confidence]} className="text-base leading-none pt-0.5">{CONF_MARK[c.confidence]}</span>
        <p className="text-[14px] text-white leading-relaxed m-0">{c.claim}</p>
      </div>
      {c.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#1c1c1e]">
          {c.evidence.map((e, i) => <EvidenceChip key={i} e={e} />)}
        </div>
      )}
    </li>
  );
}

function Section({
  eyebrow, title, children,
}: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-2">{eyebrow}</div>
      <h3 className="font-serif text-[22px] font-bold text-white m-0 mb-[14px]">{title}</h3>
      {children}
    </section>
  );
}

function ClaimList({ items, empty }: { items: ReviewClaim[]; empty: string }) {
  if (!items.length) return <div className="text-[13px] text-white/40 italic">{empty}</div>;
  return <ul className="list-none p-0 m-0 flex flex-col gap-2.5">{items.map((c, i) => <Claim key={i} c={c} />)}</ul>;
}

const VERDICT_STYLE: Record<ReportT['decisionVerdict']['verdict'], { color: string; bg: string; label: string }> = {
  correct:              { color: '#4a7c59', bg: 'rgba(74,124,89,0.10)',  label: 'החלטה נכונה' },
  'partially-correct':  { color: '#d4af37', bg: 'rgba(212,175,55,0.10)', label: 'חלקית נכונה' },
  incorrect:            { color: '#8b3a3a', bg: 'rgba(139,58,58,0.10)',  label: 'החלטה שגויה' },
  unclear:              { color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.03)', label: 'לא ברור מספיק' },
};

export default function TradeReviewReport({ report }: { report: ReportT }) {
  const v = VERDICT_STYLE[report.decisionVerdict.verdict];
  return (
    <div dir="rtl" className="flex flex-col gap-8">

      {/* Overall verdict — the meta-headline */}
      <section className="rounded-2xl border p-5" style={{ borderColor: v.color + '55', background: v.bg }}>
        <div className="flex items-center gap-3 mb-2.5 flex-wrap">
          <span className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-white/50">שיפוט כללי</span>
          <span className="inline-flex items-center gap-2 py-1 px-3 rounded-full text-[12px] font-bold" style={{ color: v.color, background: 'rgba(0,0,0,0.4)', border: `1px solid ${v.color}55` }}>
            {CONF_MARK[report.decisionVerdict.confidence]} {v.label}
          </span>
          <span className="text-[11.5px] text-white/40">ביטחון הדוח: {CONF_LABEL[report.overallConfidence]}</span>
        </div>
        <p className="text-[15px] text-white leading-relaxed m-0">{report.decisionVerdict.reasoning}</p>
        {report.decisionVerdict.evidence.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {report.decisionVerdict.evidence.map((e, i) => <EvidenceChip key={i} e={e} />)}
          </div>
        )}
      </section>

      <Section eyebrow="Section 01" title="מה קרה בפועל">
        <ClaimList items={report.whatHappened} empty="אין עדות מספקת לשחזר." />
      </Section>

      <Section eyebrow="Section 02" title="טעויות שזוהו">
        <ClaimList items={report.mistakes} empty="לא זוהו טעויות מהותיות." />
      </Section>

      <Section eyebrow="Section 03" title="החלטות טובות">
        <ClaimList items={report.goodDecisions} empty="אין החלטות טובות שהתבררו בבירור." />
      </Section>

      <Section eyebrow="Section 04" title="חוקים שהופרו">
        <ClaimList items={report.rulesBroken} empty="אף חוק לא נמצא כמופר במפורש." />
      </Section>

      <Section eyebrow="Section 05" title="דפוסים חוזרים שהופיעו">
        <ClaimList items={report.recurringPatterns} empty="אין דפוס חוזר שהתבטא בעסקה הזאת." />
      </Section>

      {report.alternativeReadings.length > 0 && (
        <Section eyebrow="Section 06" title="פרשנויות חלופיות שנשקלו">
          <ul className="list-none p-0 m-0 flex flex-col gap-2">
            {report.alternativeReadings.map((s, i) => (
              <li key={i} className="text-[13.5px] text-white/70 leading-relaxed py-2.5 px-4 rounded-md border border-[#1c1c1e] bg-white/[0.015]">
                {s}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* The ONE habit — always last, always framed as the take-away */}
      <section className="rounded-2xl border border-[#d4af37]/40 p-6" style={{ background: 'linear-gradient(180deg, rgba(212,175,55,0.06), rgba(212,175,55,0.015))' }}>
        <div className="font-mono text-[10.5px] font-bold tracking-[0.28em] uppercase text-[#d4af37] mb-2">The ONE thing</div>
        <h3 className="font-serif text-[26px] font-bold text-white leading-[1.15] m-0 mb-[14px]">
          {report.oneThingToImprove.habit || 'אין הרגל בודד לזהות משיחה זו.'}
        </h3>
        {report.oneThingToImprove.whyThisOne && (
          <p className="text-[14px] text-white/75 leading-relaxed mb-3 m-0">
            <span className="text-[#d4af37] font-bold">למה זה: </span>{report.oneThingToImprove.whyThisOne}
          </p>
        )}
        {report.oneThingToImprove.howToPractice && (
          <p className="text-[14px] text-white/75 leading-relaxed mb-3 m-0">
            <span className="text-[#d4af37] font-bold">איך מתרגלים: </span>{report.oneThingToImprove.howToPractice}
          </p>
        )}
        {report.oneThingToImprove.evidence.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {report.oneThingToImprove.evidence.map((e, i) => <EvidenceChip key={i} e={e} />)}
          </div>
        )}
      </section>
    </div>
  );
}
