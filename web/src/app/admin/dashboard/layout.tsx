'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import styles from './layout.module.css';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [salonName, setSalonName] = useState<string>('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Client-side authentication guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/admin/login');
    }
  }, [user, loading, router]);

  // Fetch real branch name
  useEffect(() => {
    if (!user) return;
    if (user.role === 'superadmin') {
      setSalonName('Timmo Admin');
      return;
    }
    const branchId = user.assignedBranches?.[0];
    if (!branchId) {
      setSalonName(locale === 'vi' ? 'Chưa gán chi nhánh' : 'No Branch');
      return;
    }
    const fetchBranch = async () => {
      try {
        const docRef = doc(db, 'branches', branchId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setSalonName(snap.data().name);
        } else {
          setSalonName(branchId);
        }
      } catch (e) {
        console.error("Error fetching branch name:", e);
        setSalonName(branchId);
      }
    };
    fetchBranch();
  }, [user, locale]);

  if (loading || !user) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.spinner} />
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  // Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (locale === 'vi') {
      if (hour < 12) return 'Chào buổi sáng';
      if (hour < 18) return 'Chào buổi chiều';
      return 'Chào buổi tối';
    }
    if (locale === 'de') {
      if (hour < 12) return 'Guten Morgen';
      if (hour < 18) return 'Guten Tag';
      return 'Guten Abend';
    }
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // Bottom tab items based on role
  const getTabItems = () => {
    const tabs: { name: string; path: string; icon: string; activeIcon: string }[] = [];

    tabs.push({
      name: locale === 'vi' ? 'Trang chủ' : locale === 'de' ? 'Startseite' : 'Home',
      path: '/admin/dashboard/',
      icon: '🏠',
      activeIcon: '🏠',
    });

    if (['owner', 'manager', 'staff'].includes(user.role)) {
      tabs.push({
        name: locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings',
        path: '/admin/dashboard/bookings/',
        icon: '📅',
        activeIcon: '📅',
      });
    }

    if (user.role === 'superadmin') {
      tabs.push({
        name: locale === 'vi' ? 'Chi nhánh' : locale === 'de' ? 'Filialen' : 'Branches',
        path: '/admin/dashboard/branches/',
        icon: '🏢',
        activeIcon: '🏢',
      });
      tabs.push({
        name: locale === 'vi' ? 'Tài khoản' : locale === 'de' ? 'Konten' : 'Accounts',
        path: '/admin/dashboard/accounts/',
        icon: '👤',
        activeIcon: '👤',
      });
    }

    return tabs;
  };

  const tabItems = getTabItems();

  const isTabActive = (tabPath: string) => {
    if (tabPath === '/admin/dashboard/') {
      return pathname === '/admin/dashboard/' || pathname === '/admin/dashboard';
    }
    return pathname.startsWith(tabPath);
  };

  return (
    <div className={styles.dashboardContainer}>
      {/* Top Greeting Header */}
      <header className={styles.greetingHeader}>
        <div className={styles.greetingLeft}>
          <div className={styles.avatar}>
            {user.name.substring(0, 2).toUpperCase()}
          </div>
          <div className={styles.greetingText}>
            <span className={styles.greetingLine}>
              {getGreeting()}, <strong>{user.name.split(' ').pop()}</strong>
            </span>
            {salonName && (
              <span className={styles.salonLabel}>{salonName}</span>
            )}
          </div>
        </div>
        <div className={styles.greetingRight}>
          <LanguageSwitcher variant="light" />
          <div className={styles.profileWrapper}>
            <button
              className={styles.profileBtn}
              onClick={() => setShowProfileMenu(!showProfileMenu)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21a8 8 0 1 0-16 0" />
              </svg>
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

      {/* Bottom Tab Bar */}
      <nav className={styles.bottomTabBar}>
        {tabItems.map((tab) => {
          const active = isTabActive(tab.path);
          return (
            <Link
              key={tab.path}
              href={tab.path}
              className={`${styles.tabItem} ${active ? styles.tabItemActive : ''}`}
            >
              <span className={styles.tabIcon}>{active ? tab.activeIcon : tab.icon}</span>
              <span className={styles.tabLabel}>{tab.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Overlay to close profile menu */}
      {showProfileMenu && (
        <div className={styles.overlay} onClick={() => setShowProfileMenu(false)} />
      )}
    </div>
  );
}
