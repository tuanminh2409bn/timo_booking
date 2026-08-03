'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Search, ShieldAlert, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  fetchAdminCustomers,
  setAdminCustomerBlocked,
  type AdminCustomer,
} from '@/lib/adminHrmApi';

export default function CustomersPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const [items, setItems] = useState<AdminCustomer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const storeId = activeBranch || user?.assignedBranches?.[0];

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      setItems(await fetchAdminCustomers(storeId));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

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
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not update customer');
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-950">
          {locale === 'vi' ? 'Khách hàng' : locale === 'de' ? 'Kunden' : 'Customers'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {locale === 'vi'
            ? 'Lịch sử tổng hợp và danh sách khách bị chặn của riêng tiệm.'
            : locale === 'de'
              ? 'Zusammengefasste Historie und Sperrliste dieses Salons.'
              : 'Consolidated history and this salon’s blocked-customer list.'}
        </p>
      </div>

      <label className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <Search className="h-5 w-5 text-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={locale === 'vi' ? 'Tìm tên hoặc số điện thoại' : 'Search name or phone'}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {locale === 'vi' ? 'Đang tải khách hàng...' : 'Loading customers...'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          {locale === 'vi' ? 'Chưa có khách hàng phù hợp.' : 'No matching customers.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((customer) => (
            <article
              key={customer.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                customer.blocked ? 'border-red-200' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                  customer.blocked ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                }`}>
                  {customer.blocked ? <ShieldAlert className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-gray-950">{customer.name}</h2>
                    {customer.blocked && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                        {locale === 'vi' ? 'Đã chặn' : locale === 'de' ? 'Gesperrt' : 'Blocked'}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">{customer.phone || customer.email || '—'}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    {locale === 'vi' ? 'Tổng lịch' : 'Bookings'}: {customer.counters.total}
                    {' · '}
                    {locale === 'vi' ? 'Hoàn thành' : 'Completed'}: {customer.counters.completed}
                    {' · '}
                    {locale === 'vi' ? 'Không đến' : 'No-show'}: {customer.counters.noShow}
                  </p>
                  {customer.blockedReason && (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                      {customer.blockedReason}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busyId === customer.id}
                  onClick={() => void toggleBlocked(customer)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-50 ${
                    customer.blocked
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {customer.blocked
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <Ban className="h-4 w-4" />}
                  <span className="hidden sm:inline">
                    {customer.blocked
                      ? (locale === 'vi' ? 'Bỏ chặn' : 'Unblock')
                      : (locale === 'vi' ? 'Chặn' : 'Block')}
                  </span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
