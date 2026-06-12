'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

interface FirestoreBooking {
  id: string;
  customerName: string;
  customerPhone: string;
  services: any[];
  staffId: string;
  staffName: string;
  appointmentDate: string;
  startTime: string;
  totalPrice: number;
  totalDurationMinutes: number;
  status: 'pending_approval' | 'confirmed' | 'cancelled';
  createdAt: string;
}

export default function BookingsManagementPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [bookings, setBookings] = useState<FirestoreBooking[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending_approval' | 'confirmed' | 'cancelled'>('all');
  const [loading, setLoading] = useState(true);

  // Sync bookings in real-time from Firestore
  useEffect(() => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    const bookingsRef = collection(db, 'branches', branchId, 'bookings');
    
    // Staff can only read their own bookings (Firestore rules enforce this)
    const bookingsQuery = user.role === 'staff' && user.staffId
      ? query(bookingsRef, where('staffId', '==', user.staffId))
      : bookingsRef;

    const unsubscribe = onSnapshot(bookingsQuery, (snap) => {
      const list: FirestoreBooking[] = [];
      snap.forEach(doc => {
        list.push(doc.data() as FirestoreBooking);
      });
      // Sort bookings by creation date descending
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBookings(list);
      setLoading(false);
    }, (e) => {
      console.error('Error listening to bookings:', e);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleApprove = async (id: string) => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try {
      const bookingDocRef = doc(db, 'branches', branchId, 'bookings', id);
      await updateDoc(bookingDocRef, { status: 'confirmed' });
    } catch (e) {
      console.error('Error approving booking:', e);
    }
  };

  const handleReject = async (id: string) => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try {
      const bookingDocRef = doc(db, 'branches', branchId, 'bookings', id);
      await updateDoc(bookingDocRef, { status: 'cancelled' });
    } catch (e) {
      console.error('Error rejecting/cancelling booking:', e);
    }
  };

  // Filter bookings based on user role permissions (Staff only sees their own schedule)
  const bookingsForRole = bookings.filter(b => {
    if (user?.role === 'staff') {
      return b.staffId === user.staffId;
    }
    return true;
  });

  const filteredBookings = bookingsForRole.filter(b => filter === 'all' || b.status === filter);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending_approval':
        return <span className={`${styles.badge} ${styles.badgePending}`}>{t.admin.bookings.statusPending}</span>;
      case 'confirmed':
        return <span className={`${styles.badge} ${styles.badgeConfirmed}`}>{t.admin.bookings.statusConfirmed}</span>;
      case 'cancelled':
        return <span className={`${styles.badge} ${styles.badgeCancelled}`}>{t.admin.bookings.statusCancelled}</span>;
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{t.admin.bookings.title}</h1>
          <p className={styles.subtitle}>
            {user?.role === 'staff' 
              ? t.admin.bookings.subtitleStaff 
              : t.admin.bookings.subtitleOwner}
          </p>
        </div>

        {/* Filters */}
        <div className={styles.filterTabs}>
          <button
            className={`${styles.filterTab} ${filter === 'all' ? styles.filterTabActive : ''}`}
            onClick={() => setFilter('all')}
          >
            {t.admin.bookings.tabAll} ({bookingsForRole.length})
          </button>
          <button
            className={`${styles.filterTab} ${filter === 'pending_approval' ? styles.filterTabActive : ''}`}
            onClick={() => setFilter('pending_approval')}
          >
            {t.admin.bookings.tabPending} ({bookingsForRole.filter(b => b.status === 'pending_approval').length})
          </button>
          <button
            className={`${styles.filterTab} ${filter === 'confirmed' ? styles.filterTabActive : ''}`}
            onClick={() => setFilter('confirmed')}
          >
            {t.admin.bookings.tabConfirmed} ({bookingsForRole.filter(b => b.status === 'confirmed').length})
          </button>
          <button
            className={`${styles.filterTab} ${filter === 'cancelled' ? styles.filterTabActive : ''}`}
            onClick={() => setFilter('cancelled')}
          >
            {t.admin.bookings.tabCancelled} ({bookingsForRole.filter(b => b.status === 'cancelled').length})
          </button>
        </div>
      </div>

      {/* Bookings List */}
      <div className={styles.bookingsList}>
        {loading ? (
          <div className={styles.noBookings}>
            <p>{t.admin.bookings.loading}</p>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className={styles.noBookings}>
            <span className={styles.emptyIcon}>📭</span>
            <p>{t.admin.bookings.empty}</p>
          </div>
        ) : (
          filteredBookings.map((booking) => (
            <div key={booking.id} className={styles.bookingCard}>
              {/* Top Row: Customer Info & Status */}
              <div className={styles.cardHeader}>
                <div className={styles.customerInfo}>
                  <h3 className={styles.customerName}>{booking.customerName}</h3>
                  {user?.role !== 'staff' ? (
                    <span className={styles.customerPhone}>{booking.customerPhone}</span>
                  ) : (
                    <span className={styles.customerPhone}>{t.admin.bookings.contactManager}</span>
                  )}
                </div>
                <div className={styles.statusGroup}>
                  {getStatusBadge(booking.status)}
                  <span className={styles.bookingId}>{booking.id}</span>
                </div>
              </div>

              {/* Middle Section: Services & Staff details */}
              <div className={styles.cardBody}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t.admin.bookings.detailServices}:</span>
                  <div className={styles.servicesList}>
                    {booking.services.map((s, idx) => {
                      const serviceText = typeof s === 'object' && s !== null 
                        ? (s.serviceName || s.name || '') 
                        : String(s);
                      return (
                        <span key={idx} className={styles.serviceItemPill}>💅 {serviceText}</span>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.detailsGrid}>
                  <div className={styles.gridItem}>
                    <span className={styles.detailLabel}>{t.admin.bookings.detailStaff}:</span>
                    <span className={styles.detailValue}>👩‍🎨 {booking.staffName}</span>
                  </div>
                  <div className={styles.gridItem}>
                    <span className={styles.detailLabel}>{t.admin.bookings.detailDate}:</span>
                    <span className={styles.detailValue}>📅 {formatDate(booking.appointmentDate)}</span>
                  </div>
                  <div className={styles.gridItem}>
                    <span className={styles.detailLabel}>{t.admin.bookings.detailTime}:</span>
                    <span className={styles.detailValue}>⏰ {booking.startTime} ({booking.totalDurationMinutes} {t.common.minutes})</span>
                  </div>
                  <div className={styles.gridItem}>
                    <span className={styles.detailLabel}>{t.admin.bookings.detailTotal}:</span>
                    <span className={`${styles.detailValue} ${styles.priceText}`}>€{booking.totalPrice}</span>
                  </div>
                </div>
              </div>

              {/* Bottom Row: Action Buttons (Hidden for Staff) */}
              {user?.role !== 'staff' && (
                <>
                  {booking.status === 'pending_approval' && (
                    <div className={styles.cardActions}>
                      <button
                        className={styles.rejectBtn}
                        onClick={() => handleReject(booking.id)}
                      >
                        {t.admin.bookings.btnReject}
                      </button>
                      <button
                        className={styles.approveBtn}
                        onClick={() => handleApprove(booking.id)}
                      >
                        {t.admin.bookings.btnApprove}
                      </button>
                    </div>
                  )}

                  {booking.status === 'confirmed' && (
                    <div className={styles.cardActions}>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => handleReject(booking.id)}
                      >
                        {t.admin.bookings.btnCancel}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
