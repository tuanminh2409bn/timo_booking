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
  const [salonName, setSalonName] = useState<string>('Glamour Nails Berlin');

  // Client-side authentication guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/admin/login');
    }
  }, [user, loading, router]);

  // Fetch real branch name or show SaaS admin name
  useEffect(() => {
    if (!user) return;
    if (user.role === 'superadmin') {
      setSalonName(locale === 'vi' ? 'Quản trị hệ thống Timmo' : locale === 'de' ? 'Timmo Systemverwaltung' : 'Timmo SaaS Admin');
      return;
    }
    const branchId = user.assignedBranches?.[0];
    if (!branchId) {
      setSalonName(locale === 'vi' ? 'Chưa gán chi nhánh' : 'No Branch Assigned');
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
        <p>{t.common.loading}</p>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  const menuItems = [
    {
      name: t.admin.menu.stats,
      path: '/admin/dashboard/',
      icon: '📊',
      roles: ['owner', 'manager', 'superadmin'],
    },
    {
      name: t.admin.menu.branches,
      path: '/admin/dashboard/branches/',
      icon: '🏢',
      roles: ['superadmin'],
    },
    {
      name: t.admin.menu.accounts,
      path: '/admin/dashboard/accounts/',
      icon: '👤',
      roles: ['superadmin'],
    },
    {
      name: t.admin.menu.bookings,
      path: '/admin/dashboard/bookings/',
      icon: '📅',
      roles: ['owner', 'manager', 'staff'],
    },
    {
      name: t.admin.menu.myBranches,
      path: '/admin/dashboard/my-branches/',
      icon: '🏪',
      roles: ['owner'],
    },
    {
      name: t.admin.menu.staff,
      path: '/admin/dashboard/staff/',
      icon: '👥',
      roles: ['owner', 'manager'],
    },
    {
      name: t.admin.menu.services,
      path: '/admin/dashboard/services/',
      icon: '💅',
      roles: ['owner', 'manager'],
    },
  ];

  const filteredMenu = menuItems.filter(item => item.roles.includes(user.role));

  const getRoleLabel = (role: string) => {
    const roleMap: Record<string, Record<string, string>> = {
      superadmin: { de: 'SaaS Admin', en: 'SaaS Admin', vi: 'SaaS Admin' },
      owner: { de: 'Inhaber', en: 'Owner', vi: 'Chủ tiệm' },
      manager: { de: 'Manager', en: 'Manager', vi: 'Quản lý' },
      staff: { de: 'Mitarbeiter', en: 'Staff', vi: 'Nhân viên' }
    };
    return roleMap[role]?.[locale] || role;
  };

  return (
    <div className={styles.dashboardContainer}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.logoSection}>
          <span className={styles.logoText}>Timmo Dashboard</span>
        </div>

        {/* User Card */}
        <div className={styles.userCard}>
          <div className={styles.avatar}>
            {user.name.substring(0, 2).toUpperCase()}
          </div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{user.name}</div>
            <div className={`${styles.userRole} ${styles[`role_${user.role}`]}`}>
              {getRoleLabel(user.role)}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.navMenu}>
          {filteredMenu.map((item) => {
            const isActive = pathname === item.path || (item.path !== '/admin/dashboard/' && pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navText}>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer actions */}
        <div className={styles.sidebarFooter}>
          <button onClick={handleLogout} className={styles.logoutBtn}>
            <span className={styles.navIcon}>🚪</span>
            <span>{t.admin.menu.logout}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainContent}>
        <header className={styles.topHeader}>
          <div className={styles.headerTitleGroup}>
            <h2 className={styles.headerTitle}>{t.admin.topHeader.title}</h2>
            <span className={styles.salonName}>{salonName}</span>
          </div>
          <div className={styles.headerActions}>
            <LanguageSwitcher variant="light" />
            <Link href="/" className={styles.viewSiteBtn} target="_blank">
              {t.admin.topHeader.viewSite}
            </Link>
          </div>
        </header>

        <main className={styles.contentBody}>{children}</main>
      </div>
    </div>
  );
}
