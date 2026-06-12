'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

// ===== Interfaces =====
interface CategoryData {
  id: string;
  name: string;
  nameLocalized?: { vi?: string; en?: string; de?: string };
  description: string;
  displayOrder: number;
  isActive: boolean;
  branchId: string;
  businessId?: string;
  conflictGroup?: 'gel' | 'acryl';
  requiresStaffAutoAssign?: boolean;
}

interface ServiceData {
  id: string;
  categoryId: string;
  name: string;
  nameLocalized?: { vi?: string; en?: string; de?: string };
  description: string;
  durationMinutes: number;
  price: number;
  currency: string;
  displayOrder: number;
  isActive: boolean;
  type: 'standard' | 'addon';
  staffType?: 'main' | 'junior' | 'any';
  branchId: string;
  businessId?: string;
  hasAppointments: boolean;
  createdAt: string;
}

type ModalMode = 'addCategory' | 'editCategory' | 'addService' | 'editService' | null;

interface Toast {
  message: string;
  type: 'success' | 'error';
}

// ===== Component =====
export default function ServicesManagementPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();

  // Data states
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [services, setServices] = useState<ServiceData[]>([]);
  const [loading, setLoading] = useState(true);

  // UI states
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Category form
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [catNameVi, setCatNameVi] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameDe, setCatNameDe] = useState('');
  const [catDescription, setCatDescription] = useState('');
  const [catDisplayOrder, setCatDisplayOrder] = useState(0);
  const [catIsActive, setCatIsActive] = useState(true);

  // Service form
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [svcCategoryId, setSvcCategoryId] = useState('');
  const [svcNameVi, setSvcNameVi] = useState('');
  const [svcNameEn, setSvcNameEn] = useState('');
  const [svcNameDe, setSvcNameDe] = useState('');
  const [svcDescription, setSvcDescription] = useState('');
  const [svcDuration, setSvcDuration] = useState(30);
  const [svcPrice, setSvcPrice] = useState(0);
  const [svcCurrency, setSvcCurrency] = useState('EUR');
  const [svcDisplayOrder, setSvcDisplayOrder] = useState(0);
  const [svcIsActive, setSvcIsActive] = useState(true);
  const [svcType, setSvcType] = useState<'standard' | 'addon'>('standard');
  const [svcStaffType, setSvcStaffType] = useState<'main' | 'junior' | 'any'>('any');

  const branchId = user?.assignedBranches?.[0] || '';
  const ts = t.admin.services;

  // ===== Helper: get localized name =====
  const getLocalizedName = (item: { name: string; nameLocalized?: { vi?: string; en?: string; de?: string } }) => {
    if (item.nameLocalized) {
      const localized = item.nameLocalized[locale as 'vi' | 'en' | 'de'];
      if (localized) return localized;
    }
    return item.name;
  };

  // ===== Toast helper =====
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ===== Firestore: Real-time sync categories =====
  useEffect(() => {
    if (!user || !branchId) return;
    if (user.role !== 'owner' && user.role !== 'manager') return;

    const catRef = collection(db, 'branches', branchId, 'categories');
    const catQuery = query(catRef, orderBy('displayOrder', 'asc'));

    const unsubscribe = onSnapshot(
      catQuery,
      (snap) => {
        const list: CategoryData[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as CategoryData);
        });
        setCategories(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to categories:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, branchId]);

  // ===== Firestore: Real-time sync services =====
  useEffect(() => {
    if (!user || !branchId) return;
    if (user.role !== 'owner' && user.role !== 'manager') return;

    const svcRef = collection(db, 'branches', branchId, 'services');
    const svcQuery = query(svcRef, orderBy('displayOrder', 'asc'));

    const unsubscribe = onSnapshot(
      svcQuery,
      (snap) => {
        const list: ServiceData[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as ServiceData);
        });
        setServices(list);
      },
      (err) => {
        console.error('Error listening to services:', err);
      }
    );

    return () => unsubscribe();
  }, [user, branchId]);

  // ===== Toggle accordion =====
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // ===== Reset category form =====
  const resetCategoryForm = () => {
    setEditingCategoryId(null);
    setCatNameVi('');
    setCatNameEn('');
    setCatNameDe('');
    setCatDescription('');
    setCatDisplayOrder(categories.length);
    setCatIsActive(true);
  };

  // ===== Reset service form =====
  const resetServiceForm = () => {
    setEditingServiceId(null);
    setSvcNameVi('');
    setSvcNameEn('');
    setSvcNameDe('');
    setSvcDescription('');
    setSvcDuration(30);
    setSvcPrice(0);
    setSvcCurrency('EUR');
    setSvcDisplayOrder(0);
    setSvcIsActive(true);
    setSvcType('standard');
    setSvcStaffType('any');
  };

  // ===== Open Add Category modal =====
  const handleAddCategory = () => {
    resetCategoryForm();
    setCatDisplayOrder(categories.length);
    setModalMode('addCategory');
  };

  // ===== Open Edit Category modal =====
  const handleEditCategory = (cat: CategoryData) => {
    setEditingCategoryId(cat.id);
    setCatNameVi(cat.nameLocalized?.vi || cat.name);
    setCatNameEn(cat.nameLocalized?.en || cat.name);
    setCatNameDe(cat.nameLocalized?.de || cat.name);
    setCatDescription(cat.description || '');
    setCatDisplayOrder(cat.displayOrder);
    setCatIsActive(cat.isActive);
    setModalMode('editCategory');
  };

  // ===== Save Category =====
  const handleSaveCategory = async () => {
    if (!branchId || (!catNameVi && !catNameEn && !catNameDe)) return;
    setSaving(true);

    try {
      const defaultName = catNameEn || catNameVi || catNameDe;
      const data: Record<string, unknown> = {
        name: defaultName,
        nameLocalized: { vi: catNameVi, en: catNameEn, de: catNameDe },
        description: catDescription,
        displayOrder: catDisplayOrder,
        isActive: catIsActive,
        branchId,
        businessId: user?.businessId || '',
      };

      if (modalMode === 'addCategory') {
        const newId = `cat-${Date.now()}`;
        const docRef = doc(db, 'branches', branchId, 'categories', newId);
        await setDoc(docRef, { id: newId, ...data });
      } else if (modalMode === 'editCategory' && editingCategoryId) {
        const docRef = doc(db, 'branches', branchId, 'categories', editingCategoryId);
        await updateDoc(docRef, data);
      }

      showToast(ts.saveSuccess, 'success');
      setModalMode(null);
    } catch (err) {
      console.error('Error saving category:', err);
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Delete Category (with batch to remove child services) =====
  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm(ts.confirmDeleteCategory)) return;

    try {
      const batch = writeBatch(db);

      // Delete all services in this category
      const svcRef = collection(db, 'branches', branchId, 'services');
      const q = query(svcRef, where('categoryId', '==', categoryId));
      const snap = await getDocs(q);
      snap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // Delete the category itself
      const catDocRef = doc(db, 'branches', branchId, 'categories', categoryId);
      batch.delete(catDocRef);

      await batch.commit();
      showToast(ts.deleteSuccess, 'success');
    } catch (err) {
      console.error('Error deleting category:', err);
      showToast(String(err), 'error');
    }
  };

  // ===== Open Add Service modal =====
  const handleAddService = (categoryId: string) => {
    resetServiceForm();
    setSvcCategoryId(categoryId);
    const catServices = services.filter((s) => s.categoryId === categoryId);
    setSvcDisplayOrder(catServices.length);
    setModalMode('addService');
  };

  // ===== Open Edit Service modal =====
  const handleEditService = (svc: ServiceData) => {
    setEditingServiceId(svc.id);
    setSvcCategoryId(svc.categoryId);
    setSvcNameVi(svc.nameLocalized?.vi || svc.name);
    setSvcNameEn(svc.nameLocalized?.en || svc.name);
    setSvcNameDe(svc.nameLocalized?.de || svc.name);
    setSvcDescription(svc.description || '');
    setSvcDuration(svc.durationMinutes);
    setSvcPrice(svc.price);
    setSvcCurrency(svc.currency || 'EUR');
    setSvcDisplayOrder(svc.displayOrder);
    setSvcIsActive(svc.isActive);
    setSvcType(svc.type);
    setSvcStaffType(svc.staffType || 'any');
    setModalMode('editService');
  };

  // ===== Save Service =====
  const handleSaveService = async () => {
    if (!branchId || !svcCategoryId || (!svcNameVi && !svcNameEn && !svcNameDe)) return;
    setSaving(true);

    try {
      const defaultName = svcNameEn || svcNameVi || svcNameDe;
      const data: Record<string, unknown> = {
        categoryId: svcCategoryId,
        name: defaultName,
        nameLocalized: { vi: svcNameVi, en: svcNameEn, de: svcNameDe },
        description: svcDescription,
        durationMinutes: svcDuration,
        price: svcPrice,
        currency: svcCurrency,
        displayOrder: svcDisplayOrder,
        isActive: svcIsActive,
        type: svcType,
        isAddon: svcType === 'addon',
        staffType: svcStaffType,
        branchId,
        businessId: user?.businessId || '',
      };

      if (modalMode === 'addService') {
        const newId = `svc-${Date.now()}`;
        const docRef = doc(db, 'branches', branchId, 'services', newId);
        await setDoc(docRef, {
          id: newId,
          ...data,
          hasAppointments: false,
          createdAt: new Date().toISOString(),
        });
      } else if (modalMode === 'editService' && editingServiceId) {
        const docRef = doc(db, 'branches', branchId, 'services', editingServiceId);
        await updateDoc(docRef, data);
      }

      showToast(ts.saveSuccess, 'success');
      setModalMode(null);
    } catch (err) {
      console.error('Error saving service:', err);
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Delete Service =====
  const handleDeleteService = async (serviceId: string) => {
    if (!confirm(ts.confirmDelete)) return;

    try {
      const docRef = doc(db, 'branches', branchId, 'services', serviceId);
      await deleteDoc(docRef);
      showToast(ts.deleteSuccess, 'success');
    } catch (err) {
      console.error('Error deleting service:', err);
      showToast(String(err), 'error');
    }
  };

  // ===== Helper: get services for a category =====
  const getServicesForCategory = (categoryId: string) =>
    services.filter((s) => s.categoryId === categoryId);

  // ===== Render staff type label =====
  const getStaffTypeLabel = (type?: string) => {
    switch (type) {
      case 'main':
        return ts.main;
      case 'junior':
        return ts.junior;
      default:
        return ts.any;
    }
  };

  // ===== Render service type label =====
  const getServiceTypeLabel = (type: string) => {
    return type === 'addon' ? ts.addon : ts.standard;
  };

  // ===== Guard: only owner/manager =====
  if (!user || (user.role !== 'owner' && user.role !== 'manager')) {
    return null;
  }

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{ts.title}</h1>
          <p className={styles.subtitle}>{ts.subtitle}</p>
        </div>
        <button className={styles.addCategoryBtn} onClick={handleAddCategory}>
          ➕ {ts.addCategory}
        </button>
      </div>

      {/* Categories List */}
      {loading ? (
        <div className={styles.emptyState}>
          <p>{t.common.loading}</p>
        </div>
      ) : categories.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{ts.noCategories}</p>
        </div>
      ) : (
        <div className={styles.categoryList}>
          {categories.map((cat) => {
            const isExpanded = expandedCategories.has(cat.id);
            const catServices = getServicesForCategory(cat.id);

            return (
              <div key={cat.id} className={styles.categoryAccordion}>
                {/* Category Header */}
                <div
                  className={styles.categoryHeader}
                  onClick={() => toggleCategory(cat.id)}
                >
                  <div className={styles.categoryHeaderLeft}>
                    <span
                      className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
                    >
                      ▶
                    </span>
                    <div className={styles.categoryInfo}>
                      <h3 className={styles.categoryName}>
                        {getLocalizedName(cat)}
                      </h3>
                      {cat.description && (
                        <p className={styles.categoryDesc}>{cat.description}</p>
                      )}
                    </div>
                  </div>

                  <div className={styles.categoryMeta}>
                    <span className={styles.orderBadge}>#{cat.displayOrder}</span>
                    <span
                      className={`${styles.statusPill} ${
                        cat.isActive ? styles.statusActive : styles.statusInactive
                      }`}
                    >
                      {cat.isActive ? ts.active : ts.inactive}
                    </span>
                    <span className={styles.orderBadge}>
                      {catServices.length} {catServices.length === 1 ? 'service' : 'services'}
                    </span>
                    <div
                      className={styles.categoryActions}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className={styles.iconBtn}
                        onClick={() => handleEditCategory(cat)}
                        title={ts.editCategory}
                      >
                        ✏️
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => handleDeleteCategory(cat.id)}
                        title={ts.deleteCategory}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>

                {/* Category Body (services) */}
                {isExpanded && (
                  <div className={styles.categoryBody}>
                    <div className={styles.serviceListHeader}>
                      <span className={styles.serviceListTitle}>
                        {ts.categories} › {getLocalizedName(cat)}
                      </span>
                      <button
                        className={styles.addServiceBtn}
                        onClick={() => handleAddService(cat.id)}
                      >
                        ＋ {ts.addService}
                      </button>
                    </div>

                    {catServices.length === 0 ? (
                      <div className={styles.emptyStateInline}>
                        {ts.noServices}
                      </div>
                    ) : (
                      <div className={styles.serviceGrid}>
                        {catServices.map((svc) => (
                          <div key={svc.id} className={styles.serviceCard}>
                            <div className={styles.serviceCardHeader}>
                              <div className={styles.serviceNameGroup}>
                                <h4 className={styles.serviceName}>
                                  {getLocalizedName(svc)}
                                </h4>
                                {svc.description && (
                                  <p className={styles.serviceDesc}>
                                    {svc.description}
                                  </p>
                                )}
                              </div>
                              <div className={styles.serviceCardActions}>
                                <span
                                  className={`${styles.statusPill} ${
                                    svc.isActive
                                      ? styles.statusActive
                                      : styles.statusInactive
                                  }`}
                                >
                                  {svc.isActive ? ts.active : ts.inactive}
                                </span>
                              </div>
                            </div>

                            <div className={styles.serviceCardBody}>
                              <span
                                className={`${styles.serviceBadge} ${styles.badgeDuration}`}
                              >
                                ⏱ {svc.durationMinutes} {ts.minutes}
                              </span>
                              <span
                                className={`${styles.serviceBadge} ${styles.badgePrice}`}
                              >
                                💰 {svc.price} {svc.currency}
                              </span>
                              <span
                                className={`${styles.serviceBadge} ${
                                  svc.type === 'addon'
                                    ? styles.badgeAddon
                                    : styles.badgeType
                                }`}
                              >
                                {getServiceTypeLabel(svc.type)}
                              </span>
                              <span
                                className={`${styles.serviceBadge} ${styles.badgeStaff}`}
                              >
                                👤 {getStaffTypeLabel(svc.staffType)}
                              </span>
                            </div>

                            <div
                              className={styles.serviceCardActions}
                              style={{ justifyContent: 'flex-end', gap: '6px' }}
                            >
                              <button
                                className={styles.iconBtn}
                                onClick={() => handleEditService(svc)}
                                title={ts.editService}
                              >
                                ✏️
                              </button>
                              <button
                                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                onClick={() => handleDeleteService(svc.id)}
                                title={ts.deleteService}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== CATEGORY MODAL ===== */}
      {(modalMode === 'addCategory' || modalMode === 'editCategory') && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {modalMode === 'addCategory' ? ts.addCategory : ts.editCategory}
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setModalMode(null)}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Multilingual name */}
              <div className={styles.multilingualSection}>
                <p className={styles.multilingualTitle}>
                  🌐 {ts.multilingualName}
                </p>
                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇻🇳</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameVi}
                    value={catNameVi}
                    onChange={(e) => setCatNameVi(e.target.value)}
                  />
                </div>
                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇬🇧</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameEn}
                    value={catNameEn}
                    onChange={(e) => setCatNameEn(e.target.value)}
                  />
                </div>
                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇩🇪</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameDe}
                    value={catNameDe}
                    onChange={(e) => setCatNameDe(e.target.value)}
                  />
                </div>
              </div>

              {/* Description */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{ts.categoryDescription}</label>
                <textarea
                  className={styles.formTextarea}
                  value={catDescription}
                  onChange={(e) => setCatDescription(e.target.value)}
                />
              </div>

              {/* Display Order + Active */}
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.displayOrder}</label>
                  <input
                    type="number"
                    className={styles.formInput}
                    value={catDisplayOrder}
                    onChange={(e) => setCatDisplayOrder(Number(e.target.value))}
                    min={0}
                  />
                </div>
                <div className={styles.formGroup}>
                  <div className={styles.toggleRow}>
                    <span className={styles.toggleLabel}>
                      {catIsActive ? ts.active : ts.inactive}
                    </span>
                    <label className={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        checked={catIsActive}
                        onChange={(e) => setCatIsActive(e.target.checked)}
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <button
                className={styles.submitBtn}
                onClick={handleSaveCategory}
                disabled={saving}
              >
                {saving ? t.common.loading : t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== SERVICE MODAL ===== */}
      {(modalMode === 'addService' || modalMode === 'editService') && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {modalMode === 'addService' ? ts.addService : ts.editService}
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setModalMode(null)}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Multilingual name */}
              <div className={styles.multilingualSection}>
                <p className={styles.multilingualTitle}>
                  🌐 {ts.multilingualName}
                </p>
                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇻🇳</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameVi}
                    value={svcNameVi}
                    onChange={(e) => setSvcNameVi(e.target.value)}
                  />
                </div>
                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇬🇧</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameEn}
                    value={svcNameEn}
                    onChange={(e) => setSvcNameEn(e.target.value)}
                  />
                </div>
                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇩🇪</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameDe}
                    value={svcNameDe}
                    onChange={(e) => setSvcNameDe(e.target.value)}
                  />
                </div>
              </div>

              {/* Description */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{ts.serviceDescription}</label>
                <textarea
                  className={styles.formTextarea}
                  value={svcDescription}
                  onChange={(e) => setSvcDescription(e.target.value)}
                />
              </div>

              {/* Duration + Price */}
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.duration}</label>
                  <input
                    type="number"
                    className={styles.formInput}
                    value={svcDuration}
                    onChange={(e) => setSvcDuration(Number(e.target.value))}
                    min={5}
                    step={5}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.price}</label>
                  <input
                    type="number"
                    className={styles.formInput}
                    value={svcPrice}
                    onChange={(e) => setSvcPrice(Number(e.target.value))}
                    min={0}
                    step={0.5}
                  />
                </div>
              </div>

              {/* Currency + Display Order */}
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.currency}</label>
                  <select
                    className={styles.formSelect}
                    value={svcCurrency}
                    onChange={(e) => setSvcCurrency(e.target.value)}
                  >
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                    <option value="VND">VND (₫)</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.displayOrder}</label>
                  <input
                    type="number"
                    className={styles.formInput}
                    value={svcDisplayOrder}
                    onChange={(e) => setSvcDisplayOrder(Number(e.target.value))}
                    min={0}
                  />
                </div>
              </div>

              {/* Type + Staff Type */}
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.type}</label>
                  <select
                    className={styles.formSelect}
                    value={svcType}
                    onChange={(e) => setSvcType(e.target.value as 'standard' | 'addon')}
                  >
                    <option value="standard">{ts.standard}</option>
                    <option value="addon">{ts.addon}</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.staffType}</label>
                  <select
                    className={styles.formSelect}
                    value={svcStaffType}
                    onChange={(e) =>
                      setSvcStaffType(e.target.value as 'main' | 'junior' | 'any')
                    }
                  >
                    <option value="any">{ts.any}</option>
                    <option value="main">{ts.main}</option>
                    <option value="junior">{ts.junior}</option>
                  </select>
                </div>
              </div>

              {/* Active toggle */}
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>
                  {svcIsActive ? ts.active : ts.inactive}
                </span>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={svcIsActive}
                    onChange={(e) => setSvcIsActive(e.target.checked)}
                  />
                  <span className={styles.toggleTrack} />
                </label>
              </div>

              {/* Submit */}
              <button
                className={styles.submitBtn}
                onClick={handleSaveService}
                disabled={saving}
              >
                {saving ? t.common.loading : t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.type === 'success' ? styles.toastSuccess : styles.toastError
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
