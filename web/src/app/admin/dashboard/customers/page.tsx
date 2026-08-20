'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Phone, Search, ShieldAlert, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { HrmCard, HrmEmptyState, HrmPageHeader } from '@/components/hrm-ui';
import {
  fetchAdminCustomers,
  fetchAdminCustomerAttendanceHistory,
  fetchAdminCustomerAttendanceSummary,
  fetchAdminCustomerDetail,
  setAdminCustomerBlocked,
  type AdminCustomer,
  type AdminCustomerAttendanceHistoryItem,
  type AdminCustomerAttendanceSummary,
} from '@/lib/adminHrmApi';

const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const getRange = (anchor: string, period: 'week' | 'month') => {
  const date = new Date(`${anchor}T00:00:00`);
  if (period === 'week') {
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    const end = new Date(date); end.setDate(end.getDate() + 6);
    return { startDate: formatDate(date), endDate: formatDate(end) };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { startDate: formatDate(start), endDate: formatDate(end) };
};

export default function CustomersPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<AdminCustomer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [selectedCustomer, setSelectedCustomer] = useState<AdminCustomer>();
  const [detailPeriod, setDetailPeriod] = useState<'week' | 'month'>('week');
  const [detailAnchor, setDetailAnchor] = useState(() => formatDate(new Date()));
  const [detailSummary, setDetailSummary] = useState<AdminCustomerAttendanceSummary>();
  const [detailHistory, setDetailHistory] = useState<AdminCustomerAttendanceHistoryItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const storeId = activeBranch || user?.assignedBranches?.[0];

  const load = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setLoadError(locale === 'vi' ? 'Vui lòng chọn cửa hàng.' : 'Please select a store.');
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      setItems(await fetchAdminCustomers(storeId));
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : locale === 'vi'
            ? 'Không thể tải danh sách khách hàng.'
            : 'Could not load customers.',
      );
    } finally {
      setLoading(false);
    }
  }, [locale, storeId]);

  useEffect(() => {
    if (user && !['owner', 'manager'].includes(user.role)) return;
    void load();
  }, [user, load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.name} ${item.phone ?? ''} ${item.email ?? ''}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  const detailRange = useMemo(() => getRange(detailAnchor, detailPeriod), [detailAnchor, detailPeriod]);
  const selectedCustomerId = selectedCustomer?.id;
  useEffect(() => {
    if (!storeId || !selectedCustomerId) return;
    let active = true;
    setDetailLoading(true);
    Promise.all([
      fetchAdminCustomerDetail(storeId, selectedCustomerId),
      fetchAdminCustomerAttendanceSummary(storeId, selectedCustomerId, detailRange.startDate, detailRange.endDate),
      fetchAdminCustomerAttendanceHistory(storeId, selectedCustomerId, detailRange.startDate, detailRange.endDate),
    ]).then(([customer, summary, history]) => {
      if (!active) return;
      setSelectedCustomer((current) => current?.id === customer.id ? { ...current, ...customer } : current);
      setDetailSummary(summary);
      setDetailHistory(history);
    }).catch((error: unknown) => window.alert(error instanceof Error ? error.message : 'Could not load customer report'))
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detailRange.endDate, detailRange.startDate, selectedCustomerId, storeId]);

  if (!user || !['owner', 'manager'].includes(user.role)) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        {locale === 'vi'
          ? 'Chỉ chủ tiệm hoặc quản lý được xem danh sách khách hàng.'
          : locale === 'de'
            ? 'Nur Inhaber oder Manager dürfen Kunden verwalten.'
            : 'Only owners or managers may manage customers.'}
      </div>
    );
  }

  const toggleBlocked = async (customer: AdminCustomer) => {
    if (!storeId) return;
    let reason: string | undefined;
    if (!customer.blocked) {
      reason = window.prompt(
        locale === 'vi'
          ? 'Nhập lý do chặn khách hàng (bắt buộc):'
          : locale === 'de'
            ? 'Grund für die Sperrung (erforderlich):'
            : 'Enter the block reason (required):',
      )?.trim();
      if (!reason) return;
    }
    setBusyId(customer.id);
    try {
      await setAdminCustomerBlocked(storeId, customer.id, !customer.blocked, reason);
      await load();
      setSelectedCustomer((current) => current?.id === customer.id ? { ...current, blocked: !customer.blocked, blockedReason: reason } : current);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not update customer');
    } finally {
      setBusyId(undefined);
    }
  };

  if (selectedCustomer) {
    const shiftPeriod = (direction: number) => {
      const next = new Date(`${detailAnchor}T00:00:00`);
      if (detailPeriod === 'week') next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction);
      setDetailAnchor(formatDate(next));
    };
    const metrics = [
      [locale === 'vi' ? 'Tổng lịch' : 'Total', detailSummary?.total ?? 0],
      [locale === 'vi' ? 'Đã xác nhận' : 'Confirmed', detailSummary?.confirmed ?? 0],
      [locale === 'vi' ? 'Chờ xác nhận' : 'Pending', detailSummary?.pending_approval ?? 0],
      [locale === 'vi' ? 'Hoàn thành' : 'Completed', detailSummary?.completed ?? 0],
      [locale === 'vi' ? 'Đã hủy' : 'Cancelled', detailSummary?.cancelled ?? 0],
      [locale === 'vi' ? 'Không đến' : 'No-show', detailSummary?.no_show ?? 0],
    ] as const;
    return (
      <section className="mx-auto max-w-2xl space-y-4">
        <HrmPageHeader className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl" title={locale === 'vi' ? 'Báo cáo khách hàng' : 'Customer report'} onBack={() => setSelectedCustomer(undefined)} />
        <HrmCard className={`p-5 ${selectedCustomer.blocked ? 'border-red-200' : ''}`}><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]"><UserRound className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h1 className="truncate text-lg font-bold text-slate-950">{selectedCustomer.name}</h1><p className="text-sm text-slate-500">{selectedCustomer.phone || selectedCustomer.email || '—'}</p></div><button type="button" disabled={busyId === selectedCustomer.id} onClick={() => void toggleBlocked(selectedCustomer)} className={`rounded-xl px-3 py-2 text-xs font-bold ${selectedCustomer.blocked ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{selectedCustomer.blocked ? (locale === 'vi' ? 'Bỏ chặn' : 'Unblock') : (locale === 'vi' ? 'Chặn' : 'Block')}</button></div>{selectedCustomer.blockedReason && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700">{selectedCustomer.blockedReason}</p>}</HrmCard>
        <HrmCard className="p-3"><div className="flex items-center justify-between gap-2"><div className="flex rounded-full bg-slate-100 p-1">{(['week', 'month'] as const).map((period) => <button key={period} type="button" onClick={() => setDetailPeriod(period)} className={`rounded-full px-4 py-2 text-xs font-bold ${detailPeriod === period ? 'bg-[var(--hrm-blue-700)] text-white' : 'text-slate-500'}`}>{period === 'week' ? (locale === 'vi' ? 'Tuần' : 'Week') : (locale === 'vi' ? 'Tháng' : 'Month')}</button>)}</div><div className="flex items-center gap-2"><button type="button" onClick={() => shiftPeriod(-1)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow"><ChevronLeft className="h-4 w-4" /></button><span className="text-xs font-bold text-slate-800">{detailRange.startDate} – {detailRange.endDate}</span><button type="button" onClick={() => shiftPeriod(1)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow"><ChevronRight className="h-4 w-4" /></button></div></div></HrmCard>
        <div className="grid grid-cols-2 gap-2">{metrics.map(([label, value]) => <HrmCard key={label} className="min-h-[72px] p-3"><span className="text-[11px] font-semibold text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-950">{detailLoading ? '…' : value}</strong></HrmCard>)}</div>
        <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${selectedCustomer.blocked ? 'border-red-100 bg-red-50' : 'border-emerald-100 bg-emerald-50'}`}>
          <span className="min-w-0"><strong className={`block text-sm ${selectedCustomer.blocked ? 'text-red-800' : 'text-emerald-800'}`}>{selectedCustomer.blocked ? (locale === 'vi' ? 'Khách đang bị chặn' : 'Customer is blocked') : (locale === 'vi' ? 'Đang hoạt động' : 'Active customer')}</strong><span className="mt-0.5 block truncate text-xs text-slate-500">{selectedCustomer.blockedReason || (locale === 'vi' ? 'Khách có thể tiếp tục đặt lịch.' : 'Customer may continue booking.')}</span></span>
          <button type="button" disabled={busyId === selectedCustomer.id} onClick={() => void toggleBlocked(selectedCustomer)} className={`h-9 shrink-0 rounded-xl px-3 text-xs font-bold text-white ${selectedCustomer.blocked ? 'bg-emerald-600' : 'bg-red-500'}`}>{selectedCustomer.blocked ? (locale === 'vi' ? 'Bỏ chặn' : 'Unblock') : (locale === 'vi' ? 'Chặn khách' : 'Block')}</button>
        </div>
        <div><h2 className="mb-2 text-sm font-bold text-slate-950">{locale === 'vi' ? 'Lịch sử đặt lịch' : 'Booking history'}</h2><div className="space-y-2">{!detailLoading && detailHistory.length === 0 ? <HrmEmptyState title={locale === 'vi' ? 'Không có lịch trong kỳ này.' : 'No bookings in this period.'} /> : detailHistory.map((item) => <HrmCard key={item.id} className="flex items-center gap-3 p-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-700"><CalendarDays className="h-5 w-5" /></span><div className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-950">{item.services.map((service) => service.name).join(', ') || '—'}</strong><span className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />{item.workDate} · {String(Math.floor(item.startTime / 60)).padStart(2, '0')}:{String(item.startTime % 60).padStart(2, '0')}</span></div><span className="text-[10px] font-bold text-blue-700">{item.bookingStatus || item.status}</span></HrmCard>)}</div></div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Khách hàng' : locale === 'de' ? 'Kunden' : 'Customers'}
        onBack={() => router.push('/admin/dashboard/')}
      />
      <label className="flex h-10 items-center gap-3 rounded-full border border-slate-200 bg-white px-4">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={locale === 'vi' ? 'Tìm tên hoặc số điện thoại' : 'Search name or phone'}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
        />
      </label>

      <HrmCard className="flex items-center gap-3 p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white"><Phone className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm text-slate-950">{locale === 'vi' ? 'Hồ sơ khách hàng' : 'Customer profiles'}</strong><span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">{locale === 'vi' ? 'Xem thống kê, lịch sử và danh sách khách hàng theo từng tiệm.' : 'View customer statistics, history and block list.'}</span></span>
        <span className="text-xs font-bold text-slate-500">{items.length}</span>
      </HrmCard>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {locale === 'vi' ? 'Đang tải khách hàng...' : 'Loading customers...'}
        </div>
      ) : loadError && items.length === 0 ? (
        <div role="alert" className="rounded-2xl bg-red-50 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-red-700">
            {locale === 'vi' ? 'Không thể tải danh sách khách hàng.' : 'Could not load customers.'}
          </p>
          <p className="mt-1 text-xs text-red-600">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white"
          >
            {locale === 'vi' ? 'Thử lại' : 'Retry'}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <HrmEmptyState title={locale === 'vi' ? 'Chưa có khách hàng phù hợp.' : 'No matching customers.'} />
      ) : (
        <div>
          <div className="mb-1 flex items-center justify-between px-1"><h2 className="text-sm font-bold text-slate-950">{locale === 'vi' ? 'Danh sách' : 'List'}</h2><span className="text-[11px] font-semibold text-slate-500">{filtered.length} {locale === 'vi' ? 'khách' : 'customers'}</span></div>
          <div className="overflow-hidden rounded-2xl bg-white shadow-[var(--hrm-shadow-card)]">
          {filtered.map((customer) => (
            <button
              key={customer.id}
              onClick={() => setSelectedCustomer(customer)}
              className="flex min-h-[62px] w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0"
            >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  customer.blocked ? 'bg-red-50 text-red-600' : 'bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]'
                }`}>
                  {customer.blocked ? <ShieldAlert className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm font-semibold text-gray-950">{customer.name}</strong>
                    {customer.blocked && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                        {locale === 'vi' ? 'Đã chặn' : locale === 'de' ? 'Gesperrt' : 'Blocked'}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-500">{customer.phone || customer.email || '—'}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}
