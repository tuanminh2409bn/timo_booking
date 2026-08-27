'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Store, X } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmCard, HrmIconButton, HrmInput, HrmPageHeader } from '@/components/hrm-ui';
import {
  createPlatformStore,
  fetchPlatformAccounts,
  fetchPlatformStores,
  updatePlatformStore,
  type PlatformAccount,
  type PlatformStore,
} from '@/lib/adminHrmApi';

export default function PlatformStoresPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<PlatformStore[]>([]);
  const [owners, setOwners] = useState<PlatformAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    ownerUserId: '', name: '', bookingSlug: '', phone: '', address: '',
    openTime: '09:00', closeTime: '18:00', bookingWindowDays: 30,
    minimumNoticeHours: 2, cancellationNoticeHours: 12,
    slotIntervalMinutes: 15, publicStaffSelection: true,
  });
  const load = useCallback(async () => {
    const [stores, accounts] = await Promise.all([fetchPlatformStores(), fetchPlatformAccounts()]);
    setItems(stores);
    setOwners(accounts.filter((account) => account.role === 'owner' && account.active));
  }, []);
  useEffect(() => {
    if (user?.role === 'superadmin') void load().catch(console.error);
  }, [user, load]);
  if (user?.role !== 'superadmin') return <div className="rounded-2xl bg-red-50 p-5 text-red-800">Platform admin access required.</div>;

  const toggle = async (store: PlatformStore) => {
    setBusy(true);
    try {
      await updatePlatformStore(store.id, store.status === 'active' ? 'disabled' : 'active');
      await load();
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!form.ownerUserId || !form.name.trim() || !form.bookingSlug.trim()) return;
    if (!window.confirm(locale === 'vi'
      ? `Tạo cửa hàng “${form.name.trim()}” cho tài khoản chủ đã chọn?`
      : `Create “${form.name.trim()}” for the selected owner?`)) return;
    setBusy(true);
    setError('');
    try {
      await createPlatformStore({
        ...form,
        name: form.name.trim(),
        bookingSlug: form.bookingSlug.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        address: form.address.trim() ? { line1: form.address.trim(), country: 'Germany' } : undefined,
      });
      setOpen(false);
      setForm((current) => ({ ...current, ownerUserId: '', name: '', bookingSlug: '', phone: '', address: '' }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create store');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Cửa hàng hệ thống' : 'Platform stores'}
        onBack={() => router.push('/admin/dashboard/')}
        right={<HrmIconButton aria-label={locale === 'vi' ? 'Tạo cửa hàng' : 'Create store'} onClick={() => setOpen(true)}><Plus className="h-5 w-5" /></HrmIconButton>}
      />
      <div className="flex items-end justify-between rounded-2xl bg-white p-4 shadow-sm">
        <div><p className="text-xs font-semibold text-slate-500">{locale === 'vi' ? 'Tổng cửa hàng' : 'Total stores'}</p><p className="text-2xl font-black">{items.length}</p></div>
        <HrmButton onClick={() => setOpen(true)} className="rounded-xl"><Plus className="h-4 w-4" />{locale === 'vi' ? 'Tạo cửa hàng' : 'Create store'}</HrmButton>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((store) => (
          <HrmCard key={store.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]"><Store className="h-5 w-5 stroke-[1.8]" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-bold">{store.name}</h2>
                <p className="mt-1 flex items-center gap-1 truncate text-sm text-gray-500"><MapPin className="h-3.5 w-3.5" /> {store.addressText || '—'}</p>
                <p className="mt-2 truncate text-xs text-gray-400">Owner: {store.ownerId}</p>
              </div>
              <button disabled={busy} onClick={() => void toggle(store)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${store.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {store.status}
              </button>
            </div>
          </HrmCard>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-[150] flex min-h-dvh items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="max-h-[calc(100dvh-3rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-black">{locale === 'vi' ? 'Tạo cửa hàng Booking' : 'Create Booking store'}</h2><p className="mt-1 text-sm text-slate-500">{locale === 'vi' ? 'Gán đúng chủ tiệm và cấu hình đặt lịch ngay từ đầu.' : 'Assign the owner and initial booking settings.'}</p></div><button onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-50"><X className="h-5 w-5" /></button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold sm:col-span-2">{locale === 'vi' ? 'Chủ tiệm' : 'Owner'}<select value={form.ownerUserId} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value })} className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"><option value="">{locale === 'vi' ? 'Chọn tài khoản chủ tiệm' : 'Select owner'}</option>{owners.map((owner) => <option key={owner.uid} value={owner.uid}>{owner.name} · {owner.email}</option>)}</select></label>
              <label className="text-sm font-bold sm:col-span-2">{locale === 'vi' ? 'Tên cửa hàng' : 'Store name'}<HrmInput className="mt-1.5 font-normal" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="text-sm font-bold sm:col-span-2">Booking slug<HrmInput className="mt-1.5 font-normal" value={form.bookingSlug} onChange={(event) => setForm({ ...form, bookingSlug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="salon-berlin" /></label>
              <label className="text-sm font-bold">Phone<HrmInput className="mt-1.5 font-normal" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Địa chỉ' : 'Address'}<HrmInput className="mt-1.5 font-normal" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Mở cửa' : 'Open'}<HrmInput type="time" className="mt-1.5 font-normal" value={form.openTime} onChange={(event) => setForm({ ...form, openTime: event.target.value })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Đóng cửa' : 'Close'}<HrmInput type="time" className="mt-1.5 font-normal" value={form.closeTime} onChange={(event) => setForm({ ...form, closeTime: event.target.value })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Ngày cho đặt trước' : 'Booking window'}<HrmInput type="number" className="mt-1.5 font-normal" value={form.bookingWindowDays} onChange={(event) => setForm({ ...form, bookingWindowDays: Number(event.target.value) })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Báo trước (giờ)' : 'Notice hours'}<HrmInput type="number" className="mt-1.5 font-normal" value={form.minimumNoticeHours} onChange={(event) => setForm({ ...form, minimumNoticeHours: Number(event.target.value) })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Hủy trước (giờ)' : 'Cancellation hours'}<HrmInput type="number" className="mt-1.5 font-normal" value={form.cancellationNoticeHours} onChange={(event) => setForm({ ...form, cancellationNoticeHours: Number(event.target.value) })} /></label>
              <label className="text-sm font-bold">{locale === 'vi' ? 'Bước lịch (phút)' : 'Slot interval'}<select value={form.slotIntervalMinutes} onChange={(event) => setForm({ ...form, slotIntervalMinutes: Number(event.target.value) })} className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"><option value={15}>15</option><option value={30}>30</option><option value={60}>60</option></select></label>
              <label className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-bold sm:col-span-2"><span>{locale === 'vi' ? 'Cho khách chọn thợ' : 'Public staff selection'}</span><input type="checkbox" checked={form.publicStaffSelection} onChange={(event) => setForm({ ...form, publicStaffSelection: event.target.checked })} className="h-5 w-5" /></label>
            </div>
            {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
            <HrmButton disabled={busy || !form.ownerUserId || !form.name.trim() || !form.bookingSlug.trim()} onClick={() => void create()} className="mt-5 min-h-12 w-full rounded-xl font-black">{busy ? '…' : locale === 'vi' ? 'Tạo cửa hàng' : 'Create store'}</HrmButton>
          </section>
        </div>
      )}
    </section>
  );
}
