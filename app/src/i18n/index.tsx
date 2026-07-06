// Lightweight EN/FR i18n. Strings stay co-located via an inline `tr(fr, en)`
// helper (no key dictionary to drift), and richer content (explanations) is
// authored as { fr, en } pairs resolved by the current language.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'fr' | 'en';
const STORAGE_KEY = 'quali-nirs4all.lang';

interface I18nContext {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const Ctx = createContext<I18nContext | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (v === 'fr' || v === 'en') return v;
    } catch { /* ignore */ }
    return 'fr';
  });
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): I18nContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLang must be used within an I18nProvider');
  return c;
}

/** A localized value, resolved to the current language. */
export type Localized<T> = { fr: T; en: T };

export function pick<T>(value: Localized<T>, lang: Lang): T {
  return value[lang];
}

/** Returns a `tr(fr, en)` picker bound to the current language. */
export function useTr(): (fr: string, en: string) => string {
  const { lang } = useLang();
  return useCallback((fr: string, en: string) => (lang === 'en' ? en : fr), [lang]);
}
