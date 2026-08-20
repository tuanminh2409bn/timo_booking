'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmCard, HrmIconButton, HrmInput, HrmPageHeader } from '@/components/hrm-ui';
import {
  fetchPlatformAccounts,
  createPlatformOwner,
  updatePlatformAccount,
  type PlatformAccount,
} from '@/lib/adminHrmApi';

export default function PlatformAccountsPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
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
    <section className="mx-auto max-w-2xl space-y-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Tài khoản hệ thống' : 'Platform accounts'}
        onBack={() => router.push('/admin/dashboard/')}
        right={<HrmIconButton aria-label={locale === 'vi' ? 'Tạo chủ tiệm' : 'Create owner'} onClick={() => setOpen(true)}><Plus className="h-5 w-5" /></HrmIconButton>}
      />
      <p className="text-sm text-slate-500">{items.length} accounts in the current Firebase</p>
      <label className="flex h-10 items-center gap-3 rounded-full border border-slate-200 bg-white px-4">
        <Search className="h-4 w-4 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="flex-1 bg-transparent text-sm outline-none" placeholder="Search accounts" />
      </label>
      <div className="grid gap-3">
        {filtered.map((account) => (
          <HrmCard key={account.uid} className="flex items-center gap-3 p-4">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ${account.role === 'admin' ? 'bg-red-50 text-red-600' : 'bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]'}`}>
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
          </HrmCard>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-[130] flex min-h-dvh w-full items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="relative max-h-[calc(100dvh-3rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-[var(--hrm-border)] bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">{locale === 'vi' ? 'Tạo tài khoản chủ tiệm' : 'Create owner account'}</h2><button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <HrmInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={locale === 'vi' ? 'Họ tên *' : 'Name *'} />
              <HrmInput type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email *" />
              <HrmInput type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={locale === 'vi' ? 'Mật khẩu *' : 'Password *'} />
              <HrmInput value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder={locale === 'vi' ? 'Điện thoại' : 'Phone'} />
              <HrmInput value={form.salonName} onChange={(event) => setForm({ ...form, salonName: event.target.value })} placeholder={locale === 'vi' ? 'Tên tiệm *' : 'Salon name *'} className="sm:col-span-2" />
              <HrmInput value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder={locale === 'vi' ? 'Địa chỉ' : 'Address'} className="sm:col-span-2" />
            </div>
            <HrmButton disabled={busy || !form.name.trim() || !form.email.trim() || form.password.length < 6 || !form.salonName.trim()} onClick={() => void createOwner()} className="mt-5 min-h-11 w-full rounded-xl font-bold">{busy ? '...' : (locale === 'vi' ? 'Tạo chủ tiệm' : 'Create owner')}</HrmButton>
          </section>
        </div>
      )}
    </section>
  );
}
