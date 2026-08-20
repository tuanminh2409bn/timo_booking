'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, MapPin, Phone, Plus, Store, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmIconButton, HrmInput, HrmPageHeader } from '@/components/hrm-ui';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createAdminStore,
  fetchAdminStores,
  updateAdminStore,
  type AdminStore,
} from '@/lib/adminHrmApi';
import { withStoresReturn } from '@/lib/adminNavigation';

export default function MyStoresPage() {
  const { user, setActiveBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<AdminStore[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [editingStore, setEditingStore] = useState<AdminStore>();
  const [editingIdentity, setEditingIdentity] = useState({ name: '', phone: '', address: '' });
  const [bookingSettings, setBookingSettings] = useState({
    bookingSlug: '',
    openTime: '09:00',
    closeTime: '18:00',
    bookingWindowDays: 30,
    minimumNoticeHours: 2,
    cancellationNoticeHours: 12,
    slotIntervalMinutes: 15,
    publicStaffSelection: true,
  });

  const load = useCallback(async () => setItems(await fetchAdminStores()), []);
  useEffect(() => {
    if (user?.role === 'owner') void load().catch((error: unknown) => console.error(error));
  }, [user, load]);

  if (user?.role !== 'owner') {
    return <div className="rounded-2xl bg-amber-50 p-5 text-amber-900">Only owners may manage stores.</div>;
  }

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createAdminStore({
        name: name.trim(),
        phone: phone.trim() || undefined,
        address: address.trim() ? { line1: address.trim() } : undefined,
        openTime: '09:00',
        closeTime: '18:00',
      });
      setOpen(false);
      setName('');
      setPhone('');
      setAddress('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveBookingSettings = async () => {
    if (!editingStore || !bookingSettings.bookingSlug.trim()) return;
    setBusy(true);
    try {
      await updateAdminStore(editingStore.id, {
        ...bookingSettings,
        bookingSlug: bookingSettings.bookingSlug.trim().toLowerCase(),
        name: editingIdentity.name.trim(),
        phone: editingIdentity.phone.trim(),
        address: { line1: editingIdentity.address.trim() },
      });
      setEditingStore(undefined);
      await load();
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not save booking settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Cửa hàng' : locale === 'de' ? 'Filialen' : 'Stores'}
        onBack={() => router.push('/admin/dashboard/')}
        right={items.length < 1 ? <HrmIconButton aria-label={locale === 'vi' ? 'Thêm cửa hàng' : 'Add store'} onClick={() => setOpen(true)}><Plus className="h-5 w-5" /></HrmIconButton> : null}
      />

      <div className="flex items-end justify-between">
        <div><p className="text-xs font-semibold text-gray-500">{locale === 'vi' ? 'Giới hạn' : 'Limit'}</p><p className="text-2xl font-black text-gray-950">{items.length}/1</p></div>
        <button disabled={items.length >= 1} onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--hrm-blue-50)] px-4 text-sm font-bold text-[var(--hrm-blue-700)] disabled:text-gray-400 disabled:opacity-60">
          <Plus className="h-4 w-4" />
          <span>{locale === 'vi' ? 'Thêm' : 'Add'}</span>
        </button>
      </div>

      {items.length >= 1 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>{locale === 'vi' ? 'Bạn đã đạt giới hạn cửa hàng' : 'Store limit reached'}</strong><p className="mt-1 text-xs leading-5">{locale === 'vi' ? 'Gói hiện tại cho phép tối đa 1 cửa hàng. Nâng cấp để thêm địa điểm mới.' : 'Upgrade your plan to add another location.'}</p><button onClick={() => router.push(withStoresReturn('/admin/dashboard/billing/'))} className="mt-2 text-xs font-extrabold text-blue-700">{locale === 'vi' ? 'Xem gói nâng cấp →' : 'View plans →'}</button></div>}

      <div>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold text-gray-950">{locale === 'vi' ? 'Cửa hàng' : 'Stores'}</h2><span className="text-xs text-gray-500">{items.length} {locale === 'vi' ? 'cửa hàng' : 'stores'}</span></div>
        <div className="space-y-2">
        {items.map((store) => (
          <article key={store.id} className="rounded-2xl px-0 py-3">
            <div className="flex items-start gap-3">
              <button onClick={() => store.status === 'active' && setActiveBranch(store.id)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white"><Store className="h-5 w-5 stroke-[1.8]" /></button>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-gray-950">{store.name}</h2>
                <p className="mt-1 flex items-center gap-1 text-sm text-gray-500"><MapPin className="h-3.5 w-3.5" /> {store.addressText || '—'}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-gray-500"><Phone className="h-3.5 w-3.5" /> {store.phone || '—'}</p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingStore(store);
                    setEditingIdentity({ name: store.name, phone: store.phone ?? '', address: store.addressText ?? '' });
                    setBookingSettings({
                      bookingSlug: store.bookingSlug ?? store.id.toLowerCase(),
                      openTime: store.openTime ?? '09:00',
                      closeTime: store.closeTime ?? '18:00',
                      bookingWindowDays: store.bookingWindowDays ?? 30,
                      minimumNoticeHours: store.minimumNoticeHours ?? 2,
                      cancellationNoticeHours: store.cancellationNoticeHours ?? 12,
                      slotIntervalMinutes: store.slotIntervalMinutes ?? 15,
                      publicStaffSelection: store.publicStaffSelection ?? true,
                    });
                  }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[var(--hrm-blue-700)]"
                >
                  {locale === 'vi' ? 'Cài đặt đặt lịch' : 'Booking settings'}
                </button>
              </div>
              <button onClick={() => { setEditingStore(store); setEditingIdentity({ name: store.name, phone: store.phone ?? '', address: store.addressText ?? '' }); setBookingSettings({ bookingSlug: store.bookingSlug ?? store.id.toLowerCase(), openTime: store.openTime ?? '09:00', closeTime: store.closeTime ?? '18:00', bookingWindowDays: store.bookingWindowDays ?? 30, minimumNoticeHours: store.minimumNoticeHours ?? 2, cancellationNoticeHours: store.cancellationNoticeHours ?? 12, slotIntervalMinutes: store.slotIntervalMinutes ?? 15, publicStaffSelection: store.publicStaffSelection ?? true }); }} className="mt-2 text-gray-400"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </article>
        ))}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[130] flex min-h-dvh w-full items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="relative w-full max-w-lg rounded-3xl border border-[var(--hrm-border)] bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">{locale === 'vi' ? 'Thêm cửa hàng' : 'Add store'}</h2>
              <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <HrmInput value={name} onChange={(event) => setName(event.target.value)} placeholder={locale === 'vi' ? 'Tên cửa hàng' : 'Store name'} />
              <HrmInput value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" />
              <HrmInput value={address} onChange={(event) => setAddress(event.target.value)} placeholder={locale === 'vi' ? 'Địa chỉ' : 'Address'} />
            </div>
            <HrmButton disabled={busy || !name.trim()} onClick={() => void create()} className="mt-5 min-h-11 w-full rounded-xl font-bold">
              {locale === 'vi' ? 'Tạo cửa hàng' : 'Create store'}
            </HrmButton>
          </section>
        </div>
      )}

      {editingStore && (
        <div className="fixed inset-0 z-[130] flex min-h-dvh w-full items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="relative max-h-[calc(100dvh-3rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-[var(--hrm-border)] bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{locale === 'vi' ? 'Cài đặt đặt lịch' : 'Booking settings'}</h2>
                <p className="text-sm text-gray-500">{editingStore.name}</p>
              </div>
              <button onClick={() => setEditingStore(undefined)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">{locale === 'vi' ? 'Tên cửa hàng' : 'Store name'}<HrmInput value={editingIdentity.name} onChange={(event) => setEditingIdentity({ ...editingIdentity, name: event.target.value })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">{locale === 'vi' ? 'Địa chỉ' : 'Address'}<HrmInput value={editingIdentity.address} onChange={(event) => setEditingIdentity({ ...editingIdentity, address: event.target.value })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">{locale === 'vi' ? 'Số điện thoại' : 'Phone'}<HrmInput value={editingIdentity.phone} onChange={(event) => setEditingIdentity({ ...editingIdentity, phone: event.target.value })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                {locale === 'vi' ? 'Đường dẫn đặt lịch' : 'Booking URL slug'}
                <div className="mt-1.5 flex items-center rounded-xl border border-gray-200 px-3">
                  <span className="text-sm text-gray-400">/book/</span>
                  <input value={bookingSettings.bookingSlug} onChange={(event) => setBookingSettings({ ...bookingSettings, bookingSlug: event.target.value.replace(/[^a-zA-Z0-9-]/g, '') })} className="min-w-0 flex-1 px-1 py-2.5 font-normal outline-none" />
                </div>
              </label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Giờ mở cửa' : 'Open time'}<HrmInput type="time" value={bookingSettings.openTime} onChange={(event) => setBookingSettings({ ...bookingSettings, openTime: event.target.value })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Giờ đóng cửa' : 'Close time'}<HrmInput type="time" value={bookingSettings.closeTime} onChange={(event) => setBookingSettings({ ...bookingSettings, closeTime: event.target.value })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Đặt trước tối đa (ngày)' : 'Booking window (days)'}<HrmInput type="number" min="1" max="365" value={bookingSettings.bookingWindowDays} onChange={(event) => setBookingSettings({ ...bookingSettings, bookingWindowDays: Number(event.target.value) })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Báo trước tối thiểu (giờ)' : 'Minimum notice (hours)'}<HrmInput type="number" min="0" max="168" value={bookingSettings.minimumNoticeHours} onChange={(event) => setBookingSettings({ ...bookingSettings, minimumNoticeHours: Number(event.target.value) })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Hạn khách tự hủy (giờ)' : 'Cancellation notice (hours)'}<HrmInput type="number" min="0" max="168" value={bookingSettings.cancellationNoticeHours} onChange={(event) => setBookingSettings({ ...bookingSettings, cancellationNoticeHours: Number(event.target.value) })} className="mt-1.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Khoảng giờ đặt lịch' : 'Slot interval'}<select value={bookingSettings.slotIntervalMinutes} onChange={(event) => setBookingSettings({ ...bookingSettings, slotIntervalMinutes: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal"><option value="5">5 phút</option><option value="10">10 phút</option><option value="15">15 phút</option><option value="30">30 phút</option><option value="60">60 phút</option></select></label>
              <label className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 text-sm font-semibold text-gray-700 sm:col-span-2"><input type="checkbox" checked={bookingSettings.publicStaffSelection} onChange={(event) => setBookingSettings({ ...bookingSettings, publicStaffSelection: event.target.checked })} />{locale === 'vi' ? 'Cho phép khách chọn thợ cụ thể' : 'Allow customers to choose a specific employee'}</label>
            </div>
            <HrmButton disabled={busy || !editingIdentity.name.trim() || !bookingSettings.bookingSlug.trim() || bookingSettings.openTime >= bookingSettings.closeTime} onClick={() => void saveBookingSettings()} className="mt-5 min-h-11 w-full rounded-xl font-bold">{busy ? '...' : (locale === 'vi' ? 'Lưu cài đặt' : 'Save settings')}</HrmButton>
          </section>
        </div>
      )}
    </section>
  );
}
