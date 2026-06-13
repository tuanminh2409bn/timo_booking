'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n, localeFlags, localeNames, type Locale } from '@/lib/i18n';
import styles from './LanguageSwitcher.module.css';

const locales: Locale[] = ['de', 'en', 'vi'];

export default function LanguageSwitcher({
  variant = 'light',
  align = 'right',
}: {
  variant?: 'light' | 'dark';
  align?: 'left' | 'right';
}) {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={styles.switcher} ref={ref}>
      <button
        className={`${styles.trigger} ${variant === 'dark' ? styles.triggerDark : ''}`}
        onClick={() => setOpen(!open)}
        aria-label="Switch language"
      >
        <span className={styles.flag}>{localeFlags[locale]}</span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.overlay} onClick={() => setOpen(false)} />
          <div className={`${styles.dropdown} ${align === 'left' ? styles.dropdownLeft : ''}`}>
            {locales.map((loc) => (
              <button
                key={loc}
                className={`${styles.option} ${loc === locale ? styles.optionActive : ''}`}
                onClick={() => {
                  setLocale(loc);
                  setOpen(false);
                }}
              >
                <span className={styles.optionFlag}>{localeFlags[loc]}</span>
                <span className={styles.optionLabel}>{localeNames[loc]}</span>
                {loc === locale && (
                  <svg
                    className={styles.checkmark}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
