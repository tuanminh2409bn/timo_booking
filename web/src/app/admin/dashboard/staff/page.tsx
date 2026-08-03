'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, UserRound, Wrench, X } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createAdminEmployee,
  fetchAdminEmployees,
  updateAdminEmployee,
  type AdminEmployee,
  type AdminEmployeeInput,
} from '@/lib/adminHrmApi';
import { fetchHrmServices, type HrmService } from '@/lib/hrmApi';

const emptyForm: AdminEmployeeInput = {
  name: '',
  email: '',
  password: '',
  phone: '',
  workerType: 'main',
  compensationModel: 'commission',
  ownerCommissionRate: 50,
  serviceIds: [],
};

export default function StaffManagementPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [services, setServices] = useState<HrmService[]>([]);
  const [form, setForm] = useState<AdminEmployeeInput>(emptyForm);
  const [open, setOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<AdminEmployee>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    const [employeeItems, serviceItems] = await Promise.all([
      fetchAdminEmployees(storeId),
      fetchHrmServices(storeId),
    ]);
    setEmployees(employeeItems);
    setServices(serviceItems);
  }, [storeId]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    void load().catch((error: unknown) => console.error(error));
  }, [user, load]);

  if (user?.role !== 'owner') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        {locale === 'vi'
          ? 'Chỉ chủ tiệm được tạo và thay đổi tài khoản thợ.'
          : locale === 'de'
            ? 'Nur der Inhaber kann Mitarbeiterkonten verwalten.'
            : 'Only the owner may manage employee accounts.'}
      </div>
    );
  }

  const save = async () => {
    if (!storeId || !form.name.trim() || (!editingEmployee && (!form.email.trim() || form.password.length < 6))) return;
    setBusy(true);
    try {
      if (editingEmployee) {
        await updateAdminEmployee(storeId, editingEmployee.id, {
          workerType: form.workerType,
          serviceIds: form.serviceIds,
        });
      } else {
        await createAdminEmployee(storeId, {
          ...form,
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone?.trim() || undefined,
        });
      }
      setOpen(false);
      setEditingEmployee(undefined);
      setForm(emptyForm);
      await load();
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not create employee');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (employee: AdminEmployee) => {
    if (!storeId) return;
    setBusy(true);
    try {
      await updateAdminEmployee(storeId, employee.id, { active: !employee.active });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">
            {locale === 'vi' ? 'Nhân sự' : locale === 'de' ? 'Mitarbeiter' : 'Staff'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {locale === 'vi'
              ? 'Tạo tài khoản thợ chính, thợ phụ trực tiếp trên Firebase hiện tại.'
              : 'Create main and assistant employee accounts in the current Firebase.'}
          </p>
        </div>
        <button onClick={() => { setEditingEmployee(undefined); setForm(emptyForm); setOpen(true); }} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{locale === 'vi' ? 'Thêm thợ' : 'Add staff'}</span>
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {employees.map((employee) => (
          <article key={employee.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${employee.active ? 'border-gray-100' : 'border-gray-200 opacity-65'}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                {employee.workerType === 'assistant' ? <Wrench className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-gray-950">{employee.name}</h2>
                <p className="text-sm text-gray-500">
                  {employee.workerType === 'assistant'
                    ? (locale === 'vi' ? 'Thợ phụ' : 'Assistant')
                    : (locale === 'vi' ? 'Thợ chính' : 'Main staff')}
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => void toggleActive(employee)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${employee.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}
              >
                {employee.active
                  ? (locale === 'vi' ? 'Đang làm' : 'Active')
                  : (locale === 'vi' ? 'Đã nghỉ' : 'Inactive')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingEmployee(employee);
                  setForm({
                    ...emptyForm,
                    name: employee.name,
                    workerType: employee.workerType ?? 'main',
                    compensationModel: employee.compensationModel ?? (employee.workerType === 'assistant' ? 'fixed' : 'commission'),
                    ownerCommissionRate: employee.ownerCommissionRate ?? 50,
                    hourlyRate: employee.hourlyRate,
                    fixedSalary: employee.fixedSalary ?? 0,
                    serviceIds: employee.serviceIds ?? [],
                  });
                  setOpen(true);
                }}
                className="rounded-full bg-gray-100 p-2 text-gray-600"
                aria-label="Edit employee"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-[28px]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editingEmployee ? (locale === 'vi' ? 'Sửa thợ' : 'Edit employee') : (locale === 'vi' ? 'Tạo tài khoản thợ' : 'Create employee account')}</h2>
              <button onClick={() => { setOpen(false); setEditingEmployee(undefined); }} className="rounded-full bg-gray-100 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Họ tên' : 'Name'}
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
              </label>
              {!editingEmployee && <label className="text-sm font-semibold text-gray-700">
                Email
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
              </label>}
              {!editingEmployee && <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Mật khẩu ban đầu' : 'Initial password'}
                <input type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
              </label>}
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Loại thợ' : 'Staff type'}
                <select value={form.workerType} onChange={(event) => {
                  const workerType = event.target.value as 'main' | 'assistant';
                  setForm({
                    ...form,
                    workerType,
                    compensationModel: workerType === 'assistant' ? 'fixed' : 'commission',
                    ...(workerType === 'assistant' && { fixedSalary: form.fixedSalary ?? 0 }),
                  });
                }} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal">
                  <option value="main">{locale === 'vi' ? 'Thợ chính' : 'Main staff'}</option>
                  <option value="assistant">{locale === 'vi' ? 'Thợ phụ' : 'Assistant'}</option>
                </select>
              </label>
              {!editingEmployee && form.workerType === 'assistant' && (
                <label className="text-sm font-semibold text-gray-700">
                  {locale === 'vi' ? 'Lương cố định' : 'Fixed salary'}
                  <input type="number" min="0" value={form.fixedSalary ?? 0} onChange={(event) => setForm({ ...form, fixedSalary: Number(event.target.value) })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
                </label>
              )}
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-semibold text-gray-700">
                  {locale === 'vi' ? 'Dịch vụ có thể làm' : 'Services this employee can perform'}
                </legend>
                <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-gray-200 p-3 sm:grid-cols-2">
                  {services.map((service) => (
                    <label key={service.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.serviceIds?.includes(service.id) ?? false}
                        onChange={(event) => setForm({
                          ...form,
                          serviceIds: event.target.checked
                            ? [...(form.serviceIds ?? []), service.id]
                            : (form.serviceIds ?? []).filter((id) => id !== service.id),
                        })}
                      />
                      {service.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <button disabled={busy || !form.name.trim() || (!editingEmployee && (!form.email.trim() || form.password.length < 6))} onClick={() => void save()} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy ? '...' : editingEmployee ? (locale === 'vi' ? 'Lưu thay đổi' : 'Save changes') : (locale === 'vi' ? 'Tạo tài khoản' : 'Create account')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
