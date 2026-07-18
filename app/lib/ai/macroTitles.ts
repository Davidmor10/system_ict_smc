// ─────────────────────────────────────────────────────────────────────────────
// Hebrew names for the recurring macro-calendar events the FairEconomy feed
// (app/lib/ai/macroCalendar.ts) actually publishes week after week. The feed
// itself only carries English titles — this is a curated lookup for the
// common, standardized ones (NFP, CPI, FOMC, PMIs, etc.), never a guess.
// An event whose exact title isn't in the table falls through untranslated
// (`he` = the original English title, `hasTranslation: false`) rather than
// inventing a Hebrew name for something we don't actually recognize.
// ─────────────────────────────────────────────────────────────────────────────

const TITLES_HE: Record<string, string> = {
  // Employment
  'Non-Farm Employment Change': 'שינוי תעסוקה (NFP)',
  'ADP Non-Farm Employment Change': 'שינוי תעסוקה ADP',
  'Unemployment Rate': 'שיעור האבטלה',
  'Average Hourly Earnings m/m': 'שכר שעתי ממוצע (ח/ח)',
  'Unemployment Claims': 'תביעות אבטלה שבועיות',
  'JOLTS Job Openings': 'משרות פנויות JOLTS',
  'Challenger Job Cuts y/y': 'פיטורים (Challenger, ש/ש)',

  // Inflation
  'CPI m/m': 'מדד המחירים לצרכן (ח/ח)',
  'CPI y/y': 'מדד המחירים לצרכן (ש/ש)',
  'Core CPI m/m': 'מדד ליבה (ח/ח)',
  'Core CPI y/y': 'מדד ליבה (ש/ש)',
  'PPI m/m': 'מדד מחירי היצרן (ח/ח)',
  'Core PPI m/m': 'מדד מחירי היצרן ליבה (ח/ח)',
  'PCE Price Index m/m': 'מדד PCE (ח/ח)',
  'Core PCE Price Index m/m': 'מדד PCE ליבה (ח/ח)',

  // Rates / Fed
  'Federal Funds Rate': 'ריבית הפד',
  'FOMC Statement': 'הודעת ה-FOMC',
  'FOMC Press Conference': 'מסיבת עיתונאים של ה-FOMC',
  'FOMC Meeting Minutes': 'פרוטוקול ישיבת ה-FOMC',
  'FOMC Economic Projections': 'תחזיות כלכליות של ה-FOMC',

  // Growth / activity
  'GDP q/q': 'תוצר מקומי גולמי (רבעוני)',
  'Prelim GDP q/q': 'תוצר מקומי גולמי — אומדן ראשוני',
  'Advance GDP q/q': 'תוצר מקומי גולמי — אומדן מקדים',
  'Final GDP q/q': 'תוצר מקומי גולמי — אומדן סופי',
  'ISM Manufacturing PMI': 'מדד מנהלי הרכש בתעשייה (ISM)',
  'ISM Services PMI': 'מדד מנהלי הרכש בשירותים (ISM)',
  'Flash Manufacturing PMI': 'מדד מנהלי רכש בתעשייה — ראשוני',
  'Flash Services PMI': 'מדד מנהלי רכש בשירותים — ראשוני',
  'Chicago PMI': 'מדד מנהלי הרכש (שיקגו)',
  'Empire State Manufacturing Index': 'מדד התעשייה (ניו יורק)',
  'Philly Fed Manufacturing Index': 'מדד התעשייה (פילדלפיה)',
  'Factory Orders m/m': 'הזמנות מפעלים (ח/ח)',
  'Durable Goods Orders m/m': 'הזמנות מוצרים בני-קיימא (ח/ח)',
  'Core Durable Goods Orders m/m': 'הזמנות מוצרים בני-קיימא ליבה (ח/ח)',

  // Consumer
  'Retail Sales m/m': 'מכירות קמעונאיות (ח/ח)',
  'Core Retail Sales m/m': 'מכירות קמעונאיות ליבה (ח/ח)',
  'CB Consumer Confidence': 'מדד אמון הצרכנים (Conference Board)',
  'Prelim UoM Consumer Sentiment': 'מדד אמון הצרכנים (מישיגן) — ראשוני',
  'Revised UoM Consumer Sentiment': 'מדד אמון הצרכנים (מישיגן) — מתוקן',
  'Personal Income m/m': 'הכנסה אישית (ח/ח)',
  'Personal Spending m/m': 'הוצאה אישית (ח/ח)',

  // Housing
  'Building Permits': 'היתרי בנייה',
  'Housing Starts': 'התחלות בנייה',
  'Existing Home Sales': 'מכירות בתים קיימים',
  'New Home Sales': 'מכירות בתים חדשים',
  'Pending Home Sales m/m': 'עסקאות דיור ממתינות (ח/ח)',
  'S&P/CS Composite-20 HPI y/y': 'מדד מחירי דיור (S&P/CS, ש/ש)',

  // Trade / misc
  'Trade Balance': 'מאזן מסחר',
  'Crude Oil Inventories': 'מלאי נפט גולמי',
  'Consumer Credit m/m': 'אשראי צרכני (ח/ח)',
  'Wholesale Inventories m/m': 'מלאי סיטונאי (ח/ח)',

  // Non-US central banks (common cross-currency events on the same feed)
  'ECB Main Refinancing Rate': 'ריבית ה-ECB',
  'ECB Press Conference': 'מסיבת עיתונאים של ה-ECB',
  'ECB Monetary Policy Statement': 'הודעת מדיניות מוניטרית — ECB',
  'Official Bank Rate': 'ריבית בנק אנגליה',
  'BOE Monetary Policy Report': 'דוח מדיניות מוניטרית — BOE',
  'BOE Monetary Policy Summary': 'תמצית מדיניות מוניטרית — BOE',
};

export interface MacroTitleTranslation {
  /** Hebrew name when recognized, otherwise the original English title unchanged. */
  he: string;
  /** True only when a real translation was found — controls whether the UI
      shows the English name a second time in parentheses. */
  hasTranslation: boolean;
}

export function translateMacroTitle(enTitle: string): MacroTitleTranslation {
  const he = TITLES_HE[enTitle];
  return he ? { he, hasTranslation: true } : { he: enTitle, hasTranslation: false };
}
