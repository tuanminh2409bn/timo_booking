'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Pencil, Plus, Scissors, Trash2, X } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createAdminService,
  deleteAdminService,
  updateAdminService,
  type AdminServiceInput,
} from '@/lib/adminHrmApi';
import { fetchHrmServices, type HrmService } from '@/lib/hrmApi';

const categories: AdminServiceInput['category'][] = [
  'nail',
  'manicure',
  'pedicure',
  'design',
  'other',
];

const emptyForm: AdminServiceInput = {
  name: '',
  description: '',
  category: 'nail',
  groupService: 'Nail',
  price: 0,
  duration: 30,
  preferredWorkerType: 'main',
  bookingKind: 'main',
};

export default function ServicesManagementPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [items, setItems] = useState<HrmService[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<AdminServiceInput>(emptyForm);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setItems(await fetchHrmServices(storeId));
  }, [storeId]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    void load().catch((error: unknown) => console.error(error));
  }, [user, load]);

  const filtered = useMemo(
    () => selectedCategory === 'all'
      ? items
      : items.filter((item) => (item.category || 'other') === selectedCategory),
    [items, selectedCategory],
  );

  if (user?.role !== 'owner') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        {locale === 'vi'
          ? 'Chỉ chủ tiệm được thay đổi dịch vụ.'
          : locale === 'de'
            ? 'Nur der Inhaber kann Services ändern.'
            : 'Only the owner may change services.'}
      </div>
    );
  }

  const openCreate = () => {
    setEditingId(undefined);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (service: HrmService) => {
    setEditingId(service.id);
    setForm({
      name: service.name,
      description: '',
      category: categories.includes(service.category as AdminServiceInput['category'])
        ? service.category as AdminServiceInput['category']
        : 'other',
      groupService: service.groupService || service.category || 'Other',
      price: service.price,
      duration: service.durationMax || service.durationMin || 30,
      preferredWorkerType: service.preferredWorkerType ?? 'main',
      bookingKind: service.bookingKind ?? 'main',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!storeId || !form.name.trim() || form.duration <= 0 || form.price < 0) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        groupService: form.groupService?.trim() || form.category,
      };
      if (editingId) await updateAdminService(storeId, editingId, payload);
      else await createAdminService(storeId, payload);
      setOpen(false);
      await load();
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not save service');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (service: HrmService) => {
    if (!storeId || !window.confirm(
      locale === 'vi'
        ? `Xóa dịch vụ “${service.name}”? Dịch vụ đã có trong lịch sẽ không thể xóa.`
        : `Delete “${service.name}”? Services already used in bookings cannot be deleted.`,
    )) return;
    setBusy(true);
    try {
      await deleteAdminService(storeId, service.id);
      await load();
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not delete service');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">
            {locale === 'vi' ? 'Dịch vụ tiệm' : locale === 'de' ? 'Salon-Services' : 'Salon services'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {locale === 'vi'
              ? 'Giá và thời lượng này được dùng trực tiếp khi khách đặt lịch.'
              : 'Prices and durations are used directly in customer booking.'}
          </p>
        </div>
        <button onClick={openCreate} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{locale === 'vi' ? 'Thêm dịch vụ' : 'Add service'}</span>
        </button>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', ...categories].map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
              selectedCategory === category
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600'
            }`}
          >
            {category === 'all'
              ? (locale === 'vi' ? 'Tất cả' : 'All')
              : category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((service) => (
          <article key={service.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Scissors className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-gray-950">{service.name}</h2>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                  {service.groupService || service.category || 'Other'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {service.bookingKind === 'add_on'
                    ? (locale === 'vi' ? 'Dịch vụ thêm · không chiếm lịch' : 'Add-on · no calendar block')
                    : service.preferredWorkerType === 'assistant'
                      ? (locale === 'vi' ? 'Ưu tiên thợ phụ' : 'Assistant preferred')
                      : (locale === 'vi' ? 'Ưu tiên thợ chính' : 'Main staff preferred')}
                </p>
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <span className="font-bold text-blue-700">€{service.price}</span>
                  <span className="inline-flex items-center gap-1 text-gray-500">
                    <Clock3 className="h-4 w-4" />
                    {service.durationMax || service.durationMin || 0} min
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(service)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => void remove(service)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="w-full rounded-t-[28px] bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-[28px]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-950">
                {editingId
                  ? (locale === 'vi' ? 'Sửa dịch vụ' : 'Edit service')
                  : (locale === 'vi' ? 'Thêm dịch vụ' : 'Add service')}
              </h2>
              <button onClick={() => setOpen(false)} className="rounded-full bg-gray-100 p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700 sm:col-span-2">
                {locale === 'vi' ? 'Tên dịch vụ' : 'Name'}
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal outline-none focus:border-blue-500" />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Nhóm' : 'Category'}
                <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as AdminServiceInput['category'], groupService: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal">
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Tên nhóm hiển thị' : 'Group label'}
                <input value={form.groupService} onChange={(event) => setForm({ ...form, groupService: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Giá (€)' : 'Price (€)'}
                <input type="number" min="0" step="0.5" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Thời lượng (phút)' : 'Duration (minutes)'}
                <input type="number" min={form.bookingKind === 'add_on' ? 0 : 1} step="5" value={form.duration} disabled={form.bookingKind === 'add_on'} onChange={(event) => setForm({ ...form, duration: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal disabled:bg-gray-100" />
              </label>
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Loại dịch vụ' : 'Booking type'}
                <select value={form.bookingKind} onChange={(event) => {
                  const bookingKind = event.target.value as AdminServiceInput['bookingKind'];
                  setForm({ ...form, bookingKind, ...(bookingKind === 'add_on' && { duration: 1 }) });
                }} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal">
                  <option value="main">{locale === 'vi' ? 'Dịch vụ chính' : 'Main service'}</option>
                  <option value="add_on">{locale === 'vi' ? 'Dịch vụ thêm (không chiếm lịch)' : 'Add-on (no calendar block)'}</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Loại thợ ưu tiên' : 'Preferred staff type'}
                <select value={form.preferredWorkerType} disabled={form.bookingKind === 'add_on'} onChange={(event) => setForm({ ...form, preferredWorkerType: event.target.value as 'main' | 'assistant' })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal disabled:bg-gray-100">
                  <option value="main">{locale === 'vi' ? 'Thợ chính' : 'Main staff'}</option>
                  <option value="assistant">{locale === 'vi' ? 'Thợ phụ' : 'Assistant'}</option>
                </select>
              </label>
            </div>
            <button disabled={busy || !form.name.trim()} onClick={() => void save()} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy ? '...' : (locale === 'vi' ? 'Lưu dịch vụ' : 'Save service')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
