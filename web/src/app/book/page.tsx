'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import {
  fetchHrmPublicStores,
  type HrmPublicStoreSummary,
} from '@/lib/hrmApi';
import { useI18n } from '@/lib/i18n';
import styles from './page.module.css';

export default function BookLandingPage() {
  const { locale } = useI18n();
  const copy = {
    de: {
      title: 'Nagelstudio auswählen',
      subtitle: 'Finden Sie ein Studio und buchen Sie Ihren Termin direkt online.',
      search: 'Nach Studio, Stadt oder Adresse suchen ...',
      result: 'Studios verfügbar',
      addressMissing: 'Adresse wird noch ergänzt',
      hours: 'Öffnungszeiten',
      book: 'Termin buchen',
      empty: 'Keine passenden Studios gefunden.',
      error: 'Die Studios konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
      loadMore: 'Weitere Studios laden',
      loading: 'Studios werden geladen ...',
      home: 'Zurück zu Timmo Booking',
    },
    en: {
      title: 'Choose a nail salon',
      subtitle: 'Find a salon and book your appointment directly online.',
      search: 'Search by salon, city, or address ...',
      result: 'salons available',
      addressMissing: 'Address will be added soon',
      hours: 'Opening hours',
      book: 'Book appointment',
      empty: 'No matching salons were found.',
      error: 'The salon directory could not be loaded.',
      retry: 'Try again',
      loadMore: 'Load more salons',
      loading: 'Loading salons ...',
      home: 'Back to Timmo Booking',
    },
    vi: {
      title: 'Chọn cửa hàng đặt lịch',
      subtitle: 'Tìm cửa hàng phù hợp và đặt lịch trực tuyến ngay trên Timmo.',
      search: 'Tìm theo tên cửa hàng, thành phố hoặc địa chỉ ...',
      result: 'cửa hàng đang nhận lịch',
      addressMissing: 'Cửa hàng chưa cập nhật địa chỉ',
      hours: 'Giờ mở cửa',
      book: 'Đặt lịch ngay',
      empty: 'Không tìm thấy cửa hàng phù hợp.',
      error: 'Không thể tải danh sách cửa hàng.',
      retry: 'Thử lại',
      loadMore: 'Xem thêm cửa hàng',
      loading: 'Đang tải cửa hàng ...',
      home: 'Quay lại Timmo Booking',
    },
  }[locale];

  const [query, setQuery] = useState('');
  const [stores, setStores] = useState<HrmPublicStoreSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetchHrmPublicStores({ query, limit: 24 });
        if (cancelled) return;
        setStores(response.items);
        setTotal(response.meta.total);
        setNextCursor(response.meta.nextCursor);
      } catch {
        if (!cancelled) {
          setStores([]);
          setTotal(0);
          setNextCursor(undefined);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetchHrmPublicStores({ query, limit: 24, cursor: nextCursor });
      setStores((current) => [...current, ...response.items]);
      setTotal(response.meta.total);
      setNextCursor(response.meta.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, query]);

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <Link href="/" className={styles.homeLink}>← {copy.home}</Link>
        <LanguageSwitcher variant="light" />
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.subtitle}>{copy.subtitle}</p>
      </header>

      <div className={styles.searchContainer}>
        <span className={styles.searchIcon}>⌕</span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder={copy.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={copy.search}
        />
      </div>

      {!loading && !error && (
        <p className={styles.resultSummary}>{total} {copy.result}</p>
      )}

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{copy.loading}</span>
        </div>
      ) : error && stores.length === 0 ? (
        <div className={styles.noResults}>
          <div className={styles.noResultsIcon}>!</div>
          <p className={styles.noResultsText}>{copy.error}</p>
          <button className={styles.retryButton} onClick={() => setReloadKey((key) => key + 1)}>
            {copy.retry}
          </button>
        </div>
      ) : stores.length === 0 ? (
        <div className={styles.noResults}>
          <div className={styles.noResultsIcon}>⌕</div>
          <p className={styles.noResultsText}>{copy.empty}</p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {stores.map((store) => (
              <article className={styles.card} key={store.id}>
                <div className={styles.cardBody}>
                  <h2 className={styles.salonName}>{store.name}</h2>
                  <div className={styles.detailsList}>
                    <div className={styles.detailItem}>
                      <span className={styles.icon}>⌖</span>
                      <span>{store.addressText || copy.addressMissing}</span>
                    </div>
                    {store.openTime && store.closeTime && (
                      <div className={styles.detailItem}>
                        <span className={styles.icon}>◷</span>
                        <span>{copy.hours}: {store.openTime}–{store.closeTime}</span>
                      </div>
                    )}
                    {store.phone && (
                      <div className={styles.detailItem}>
                        <span className={styles.icon}>☎</span>
                        <span>{store.phone}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Link
                  href={`/book/${encodeURIComponent(store.bookingSlug)}/`}
                  className={styles.bookBtn}
                >
                  {copy.book}
                </Link>
              </article>
            ))}
          </div>
          {nextCursor && (
            <div className={styles.loadMoreWrapper}>
              <button className={styles.loadMoreButton} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? copy.loading : copy.loadMore}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
