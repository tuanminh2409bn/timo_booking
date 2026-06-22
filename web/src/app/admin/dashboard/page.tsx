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
import { BarChart3, Award, Store, Users, Calendar, Scissors, Bell, User, Clock, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';

export default function DashboardPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { getServiceName: translateService, getCategoryName: translateCategory } = useServiceTranslation();
  const router = useRouter();
  const [realBookings, setRealBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Owner/Manager states
  const [realStaffList, setRealStaffList] = useState<any[]>([]);
  const [realServicesList, setRealServicesList] = useState<any[]>([]);
  const [staffCount, setStaffCount] = useState(0);
  const [servicesCount, setServicesCount] = useState(0);
  const [showTodaySchedule, setShowTodaySchedule] = useState(false);
  const [expandedBookingIds, setExpandedBookingIds] = useState<string[]>([]);

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

  // Listen to branch staff (Owner/Manager)
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    const branchId = user.assignedBranches?.[0];
    if (!branchId) return;
    const staffRef = collection(db, 'branches', branchId, 'staff');
    const unsubscribe = onSnapshot(staffRef, (snap) => {
      const list: any[] = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      setRealStaffList(list);
      setStaffCount(snap.size);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen to branch services (Owner/Manager)
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    const branchId = user.assignedBranches?.[0];
    if (!branchId) return;
    const servicesRef = collection(db, 'branches', branchId, 'services');
    const unsubscribe = onSnapshot(servicesRef, (snap) => {
      const list: any[] = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      setRealServicesList(list);
      setServicesCount(snap.size);
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

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getEndTime = (startTime: string, durationMinutes: number) => {
    if (!startTime) return '';
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + durationMinutes);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const getStaffNameDisplay = (staffId: string) => {
    if (!staffId || staffId === 'any') {
      return locale === 'vi' ? 'Bất kỳ ai' : 'Any staff';
    }
    const found = realStaffList.find(s => s.id === staffId);
    return found ? found.name : staffId;
  };

  const toggleBookingExpanded = (bookingId: string) => {
    setExpandedBookingIds(prev => 
      prev.includes(bookingId) 
        ? prev.filter(id => id !== bookingId) 
        : [...prev, bookingId]
    );
  };

  const findServiceInList = (part: string): any | null => {
    // Match by name, id, or any localized variant (handles old German-named bookings)
    return realServicesList.find(item =>
      item.id === part ||
      item.name === part ||
      item.nameLocalized?.vi === part ||
      item.nameLocalized?.en === part ||
      item.nameLocalized?.de === part
    ) || null;
  };

  const getServiceName = (s: any, bookingServiceIds?: string[], serviceIndex?: number) => {
    if (typeof s === 'object' && s !== null) {
      // New format: object with serviceId, categoryId, serviceName, categoryName
      const sId = s.serviceId || s.id;
      const sNameDefault = s.serviceName || s.name;

      // Translate service name
      let svcName = sNameDefault;
      if (sId) {
        svcName = translateService(sId, sNameDefault);
      } else {
        // Fallback: try realServicesList lookup
        const found = findServiceInList(sNameDefault);
        if (found) {
          svcName = found.nameLocalized?.[locale] || translateService(found.id, found.name || sNameDefault);
        }
      }

      // Translate category name
      let catName = '';
      if (s.categoryId) {
        catName = translateCategory(s.categoryId, s.categoryName || '');
      } else if (s.categoryName) {
        catName = s.categoryName;
      } else if (sId) {
        // Try to find category via realServicesList
        const foundSvc = realServicesList.find(item => item.id === sId);
        if (foundSvc?.categoryId) {
          catName = translateCategory(foundSvc.categoryId, '');
        }
      }

      // Build extras suffix
      let extrasSuffix = '';
      if (s.extras && Array.isArray(s.extras) && s.extras.length > 0) {
        const extrasNames = s.extras.map((e: any) => 
          e.serviceId ? translateService(e.serviceId, e.name || '') : (e.name || '')
        ).join(', ');
        extrasSuffix = ` + ${extrasNames}`;
      }

      if (catName) {
        return `${catName} \u2013 ${svcName}${extrasSuffix}`;
      }
      return `${svcName}${extrasSuffix}`;
    }
    
    if (typeof s === 'string') {
      const parts = s.split(' + ').map(p => p.trim());
      const translatedParts = parts.map((part, idx) => {
        // Try lookup via serviceIds array from booking (index-based for + separated strings)
        let foundById: any = null;
        if (bookingServiceIds && serviceIndex !== undefined && bookingServiceIds[serviceIndex]) {
          foundById = realServicesList.find(item => item.id === bookingServiceIds[serviceIndex]);
        }
        // Try matching by name or any localized variant
        const found = foundById || findServiceInList(part);
        if (found) {
          const svcName = translateService(found.id, found.nameLocalized?.[locale] || found.name || part);
          // Try to get category name
          const catName = found.categoryId ? translateCategory(found.categoryId, '') : '';
          if (catName && idx === 0) {
            return `${catName} \u2013 ${svcName}`;
          }
          return svcName;
        }
        return part;
      });
      return translatedParts.join(' + ');
    }
    
    return s;
  };

  const getServicePrice = (s: any, bookingCurrency: string, serviceId?: string) => {
    const currency = bookingCurrency || 'đ';
    if (typeof s === 'object' && s.price !== undefined && s.price !== null) {
      return `${s.price}${currency}`;
    }
    const sId = serviceId || (typeof s === 'object' ? s.serviceId || s.id : null);
    const sName = typeof s === 'object' ? s.serviceName || s.name : s;
    // Try ID lookup first, then name/localized match
    const found = (sId ? realServicesList.find(item => item.id === sId) : null) || findServiceInList(sName);
    if (found && found.price !== undefined) {
      return `${found.price}${currency}`;
    }
    return '';
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
            <span className={styles.summaryIcon}>
              <BarChart3 className="w-6 h-6 text-[#1A56DB]" />
            </span>
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
              <Award className="w-5 h-5 text-yellow-500" />
              <span>{locale === 'vi' ? 'Chờ duyệt' : 'Pending'}</span> 
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
            <span className={styles.menuIcon}>
              <Store className="w-5 h-5 text-[#1A56DB]" />
            </span>
            <span className={styles.menuLabel}>{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
            <span className={styles.menuBadge}>{totalBranches}</span>
            <span className={styles.menuArrow}>›</span>
          </Link>
          <Link href="/admin/dashboard/accounts/" className={styles.menuItem}>
            <span className={styles.menuIcon}>
              <Users className="w-5 h-5 text-[#1A56DB]" />
            </span>
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
    // Helper: get booking source label
    const getSourceLabel = (b: any) => {
      if (b.source === 'online') return 'Booking';
      if (b.source === 'walk_in') return locale === 'vi' ? 'Walk-in' : 'Walk-in';
      return locale === 'vi' ? 'Thủ công' : 'Manual';
    };

    return (
      <div className="w-full max-w-5xl mx-auto px-0 md:px-4 py-6 md:py-8">
        <div className="flex flex-col gap-6">
          {/* Card Lịch Hẹn */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-md">
            <div className="p-6 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                <Calendar className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{locale === 'vi' ? 'Lịch hẹn' : 'Bookings'}</h2>
                <p className="text-sm text-gray-500">{todayBookings.length} {locale === 'vi' ? 'lịch' : 'bookings'}</p>
              </div>
            </div>
            <div 
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 flex items-center justify-between cursor-pointer transition-colors duration-200"
              onClick={() => setShowTodaySchedule(!showTodaySchedule)}
            >
              <span className="font-semibold text-sm tracking-wide">{locale === 'vi' ? 'Thống kê' : 'Statistics'}</span>
              <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${showTodaySchedule ? 'rotate-90' : ''}`} />
            </div>
          </div>

          {/* Booking cards — shown when Thống kê is clicked */}
          {showTodaySchedule && (
            <div className="flex flex-col gap-4">
              {todayBookings.length === 0 ? (
                <div className="text-center py-8 px-4 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
                  {locale === 'vi' ? 'Không có lịch hẹn hôm nay' : 'No bookings today'}
                </div>
              ) : (
                todayBookings
                  .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
                  .map((b) => {
                    const isExpanded = expandedBookingIds.includes(b.id);
                    const formattedEndTime = getEndTime(b.startTime, b.totalDurationMinutes || 60);
                    const serviceCount = b.services?.length || 0;
                    const sourceLabel = getSourceLabel(b);
                    
                    return (
                      <div 
                        key={b.id} 
                        className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 transition-all hover:border-blue-100"
                      >
                        <div 
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => toggleBookingExpanded(b.id)}
                        >
                          <div className="flex items-center gap-3 flex-wrap">
                            <Clock className="w-5 h-5 text-blue-600" />
                            <span className="text-base font-bold text-gray-900">
                              {b.startTime || '—'} - {formattedEndTime}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">
                              {sourceLabel}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 mt-2 pl-8 text-sm text-gray-500">
                          <span>{serviceCount} {locale === 'vi' ? 'dịch vụ' : 'services'}</span>
                          <span className="font-medium text-gray-800">{b.totalPrice || 0}{b.currency || 'đ'}</span>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pl-8 border-t border-gray-50 pt-3">
                            <div className="flex flex-col gap-2.5 mb-3">
                              {(b.services || []).map((s: any, idx: number) => {
                                const sId = b.serviceIds?.[idx];
                                const sName = getServiceName(s, b.serviceIds, idx);
                                const sPriceDisplay = getServicePrice(s, b.currency, sId);
                                return (
                                  <div key={idx} className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">{sName}</span>
                                    {sPriceDisplay && (
                                      <span className="font-semibold text-gray-900">{sPriceDisplay}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="border-t border-gray-50 pt-3 flex">
                              <Link 
                                href={`/admin/dashboard/bookings/?date=${b.appointmentDate}&id=${b.id}`} 
                                className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                              >
                                {locale === 'vi' ? 'Xem chi tiết' : 'View details'} <span className="text-base">›</span>
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
  // ---------- RENDER: OWNER / MANAGER ----------
  return (
    <div className="w-full max-w-5xl mx-auto px-0 md:px-4 py-6 md:py-8">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Column: Booking Card & Today Schedule */}
        <div className="md:col-span-7 flex flex-col gap-6">
          {/* Card Lịch Hẹn */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-md">
            <div className="p-6 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                <Calendar className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{locale === 'vi' ? 'Lịch hẹn' : 'Bookings'}</h2>
                <p className="text-sm text-gray-500">{todayBookings.length} {locale === 'vi' ? 'lịch hôm nay' : 'bookings today'}</p>
              </div>
            </div>
            <div 
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 flex items-center justify-between cursor-pointer transition-colors duration-200"
              onClick={() => setShowTodaySchedule(!showTodaySchedule)}
            >
              <span className="font-semibold text-sm tracking-wide">{locale === 'vi' ? 'Thống kê lịch hôm nay' : 'Today Schedule Stats'}</span>
              <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${showTodaySchedule ? 'rotate-90' : ''}`} />
            </div>
          </div>

          {/* Lịch hôm nay (Accordion) */}
          {showTodaySchedule && (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-bold text-gray-800 px-1">{locale === 'vi' ? 'Lịch hôm nay' : "Today's Schedule"}</h3>
              {todayBookings.length === 0 ? (
                <div className="text-center py-8 px-4 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
                  {locale === 'vi' ? 'Không có lịch hẹn hôm nay' : 'No bookings today'}
                </div>
              ) : (
                todayBookings
                  .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
                  .map((b) => {
                    const isExpanded = expandedBookingIds.includes(b.id);
                    const formattedEndTime = getEndTime(b.startTime, b.totalDurationMinutes || 60);
                    const staffName = getStaffNameDisplay(b.staffId);
                    const serviceCount = b.services?.length || 0;
                    
                    return (
                      <div 
                        key={b.id} 
                        className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 transition-all hover:border-blue-100"
                      >
                        <div 
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => toggleBookingExpanded(b.id)}
                        >
                          <div className="flex items-center gap-3 flex-wrap">
                            <Clock className="w-5 h-5 text-blue-600" />
                            <span className="text-base font-bold text-gray-900">
                              {b.startTime || '—'} - {formattedEndTime}
                            </span>
                            <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">
                              {staffName}
                            </span>
                          </div>
                          <div>
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 mt-2 pl-8 text-sm text-gray-500">
                          <span>{serviceCount} {locale === 'vi' ? 'dịch vụ' : 'services'}</span>
                          <span className="font-medium text-gray-800">{b.totalPrice || 0}{b.currency || 'đ'}</span>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pl-8 border-t border-gray-50 pt-3">
                            <div className="flex flex-col gap-2.5 mb-3">
                              {(b.services || []).map((s: any, idx: number) => {
                                const sId = b.serviceIds?.[idx];
                                const sName = getServiceName(s, b.serviceIds, idx);
                                const sPriceDisplay = getServicePrice(s, b.currency, sId);
                                return (
                                  <div key={idx} className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">{sName}</span>
                                    {sPriceDisplay && (
                                      <span className="font-semibold text-gray-900">{sPriceDisplay}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="border-t border-gray-50 pt-3 flex">
                              <Link 
                                href={`/admin/dashboard/bookings/?date=${b.appointmentDate}&id=${b.id}`} 
                                className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                              >
                                {locale === 'vi' ? 'Xem chi tiết' : 'View details'} <span className="text-base">›</span>
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          )}
        </div>

        {/* Right Column: Management Menu */}
        <div className="md:col-span-5 flex flex-col gap-4">
          <h3 className="text-lg font-bold text-gray-800 px-1">{locale === 'vi' ? 'Quản lý' : 'Management'}</h3>
          
          <Link 
            href="/admin/dashboard/staff/" 
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between transition-all hover:border-blue-100 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <span className="font-bold text-gray-900 text-base">{locale === 'vi' ? 'Nhân sự' : 'Staff'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center px-1.5">{staffCount}</span>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </Link>

          <Link 
            href="/admin/dashboard/services/" 
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between transition-all hover:border-blue-100 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                <Scissors className="w-5 h-5" />
              </div>
              <span className="font-bold text-gray-900 text-base">{locale === 'vi' ? 'Dịch vụ' : 'Services'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center px-1.5">{servicesCount}</span>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </Link>

          {user.role === 'owner' && (
            <Link 
              href="/admin/dashboard/my-branches/" 
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between transition-all hover:border-blue-100 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                  <Store className="w-5 h-5" />
                </div>
                <span className="font-bold text-gray-900 text-base">{locale === 'vi' ? 'Chi nhánh của tôi' : 'My Branches'}</span>
              </div>
              <div className="flex items-center gap-3">
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
