'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import { getGermanDateObject } from '@/lib/timeUtils';
import { Home, Calendar, Briefcase, Users, User, LogOut, Plus, CalendarOff, CreditCard, Scissors, Store } from 'lucide-react';
import { fetchHrmStore } from '@/lib/hrmApi';
import { AdminPageTransition } from '@/components/hrm-ui/AdminPageTransition';

type TabDef = { name: string; path: string; iconType: 'home' | 'calendar' | 'customers' | 'branches' | 'accounts' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, activeBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [resolvedSalonName, setResolvedSalonName] = useState<string>('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/admin/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || user?.role !== 'staff') return;
    const isAllowedStaffPage =
      pathname === '/admin/dashboard' ||
      pathname === '/admin/dashboard/' ||
      pathname.startsWith('/admin/dashboard/bookings');
    if (!isAllowedStaffPage) router.replace('/admin/dashboard/');
  }, [loading, pathname, router, user]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'superadmin') return;
    const branchId = activeBranch || user.assignedBranches?.[0];
    if (!branchId) return;
    fetchHrmStore(branchId)
      .then((store) => setResolvedSalonName(store.name))
      .catch(() => setResolvedSalonName(branchId));
  }, [user, activeBranch]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-slate-500">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[var(--hrm-blue-700)]" />
          <span className="text-sm font-medium">
            {locale === 'vi' ? 'Đang tải dữ liệu...' : locale === 'de' ? 'Daten werden geladen...' : 'Loading data...'}
          </span>
        </div>
      </div>
    );
  }

  const handleLogout = async () => { await logout(); router.push('/admin/login'); };
  const branchId = user.assignedBranches?.[0];
  const salonName =
    user.role === 'superadmin'
      ? 'Timmo Admin'
      : branchId
        ? resolvedSalonName || branchId
        : locale === 'vi'
          ? 'Chưa gán chi nhánh'
          : locale === 'de'
            ? 'Keine Filiale zugewiesen'
            : 'No branch assigned';

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
    if (['owner', 'manager'].includes(user.role)) {
      tabs.push({ name: locale === 'vi' ? 'Khách hàng' : locale === 'de' ? 'Kunden' : 'Customers', path: '/admin/dashboard/customers/', iconType: 'customers' });
    }
    if (user.role === 'superadmin') {
      tabs.push({ name: locale === 'vi' ? 'Chi nhánh' : locale === 'de' ? 'Filialen' : 'Branches', path: '/admin/dashboard/branches/', iconType: 'branches' });
      tabs.push({ name: locale === 'vi' ? 'Tài khoản' : locale === 'de' ? 'Konten' : 'Accounts', path: '/admin/dashboard/accounts/', iconType: 'accounts' });
    }
    return tabs;
  };

  const tabItems = getTabItems();
  const isBookingsPage = pathname.startsWith('/admin/dashboard/bookings');
  const isDashboardHome = pathname === '/admin/dashboard/' || pathname === '/admin/dashboard';
  const handleMobileCreateBooking = () => {
    if (isBookingsPage) {
      window.dispatchEvent(new CustomEvent('timmo:open-manual-booking'));
      return;
    }
    router.push('/admin/dashboard/bookings/?new=1');
  };
  const isTabActive = (tabPath: string) => {
    if (tabPath === '/admin/dashboard/') return pathname === '/admin/dashboard/' || pathname === '/admin/dashboard';
    return pathname.startsWith(tabPath);
  };

  const renderIcon = (iconType: string, active: boolean, className = "w-6 h-6") => {
    const strokeWidth = active ? 2.5 : 1.8;
    switch (iconType) {
      case 'home': return <Home className={className} strokeWidth={strokeWidth} />;
      case 'calendar': return <Calendar className={className} strokeWidth={strokeWidth} />;
      case 'customers': return <Users className={className} strokeWidth={strokeWidth} />;
      case 'branches': return <Briefcase className={className} strokeWidth={strokeWidth} />;
      case 'accounts': return <Users className={className} strokeWidth={strokeWidth} />;
      default: return <Home className={className} strokeWidth={strokeWidth} />;
    }
  };

  return (
    <div className="hrm-page-shell flex h-dvh overflow-hidden font-sans">

      {/* Desktop Sidebar */}
      <aside className="hidden w-[270px] shrink-0 flex-col border-r border-slate-100 bg-white md:flex">
        <div className="p-6 flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-950">Timmo<span className="text-[var(--hrm-blue-700)]">Booking</span></h1>
          <p className="text-sm font-medium text-slate-500">{salonName}</p>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
          {tabItems.map((tab) => {
            const active = isTabActive(tab.path);
            return (
              <Link
                key={tab.path}
                href={tab.path}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 transition-all ${active ? 'bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'}`}
              >
                {renderIcon(tab.iconType, active, "w-5 h-5")}
                <span className={`text-sm ${active ? 'font-semibold' : 'font-medium'}`}>{tab.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-4 px-2">
             <LanguageSwitcher variant="light" align="left" placement="top" />
          </div>

          <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-red-500 hover:bg-red-50 transition-colors">
            <LogOut className="w-5 h-5" />
            <span className="text-sm font-medium">
              {locale === 'vi' ? 'Đăng xuất' : locale === 'de' ? 'Abmelden' : 'Logout'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Mobile & Desktop Header */}
        {isDashboardHome && <header className="sticky top-0 z-30 flex min-h-[76px] items-center justify-between gap-3 bg-[var(--hrm-page-bg)] px-4 py-4 md:border-b md:border-slate-100 md:bg-white md:px-8 md:py-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
            {getGreeting()}, <strong className="text-base font-bold text-[var(--hrm-blue-700)]">{user.role === 'staff' ? user.name : user.name.split(' ')[0]}</strong>
          </h1>

          <nav aria-label={locale === 'vi' ? 'Tài khoản' : 'Account'} className="flex items-center gap-2">
             <div className="md:hidden">
               <LanguageSwitcher variant="hrm" />
             </div>

             <div className="relative">
               <button
                 onClick={() => setShowProfileMenu(!showProfileMenu)}
                 aria-label={locale === 'vi' ? 'Mở tài khoản' : locale === 'de' ? 'Konto öffnen' : 'Open account'}
                 className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-white text-slate-600 shadow-[var(--hrm-shadow-header)] transition active:scale-95"
               >
                 <User className="w-5 h-5" />
               </button>

               {showProfileMenu && (
                 <>
                   <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                   <div className="absolute right-0 z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_18px_46px_rgba(15,23,42,0.18)] animate-in fade-in zoom-in-95 duration-200">
                     <div className="p-4 bg-gray-50/50">
                       <div className="text-sm font-bold text-gray-900">{user.name}</div>
                       <div className="text-xs text-gray-500 mt-0.5">{user.email}</div>
                     </div>
                     <div className="h-px bg-gray-100" />
                     {user.role === 'owner' && (
                       <div className="p-2">
                         {[
                           { href: '/admin/dashboard/services/', label: locale === 'vi' ? 'Dịch vụ tiệm' : 'Services', icon: Scissors },
                           { href: '/admin/dashboard/leave/', label: locale === 'vi' ? 'Nghỉ phép của thợ' : 'Employee leave', icon: CalendarOff },
                           { href: '/admin/dashboard/customers/', label: locale === 'vi' ? 'Khách hàng' : 'Customers', icon: Users },
                           { href: '/admin/dashboard/my-branches/', label: locale === 'vi' ? 'Cửa hàng' : 'Stores', icon: Store },
                           { href: '/admin/dashboard/billing/', label: locale === 'vi' ? 'Thanh toán gói' : 'Billing', icon: CreditCard },
                         ].map((item) => (
                           <Link
                             key={item.href}
                             href={item.href}
                             onClick={() => setShowProfileMenu(false)}
                             className="flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-[var(--hrm-blue-50)] hover:text-[var(--hrm-blue-700)]"
                           >
                             {item.label}
                           </Link>
                         ))}
                       </div>
                     )}
                     {user.role === 'owner' && <div className="h-px bg-gray-100" />}
                     <button onClick={handleLogout} className="w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-red-50 font-medium flex items-center gap-2 transition-colors">
                       <LogOut className="w-4 h-4" />
                       {locale === 'vi' ? 'Đăng xuất' : locale === 'de' ? 'Abmelden' : 'Logout'}
                     </button>
                   </div>
                 </>
               )}
             </div>
          </nav>
        </header>}

        {/* Scrollable Content */}
        <main className={`hrm-scrollbar-hidden flex-1 overflow-y-auto overflow-x-hidden ${isBookingsPage ? 'p-0 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6' : 'p-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8'}`}>
          <div className={`${isBookingsPage ? 'max-w-none' : 'max-w-5xl'} relative mx-auto w-full`}>
            <AdminPageTransition>{children}</AdminPageTransition>
          </div>
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="booking-admin-bottom-nav fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-[101] flex h-[3.75rem] w-[calc(100%-5.5rem)] max-w-[21.5rem] shrink-0 items-center justify-between rounded-[1.5rem] bg-white px-4 shadow-[var(--hrm-shadow-nav)] md:hidden">
          {user.role === 'superadmin' ? tabItems.map((tab) => {
            const active = isTabActive(tab.path);
            return (
              <Link key={tab.path} href={tab.path} className={`flex h-12 w-[4.25rem] flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 transition ${active ? 'text-[var(--hrm-blue-700)]' : 'text-slate-500'}`}>
                <span className="booking-admin-nav-content">
                  {renderIcon(tab.iconType, active, 'h-5 w-5')}
                  <span className="text-[10px] font-semibold leading-none">{tab.name}</span>
                </span>
              </Link>
            );
          }) : (
            <>
              <Link href="/admin/dashboard/" className={`flex h-12 w-[4.25rem] flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 transition ${isTabActive('/admin/dashboard/') ? 'text-[var(--hrm-blue-700)]' : 'text-slate-500'}`}>
                <span className="booking-admin-nav-content">
                  <Home className="h-5 w-5" />
                  <span className="text-[10px] font-semibold leading-none">{locale === 'vi' ? 'Trang chủ' : locale === 'de' ? 'Startseite' : 'Home'}</span>
                </span>
              </Link>
              {['owner', 'manager'].includes(user.role) ? (
                <button type="button" onClick={handleMobileCreateBooking} aria-label={locale === 'vi' ? 'Tạo lịch hẹn' : 'Create booking'} className="-mt-6 flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white shadow-[0_10px_24px_rgba(37,99,235,0.32)] transition active:scale-[0.98]">
                  <Plus className="h-[1.625rem] w-[1.625rem]" />
                </button>
              ) : null}
              <Link href="/admin/dashboard/bookings/" className={`flex h-12 w-[4.25rem] flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 transition ${isBookingsPage ? 'text-[var(--hrm-blue-700)]' : 'text-slate-500'}`}>
                <span className="booking-admin-nav-content">
                  <Calendar className="h-5 w-5" />
                  <span className="text-[10px] font-semibold leading-none">{locale === 'vi' ? 'Đặt lịch' : locale === 'de' ? 'Termine' : 'Bookings'}</span>
                </span>
              </Link>
            </>
          )}
        </nav>

      </div>
    </div>
  );
}
