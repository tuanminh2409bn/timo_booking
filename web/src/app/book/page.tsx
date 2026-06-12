'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { Branch } from '@/lib/types';
import styles from './page.module.css';

export default function BookLandingPage() {
  const { t } = useI18n();
  const [salons, setSalons] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Query active branches from Firestore
    const branchesRef = collection(db, 'branches');
    const q = query(branchesRef, where('isActive', '==', true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const branchList: Branch[] = [];
      snapshot.forEach((doc) => {
        branchList.push({
          id: doc.id,
          ...doc.data(),
        } as Branch);
      });
      setSalons(branchList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching active salons: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter salons based on searchQuery
  const filteredSalons = salons.filter((salon) => {
    const q = searchQuery.toLowerCase();
    return (
      (salon.name || '').toLowerCase().includes(q) ||
      (salon.address || '').toLowerCase().includes(q) ||
      (salon.phone || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.langWrapper}>
          <LanguageSwitcher variant="light" />
        </div>
        <h1 className={styles.title}>{t.booking.discovery.title}</h1>
        <p className={styles.subtitle}>{t.booking.discovery.subtitle}</p>
      </header>

      {/* Search Bar */}
      <div className={styles.searchContainer}>
        <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t.booking.discovery.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Content Area */}
      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>{t.booking.discovery.loading}</p>
        </div>
      ) : filteredSalons.length === 0 ? (
        <div className={styles.noResults}>
          <svg className={styles.noResultsIcon} width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <div className={styles.noResultsText}>{t.booking.discovery.empty}</div>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredSalons.map((salon) => (
            <div key={salon.id} className={styles.card}>
              <div className={styles.cardBody}>
                <h2 className={styles.salonName}>{salon.name}</h2>
                <div className={styles.detailsList}>
                  <div className={styles.detailItem}>
                    <svg className={styles.icon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                      <circle cx="12" cy="9" r="2" />
                    </svg>
                    <span>{salon.address}</span>
                  </div>
                  {salon.phone && (
                    <div className={styles.detailItem}>
                      <svg className={styles.icon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <span>{salon.phone}</span>
                    </div>
                  )}
                </div>
              </div>
              <Link href={`/book/${salon.slug}`} className={styles.bookBtn}>
                {t.booking.discovery.bookBtn}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
