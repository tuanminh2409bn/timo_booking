'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, CircleHelp, Clock3, FolderPlus, Sparkles, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmInput, HrmPageHeader } from '@/components/hrm-ui';
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
  displayName: '',
  description: '',
  category: 'nail',
  groupService: 'Nail',
  price: 0,
  duration: 30,
  preferredWorkerType: 'main',
  bookingKind: 'main',
  availableForBooking: true,
};

export default function ServicesManagementPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [items, setItems] = useState<HrmService[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<AdminServiceInput>(emptyForm);
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setItems(await fetchHrmServices(storeId));
  }, [storeId]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    void load().catch((error: unknown) => console.error(error));
  }, [user, load]);

  const groupedServices = useMemo(() => {
    const groups = new Map<string, HrmService[]>();
    for (const service of items) {
      const groupName = service.groupService?.trim() || service.category?.trim() || 'Other';
      groups.set(groupName, [...(groups.get(groupName) ?? []), service]);
    }
    return Array.from(groups, ([name, services]) => ({ name, services }))
      .sort((left, right) => left.name.localeCompare(right.name, locale === 'vi' ? 'vi' : locale === 'de' ? 'de' : 'en'));
  }, [items, locale]);

  const filtered = useMemo(
    () => selectedGroup
      ? items.filter((item) => (item.groupService?.trim() || item.category?.trim() || 'Other') === selectedGroup)
      : [],
    [items, selectedGroup],
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

  const openCreate = (groupName = selectedGroup) => {
    setEditingId(undefined);
    setForm({
      ...emptyForm,
      groupService: groupName?.trim() || emptyForm.groupService,
    });
    setOpen(true);
  };

  const openEdit = (service: HrmService) => {
    setEditingId(service.id);
    setForm({
      name: service.name,
      displayName: service.displayName ?? '',
      description: service.description ?? '',
      category: categories.includes(service.category as AdminServiceInput['category'])
        ? service.category as AdminServiceInput['category']
        : 'other',
      groupService: service.groupService || service.category || 'Other',
      price: service.price,
      duration: service.durationMax || service.durationMin || 30,
      preferredWorkerType: service.preferredWorkerType ?? 'main',
      bookingKind: service.bookingKind ?? 'main',
      availableForBooking: service.availableForBooking ?? true,
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
      setSelectedGroup(payload.groupService);
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
    )) return false;
    setBusy(true);
    try {
      await deleteAdminService(storeId, service.id);
      await load();
      return true;
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not delete service');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl space-y-3">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={selectedGroup || (locale === 'vi' ? 'Nhóm dịch vụ' : locale === 'de' ? 'Servicegruppen' : 'Service groups')}
        onBack={() => selectedGroup ? setSelectedGroup(undefined) : router.push('/admin/dashboard/')}
      />

      {!selectedGroup ? (
        <>
          <button onClick={() => { setGroupDraft(''); setGroupOpen(true); }} className="flex w-full items-center gap-3 py-2 text-left">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white shadow-[0_8px_18px_rgba(15,98,254,0.2)]"><FolderPlus className="h-5 w-5 stroke-[1.8]" /></span>
            <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold leading-tight text-slate-950">{locale === 'vi' ? 'Tạo nhóm dịch vụ nhanh' : 'Create a service group'}</strong><span className="mt-1 block text-xs font-medium leading-tight text-slate-500">{locale === 'vi' ? 'Gom các dịch vụ cùng loại vào một nhóm riêng.' : 'Keep services of the same type together.'}</span></span>
            <CircleHelp className="h-5 w-5 shrink-0 text-[var(--hrm-blue-700)]" />
          </button>

          <div>
            <h2 className="mb-1 text-base font-semibold text-slate-950">{locale === 'vi' ? 'Danh sách nhóm' : 'Group list'}</h2>
            <div>
              {groupedServices.map((group) => (
                <button key={group.name} onClick={() => setSelectedGroup(group.name)} className="flex min-h-[60px] w-full items-center gap-3 py-1 text-left transition active:bg-slate-50">
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold leading-tight text-slate-950">{group.name}</strong><span className="mt-1 block text-xs font-semibold leading-tight text-slate-500">{group.services.length} {locale === 'vi' ? 'dịch vụ' : 'services'}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
              {groupedServices.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500">{locale === 'vi' ? 'Chưa có nhóm dịch vụ.' : 'No service groups yet.'}</p>}
            </div>
          </div>
        </>
      ) : (
        <div className="-mx-4 min-h-[calc(100dvh-10rem)] bg-white px-4 pb-24 pt-1 md:mx-0 md:min-h-0 md:rounded-2xl md:px-5 md:pb-5">
          <button
            type="button"
            onClick={() => openCreate()}
            className="mb-3 flex w-full items-center gap-4 py-3 text-left transition active:opacity-80"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white shadow-[0_10px_24px_-18px_rgba(37,99,235,0.8)]">
              <FolderPlus className="h-7 w-7 stroke-[1.8]" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-base font-semibold leading-tight text-slate-950">
                {locale === 'vi' ? 'Tạo dịch vụ nhanh' : 'Create a service quickly'}
              </strong>
              <span className="mt-1 block text-sm font-medium leading-snug text-slate-500">
                {locale === 'vi' ? `Thêm dịch vụ vào nhóm ${selectedGroup}.` : `Add a service to ${selectedGroup}.`}
              </span>
            </span>
            <CircleHelp className="h-5 w-5 shrink-0 text-[var(--hrm-blue-700)]" />
          </button>

          <div className="flex flex-col bg-white">
            {filtered.map((service) => (
              <button
                type="button"
                key={service.id}
                onClick={() => openEdit(service)}
                className="flex min-h-[62px] w-full items-center gap-3 py-2.5 text-left transition active:bg-slate-50"
                aria-label={`${locale === 'vi' ? 'Chỉnh sửa' : 'Edit'} ${service.displayName?.trim() || service.name}`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]">
                  <Sparkles className="h-5 w-5 stroke-[1.8]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="truncate text-sm font-semibold text-slate-950">
                    {service.displayName?.trim() || service.name}
                  </strong>
                  <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                    {service.durationMax || service.durationMin || 0} {locale === 'vi' ? 'phút' : 'min'}
                  </span>
                </span>
                <strong className="shrink-0 whitespace-nowrap text-sm font-bold text-[var(--hrm-blue-700)]">
                  €{service.price}
                </strong>
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {locale === 'vi' ? 'Chưa có dịch vụ trong nhóm này.' : 'No services in this group yet.'}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {groupOpen && (
        <div className="fixed inset-0 z-[130] flex min-h-dvh w-full items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-950">{locale === 'vi' ? 'Tạo nhóm dịch vụ' : 'Create service group'}</h2><button onClick={() => setGroupOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"><X className="h-5 w-5" /></button></div>
            <label className="text-sm font-semibold text-slate-700">{locale === 'vi' ? 'Tên nhóm' : 'Group name'}<HrmInput autoFocus value={groupDraft} onChange={(event) => setGroupDraft(event.target.value)} className="mt-1.5" /></label>
            <p className="mt-3 text-xs leading-5 text-slate-500">{locale === 'vi' ? 'Nhóm sẽ được lưu khi bạn tạo dịch vụ đầu tiên trong nhóm.' : 'The group is saved with its first service.'}</p>
            <HrmButton disabled={!groupDraft.trim()} onClick={() => { const nextGroup = groupDraft.trim(); setGroupOpen(false); setSelectedGroup(nextGroup); openCreate(nextGroup); }} className="mt-5 min-h-11 w-full rounded-xl font-bold">{locale === 'vi' ? 'Tiếp tục thêm dịch vụ' : 'Continue to service'}</HrmButton>
          </section>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[130] flex min-h-dvh w-full items-center justify-center bg-black/45 px-4 py-4 backdrop-blur-sm">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setOpen(false)} aria-label={locale === 'vi' ? 'Đóng' : 'Close'} />
          <section role="dialog" aria-modal="true" aria-labelledby="service-editor-title" className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)]">
            <div className="relative flex shrink-0 items-center justify-center px-5 pb-3 pt-5 sm:px-7">
              <h2 id="service-editor-title" className="px-12 text-center text-xl font-bold text-slate-950">
                {editingId
                  ? (locale === 'vi' ? 'Chỉnh sửa dịch vụ' : 'Edit service')
                  : (locale === 'vi' ? 'Thêm dịch vụ' : 'Add service')}
              </h2>
              <button onClick={() => setOpen(false)} className="absolute right-5 top-4 flex h-10 w-10 items-center justify-center rounded-full text-slate-900 transition hover:bg-slate-100 sm:right-7" aria-label={locale === 'vi' ? 'Đóng' : 'Close'}>
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2 sm:px-7">
              <div className="grid gap-4">
                <label className="text-sm font-semibold text-slate-800">
                  {locale === 'vi' ? 'Tên dịch vụ' : 'Name'}
                  <HrmInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 min-h-14 rounded-2xl border-0 bg-white px-4 font-normal shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] ring-1 ring-slate-100" />
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  {locale === 'vi' ? 'Tên hiển thị' : 'Display name'}
                  <HrmInput maxLength={40} value={form.displayName ?? ''} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder={locale === 'vi' ? 'Tên ngắn dùng trong lịch' : 'Short calendar label'} className="mt-2 min-h-14 rounded-2xl border-0 bg-white px-4 font-normal shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] ring-1 ring-slate-100" />
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  {locale === 'vi' ? 'Danh mục' : 'Category'}
                  <select value={form.groupService} onChange={(event) => setForm({ ...form, groupService: event.target.value })} className="mt-2 min-h-14 w-full rounded-2xl border-0 bg-white px-4 text-base font-normal text-slate-950 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] outline-none ring-1 ring-slate-100 focus:ring-2 focus:ring-[var(--hrm-blue-100)] md:text-sm">
                    {groupedServices.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
                    {!groupedServices.some((group) => group.name === form.groupService) ? <option value={form.groupService}>{form.groupService}</option> : null}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="min-w-0 text-sm font-semibold text-slate-800">
                    {locale === 'vi' ? 'Thời lượng' : 'Duration'}
                    <div className="relative mt-2">
                      <HrmInput type="number" min={form.bookingKind === 'add_on' ? 0 : 1} step="5" value={form.duration} disabled={form.bookingKind === 'add_on'} onChange={(event) => setForm({ ...form, duration: Number(event.target.value) })} className="min-h-14 rounded-2xl border-0 bg-white px-4 pr-12 font-normal shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] ring-1 ring-slate-100 disabled:bg-slate-50" />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">{locale === 'vi' ? 'phút' : 'min'}</span>
                    </div>
                  </label>
                  <label className="min-w-0 text-sm font-semibold text-slate-800">
                    {locale === 'vi' ? 'Giá dịch vụ' : 'Price'}
                    <div className="relative mt-2">
                      <HrmInput type="number" min="0" step="0.5" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} className="min-h-14 rounded-2xl border-0 bg-white px-4 pr-9 font-normal shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] ring-1 ring-slate-100" />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400">€</span>
                    </div>
                  </label>
                </div>
                <label className="text-sm font-semibold text-slate-800">
                  {locale === 'vi' ? 'Loại thợ ưu tiên' : 'Preferred staff type'}
                  <select value={form.preferredWorkerType} disabled={form.bookingKind === 'add_on'} onChange={(event) => setForm({ ...form, preferredWorkerType: event.target.value as 'main' | 'assistant' })} className="mt-2 min-h-14 w-full rounded-2xl border-0 bg-white px-4 text-base font-normal text-slate-950 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] outline-none ring-1 ring-slate-100 focus:ring-2 focus:ring-[var(--hrm-blue-100)] disabled:bg-slate-50 md:text-sm">
                    <option value="main">{locale === 'vi' ? 'Thợ chính' : 'Main staff'}</option>
                    <option value="assistant">{locale === 'vi' ? 'Thợ phụ' : 'Assistant'}</option>
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  {locale === 'vi' ? 'Loại dịch vụ' : 'Booking type'}
                  <select value={form.bookingKind} onChange={(event) => {
                    const bookingKind = event.target.value as AdminServiceInput['bookingKind'];
                    setForm({ ...form, bookingKind, ...(bookingKind === 'add_on' && { duration: 1 }) });
                  }} className="mt-2 min-h-14 w-full rounded-2xl border-0 bg-white px-4 text-base font-normal text-slate-950 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] outline-none ring-1 ring-slate-100 focus:ring-2 focus:ring-[var(--hrm-blue-100)] md:text-sm">
                    <option value="main">{locale === 'vi' ? 'Dịch vụ chính' : 'Main service'}</option>
                    <option value="add_on">{locale === 'vi' ? 'Dịch vụ thêm (không chiếm lịch)' : 'Add-on (no calendar block)'}</option>
                  </select>
                </label>
                <div className="flex min-h-[72px] items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <span><strong className="block text-sm font-semibold text-slate-900">{locale === 'vi' ? 'Hiển thị trên booking' : 'Show on booking'}</strong><span className="mt-1 block text-xs font-medium text-slate-500">{locale === 'vi' ? 'Cho phép đặt online.' : 'Allow online booking.'}</span></span>
                  <button type="button" role="switch" aria-checked={form.availableForBooking !== false} onClick={() => setForm({ ...form, availableForBooking: form.availableForBooking === false })} className={`relative h-8 w-14 shrink-0 rounded-full transition ${form.availableForBooking !== false ? 'bg-[var(--hrm-blue-700)]' : 'bg-slate-300'}`}>
                    <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] ${form.availableForBooking !== false ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
                <label className="text-sm font-semibold text-slate-800">
                  {locale === 'vi' ? 'Mô tả' : 'Description'}
                  <textarea value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={locale === 'vi' ? 'Mô tả ngắn về dịch vụ' : 'Short service description'} className="mt-2 min-h-20 w-full resize-none rounded-2xl border-0 bg-white px-4 py-3 text-base font-normal text-slate-950 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)] outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[var(--hrm-blue-100)] md:text-sm" />
                </label>
              </div>
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
              <HrmButton disabled={busy || !form.name.trim()} onClick={() => void save()} className="min-h-14 w-full rounded-2xl px-4 text-base font-bold shadow-[0_10px_22px_rgba(37,99,235,0.2)]">
                {busy ? '...' : editingId ? (locale === 'vi' ? 'Cập nhật dịch vụ' : 'Update service') : (locale === 'vi' ? 'Tạo dịch vụ' : 'Create service')}
              </HrmButton>
              {editingId ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const service = items.find((item) => item.id === editingId);
                    if (!service) return;
                    void remove(service).then((removed) => {
                      if (removed) setOpen(false);
                    });
                  }}
                  className="mt-2 flex min-h-9 w-full items-center justify-center gap-2 text-sm font-semibold text-rose-500 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {locale === 'vi' ? 'Xóa dịch vụ' : 'Delete service'}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
