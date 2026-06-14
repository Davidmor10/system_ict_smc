'use client';

import { createContext, useContext, useState } from 'react';
import type { Lang } from '../lib/i18n';
import { t as _t, type DictKey } from '../lib/i18n';

interface LangCtx {
  lang:   Lang;
  toggle: () => void;
  t:      (key: DictKey) => string;
}

const Ctx = createContext<LangCtx>({
  lang:   'he',
  toggle: () => {},
  t:      (key) => _t('he', key),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Hebrew-first: all authored copy is Hebrew; English is the toggle target.
  const [lang, setLang] = useState<Lang>('he');
  const toggle = () => setLang(l => l === 'en' ? 'he' : 'en');
  const t = (key: DictKey) => _t(lang, key);
  return <Ctx.Provider value={{ lang, toggle, t }}>{children}</Ctx.Provider>;
}

export function useLanguage(): LangCtx {
  return useContext(Ctx);
}
