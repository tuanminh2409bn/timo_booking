'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import { getGermanDateObject } from '@/lib/timeUtils';
import { Home, Calendar, Briefcase, Users, User, LogOut, Plus } from 'lucide-react';
import { fetchHrmStore } from '@/lib/hrmApi';

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
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-gray-500">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
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
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-100 shrink-0">
        <div className="p-6 flex flex-col gap-1">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Timmo<span className="text-blue-600">Booking</span></h1>
          <p className="text-sm text-gray-500 font-medium">{salonName}</p>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
          {tabItems.map((tab) => {
            const active = isTabActive(tab.path);
            return (
              <Link
                key={tab.path}
                href={tab.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
              >
                {renderIcon(tab.iconType, active, "w-5 h-5")}
                <span className={`text-sm ${active ? 'font-semibold' : 'font-medium'}`}>{tab.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-4 px-2">
             <LanguageSwitcher variant="light" />
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
        {!isBookingsPage && <header className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-md border-b border-gray-100/50 md:px-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-100 to-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm shadow-sm border border-blue-100/50">
              {user.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-600 font-medium">
                {getGreeting()}, <strong className="text-blue-600">{user.name.split(' ')[0]}</strong>
              </span>
              <span className="text-xs text-gray-400 font-medium md:hidden">{salonName}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="md:hidden">
               <LanguageSwitcher variant="light" />
             </div>

             <div className="relative">
               <button
                 onClick={() => setShowProfileMenu(!showProfileMenu)}
                 aria-label={locale === 'vi' ? 'Mở tài khoản' : locale === 'de' ? 'Konto öffnen' : 'Open account'}
                 className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
               >
                 <User className="w-5 h-5" />
               </button>

               {showProfileMenu && (
                 <>
                   <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                   <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden origin-top-right animate-in fade-in zoom-in-95 duration-200">
                     <div className="p-4 bg-gray-50/50">
                       <div className="text-sm font-bold text-gray-900">{user.name}</div>
                       <div className="text-xs text-gray-500 mt-0.5">{user.email}</div>
                     </div>
                     <div className="h-px bg-gray-100" />
                     <button onClick={handleLogout} className="w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-red-50 font-medium flex items-center gap-2 transition-colors">
                       <LogOut className="w-4 h-4" />
                       {locale === 'vi' ? 'Đăng xuất' : locale === 'de' ? 'Abmelden' : 'Logout'}
                     </button>
                   </div>
                 </>
               )}
             </div>
          </div>
        </header>}

        {/* Scrollable Content */}
        <main className={`flex-1 overflow-y-auto overflow-x-hidden ${isBookingsPage ? 'p-0 pb-20 md:p-6 md:pb-6' : 'p-4 pb-24 md:p-8 md:pb-8'}`}>
          <div className={`${isBookingsPage ? 'max-w-none' : 'max-w-5xl'} mx-auto w-full`}>
            {children}
          </div>
        </main>

        {/* Mobile Bottom Navigation */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 pb-safe shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
          <nav className="flex items-center justify-around px-2 h-16">
            {tabItems.map((tab, index) => {
              const active = isTabActive(tab.path);
              const showFab = ['owner', 'manager'].includes(user.role);
              const isMiddle = Math.floor(tabItems.length / 2) === index;

              return (
                <React.Fragment key={tab.path}>
                  {isMiddle && showFab && (
                    <Link
                      href="/admin/dashboard/bookings?new=1"
                      aria-label={locale === 'vi' ? 'Tạo lịch hẹn' : locale === 'de' ? 'Termin erstellen' : 'Create booking'}
                      className="relative -top-5 flex items-center justify-center w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 active:scale-95 transition-transform"
                    >
                      <Plus className="w-7 h-7" />
                    </Link>
                  )}
                  <Link
                    href={tab.path}
                    className={`flex flex-col items-center justify-center w-full h-full gap-1 active:scale-95 transition-transform ${active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    {renderIcon(tab.iconType, active, "w-6 h-6")}
                    <span className={`text-[10px] ${active ? 'font-bold' : 'font-medium'}`}>{tab.name}</span>
                  </Link>
                </React.Fragment>
              );
            })}
          </nav>
        </div>

      </div>
    </div>
  );
}
