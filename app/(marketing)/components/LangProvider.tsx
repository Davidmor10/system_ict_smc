'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'he' | 'en';

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<LangCtx>({ lang: 'he', setLang: () => {} });

export function MarketingLangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('he');

  const applyLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr';
    try { localStorage.setItem('onyx_landing_lang', l); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    let saved: Lang = 'he';
    try {
      const v = localStorage.getItem('onyx_landing_lang');
      if (v === 'en' || v === 'he') saved = v;
    } catch { /* noop */ }
    applyLang(saved);

    return () => {
      // Restore defaults when navigating away from marketing section
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    };
  }, [applyLang]);

  return <Ctx.Provider value={{ lang, setLang: applyLang }}>{children}</Ctx.Provider>;
}

export const useMarketingLang = () => useContext(Ctx);
