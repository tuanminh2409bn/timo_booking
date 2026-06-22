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
import { Home, Calendar, Briefcase, Users, User, LogOut } from 'lucide-react';

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
    const iconClass = "w-[22px] h-[22px]";
    switch (iconType) {
      case 'home': return <Home className={iconClass} strokeWidth={active ? 2.2 : 1.8} />;
      case 'calendar': return <Calendar className={iconClass} strokeWidth={active ? 2.2 : 1.8} />;
      case 'branches': return <Briefcase className={iconClass} strokeWidth={active ? 2.2 : 1.8} />;
      case 'accounts': return <Users className={iconClass} strokeWidth={active ? 2.2 : 1.8} />;
      default: return <Home className={iconClass} strokeWidth={active ? 2.2 : 1.8} />;
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
              <User className="w-[22px] h-[22px]" />
            </button>
            {showProfileMenu && (
              <div className={styles.profileDropdown}>
                <div className={styles.profileDropdownHeader}>
                  <div className={styles.profileDropdownName}>{user.name}</div>
                  <div className={styles.profileDropdownEmail}>{user.email}</div>
                </div>
                <div className={styles.profileDropdownDivider} />
                <button className={`${styles.profileDropdownLogout} flex items-center`} onClick={handleLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  <span>{locale === 'vi' ? 'Đăng xuất' : 'Logout'}</span>
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
