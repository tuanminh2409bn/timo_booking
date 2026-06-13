'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import Link from 'next/link';
import { getGermanDateObject, getGermanTodayString } from '@/lib/timeUtils';
import styles from './page.module.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [realBookings, setRealBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // SuperAdmin states
  const [pendingOwners, setPendingOwners] = useState<any[]>([]);
  const [totalBranches, setTotalBranches] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPlatformBookings, setTotalPlatformBookings] = useState(0);
  const [totalPlatformRevenue, setTotalPlatformRevenue] = useState(0);
  const [roleDistribution, setRoleDistribution] = useState<Record<string, number>>({ superadmin: 0, owner: 0, manager: 0, staff: 0 });

  // ---------- DATA FETCHING (UNCHANGED) ----------

  // Listen to pending owner accounts (Super Admin only)
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;
    const q = collection(db, 'users');
    const unsubscribe = onSnapshot(q, (snap) => {
      const pending: any[] = [];
      let users = 0;
      const roles: Record<string, number> = { superadmin: 0, owner: 0, manager: 0, staff: 0 };
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        users++;
        const r = d.role || 'staff';
        if (r in roles) roles[r]++;
        if (d.role === 'owner' && d.approvalStatus === 'pending_superadmin') {
          pending.push({ uid: docSnap.id, ...d });
        }
      });
      setPendingOwners(pending);
      setTotalUsers(users);
      setRoleDistribution(roles);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen to branches count (Super Admin)
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;
    const unsubscribe = onSnapshot(collection(db, 'branches'), (snap) => {
      setTotalBranches(snap.size);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen to platform-wide bookings (Super Admin)
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;
    const unsubscribe = onSnapshot(collectionGroup(db, 'bookings'), (snap) => {
      let count = 0, rev = 0;
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status !== 'cancelled') {
          count++;
          rev += (d.totalPrice || 0);
        }
      });
      setTotalPlatformBookings(count);
      setTotalPlatformRevenue(rev);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen to branch bookings (Owner/Manager)
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    const branchId = user.assignedBranches?.[0];
    if (!branchId) { setLoading(false); return; }
    const bookingsRef = collection(db, 'branches', branchId, 'bookings');
    const unsubscribe = onSnapshot(bookingsRef, (snap) => {
      const list: any[] = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      setRealBookings(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const handleApproveOwner = async (owner: any) => {
    try {
      await updateDoc(doc(db, 'users', owner.uid), { approvalStatus: 'approved' });
      const branchSlug = owner.assignedBranches?.[0];
      if (branchSlug) await updateDoc(doc(db, 'branches', branchSlug), { isActive: true });
    } catch (e) { console.error(e); }
  };

  const handleRejectOwner = async (owner: any) => {
    if (!confirm(locale === 'vi' ? 'Từ chối chủ tiệm này?' : 'Reject this owner?')) return;
    try {
      await updateDoc(doc(db, 'users', owner.uid), { approvalStatus: 'rejected' });
      const branchSlug = owner.assignedBranches?.[0];
      if (branchSlug) await updateDoc(doc(db, 'branches', branchSlug), { isActive: false });
    } catch (e) { console.error(e); }
  };

  if (!user) return null;

  // ---------- COMPUTED ----------
  const todayStr = getGermanTodayString();
  const todayBookings = realBookings.filter(b => {
    if (b.appointmentDate !== todayStr || b.status === 'cancelled') return false;
    if (user.role === 'staff' && b.staffId !== user.staffId) return false;
    return true;
  });
  const activeBookings = realBookings.filter(b => b.status !== 'cancelled');
  const pendingBookings = realBookings.filter(b => b.status === 'pending_approval');

  // ---------- RENDER: SUPER ADMIN ----------
  if (user.role === 'superadmin') {
    return (
      <div className={styles.page}>
        {/* Booking summary card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLeft}>
            <span className={styles.summaryIcon}>📊</span>
            <div>
              <div className={styles.summaryTitle}>
                {locale === 'vi' ? 'Tổng quan hệ thống' : 'System Overview'}
              </div>
              <div className={styles.summaryCount}>
                {totalPlatformBookings} {locale === 'vi' ? 'lịch hẹn' : 'bookings'}
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statNumber}>{totalBranches}</span>
            <span className={styles.statLabel}>{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statNumber}>{totalUsers}</span>
            <span className={styles.statLabel}>{locale === 'vi' ? 'Tài khoản' : 'Accounts'}</span>
          </div>
        </div>

        {/* Pending approvals */}
        {pendingOwners.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>
              👑 {locale === 'vi' ? 'Chờ duyệt' : 'Pending'} 
              <span className={styles.badge}>{pendingOwners.length}</span>
            </h3>
            {pendingOwners.map((owner) => (
              <div key={owner.uid} className={styles.approvalItem}>
                <div>
                  <div className={styles.approvalName}>{owner.name}</div>
                  <div className={styles.approvalSub}>{owner.email}</div>
                </div>
                <div className={styles.approvalActions}>
                  <button className={styles.btnApprove} onClick={() => handleApproveOwner(owner)}>
                    {locale === 'vi' ? 'Duyệt' : 'Approve'}
                  </button>
                  <button className={styles.btnReject} onClick={() => handleRejectOwner(owner)}>
                    {locale === 'vi' ? 'Từ chối' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Management menu */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {locale === 'vi' ? 'Quản lý' : 'Management'}
          </h3>
          <Link href="/admin/dashboard/branches/" className={styles.menuItem}>
            <span className={styles.menuIcon}>🏢</span>
            <span className={styles.menuLabel}>{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
            <span className={styles.menuBadge}>{totalBranches}</span>
            <span className={styles.menuArrow}>›</span>
          </Link>
          <Link href="/admin/dashboard/accounts/" className={styles.menuItem}>
            <span className={styles.menuIcon}>👤</span>
            <span className={styles.menuLabel}>{locale === 'vi' ? 'Tài khoản' : 'Accounts'}</span>
            <span className={styles.menuBadge}>{totalUsers}</span>
            <span className={styles.menuArrow}>›</span>
          </Link>
        </div>
      </div>
    );
  }

  // ---------- RENDER: STAFF ----------
  if (user.role === 'staff') {
    return (
      <div className={styles.page}>
        {/* Booking summary card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLeft}>
            <span className={styles.summaryIcon}>📅</span>
            <div>
              <div className={styles.summaryTitle}>{locale === 'vi' ? 'Lịch hẹn' : 'Bookings'}</div>
              <div className={styles.summaryCount}>
                {todayBookings.length} {locale === 'vi' ? 'lịch' : 'bookings'}
              </div>
            </div>
          </div>
          <Link href="/admin/dashboard/bookings/" className={styles.summaryBtn}>
            {locale === 'vi' ? 'Xem lịch' : 'View'} →
          </Link>
        </div>

        {/* Today's schedule */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{locale === 'vi' ? 'Lịch hôm nay' : "Today's Schedule"}</h3>
          {todayBookings.length === 0 ? (
            <div className={styles.emptyState}>
              {locale === 'vi' ? 'Không có lịch hẹn hôm nay' : 'No bookings today'}
            </div>
          ) : (
            todayBookings
              .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
              .map((b) => {
                const serviceName = (b.services || []).length > 0
                  ? (typeof b.services[0] === 'object' ? (b.services[0].serviceName || b.services[0].name) : b.services[0])
                  : 'Service';
                return (
                <div key={b.id} className={styles.bookingCard}>
                  <div className={styles.bookingTime}>
                    <span className={styles.bookingTimeText}>{b.startTime || '—'}</span>
                    <span className={styles.bookingDuration}>{b.totalDurationMinutes || 60} {locale === 'vi' ? 'phút' : 'min'}</span>
                  </div>
                  <div className={styles.bookingInfo}>
                    <span className={styles.bookingService}>
                      {serviceName} {b.services?.length > 1 ? `+${b.services.length - 1}` : ''}
                    </span>
                  </div>
                  <span className={styles.bookingPrice}>{b.totalPrice || 0}€</span>
                </div>
              )})
          )}
        </div>
      </div>
    );
  }

  // ---------- RENDER: OWNER / MANAGER ----------
  return (
    <div className={styles.page}>
      {/* Booking summary card */}
      <div className={styles.summaryCard}>
        <div className={styles.summaryLeft}>
          <span className={styles.summaryIcon}>📅</span>
          <div>
            <div className={styles.summaryTitle}>{locale === 'vi' ? 'Lịch hẹn' : 'Bookings'}</div>
            <div className={styles.summaryCount}>
              {activeBookings.length} {locale === 'vi' ? 'lịch' : 'bookings'}
            </div>
          </div>
        </div>
        <Link href="/admin/dashboard/bookings/" className={styles.summaryBtn}>
          {locale === 'vi' ? 'Xem lịch' : 'View'} →
        </Link>
      </div>

      {/* Quick stats */}
      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <span className={styles.statNumber}>{todayBookings.length}</span>
          <span className={styles.statLabel}>{locale === 'vi' ? 'Hôm nay' : 'Today'}</span>
        </div>
        <div className={styles.statItem}>
          <span className={`${styles.statNumber} ${pendingBookings.length > 0 ? styles.alertNumber : ''}`}>
            {pendingBookings.length}
          </span>
          <span className={styles.statLabel}>{locale === 'vi' ? 'Chờ duyệt' : 'Pending'}</span>
        </div>
      </div>

      {/* Management menu */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{locale === 'vi' ? 'Quản lý' : 'Management'}</h3>
        
        <Link href="/admin/dashboard/staff/" className={styles.menuItem}>
          <span className={styles.menuIcon}>👥</span>
          <span className={styles.menuLabel}>{locale === 'vi' ? 'Nhân sự' : 'Staff'}</span>
          <span className={styles.menuArrow}>›</span>
        </Link>

        <Link href="/admin/dashboard/services/" className={styles.menuItem}>
          <span className={styles.menuIcon}>💅</span>
          <span className={styles.menuLabel}>{locale === 'vi' ? 'Dịch vụ' : 'Services'}</span>
          <span className={styles.menuArrow}>›</span>
        </Link>

        {user.role === 'owner' && (
          <Link href="/admin/dashboard/my-branches/" className={styles.menuItem}>
            <span className={styles.menuIcon}>🏪</span>
            <span className={styles.menuLabel}>{locale === 'vi' ? 'Chi nhánh của tôi' : 'My Branches'}</span>
            <span className={styles.menuArrow}>›</span>
          </Link>
        )}
      </div>
    </div>
  );
}
