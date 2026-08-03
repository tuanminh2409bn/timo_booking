'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Pencil, Plus, Store, X } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createAdminStore,
  fetchAdminStores,
  updateAdminStore,
  type AdminStore,
} from '@/lib/adminHrmApi';

export default function MyStoresPage() {
  const { user, activeBranch, setActiveBranch } = useAuth();
  const { locale } = useI18n();
  const [items, setItems] = useState<AdminStore[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [editingStore, setEditingStore] = useState<AdminStore>();
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

  const toggle = async (store: AdminStore) => {
    setBusy(true);
    try {
      await updateAdminStore(store.id, {
        status: store.status === 'active' ? 'disabled' : 'active',
      });
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
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">
            {locale === 'vi' ? 'Cửa hàng của tôi' : locale === 'de' ? 'Meine Filialen' : 'My stores'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {locale === 'vi' ? 'Danh sách cửa hàng trên hệ thống HRM hiện tại.' : 'Stores in the current HRM system.'}
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{locale === 'vi' ? 'Thêm cửa hàng' : 'Add store'}</span>
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((store) => (
          <article key={store.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${activeBranch === store.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-100'}`}>
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Store className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-gray-950">{store.name}</h2>
                <p className="mt-1 flex items-center gap-1 text-sm text-gray-500"><MapPin className="h-3.5 w-3.5" /> {store.addressText || '—'}</p>
                <p className="mt-2 text-xs text-gray-500">{store.openTime || '09:00'} – {store.closeTime || '18:00'} · {store.employeeCount ?? 0} staff</p>
                {store.status === 'active' && (
                  <button onClick={() => setActiveBranch(store.id)} className="mt-3 text-xs font-bold text-blue-600">
                    {activeBranch === store.id
                      ? (locale === 'vi' ? 'Đang sử dụng' : 'Selected')
                      : (locale === 'vi' ? 'Chọn cửa hàng' : 'Select store')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingStore(store);
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
                  className="ml-4 mt-3 inline-flex items-center gap-1 text-xs font-bold text-gray-600"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {locale === 'vi' ? 'Cài đặt đặt lịch' : 'Booking settings'}
                </button>
              </div>
              <button disabled={busy} onClick={() => void toggle(store)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${store.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {store.status}
              </button>
            </div>
          </article>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="w-full rounded-t-[28px] bg-white p-5 sm:max-w-lg sm:rounded-[28px]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">{locale === 'vi' ? 'Thêm cửa hàng' : 'Add store'}</h2>
              <button onClick={() => setOpen(false)} className="rounded-full bg-gray-100 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={locale === 'vi' ? 'Tên cửa hàng' : 'Store name'} className="w-full rounded-xl border border-gray-200 px-4 py-3" />
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" className="w-full rounded-xl border border-gray-200 px-4 py-3" />
              <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={locale === 'vi' ? 'Địa chỉ' : 'Address'} className="w-full rounded-xl border border-gray-200 px-4 py-3" />
            </div>
            <button disabled={busy || !name.trim()} onClick={() => void create()} className="mt-5 w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">
              {locale === 'vi' ? 'Tạo cửa hàng' : 'Create store'}
            </button>
          </div>
        </div>
      )}

      {editingStore && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-white p-5 sm:max-w-xl sm:rounded-[28px]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{locale === 'vi' ? 'Cài đặt đặt lịch' : 'Booking settings'}</h2>
                <p className="text-sm text-gray-500">{editingStore.name}</p>
              </div>
              <button onClick={() => setEditingStore(undefined)} className="rounded-full bg-gray-100 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                {locale === 'vi' ? 'Đường dẫn đặt lịch' : 'Booking URL slug'}
                <div className="mt-1.5 flex items-center rounded-xl border border-gray-200 px-3">
                  <span className="text-sm text-gray-400">/book/</span>
                  <input value={bookingSettings.bookingSlug} onChange={(event) => setBookingSettings({ ...bookingSettings, bookingSlug: event.target.value.replace(/[^a-zA-Z0-9-]/g, '') })} className="min-w-0 flex-1 px-1 py-2.5 font-normal outline-none" />
                </div>
              </label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Giờ mở cửa' : 'Open time'}<input type="time" value={bookingSettings.openTime} onChange={(event) => setBookingSettings({ ...bookingSettings, openTime: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Giờ đóng cửa' : 'Close time'}<input type="time" value={bookingSettings.closeTime} onChange={(event) => setBookingSettings({ ...bookingSettings, closeTime: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Đặt trước tối đa (ngày)' : 'Booking window (days)'}<input type="number" min="1" max="365" value={bookingSettings.bookingWindowDays} onChange={(event) => setBookingSettings({ ...bookingSettings, bookingWindowDays: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Báo trước tối thiểu (giờ)' : 'Minimum notice (hours)'}<input type="number" min="0" max="168" value={bookingSettings.minimumNoticeHours} onChange={(event) => setBookingSettings({ ...bookingSettings, minimumNoticeHours: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Hạn khách tự hủy (giờ)' : 'Cancellation notice (hours)'}<input type="number" min="0" max="168" value={bookingSettings.cancellationNoticeHours} onChange={(event) => setBookingSettings({ ...bookingSettings, cancellationNoticeHours: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" /></label>
              <label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Khoảng giờ đặt lịch' : 'Slot interval'}<select value={bookingSettings.slotIntervalMinutes} onChange={(event) => setBookingSettings({ ...bookingSettings, slotIntervalMinutes: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal"><option value="5">5 phút</option><option value="10">10 phút</option><option value="15">15 phút</option><option value="30">30 phút</option><option value="60">60 phút</option></select></label>
              <label className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 text-sm font-semibold text-gray-700 sm:col-span-2"><input type="checkbox" checked={bookingSettings.publicStaffSelection} onChange={(event) => setBookingSettings({ ...bookingSettings, publicStaffSelection: event.target.checked })} />{locale === 'vi' ? 'Cho phép khách chọn thợ cụ thể' : 'Allow customers to choose a specific employee'}</label>
            </div>
            <button disabled={busy || !bookingSettings.bookingSlug.trim() || bookingSettings.openTime >= bookingSettings.closeTime} onClick={() => void saveBookingSettings()} className="mt-5 w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? '...' : (locale === 'vi' ? 'Lưu cài đặt' : 'Save settings')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
