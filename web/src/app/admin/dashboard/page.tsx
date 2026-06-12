'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, query, where, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [realBookings, setRealBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingOwners, setPendingOwners] = useState<any[]>([]);
  const [totalBranches, setTotalBranches] = useState<number>(0);
  const [totalUsers, setTotalUsers] = useState<number>(0);

  // SaaS Analytics states
  const [totalPlatformBookings, setTotalPlatformBookings] = useState<number>(0);
  const [totalPlatformRevenue, setTotalPlatformRevenue] = useState<number>(0);
  const [roleDistribution, setRoleDistribution] = useState<Record<string, number>>({
    superadmin: 0,
    owner: 0,
    manager: 0,
    staff: 0
  });
  const [branchRankings, setBranchRankings] = useState<{ id: string; name: string; count: number; revenue: number }[]>([]);
  const [platformWeeklyTrend, setPlatformWeeklyTrend] = useState<{ day: string; count: number }[]>([]);
  const [branchesMap, setBranchesMap] = useState<Record<string, string>>({});

  // Redirect staff to bookings page — staff has no stats dashboard
  useEffect(() => {
    if (user && user.role === 'staff') {
      router.replace('/admin/dashboard/bookings/');
    }
  }, [user, router]);

  if (user?.role === 'staff') {
    return (
      <div className={styles.container}>
        <div className={styles.welcomeBanner}>
          <div className={styles.bannerText}>
            <h1 className={styles.welcomeTitle}>
              {locale === 'vi' ? `Xin chào, ${user.name}` : locale === 'de' ? `Hallo, ${user.name}` : `Hello, ${user.name}`}
            </h1>
            <p className={styles.welcomeSubtitle}>
              {locale === 'vi' ? 'Đang chuyển đến lịch hẹn của bạn...' : locale === 'de' ? 'Weiterleitung zu Ihren Terminen...' : 'Redirecting to your bookings...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Listen to pending owner accounts (Super Admin only)
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;

    const usersRef = collection(db, 'users');
    const q = query(
      usersRef, 
      where('role', '==', 'owner'), 
      where('approvalStatus', '==', 'pending_superadmin')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const list: any[] = [];
      snap.forEach((doc) => {
        list.push({ uid: doc.id, ...doc.data() });
      });
      setPendingOwners(list);
    }, (err) => {
      console.error("Error listening to pending owners:", err);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to global SaaS stats (Super Admin only)
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;

    // Fetch branches count and map names
    const branchesRef = collection(db, 'branches');
    const unsubBranches = onSnapshot(branchesRef, (snap) => {
      setTotalBranches(snap.size);
      const tempMap: Record<string, string> = {};
      snap.forEach((docSnap) => {
        tempMap[docSnap.id] = docSnap.data().name || docSnap.id;
      });
      setBranchesMap(tempMap);
    }, (err) => {
      console.error("Error fetching branches count:", err);
    });

    // Fetch users count and role distribution
    const usersRef = collection(db, 'users');
    const unsubUsers = onSnapshot(usersRef, (snap) => {
      setTotalUsers(snap.size);
      const roles: Record<string, number> = {
        superadmin: 0,
        owner: 0,
        manager: 0,
        staff: 0
      };
      snap.forEach((docSnap) => {
        const r = docSnap.data().role || 'staff';
        if (r in roles) {
          roles[r]++;
        }
      });
      setRoleDistribution(roles);
    }, (err) => {
      console.error("Error fetching users count:", err);
    });

    return () => {
      unsubBranches();
      unsubUsers();
    };
  }, [user]);

  // Listen to platform-wide bookings (collection group query)
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;

    const bookingsGroupRef = collectionGroup(db, 'bookings');
    const unsubscribe = onSnapshot(bookingsGroupRef, (snap) => {
      let bookingsCount = 0;
      let totalRev = 0;
      const branchStats: Record<string, { count: number; revenue: number }> = {};
      
      // Weekly trend data calculations
      const today = new Date();
      const getStartOfWeek = () => {
        const d = new Date(today);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
        return new Date(d.setDate(diff));
      };
      const startOfWeek = getStartOfWeek();
      startOfWeek.setHours(0, 0, 0, 0);

      // Map day index to date strings of the current week
      const currentWeekDays: string[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        currentWeekDays.push(date.toISOString().split('T')[0]);
      }

      const WEEKDAY_NAMES = {
        vi: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'],
        de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
        en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      };
      const weekdayNames = WEEKDAY_NAMES[locale] || WEEKDAY_NAMES['de'];

      const weeklyCounts = Array.from({ length: 7 }, (_, idx) => ({
        day: weekdayNames[idx],
        count: 0
      }));

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.status !== 'cancelled') {
          bookingsCount++;
          totalRev += (data.totalPrice || 0);
          
          // Branch aggregation
          const bId = data.branchId || 'unknown';
          if (!branchStats[bId]) {
            branchStats[bId] = { count: 0, revenue: 0 };
          }
          branchStats[bId].count++;
          branchStats[bId].revenue += (data.totalPrice || 0);

          // Weekly trend check
          const appDate = data.appointmentDate; // YYYY-MM-DD
          const idx = currentWeekDays.indexOf(appDate);
          if (idx !== -1) {
            weeklyCounts[idx].count++;
          }
        }
      });

      setTotalPlatformBookings(bookingsCount);
      setTotalPlatformRevenue(totalRev);
      setPlatformWeeklyTrend(weeklyCounts);

      // Convert branchStats record to sorted list
      const rankingList = Object.keys(branchStats).map((bId) => ({
        id: bId,
        name: branchesMap[bId] || bId,
        count: branchStats[bId].count,
        revenue: branchStats[bId].revenue
      }));
      rankingList.sort((a, b) => b.count - a.count); // sort by booking count descending
      setBranchRankings(rankingList.slice(0, 5)); // Keep top 5
      setLoading(false);

    }, (err) => {
      console.error("Error listening to collectionGroup bookings:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, branchesMap, locale]);

  const handleApproveOwner = async (owner: any) => {
    try {
      // 1. Update user approvalStatus to 'approved'
      const userRef = doc(db, 'users', owner.uid);
      await updateDoc(userRef, {
        approvalStatus: 'approved'
      });

      // 2. Set branch isActive to true
      const branchSlug = owner.assignedBranches?.[0];
      if (branchSlug) {
        const branchRef = doc(db, 'branches', branchSlug);
        await updateDoc(branchRef, {
          isActive: true
        });
      }
      
      alert(locale === 'vi' ? 'Đã phê duyệt chủ tiệm thành công!' : 'Owner approved successfully!');
    } catch (e) {
      console.error("Error approving owner:", e);
    }
  };

  const handleRejectOwner = async (owner: any) => {
    if (!confirm(locale === 'vi' ? 'Bạn có chắc chắn muốn từ chối chủ tiệm này?' : 'Are you sure you want to reject this owner?')) return;
    try {
      const userRef = doc(db, 'users', owner.uid);
      await updateDoc(userRef, {
        approvalStatus: 'rejected'
      });

      const branchSlug = owner.assignedBranches?.[0];
      if (branchSlug) {
        const branchRef = doc(db, 'branches', branchSlug);
        await updateDoc(branchRef, {
          isActive: false
        });
      }
    } catch (e) {
      console.error("Error rejecting owner:", e);
    }
  };

  // Get current date strings
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-11

  // Listen to bookings in real-time (Owner/Manager only - staff is redirected)
  useEffect(() => {
    if (!user || user.role === 'superadmin' || user.role === 'staff') return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    const bookingsRef = collection(db, 'branches', branchId, 'bookings');
    const unsubscribe = onSnapshot(bookingsRef, (snap) => {
      const list: any[] = [];
      snap.forEach(doc => {
        list.push(doc.data());
      });
      setRealBookings(list);
      setLoading(false);
    }, (e) => {
      console.error('Error fetching bookings:', e);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user) return null;

  if (user.role === 'superadmin') {
    return (
      <div className={styles.container}>
        {/* Welcome banner */}
        <div className={styles.welcomeBanner} style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#ffffff' }}>
          <div className={styles.bannerText}>
            <h1 className={styles.welcomeTitle} style={{ color: '#ffffff' }}>
              {locale === 'vi' ? `Chào mừng trở lại, Super Admin ${user.name}` : `Welcome back, Super Admin ${user.name}`}
            </h1>
            <p className={styles.welcomeSubtitle} style={{ color: '#bfdbfe' }}>
              {locale === 'vi' ? 'Hệ thống đang hoạt động ổn định. Quản lý toàn bộ chi nhánh và tài khoản trên nền tảng.' : 'System is operating normally. Manage all branches and accounts on the platform.'}
            </p>
          </div>
        </div>

        {/* Super Admin Pending Owners Section */}
        {pendingOwners.length > 0 ? (
          <div style={{ backgroundColor: '#eff6ff', border: '1px solid #dbeafe', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1e40af', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>👑</span> {locale === 'vi' ? 'Yêu cầu duyệt chủ tiệm mới (SaaS)' : 'Pending Salon Owner Approvals'} ({pendingOwners.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {pendingOwners.map((owner) => (
                <div key={owner.uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                      {owner.name}
                    </div>
                    <div style={{ fontSize: '13px', color: '#4b5563', marginTop: '2px' }}>
                      ✉️ {owner.email} | 📞 {owner.phone || 'N/A'}
                    </div>
                    {owner.assignedBranches?.[0] && (
                      <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600, marginTop: '4px' }}>
                        🏢 Chi nhánh: {owner.assignedBranches[0]}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => handleApproveOwner(owner)}
                      style={{ padding: '8px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#3b82f6', color: '#ffffff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {locale === 'vi' ? 'Phê duyệt' : 'Approve'}
                    </button>
                    <button 
                      onClick={() => handleRejectOwner(owner)}
                      style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {locale === 'vi' ? 'Từ chối' : 'Reject'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ backgroundColor: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '12px', padding: '24px', marginBottom: '24px', textAlign: 'center', color: '#6b7280' }}>
            <span style={{ fontSize: '24px' }}>✓</span>
            <p style={{ margin: '8px 0 0 0', fontSize: '14px', fontWeight: 500 }}>
              {locale === 'vi' ? 'Không có yêu cầu duyệt chủ tiệm nào mới.' : 'No pending salon owner approvals.'}
            </p>
          </div>
        )}

        {/* Global SaaS Stats Grid */}
        <div className={styles.statsGrid}>
          {/* Card 1: Total branches */}
          <div className={styles.statCard}>
            <span className={styles.statLabel}>{locale === 'vi' ? 'Tổng số chi nhánh' : 'Total Branches'}</span>
            <div className={styles.statValueGroup}>
              <span className={styles.statValue}>{totalBranches}</span>
            </div>
            <p className={styles.statDesc}>{locale === 'vi' ? 'Tổng số cửa hàng/chi nhánh trên nền tảng' : 'Total salons and branches registered'}</p>
          </div>

          {/* Card 2: Total users */}
          <div className={styles.statCard}>
            <span className={styles.statLabel}>{locale === 'vi' ? 'Tổng số tài khoản' : 'Total Accounts'}</span>
            <div className={styles.statValueGroup}>
              <span className={styles.statValue}>{totalUsers}</span>
            </div>
            <p className={styles.statDesc}>{locale === 'vi' ? 'Tổng số tài khoản (Chủ tiệm, Quản lý, Nhân viên)' : 'Total system user profiles registered'}</p>
          </div>

          {/* Card 3: Total bookings */}
          <div className={styles.statCard}>
            <span className={styles.statLabel}>{locale === 'vi' ? 'Tổng lịch đặt' : 'Total Bookings'}</span>
            <div className={styles.statValueGroup}>
              <span className={styles.statValue}>{totalPlatformBookings}</span>
            </div>
            <p className={styles.statDesc}>{locale === 'vi' ? 'Tổng số lịch hẹn thành công toàn bộ hệ thống' : 'Total platform-wide bookings made'}</p>
          </div>

          {/* Card 4: Total est. revenue */}
          <div className={styles.statCard} style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.03) 0%, rgba(16, 185, 129, 0.01) 100%)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
            <span className={styles.statLabel} style={{ color: '#059669' }}>{locale === 'vi' ? 'Ước tính doanh thu' : 'Est. Platform Revenue'}</span>
            <div className={styles.statValueGroup}>
              <span className={styles.statValue} style={{ color: '#10b981' }}>€{totalPlatformRevenue.toLocaleString()}</span>
            </div>
            <p className={styles.statDesc}>{locale === 'vi' ? 'Ước tính doanh thu phát sinh trên toàn hệ thống' : 'Estimated revenue generated across SaaS'}</p>
          </div>
        </div>

        {/* Detailed SaaS Analytics Layout */}
        <div className={styles.analyticsLayout}>
          {/* Box 1: User Distribution */}
          <div className={styles.analyticsBox}>
            <h3 className={styles.analyticsBoxTitle}>
              {locale === 'vi' ? 'Phân bố vai trò người dùng' : 'User Roles Distribution'}
            </h3>
            <div className={styles.roleDistributionList}>
              {[
                { key: 'superadmin', label: 'Super Admin', color: '#7c3aed' },
                { key: 'owner', label: locale === 'vi' ? 'Chủ tiệm (Owner)' : 'Owner', color: '#2563eb' },
                { key: 'manager', label: locale === 'vi' ? 'Quản lý (Manager)' : 'Manager', color: '#059669' },
                { key: 'staff', label: locale === 'vi' ? 'Nhân viên (Staff)' : 'Staff', color: '#4b5563' }
              ].map((roleItem) => {
                const count = roleDistribution[roleItem.key] || 0;
                const percentage = totalUsers > 0 ? (count / totalUsers) * 100 : 0;
                return (
                  <div key={roleItem.key} className={styles.roleProgressGroup}>
                    <div className={styles.roleProgressLabelRow}>
                      <span className={styles.roleLabelText}>{roleItem.label}</span>
                      <span className={styles.roleCountText}>{count} ({percentage.toFixed(0)}%)</span>
                    </div>
                    <div className={styles.roleProgressBar}>
                      <div 
                        className={styles.roleProgressFill} 
                        style={{ width: `${percentage}%`, backgroundColor: roleItem.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Box 2: Top Branches */}
          <div className={styles.analyticsBox}>
            <h3 className={styles.analyticsBoxTitle}>
              {locale === 'vi' ? 'Chi nhánh hoạt động nổi bật' : 'Top Performing Branches'}
            </h3>
            {branchRankings.length === 0 ? (
              <p className={styles.emptyText} style={{ textAlign: 'center', margin: '40px 0', color: '#9ca3af' }}>
                {locale === 'vi' ? 'Chưa có dữ liệu thống kê chi nhánh.' : 'No branch analytics data available.'}
              </p>
            ) : (
              <div className={styles.rankingList}>
                {branchRankings.map((branch, index) => (
                  <div key={branch.id} className={styles.rankingItem}>
                    <div className={styles.rankingLeft}>
                      <span className={styles.rankingRank}>{index + 1}</span>
                      <div className={styles.rankingInfo}>
                        <span className={styles.rankingName}>{branch.name}</span>
                        <span className={styles.rankingBookings}>{branch.count} {locale === 'vi' ? 'lịch đặt' : 'bookings'}</span>
                      </div>
                    </div>
                    <span className={styles.rankingRevenue}>€{branch.revenue.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Platform Booking Weekly Trend Chart */}
        <div className={styles.chartSection}>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>
              {locale === 'vi' ? 'Xu hướng đặt lịch hệ thống tuần này' : 'Platform Weekly Booking Trend'}
            </h3>
            <span className={styles.chartSub}>
              {locale === 'vi' ? 'Số lượng lịch hẹn phát sinh mỗi ngày (đã loại bỏ lịch hủy)' : 'Total active bookings per day across the entire SaaS'}
            </span>
          </div>

          <div className={styles.chartWrapper}>
            <div className={styles.barChart}>
              {platformWeeklyTrend.map((item) => {
                const maxCount = Math.max(...platformWeeklyTrend.map(c => c.count), 5); // Avoid divide by 0
                const barHeight = item.count > 0 ? (item.count / maxCount) * 100 : 0;
                return (
                  <div key={item.day} className={styles.chartCol}>
                    <div className={styles.barWrapper}>
                      <span className={styles.barTooltip}>
                        {item.count} {locale === 'vi' ? 'lịch' : 'bookings'}
                      </span>
                      <div
                        className={styles.barFill}
                        style={{ height: `${barHeight}%`, background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)' }}
                      />
                    </div>
                    <span className={styles.barLabel}>{item.day}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isOwner = user.role === 'owner';

  // 1. Calculate dynamic statistics
  const todayAppointments = realBookings.filter(
    b => b.appointmentDate === todayStr && b.status !== 'cancelled'
  ).length;

  const pendingRequests = realBookings.filter(
    b => b.status === 'pending_approval'
  ).length;

  const totalBookings = realBookings.filter(b => b.status !== 'cancelled').length;
  const noShows = realBookings.filter(b => b.status === 'no_show').length;
  
  const completed = realBookings.filter(b => b.status === 'completed' || b.status === 'confirmed').length;
  const completionRate = totalBookings > 0 
    ? `${((completed / totalBookings) * 100).toFixed(1)}%`
    : '100%';

  // Calculate monthly revenue (sum of active bookings in current month/year)
  const monthlyRevenue = realBookings
    .filter(b => {
      if (b.status === 'cancelled') return false;
      const bDate = new Date(b.appointmentDate + 'T00:00:00');
      return bDate.getFullYear() === currentYear && bDate.getMonth() === currentMonth;
    })
    .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

  // 2. Generate weekly column chart data dynamically
  // Get start of the current week (Monday)
  const getStartOfWeek = () => {
    const d = new Date(today);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    return new Date(d.setDate(diff));
  };

  const startOfWeek = getStartOfWeek();
  startOfWeek.setHours(0, 0, 0, 0);

  const WEEKDAY_NAMES = {
    vi: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'],
    de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  };
  const weekdayNames = WEEKDAY_NAMES[locale] || WEEKDAY_NAMES['de'];

  // Map each day of week (0=Mon to 6=Sun) to count and revenue
  const weeklyData = Array.from({ length: 7 }).map((_, idx) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + idx);
    const dateISO = date.toISOString().split('T')[0];

    const dayBookings = realBookings.filter(
      b => b.appointmentDate === dateISO && b.status !== 'cancelled'
    );

    const revenue = dayBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    return {
      day: weekdayNames[idx],
      count: dayBookings.length,
      revenue,
    };
  });

  return (
    <div className={styles.container}>
      {/* Welcome banner */}
      <div className={styles.welcomeBanner}>
        <div className={styles.bannerText}>
          <h1 className={styles.welcomeTitle}>
            {t.admin.dashboard.welcome.replace('{name}', user.name)}
          </h1>
          {loading ? (
            <p className={styles.welcomeSubtitle}>{t.admin.dashboard.loading}</p>
          ) : (
            <p className={styles.welcomeSubtitle}>
              {t.admin.dashboard.summary
                .replace('{appointments}', String(todayAppointments))
                .replace('{requests}', String(pendingRequests))}
            </p>
          )}
        </div>
        {user.role === 'manager' && (
          <div className={styles.managerNotice}>
            <span className={styles.noticeIcon}>🔒</span>
            <span>{t.admin.dashboard.managerNotice}</span>
          </div>
        )}
      </div>

      {/* Grid: Overview Cards */}
      <div className={styles.statsGrid}>
        {/* Card 1: Today Appointments (All roles) */}
        <div className={styles.statCard}>
          <span className={styles.statLabel}>{t.admin.dashboard.todayAppointments}</span>
          <div className={styles.statValueGroup}>
            <span className={styles.statValue}>{todayAppointments}</span>
            <span className={styles.statTrendUp}>{t.admin.dashboard.today}</span>
          </div>
          <p className={styles.statDesc}>{t.admin.dashboard.todayAppointmentsDesc}</p>
        </div>

        {/* Card 2: Pending requests (All roles) */}
        <div className={styles.statCard}>
          <span className={styles.statLabel}>{t.admin.dashboard.pendingRequests}</span>
          <div className={styles.statValueGroup}>
            <span className={`${styles.statValue} ${pendingRequests > 0 ? styles.alertValue : ''}`}>
              {pendingRequests}
            </span>
            {pendingRequests > 0 && <span className={styles.statAlertBadge}>{t.admin.dashboard.pendingAlertBadge}</span>}
          </div>
          <p className={styles.statDesc}>{t.admin.dashboard.pendingRequestsDesc}</p>
        </div>

        {/* Card 3: Completion rate & no shows (All roles) */}
        <div className={styles.statCard}>
          <span className={styles.statLabel}>{t.admin.dashboard.completionRate}</span>
          <div className={styles.statValueGroup}>
            <span className={styles.statValue}>{completionRate}</span>
            {noShows > 0 && <span className={styles.statTrendDown}>{noShows} {t.admin.dashboard.noShow}</span>}
          </div>
          <p className={styles.statDesc}>{t.admin.dashboard.completionRateDesc}</p>
        </div>

        {/* Card 4: Financial Metric (OWNER ONLY) or Total Bookings (MANAGER) */}
        {isOwner ? (
          <div className={`${styles.statCard} ${styles.financialCard}`}>
            <span className={styles.statLabel}>{t.admin.dashboard.monthlyRevenue}</span>
            <div className={styles.statValueGroup}>
              <span className={styles.statValue}>€{monthlyRevenue.toLocaleString()}</span>
              <span className={styles.statTrendUp}>{t.admin.dashboard.realRate}</span>
            </div>
            <p className={styles.statDesc}>{t.admin.dashboard.monthlyRevenueDesc}</p>
          </div>
        ) : (
          <div className={styles.statCard}>
            <span className={styles.statLabel}>{t.admin.dashboard.totalBookings}</span>
            <div className={styles.statValueGroup}>
              <span className={styles.statValue}>{totalBookings}</span>
              <span className={styles.statTrendUp}>{t.admin.dashboard.active}</span>
            </div>
            <p className={styles.statDesc}>{t.admin.dashboard.totalBookingsDesc}</p>
          </div>
        )}
      </div>

      {/* Analytics Chart Section */}
      <div className={styles.chartSection}>
        <div className={styles.chartHeader}>
          <h3 className={styles.chartTitle}>
            {isOwner ? t.admin.dashboard.chartTitleOwner : t.admin.dashboard.chartTitleManager}
          </h3>
          <span className={styles.chartSub}>{t.admin.dashboard.chartSub}</span>
        </div>

        <div className={styles.chartWrapper}>
          {isOwner ? (
            /* Owner Revenue Bar Chart */
            <div className={styles.barChart}>
              {weeklyData.map((item) => {
                const maxRevenue = Math.max(...weeklyData.map(e => e.revenue), 100); // Avoid divide by 0
                const barHeight = item.revenue > 0 ? (item.revenue / maxRevenue) * 100 : 0;
                return (
                  <div key={item.day} className={styles.chartCol}>
                    <div className={styles.barWrapper}>
                      <span className={styles.barTooltip}>€{item.revenue}</span>
                      <div
                        className={styles.barFill}
                        style={{ height: `${barHeight}%` }}
                      />
                    </div>
                    <span className={styles.barLabel}>{item.day}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Manager Quantity Bar Chart */
            <div className={styles.barChart}>
              {weeklyData.map((item) => {
                const maxCount = Math.max(...weeklyData.map(c => c.count), 5); // Avoid divide by 0
                const barHeight = item.count > 0 ? (item.count / maxCount) * 100 : 0;
                return (
                  <div key={item.day} className={styles.chartCol}>
                    <div className={styles.barWrapper}>
                      <span className={styles.barTooltip}>
                        {item.count} {t.admin.dashboard.chartTooltipLich}
                      </span>
                      <div
                        className={`${styles.barFill} ${styles.managerBar}`}
                        style={{ height: `${barHeight}%` }}
                      />
                    </div>
                    <span className={styles.barLabel}>{item.day}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
