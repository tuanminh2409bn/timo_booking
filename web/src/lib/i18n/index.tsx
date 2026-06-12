'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import en, { TranslationKeys } from './locales/en';
import de from './locales/de';
import vi from './locales/vi';

export type Locale = 'en' | 'de' | 'vi';

const translations: Record<Locale, TranslationKeys> = { en, de: de as unknown as TranslationKeys, vi: vi as unknown as TranslationKeys };

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslationKeys;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'de',
  setLocale: () => {},
  t: en,
});

export function I18nProvider({ children, defaultLocale = 'de' }: { children: ReactNode; defaultLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [hydrated, setHydrated] = useState(false);

  // Read saved locale AFTER hydration to avoid server/client mismatch
  React.useEffect(() => {
    const saved = localStorage.getItem('timmo-locale') as Locale | null;
    if (saved && translations[saved]) {
      setLocaleState(saved);
      document.documentElement.lang = saved;
    }
    setHydrated(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('timmo-locale', newLocale);
    document.documentElement.lang = newLocale;
  }, []);

  // Prevent flash: show nothing until locale is resolved (very fast, ~1 frame)
  if (!hydrated) {
    return (
      <I18nContext.Provider value={{ locale: defaultLocale, setLocale, t: translations[defaultLocale] }}>
        {children}
      </I18nContext.Provider>
    );
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}

export const localeNames: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  vi: 'Tiếng Việt',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  vi: '🇻🇳',
};
