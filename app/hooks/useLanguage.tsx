'use client';

import { createContext, useContext } from 'react';
import type { Lang } from '../lib/i18n';
import { t as _t, type DictKey } from '../lib/i18n';

interface LangCtx {
  lang: Lang;
  t:    (key: DictKey) => string;
}

// Hebrew-only: the app no longer exposes an English toggle.
const Ctx = createContext<LangCtx>({
  lang: 'he',
  t:    (key) => _t('he', key),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={{ lang: 'he', t: (key) => _t('he', key) }}>{children}</Ctx.Provider>;
}

export function useLanguage(): LangCtx {
  return useContext(Ctx);
}
