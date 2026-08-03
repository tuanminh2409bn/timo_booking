'use client';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/lib/i18n';
import styles from './page.module.css';

export default function BookLandingPage() {
  const { locale } = useI18n();
  const copy = {
    de: {
      title: 'Buchungslink erforderlich',
      subtitle:
        'Timmo ist kein Salon-Marktplatz. Bitte öffnen Sie den persönlichen Buchungslink, den Sie direkt von Ihrem Salon erhalten haben.',
    },
    en: {
      title: 'Salon booking link required',
      subtitle:
        'Timmo is not a salon marketplace. Please use the private booking link shared directly by your salon.',
    },
    vi: {
      title: 'Cần đường dẫn đặt lịch của tiệm',
      subtitle:
        'Timmo không phải sàn tìm kiếm salon. Vui lòng mở đường dẫn đặt lịch riêng do tiệm gửi trực tiếp cho bạn.',
    },
  }[locale];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.langWrapper}>
          <LanguageSwitcher variant="light" />
        </div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.subtitle}>{copy.subtitle}</p>
      </header>
      <div className={styles.noResults}>
        <svg
          className={styles.noResultsIcon}
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" />
          <path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15" />
        </svg>
      </div>
    </div>
  );
}
