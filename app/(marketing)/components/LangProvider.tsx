'use client';

import { createContext, useContext, useEffect } from 'react';

export type Lang = 'he';

interface LangCtx {
  lang: Lang;
}

const Ctx = createContext<LangCtx>({ lang: 'he' });

// Hebrew-only: the marketing site no longer offers an English toggle.
export function MarketingLangProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
    return () => {
      document.documentElement.lang = 'he';
      document.documentElement.dir = 'rtl';
    };
  }, []);

  return <Ctx.Provider value={{ lang: 'he' }}>{children}</Ctx.Provider>;
}

export const useMarketingLang = () => useContext(Ctx);
