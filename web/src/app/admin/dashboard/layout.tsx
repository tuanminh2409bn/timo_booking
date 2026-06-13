'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getGermanDateObject } from '@/lib/timeUtils';
import styles from './layout.module.css';

// ===== SVG Tab Icons =====
function IconHome({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
      {!active && <polyline points="9 22 9 12 15 12 15 22" />}
      {active && <rect x="9" y="12" width="6" height="9" fill="#fff" rx="1" />}
    </svg>
  );
}

function IconCalendar({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      {!active && (
        <>
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </>
      )}
      {active && (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" fill="currentColor" />
          <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" /><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" />
          <line x1="3" y1="10" x2="21" y2="10" stroke="#fff" strokeWidth="1.5" />
          <circle cx="12" cy="15" r="2" fill="#fff" />
        </>
      )}
    </svg>
  );
}

function IconBranches({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      {!active && (
        <>
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" />
        </>
      )}
      {active && (
        <>
          <rect x="2" y="7" width="20" height="14" rx="2" fill="currentColor" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="12" x2="12" y2="16" stroke="#fff" strokeWidth="2" />
          <line x1="10" y1="14" x2="14" y2="14" stroke="#fff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

function IconAccounts({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      {!active ? (
        <>
          <circle cx="9" cy="7" r="4" /><path d="M1 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
          <circle cx="18" cy="8" r="3" /><path d="M23 21v-2a3 3 0 0 0-3-3h-1" />
        </>
      ) : (
        <>
          <circle cx="9" cy="7" r="4" fill="currentColor" /><path d="M1 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" fill="currentColor" />
          <circle cx="18" cy="8" r="3" fill="currentColor" opacity="0.6" /><path d="M23 21v-2a3 3 0 0 0-3-3h-1" stroke="currentColor" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

// Tab icon type
type TabDef = { name: string; path: string; iconType: 'home' | 'calendar' | 'branches' | 'accounts' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [salonName, setSalonName] = useState<string>('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/admin/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'superadmin') { setSalonName('Timmo Admin'); return; }
    const branchId = user.assignedBranches?.[0];
    if (!branchId) { setSalonName(locale === 'vi' ? 'Chưa gán chi nhánh' : 'No Branch'); return; }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'branches', branchId));
        setSalonName(snap.exists() ? snap.data().name : branchId);
      } catch { setSalonName(branchId); }
    })();
  }, [user, locale]);

  if (loading || !user) {
    return <div className={styles.loadingScreen}><div className={styles.spinner} /></div>;
  }

  const handleLogout = async () => { await logout(); router.push('/admin/login'); };

  const getGreeting = () => {
    const h = getGermanDateObject().getHours();
    if (locale === 'vi') return h < 12 ? 'Chào buổi sáng' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
    if (locale === 'de') return h < 12 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  const getTabItems = (): TabDef[] => {
    const tabs: TabDef[] = [
      { name: locale === 'vi' ? 'Trang chủ' : locale === 'de' ? 'Startseite' : 'Home', path: '/admin/dashboard/', iconType: 'home' },
    ];
    if (['owner', 'manager', 'staff'].includes(user.role)) {
      tabs.push({ name: locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings', path: '/admin/dashboard/bookings/', iconType: 'calendar' });
    }
    if (user.role === 'superadmin') {
      tabs.push({ name: locale === 'vi' ? 'Chi nhánh' : locale === 'de' ? 'Filialen' : 'Branches', path: '/admin/dashboard/branches/', iconType: 'branches' });
      tabs.push({ name: locale === 'vi' ? 'Tài khoản' : locale === 'de' ? 'Konten' : 'Accounts', path: '/admin/dashboard/accounts/', iconType: 'accounts' });
    }
    return tabs;
  };

  const tabItems = getTabItems();

  const isTabActive = (tabPath: string) => {
    if (tabPath === '/admin/dashboard/') return pathname === '/admin/dashboard/' || pathname === '/admin/dashboard';
    return pathname.startsWith(tabPath);
  };

  const renderTabIcon = (iconType: string, active: boolean) => {
    switch (iconType) {
      case 'home': return <IconHome active={active} />;
      case 'calendar': return <IconCalendar active={active} />;
      case 'branches': return <IconBranches active={active} />;
      case 'accounts': return <IconAccounts active={active} />;
      default: return <IconHome active={active} />;
    }
  };

  return (
    <div className={styles.dashboardContainer}>
      {/* Top Greeting Header */}
      <header className={styles.greetingHeader}>
        <div className={styles.greetingLeft}>
          <div className={styles.avatar}>{user.name.substring(0, 2).toUpperCase()}</div>
          <div className={styles.greetingText}>
            <span className={styles.greetingLine}>{getGreeting()}, <strong>{user.name.split(' ')[0]}</strong></span>
            {salonName && <span className={styles.salonLabel}>{salonName}</span>}
          </div>
        </div>
        <div className={styles.greetingRight}>
          <LanguageSwitcher variant="light" />
          <div className={styles.profileWrapper}>
            <button className={styles.profileBtn} onClick={() => setShowProfileMenu(!showProfileMenu)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" /></svg>
            </button>
            {showProfileMenu && (
              <div className={styles.profileDropdown}>
                <div className={styles.profileDropdownHeader}>
                  <div className={styles.profileDropdownName}>{user.name}</div>
                  <div className={styles.profileDropdownEmail}>{user.email}</div>
                </div>
                <div className={styles.profileDropdownDivider} />
                <button className={styles.profileDropdownLogout} onClick={handleLogout}>
                  {locale === 'vi' ? '🚪 Đăng xuất' : '🚪 Logout'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={styles.contentBody}>{children}</main>

      {/* Floating Bottom Tab Bar */}
      <div className={styles.bottomBarWrapper}>
        <nav className={styles.bottomTabBar}>
          {tabItems.map((tab) => {
            const active = isTabActive(tab.path);
            return (
              <Link key={tab.path} href={tab.path} className={`${styles.tabItem} ${active ? styles.tabItemActive : ''}`}>
                <span className={styles.tabIconWrap}>{renderTabIcon(tab.iconType, active)}</span>
                <span className={styles.tabLabel}>{tab.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {showProfileMenu && <div className={styles.overlay} onClick={() => setShowProfileMenu(false)} />}
    </div>
  );
}
