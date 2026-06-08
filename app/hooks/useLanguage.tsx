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
  lang:   'en',
  toggle: () => {},
  t:      (key) => _t('en', key),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const toggle = () => setLang(l => l === 'en' ? 'he' : 'en');
  const t = (key: DictKey) => _t(lang, key);
  return <Ctx.Provider value={{ lang, toggle, t }}>{children}</Ctx.Provider>;
}

export function useLanguage(): LangCtx {
  return useContext(Ctx);
}
