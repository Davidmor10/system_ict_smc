export type Lang = 'en' | 'he';

export const DICT = {
  // ── Language toggle ──────────────────────────────────────────────
  lang_other:           { en: 'עב',                    he: 'EN'                              },

  // ── Sidebar ──────────────────────────────────────────────────────
  nav_workspace:        { en: 'Main Workspace',         he: 'סביבת עבודה'                    },
  nav_analytics:        { en: 'Market Analytics',       he: 'ניתוח שוק'                      },
  nav_journal:          { en: 'Trading Journal',        he: 'יומן מסחר'                      },
  sys_live:             { en: 'System Live',            he: 'מערכת פעילה'                    },
  brand_sub:            { en: 'Trading',                he: 'מסחר'                           },

  // ── Header ───────────────────────────────────────────────────────
  es_label:             { en: 'ES1! · S&P 500 Futures', he: 'ES1! · חוזי S&P 500'           },
  nq_label:             { en: 'NQ1! · Nasdaq Futures',  he: 'NQ1! · חוזי נאסד"ק'           },
  market_live:          { en: 'Live',                   he: 'חי'                             },
  market_closed:        { en: 'Closed',                 he: 'סגור'                           },

  // ── Chart panels ─────────────────────────────────────────────────
  panel_es:             { en: 'ES1! — S&P 500 · Liquidity & Structure', he: 'ES1! — S&P 500 · נזילות ומבנה'  },
  panel_nq:             { en: 'NQ1! — Nasdaq · SMT Divergence Monitor', he: 'NQ1! — נאסד"ק · מוניטור SMT'  },

  // ── Macro sidebar ─────────────────────────────────────────────────
  macro:                { en: 'Macro',                  he: 'מאקרו'                          },
  eco_calendar:         { en: 'Economic Calendar',      he: 'לוח אירועים'                   },
  fcst:                 { en: 'Fcst:',                  he: 'תחזית:'                         },
  demo_note:            { en: 'Demo — connect live API',he: 'דמו — חבר API חי'              },

  ev_ism:               { en: 'ISM Services PMI',       he: 'PMI שירותים ISM'               },
  ev_fomc_min:          { en: 'FOMC Minutes',           he: 'פרוטוקול FOMC'                 },
  ev_cpi:               { en: 'CPI (MoM)',              he: 'CPI (ח/ח)'                     },
  ev_claims:            { en: 'Jobless Claims',         he: 'תביעות אבטלה'                  },
  ev_ppi:               { en: 'PPI (MoM)',              he: 'PPI (ח/ח)'                     },
  ev_retail:            { en: 'Retail Sales (MoM)',     he: 'מכירות קמעונאיות'               },

  fed_sentiment:        { en: 'Fed Sentiment',          he: 'עמדת הפד'                      },
  fed_rate:             { en: 'Target Rate',            he: 'ריבית יעד'                     },
  fed_stance:           { en: 'Stance',                 he: 'עמדה'                           },
  fed_last:             { en: 'Last FOMC',              he: 'FOMC אחרון'                    },
  fed_next:             { en: 'Next FOMC',              he: 'FOMC הבא'                      },
  fed_watch:            { en: 'CME FedWatch · Jun',     he: 'CME FedWatch · יוני'           },
  fed_hold:             { en: 'Hold (525–550)',          he: 'ללא שינוי (525–550)'           },
  fed_cut:              { en: 'Cut 25bp',               he: 'הפחתה 25bp'                    },
  fed_hike:             { en: 'Hike 25bp',              he: 'העלאה 25bp'                    },
  fed_static_note:      { en: 'Static — connect CME API', he: 'סטטי — חבר CME API'         },

  mkt_context:          { en: 'Market Context',         he: 'הקשר שוק'                      },
  mkt_context_body:     { en: 'Risk-on regime. Equities pricing in Fed pivot optionality through H2 2026. Watch CPI prints for rate-cut catalysts.',
                          he: 'רגים ריסק-און. שוקי המניות מגלמים אופציונליות על פיבוט הפד ב-H2 2026. עקוב אחר הדפסות CPI כזרזים להפחתת ריבית.' },
  mkt_manual_note:      { en: 'Manual — update per session', he: 'ידני — עדכן לפי מפגש'   },

  // ── Analytics sidebar ─────────────────────────────────────────────
  analytics:            { en: 'Analytics',              he: 'ניתוח'                          },
  gravity:              { en: 'Gravity Score',          he: 'ציון כבידה'                    },
  liq_magnet:           { en: 'Liq. Magnet',            he: 'מגנט נזילות'                   },
  draw_down:            { en: '↓ draw',                 he: 'משיכה ↓'                       },
  draw_up:              { en: '↑ draw',                 he: 'משיכה ↑'                       },
  range_h:              { en: 'Range H',                he: 'גג טווח'                       },
  equil:                { en: 'Equilib.',               he: 'שיווי משקל'                    },
  range_l:              { en: 'Range L',                he: 'תחתית טווח'                    },
  mtf_struct:           { en: 'MTF Structure',          he: 'מבנה MTF'                      },
  smc_arrays:           { en: 'SMC Arrays',             he: 'מערכי SMC'                     },
  htf_ob:               { en: 'HTF OB',                 he: 'OB גבוה זמן'                   },
  htf_fvg:              { en: 'HTF FVG',                he: 'FVG גבוה זמן'                  },
  ltf_fvgs:             { en: 'LTF FVGs',               he: 'FVGs נמוך זמן'                 },
  confluence:           { en: 'Confluence',             he: 'צירוף'                          },
  inst_signal:          { en: '◈ INSTITUTIONAL ENTRY SIGNAL', he: '◈ אות כניסה מוסדי'      },
  htf_zone:             { en: 'HTF Zone Aligned',       he: 'אזור HTF מסונכרן'              },
  liq_sweep:            { en: 'Liquidity Sweep',        he: 'רחיפת נזילות'                  },
  smt_div:              { en: 'SMT Divergence',         he: 'דיברגנס SMT'                   },
  active_word:          { en: 'active',                 he: 'פעיל'                           },

  // ── Bias rules ───────────────────────────────────────────────────
  rule_sweep_bull:      { en: 'SSL Sweep + CHoCH',      he: 'רחיפת SSL + CHoCH'             },
  rule_d1_bull_fvg:     { en: 'D1 Bull FVG',            he: 'FVG שורי D1'                   },
  rule_h4_bull_fvg:     { en: 'H4 Bull FVG',            he: 'FVG שורי H4'                   },
  rule_bear_ifvg:       { en: 'Bear iFVG Support',      he: 'תמיכת iFVG דובי'               },
  rule_sweep_bear:      { en: 'BSL Sweep + CHoCH',      he: 'רחיפת BSL + CHoCH'             },
  rule_d1_bear_fvg:     { en: 'D1 Bear FVG',            he: 'FVG דובי D1'                   },
  rule_h4_bear_fvg:     { en: 'H4 Bear FVG',            he: 'FVG דובי H4'                   },
  rule_bull_ifvg:       { en: 'Bull iFVG Resist',       he: 'התנגדות iFVG שורי'             },
  rule_conflict:        { en: 'Conflicting Zones',      he: 'אזורים מתנגשים'                },
  rule_tight:           { en: 'No Clear Structure',     he: 'אין מבנה ברור'                 },

  // ── Bias factor badges ───────────────────────────────────────────
  factor_honored:       { en: 'Honored Gaps',           he: 'פערים מכובדים'                 },
  factor_explosive:     { en: 'Explosive Gaps',         he: 'פערים נפיצים'                  },
  factor_ifvgs:         { en: 'iFVGs Active',           he: 'iFVGs פעיל'                    },
  factor_session_liq:   { en: 'Session Liq',            he: 'נזילות מפגש'                   },
  factor_inducement:    { en: 'Inducement',             he: 'פיתוי'                          },
} satisfies Record<string, { en: string; he: string }>;

export type DictKey = keyof typeof DICT;

export function t(lang: Lang, key: DictKey): string {
  return DICT[key][lang];
}
