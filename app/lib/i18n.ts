export type Lang = 'en' | 'he';

export const DICT = {
  // ── Language toggle ──────────────────────────────────────────────
  lang_other:           { en: 'עב',                    he: 'EN'                              },

  // ── Sidebar ──────────────────────────────────────────────────────
  nav_workspace:        { en: 'Dashboard',              he: 'דשבורד'                         },
  nav_ai_analytics:     { en: 'AI Analytics',           he: 'אנליטיקת AI'                    },
  nav_coach:            { en: 'AI Coach',               he: 'מאמן AI'                        },
  nav_journal:          { en: 'Journal',                he: 'יומן'                           },
  nav_playbook:         { en: 'Playbook',               he: 'סטאפים'                         },
  nav_rules:            { en: 'Rules',                  he: 'חוקים'                          },
  sys_account:          { en: 'Account',                he: 'חשבון'                          },
  brand_sub:            { en: 'Journal',                he: 'יומן'                           },

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
  today_news:           { en: "Today's News",           he: 'חדשות היום'                    },
  weekly_outlook:       { en: 'Weekly Outlook',         he: 'מבט שבועי'                      },
  eco_none:             { en: 'No high-impact events today', he: 'אין אירועים משמעותיים היום' },
  fcst:                 { en: 'Fcst:',                  he: 'תחזית:'                         },

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

  // ── Position sizing calculator ───────────────────────────────────
  calc_title:           { en: 'Institutional Risk Manager', he: 'מחשבון ניהול סיכונים מוסדי' },
  calc_subtitle:        { en: 'Position sizing · live-synced pricing', he: 'חישוב גודל פוזיציה · תמחור חי מסונכרן' },
  calc_asset:           { en: 'Asset',                   he: 'נכס'                            },
  calc_balance:         { en: 'Account Balance',         he: 'יתרת חשבון'                    },
  calc_risk:            { en: 'Risk %',                  he: 'אחוז סיכון'                    },
  calc_stop:            { en: 'Stop Loss (points)',      he: 'סטופ לוס (נקודות)'             },
  calc_entry:           { en: 'Entry Price',             he: 'מחיר כניסה'                    },
  calc_sync:            { en: 'Live',                    he: 'חי'                             },
  calc_manual:          { en: 'Manual entry — tap Live to re-sync', he: 'כניסה ידנית — הקש חי לסנכרון' },
  calc_results:         { en: 'Risk Output',             he: 'תוצאת סיכון'                   },
  calc_cash_risk:       { en: 'Total Cash at Risk',      he: 'סכום כולל בסיכון'              },
  calc_std:             { en: 'Standard Contracts',      he: 'חוזים סטנדרטיים'               },
  calc_micro:           { en: 'Micro Contracts',         he: 'חוזי מיקרו'                     },
  calc_actual_risk:     { en: 'Actual Risk',             he: 'סיכון בפועל'                   },
  calc_risk_per_std:    { en: 'Risk / Standard',         he: 'סיכון / סטנדרטי'               },
  calc_risk_per_micro:  { en: 'Risk / Micro',            he: 'סיכון / מיקרו'                 },
  calc_pt_value:        { en: 'Point Value',             he: 'ערך נקודה'                     },
  calc_stop_level:      { en: 'Stop Level (long)',       he: 'רמת סטופ (לונג)'               },
  calc_spec_note:       { en: 'CME spec — ES $50/pt · MES $5/pt · NQ $20/pt · MNQ $2/pt', he: 'מפרט CME — ES $50/נק׳ · MES $5/נק׳ · NQ $20/נק׳ · MNQ $2/נק׳' },

  // ── Landing: header / auth ───────────────────────────────────────
  hdr_signin:           { en: 'System Access',            he: 'כניסה למערכת'                  },
  hdr_signup:           { en: 'Request Access',           he: 'בקשת גישה'                     },
  hdr_workspace:        { en: 'Enter Workspace',          he: 'כניסה לסביבת העבודה'           },

  // ── Landing: hero ────────────────────────────────────────────────
  hero_tagline:         { en: 'The Institutional Market-Mapping Engine', he: 'מנוע מיפוי השוק המוסדי' },
  hero_pillars:         { en: 'Liquidity · Structure · Precision', he: 'נזילות · מבנה · דיוק'  },
  hero_scroll:          { en: 'Scroll to enter',          he: 'גלול כדי להיכנס'               },

  // ── Landing: workspace preview ───────────────────────────────────
  ws_kicker:            { en: 'The Workspace',            he: 'סביבת העבודה'                  },
  ws_title:             { en: 'An institutional trading desk.', he: 'שולחן מסחר מוסדי.'        },
  ws_title_accent:      { en: 'In real time.',            he: 'בזמן אמת.'                     },

  // ── Landing: core (liquidity / risk) ─────────────────────────────
  core_liq:             { en: 'Liquidity',                he: 'נזילות'                        },
  core_liq_body:        { en: 'Algorithmic detection and mapping of market manipulation, institutional liquidity sweeps, and points of interest across high time frames (HTF).', he: 'איתור ומיפוי אלגוריתמי של מניפולציות שוק, sweeps של נזילות מוסדית ונקודות עניין בטווחי זמן גבוהים (HTF).' },
  core_risk:            { en: 'Risk Management',          he: 'ניהול סיכונים'                 },
  core_risk_body:       { en: 'A built-in risk manager synced directly to live CME pricing, eliminating human error in position sizing.', he: 'מחשבון ניהול סיכונים מובנה המסתנכרן ישירות למחירי הלייב של בורסת שיקגו למניעת טעויות אנוש בגודל הפוזיציה.' },

  // ── Landing: capabilities ────────────────────────────────────────
  caps_kicker:          { en: 'Core Capabilities',        he: 'יכולות הליבה'                  },
  caps_title:           { en: 'A complete institutional arsenal', he: 'ארסנל מוסדי מלא'        },
  cap_open:             { en: 'Open Module',              he: 'פתח מודול'                     },
  cap1_title:           { en: 'TRADING JOURNAL',          he: 'יומן מסחר'                     },
  cap1_body:            { en: 'Track, analyze, and review every trade with institutional precision.', he: 'ניהול, ניתוח ובחינה של כל עסקאות המסחר ברמת דיוק מוסדית.' },
  cap2_title:           { en: 'RISK CALCULATOR',          he: 'מחשבון סיכון'                  },
  cap2_body:            { en: 'Automated position sizing based on account equity and risk per trade.', he: 'חישוב אוטומטי של גודל הפוזיציה לפי הון החשבון והסיכון לכל עסקה.' },
  cap3_title:           { en: 'MARKET INTEL',             he: 'מודיעין שוק'                   },
  cap3_body:            { en: 'Real-time institutional data and economic calendar tracking.', he: 'נתונים מוסדיים בזמן אמת ומעקב אחר יומן כלכלי.' },
  cap4_title:           { en: 'PERFORMANCE ANALYTICS',    he: 'אנליטיקת ביצועים'              },
  cap4_body:            { en: 'Visualizing PnL, Win-Rate, and R:R distribution metrics.', he: 'הצגה חזותית של מדדי רווח והפסד, אחוז הצלחה והתפלגות יחס סיכון/סיכוי.' },
  spec_langs:           { en: 'Hebrew · English',         he: 'עברית · English'               },

  // ── Landing: pricing CTA block ───────────────────────────────────
  cta_title:            { en: 'Every institutional edge.', he: 'כל הקצה המוסדי.'               },
  cta_title_accent:     { en: 'On one screen.',           he: 'במסך אחד.'                     },
  cta_sub:              { en: 'Choose your plan and start trading with institutional tools.', he: 'בחר את המסלול שלך והתחל לסחור עם הכלים של המוסדיים.' },
  cta_upgrade:          { en: 'Subscribe & Upgrade the System', he: 'לרכישת מנוי ושדרוג המערכת' },
  dock_sub:             { en: 'Upgrade · Onyx Trading',   he: 'שדרוג · Onyx Trading'          },

  // ── Pricing tiers ────────────────────────────────────────────────
  tier_premium_name:    { en: 'PREMIUM Plan',             he: 'מנוי PREMIUM'                  },
  tier_premium_tag:     { en: 'Full Trading Access',      he: 'גישת מסחר מלאה'                },
  tier_premium_sub:     { en: 'Everything you need to trade live.', he: 'כל הכלים שאתה צריך בשביל לסחור בלייב.' },
  tier_premium_f1:      { en: 'Central trading dashboard', he: 'דשבורד המסחר המרכזי'           },
  tier_premium_f2:      { en: 'Live ES & NQ futures chart sync', he: 'סינכרון גרפים חי של חוזי ES ו-NQ' },
  tier_premium_f3:      { en: 'Built-in CME risk manager', he: 'מחשבון ניהול סיכונים CME מובנה' },
  tier_premium_f4:      { en: 'Real-time macro news panel', he: 'פאנל חדשות מאקרו בזמן אמת'     },
  tier_deluxe_name:     { en: 'DELUXE Plan',              he: 'מנוי DELUXE'                   },
  tier_deluxe_tag:      { en: "The Professionals' Suite", he: 'חבילת המקצוענים'               },
  tier_deluxe_badge:    { en: "Professionals' Choice",    he: 'הבחירה של המקצוענים'           },
  tier_deluxe_sub:      { en: 'The most complete and advanced version of the system.', he: 'הגרסה המלאה והמתקדמת ביותר של המערכת.' },
  tier_deluxe_f1:       { en: 'All Premium plan capabilities', he: 'כל יכולות מנוי ה-Premium'  },
  tier_deluxe_f2:       { en: 'Exclusive access to the Analytics screen', he: 'גישה בלעדית למסך הניתוחים' },
  tier_deluxe_f3:       { en: 'Digital trading journal for logging trades', he: 'יומן המסחר הדיגיטלי לתיעוד עסקאות' },
  tier_deluxe_f4:       { en: 'Essential performance metrics bar (StatsBar)', he: 'שורת מדדי הביצוע החיוניים (StatsBar)' },
  card_selected:        { en: 'Selected ✓',               he: 'נבחר ✓'                        },
  card_select:          { en: 'Select Plan',              he: 'בחר מסלול'                     },

  // ── Footer / legal ───────────────────────────────────────────────
  legal_title:          { en: 'Legal Notice · Risk Disclaimer', he: 'הבהרה משפטית · Risk Disclaimer' },
  legal_body:           { en: 'Risk Disclaimer: The information and tools presented in the ONYX TRADING system are intended for educational, research, and informational purposes only, and do not constitute in any way investment advice, financial or business advice, or a recommendation/solicitation to buy or sell securities, futures, or any other financial instrument. Trading in the capital markets involves high financial risk and may lead to full or partial loss of your funds. The company, its developers, and its owners bear no direct or indirect responsibility for any loss, damage, or financial harm resulting from use of the system, its indicators, or the data presented within it. Use of the system is at the sole responsibility of the user.', he: 'הבהרה משפטית וסרת אחריות (Risk Disclaimer): המידע והכלים המוצגים במערכת ONYX TRADING נועדו למטרות לימודיות, מחקריות ואינפורמטיביות בלבד, ואינם מהווים בשום אופן ייעוץ השקעות, ייעוץ פיננסי, עסקי, או המלצה/שידול לביצוע פעולות קנייה ומכירה בניירות ערך, חוזים עתידיים או כל מכשיר פיננסי אחר. המסחר בשוק ההון כרוך בסיכון כלכלי גבוה ועלול להוביל להפסד מלא או חלקי של כספך. החברה, מפתחיה או בעליה אינם נושאים באחריות ישירה או עקיפה לכל הפסד, נזק או אובדן כספי שייגרם כתוצאה משימוש במערכת, באינדיקטורים או בנתונים המוצגים בה. השימוש במערכת הוא על אחריותו הבלעדית של המשתמש בלבד.' },
} satisfies Record<string, { en: string; he: string }>;

export type DictKey = keyof typeof DICT;

export function t(lang: Lang, key: DictKey): string {
  return DICT[key][lang];
}
