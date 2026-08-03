'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  fetchPlatformAccounts,
  createPlatformOwner,
  updatePlatformAccount,
  type PlatformAccount,
} from '@/lib/adminHrmApi';

export default function PlatformAccountsPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [items, setItems] = useState<PlatformAccount[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', salonName: '', address: '' });
  const load = useCallback(async () => setItems(await fetchPlatformAccounts()), []);
  useEffect(() => {
    if (user?.role === 'superadmin') void load().catch(console.error);
  }, [user, load]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? items.filter((item) => `${item.name} ${item.email} ${item.role}`.toLowerCase().includes(search)) : items;
  }, [items, query]);
  if (user?.role !== 'superadmin') return <div className="rounded-2xl bg-red-50 p-5 text-red-800">Platform admin access required.</div>;

  const toggle = async (account: PlatformAccount) => {
    setBusy(true);
    try {
      await updatePlatformAccount(account.uid, !account.active);
      await load();
    } finally { setBusy(false); }
  };

  const createOwner = async () => {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6 || !form.salonName.trim()) return;
    setBusy(true);
    try {
      await createPlatformOwner({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        salonName: form.salonName.trim(),
        ...(form.phone.trim() && { phone: form.phone.trim() }),
        ...(form.address.trim() && { address: form.address.trim() }),
      });
      setOpen(false);
      setForm({ name: '', email: '', password: '', phone: '', salonName: '', address: '' });
      await load();
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not create owner');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">{locale === 'vi' ? 'Tài khoản hệ thống' : 'Platform accounts'}</h1>
        <p className="mt-1 text-sm text-gray-500">{items.length} accounts in the current Firebase</p></div>
        <button onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" />{locale === 'vi' ? 'Tạo chủ tiệm' : 'Create owner'}</button>
      </header>
      <label className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <Search className="h-5 w-5 text-gray-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="flex-1 bg-transparent text-sm outline-none" placeholder="Search accounts" />
      </label>
      <div className="grid gap-3">
        {filtered.map((account) => (
          <article key={account.uid} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ${account.role === 'admin' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
              {account.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold">{account.name}</h2>
              <p className="truncate text-sm text-gray-500">{account.email} · {account.role}</p>
            </div>
            {account.uid !== user.uid && (
              <button disabled={busy} onClick={() => void toggle(account)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${account.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {account.active ? 'active' : 'disabled'}
              </button>
            )}
          </article>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-white p-5 sm:max-w-lg sm:rounded-[28px]">
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">{locale === 'vi' ? 'Tạo tài khoản chủ tiệm' : 'Create owner account'}</h2><button onClick={() => setOpen(false)} className="rounded-full bg-gray-100 p-2"><X className="h-4 w-4" /></button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={locale === 'vi' ? 'Họ tên *' : 'Name *'} className="rounded-xl border border-gray-200 px-4 py-3" />
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email *" className="rounded-xl border border-gray-200 px-4 py-3" />
              <input type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={locale === 'vi' ? 'Mật khẩu *' : 'Password *'} className="rounded-xl border border-gray-200 px-4 py-3" />
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder={locale === 'vi' ? 'Điện thoại' : 'Phone'} className="rounded-xl border border-gray-200 px-4 py-3" />
              <input value={form.salonName} onChange={(event) => setForm({ ...form, salonName: event.target.value })} placeholder={locale === 'vi' ? 'Tên tiệm *' : 'Salon name *'} className="rounded-xl border border-gray-200 px-4 py-3 sm:col-span-2" />
              <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder={locale === 'vi' ? 'Địa chỉ' : 'Address'} className="rounded-xl border border-gray-200 px-4 py-3 sm:col-span-2" />
            </div>
            <button disabled={busy || !form.name.trim() || !form.email.trim() || form.password.length < 6 || !form.salonName.trim()} onClick={() => void createOwner()} className="mt-5 w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? '...' : (locale === 'vi' ? 'Tạo chủ tiệm' : 'Create owner')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
