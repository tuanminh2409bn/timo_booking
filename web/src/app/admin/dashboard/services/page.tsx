'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Clock, 
  User, 
  Globe, 
  X, 
  ArrowLeft, 
  ChevronRight, 
  Folder, 
  FileText, 
  Info, 
  Tag,
  Coins
} from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { autoLocalizeName } from '@/lib/i18n/serviceTranslations';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
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
  isAddon?: boolean;
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

// ===== Category Custom SVG Icons =====
const CategoryIcon = ({ id, className = "w-5 h-5" }: { id: string; className?: string }) => {
  switch (id) {
    case 'cat-gel':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2h4v7h-4z" />
          <path d="M6 9h12a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8a2 2 0 0 1 2-2z" />
          <circle cx="12" cy="15" r="1.5" />
        </svg>
      );
    case 'cat-auffuellen-gel':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 3L6 15v6h6L21 9z" />
          <path d="M16 5l3 3" />
          <path d="M9 12l3 3" />
        </svg>
      );
    case 'cat-acryl':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h12v4H6z" />
          <rect x="4" y="7" width="16" height="14" rx="2" />
          <path d="M9 13h6" />
        </svg>
      );
    case 'cat-auffuellen-acryl':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9z" />
          <path d="M18 4l-7 8" />
        </svg>
      );
    case 'cat-zehen':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16c0-1.5 1-2.5 2-3s2-.5 2 1.5v3c0 .5-.5 1.5-2 1.5s-2-1.5-2-3zM8 11.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
          <path d="M14 14c0-1.5 1-2.5 2-3s2-.5 2 1.5v3c0 .5-.5 1.5-2 1.5s-2-1.5-2-3zM18 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
        </svg>
      );
    case 'cat-mani':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8V5a3 3 0 0 0-6 0v3h-1V3.5a2.5 2.5 0 0 0-5 0V11H5v3c0 4.4 3.6 8 8 8h3a6 6 0 0 0 6-6v-6h-4z" />
        </svg>
      );
    case 'cat-pedi':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 13.5c1-1.5 2.5-2.5 4-2.5s2 1 2 3v3.5c0 1.5-1 2.5-3 2.5s-3-2-3-6.5zM11.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
        </svg>
      );
    case 'cat-wimpern':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 10a14 14 0 0 0 20 0" />
          <path d="M5 11.5l-1.5 2.5" />
          <path d="M9 12.2l-1 3" />
          <path d="M12 12.5v3.5" />
          <path d="M15 12.2l1 3" />
          <path d="M19 11.5l1.5 2.5" />
        </svg>
      );
    case 'cat-abloesung':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M20 4L8.12 15.88" />
          <path d="M14.47 14.48L20 20" />
          <path d="M8.12 8.12L12 12" />
        </svg>
      );
    case 'cat-zusatz':
    case 'cat-addon':
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
  }
};

// ===== Color Themes for Category Borders/Icons =====
const getCategoryColorTheme = (id: string) => {
  switch (id) {
    case 'cat-gel':
      return { border: '#3B82F6', text: '#1D4ED8', bg: '#EFF6FF', circleBg: '#DBEAFE', borderLeft: '#1D4ED8' };
    case 'cat-auffuellen-gel':
      return { border: '#8B5CF6', text: '#6D28D9', bg: '#F5F3FF', circleBg: '#EDE9FE', borderLeft: '#6D28D9' };
    case 'cat-acryl':
      return { border: '#10B981', text: '#059669', bg: '#ECFDF5', circleBg: '#D1FAE5', borderLeft: '#059669' };
    case 'cat-auffuellen-acryl':
      return { border: '#F59E0B', text: '#D97706', bg: '#FEF3C7', circleBg: '#FDE68A', borderLeft: '#D97706' };
    case 'cat-zehen':
      return { border: '#EC4899', text: '#EC4899', bg: '#FDF2F8', circleBg: '#FCE7F3', borderLeft: '#EC4899' };
    case 'cat-mani':
      return { border: '#14B8A6', text: '#0D9488', bg: '#F0FDFA', circleBg: '#CCFBF1', borderLeft: '#0D9488' };
    case 'cat-pedi':
      return { border: '#0284C7', text: '#0284C7', bg: '#F0F9FF', circleBg: '#E0F2FE', borderLeft: '#0284C7' };
    case 'cat-wimpern':
      return { border: '#D946EF', text: '#7C3AED', bg: '#FDF4FF', circleBg: '#F3E8FF', borderLeft: '#7C3AED' };
    case 'cat-abloesung':
      return { border: '#EF4444', text: '#EF4444', bg: '#FEF2F2', circleBg: '#FEE2E2', borderLeft: '#EF4444' };
    case 'cat-zusatz':
    case 'cat-addon':
    default:
      return { border: '#F59E0B', text: '#D97706', bg: '#FEF3C7', circleBg: '#FEF3C7', borderLeft: '#F59E0B' };
  }
};

const getCurrencySymbol = (currencyCode: string) => {
  switch (currencyCode) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    case 'VND': return 'đ';
    default: return currencyCode;
  }
};

// ===== Main Component =====
export default function ServicesManagementPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();

  // Data states
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [services, setServices] = useState<ServiceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchCurrency, setBranchCurrency] = useState('EUR');

  // Navigation State
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  // UI states
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

  const isPredefinedService = (id: string) => id.startsWith('svc-');
  const isPredefinedCategory = (id: string) => id.startsWith('cat-');

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

  // ===== Fetch Branch Config (for Currency) =====
  useEffect(() => {
    if (!branchId) return;
    const docRef = doc(db, 'branches', branchId);
    getDoc(docRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.currency) {
          setBranchCurrency(data.currency);
          setSvcCurrency(data.currency);
        }
      }
    }).catch(err => console.error('Error fetching branch settings:', err));
  }, [branchId]);

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
    setSvcCurrency(branchCurrency);
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

  // ===== Auto-localize Category name on blur =====
  const handleCategoryNameBlur = (lang: 'vi' | 'en' | 'de') => {
    const currentVal = lang === 'vi' ? catNameVi : lang === 'en' ? catNameEn : catNameDe;
    if (!currentVal.trim()) return;

    if (!catNameVi.trim() || !catNameEn.trim() || !catNameDe.trim()) {
      const autoFilled = autoLocalizeName(currentVal);
      if (!catNameVi.trim()) setCatNameVi(autoFilled.vi);
      if (!catNameEn.trim()) setCatNameEn(autoFilled.en);
      if (!catNameDe.trim()) setCatNameDe(autoFilled.de);
    }
  };

  // ===== Auto-localize Service name on blur =====
  const handleServiceNameBlur = (lang: 'vi' | 'en' | 'de') => {
    const currentVal = lang === 'vi' ? svcNameVi : lang === 'en' ? svcNameEn : svcNameDe;
    if (!currentVal.trim()) return;

    if (!svcNameVi.trim() || !svcNameEn.trim() || !svcNameDe.trim()) {
      const autoFilled = autoLocalizeName(currentVal);
      if (!svcNameVi.trim()) setSvcNameVi(autoFilled.vi);
      if (!svcNameEn.trim()) setSvcNameEn(autoFilled.en);
      if (!svcNameDe.trim()) setSvcNameDe(autoFilled.de);
    }
  };

  // ===== Save Category =====
  const handleSaveCategory = async () => {
    if (!branchId || (!catNameVi && !catNameEn && !catNameDe)) return;
    setSaving(true);

    try {
      const enteredName = catNameDe || catNameEn || catNameVi;
      const autoFilled = autoLocalizeName(enteredName);
      const finalVi = catNameVi.trim() || autoFilled.vi;
      const finalEn = catNameEn.trim() || autoFilled.en;
      const finalDe = catNameDe.trim() || autoFilled.de;
      const defaultName = finalDe || finalEn || finalVi;

      const data: Record<string, unknown> = {
        name: defaultName,
        nameLocalized: { vi: finalVi, en: finalEn, de: finalDe },
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
      setModalMode(null);
      setActiveCategoryId(null);
    } catch (err) {
      console.error('Error deleting category:', err);
      showToast(String(err), 'error');
    }
  };

  // ===== Open Add Service modal =====
  const handleAddService = (categoryId: string) => {
    resetServiceForm();
    setSvcCategoryId(categoryId);
    if (categoryId === 'cat-zusatz') {
      setSvcType('addon');
    }
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
    setSvcCurrency(svc.currency || branchCurrency);
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
      const enteredName = svcNameDe || svcNameEn || svcNameVi;
      const autoFilled = autoLocalizeName(enteredName);
      const finalVi = svcNameVi.trim() || autoFilled.vi;
      const finalEn = svcNameEn.trim() || autoFilled.en;
      const finalDe = svcNameDe.trim() || autoFilled.de;
      const defaultName = finalDe || finalEn || finalVi;

      const data: Record<string, unknown> = {
        categoryId: svcCategoryId,
        name: defaultName,
        nameLocalized: { vi: finalVi, en: finalEn, de: finalDe },
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
      setModalMode(null);
    } catch (err) {
      console.error('Error deleting service:', err);
      showToast(String(err), 'error');
    }
  };

  // ===== Sync Multilingual Data for all existing categories & services =====
  const handleSyncAllData = async () => {
    if (!branchId) return;
    if (!confirm(ts.syncConfirm)) return;

    setSaving(true);
    try {
      const batch = writeBatch(db);
      let updatedCount = 0;

      const catRef = collection(db, 'branches', branchId, 'categories');
      const catSnap = await getDocs(catRef);
      
      catSnap.forEach((docSnap) => {
        const cat = docSnap.data() as CategoryData;
        const currentVi = cat.nameLocalized?.vi || '';
        const currentEn = cat.nameLocalized?.en || '';
        const currentDe = cat.nameLocalized?.de || '';

        if (!currentVi || !currentEn || !currentDe) {
          const nameToUse = currentDe || currentEn || currentVi || cat.name || '';
          if (nameToUse) {
            const autoFilled = autoLocalizeName(nameToUse);
            const finalVi = currentVi.trim() || autoFilled.vi;
            const finalEn = currentEn.trim() || autoFilled.en;
            const finalDe = currentDe.trim() || autoFilled.de;
            const defaultName = finalDe || finalEn || finalVi;

            batch.update(docSnap.ref, {
              name: defaultName,
              nameLocalized: { vi: finalVi, en: finalEn, de: finalDe }
            });
            updatedCount++;
          }
        }
      });

      const svcRef = collection(db, 'branches', branchId, 'services');
      const svcSnap = await getDocs(svcRef);

      svcSnap.forEach((docSnap) => {
        const svc = docSnap.data() as ServiceData;
        const currentVi = svc.nameLocalized?.vi || '';
        const currentEn = svc.nameLocalized?.en || '';
        const currentDe = svc.nameLocalized?.de || '';

        if (!currentVi || !currentEn || !currentDe) {
          const nameToUse = currentDe || currentEn || currentVi || svc.name || '';
          if (nameToUse) {
            const autoFilled = autoLocalizeName(nameToUse);
            const finalVi = currentVi.trim() || autoFilled.vi;
            const finalEn = currentEn.trim() || autoFilled.en;
            const finalDe = currentDe.trim() || autoFilled.de;
            const defaultName = finalDe || finalEn || finalVi;

            batch.update(docSnap.ref, {
              name: defaultName,
              nameLocalized: { vi: finalVi, en: finalEn, de: finalDe }
            });
            updatedCount++;
          }
        }
      });

      if (updatedCount > 0) {
        await batch.commit();
        showToast(`${ts.syncSuccess} (${updatedCount})`, 'success');
      } else {
        showToast(ts.syncSuccess, 'success');
      }
    } catch (err) {
      console.error('Error syncing multilingual data:', err);
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Helper: get services for a category =====
  const getServicesForCategory = (categoryId: string) =>
    services.filter((s) => s.categoryId === categoryId);

  // ===== Guard: only owner/manager =====
  if (!user || (user.role !== 'owner' && user.role !== 'manager')) {
    return null;
  }

  const activeCat = activeCategoryId ? categories.find(c => c.id === activeCategoryId) : null;
  const catServices = activeCategoryId ? getServicesForCategory(activeCategoryId) : [];

  return (
    <div className={styles.container}>
      {/* =======================================================
          VIEW 1: CATEGORY LIST SCREEN (activeCategoryId === null)
         ======================================================= */}
      {activeCategoryId === null && (
        <>
          {/* Header */}
          <div className={styles.pageHeader}>
            <div className={styles.headerLeft}>
              <button 
                className={styles.backBtn}
                onClick={() => router.push('/admin/dashboard/')}
                title={locale === 'vi' ? 'Quay lại' : 'Back'}
              >
                <ArrowLeft className="w-5 h-5 text-gray-700" />
              </button>
            </div>
            <h1 className={styles.headerTitleCentered}>
              {locale === 'vi' ? 'Dịch vụ' : locale === 'de' ? 'Dienste' : 'Services'}
            </h1>
            <div className={styles.headerRight}>
              <button className={styles.addCategoryBtn} onClick={handleAddCategory}>
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* List of categories */}
          {loading ? (
            <div className={styles.emptyState}>
              <p>{t.common.loading}</p>
            </div>
          ) : categories.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{ts.noCategories}</p>
            </div>
          ) : (
            <>
              <div className={styles.categoryGridList}>
                {categories.map((cat) => {
                  const theme = getCategoryColorTheme(cat.id);
                  const count = getServicesForCategory(cat.id).length;

                  return (
                    <div 
                      key={cat.id} 
                      className={styles.categoryCardItem}
                      onClick={() => setActiveCategoryId(cat.id)}
                      style={{ borderLeftColor: theme.borderLeft }}
                    >
                      <div className={styles.categoryCardLeft}>
                        <div 
                          className={styles.iconCircle}
                          style={{ 
                            backgroundColor: theme.circleBg, 
                            color: theme.text,
                            borderColor: theme.border
                          }}
                        >
                          <CategoryIcon id={cat.id} />
                        </div>
                        <div className={styles.categoryTextInfo}>
                          <h3 className={styles.categoryNameText}>{getLocalizedName(cat)}</h3>
                          <p className={styles.categoryCountText}>
                            {count} {locale === 'vi' ? 'dịch vụ' : count === 1 ? 'service' : 'services'}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>

              {/* Sync translations button at the bottom of categories list */}
              <div className={styles.syncBtnContainer}>
                <button className={styles.syncBtn} onClick={handleSyncAllData} disabled={saving}>
                  <Globe className="w-4 h-4" />
                  <span>{ts.syncMultilingual}</span>
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* =======================================================
          VIEW 2: CATEGORY SERVICES DETAILS (activeCategoryId !== null)
         ======================================================= */}
      {activeCategoryId !== null && activeCat && (
        <>
          {/* Header */}
          <div className={styles.pageHeader}>
            <div className={styles.headerLeft}>
              <button 
                className={styles.backBtn}
                onClick={() => setActiveCategoryId(null)}
                title={locale === 'vi' ? 'Quay lại' : 'Back'}
              >
                <ArrowLeft className="w-5 h-5 text-gray-700" />
              </button>
            </div>
            <h1 className={styles.headerTitleCentered}>
              {getLocalizedName(activeCat)}
            </h1>
            <div className={styles.headerRight}>
              <button 
                className={styles.addCategoryBtn} 
                onClick={() => handleAddService(activeCat.id)}
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Category Summary Header Card */}
          {(() => {
            const theme = getCategoryColorTheme(activeCat.id);
            return (
              <div 
                className={styles.categoryDetailCard}
                onClick={() => handleEditCategory(activeCat)}
                style={{ borderLeftColor: theme.borderLeft }}
              >
                <div className={styles.categoryCardLeft}>
                  <div 
                    className={styles.iconCircle}
                    style={{ 
                      backgroundColor: theme.circleBg, 
                      color: theme.text,
                      borderColor: theme.border
                    }}
                  >
                    <CategoryIcon id={activeCat.id} />
                  </div>
                  <div className={styles.categoryTextInfo}>
                    <h3 className={styles.categoryNameText}>{getLocalizedName(activeCat)}</h3>
                    <p className={styles.categoryCountText}>
                      {catServices.length} {locale === 'vi' ? 'dịch vụ' : catServices.length === 1 ? 'service' : 'services'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </div>
            );
          })()}

          {/* List of Services */}
          {catServices.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{ts.noServices}</p>
            </div>
          ) : (
            <div className={styles.serviceDetailGrid}>
              {catServices.map((svc) => {
                const isAddon = svc.type === 'addon' || svc.isAddon;
                return (
                  <div 
                    key={svc.id} 
                    className={styles.serviceDetailCardItem}
                    onClick={() => handleEditService(svc)}
                  >
                    <div className={styles.serviceTextGroup}>
                      <h4 className={styles.serviceNameBold}>{getLocalizedName(svc)}</h4>
                      <div className={styles.serviceDurationWrap}>
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span>
                          {isAddon ? '+' : ''}{svc.durationMinutes} {ts.minutes}
                        </span>
                      </div>
                    </div>
                    <div className={styles.serviceCardRight}>
                      <span className={styles.servicePriceBlue}>
                        {svc.price}{getCurrencySymbol(svc.currency || branchCurrency)}
                      </span>
                      <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* =======================================================
          DRAWER: ADD / EDIT CATEGORY
         ======================================================= */}
      {(modalMode === 'addCategory' || modalMode === 'editCategory') && (
        <div className={styles.drawerOverlay} onClick={() => setModalMode(null)}>
          <div className={styles.drawerContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>
                {modalMode === 'addCategory' ? ts.addCategory : ts.editCategory}
              </h2>
              <button 
                type="button" 
                className={styles.drawerCloseBtn}
                onClick={() => setModalMode(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={styles.drawerBody}>
              {/* Multilingual names */}
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
                    onBlur={() => handleCategoryNameBlur('vi')}
                    disabled={saving || (modalMode === 'editCategory' && isPredefinedCategory(editingCategoryId || ''))}
                  />
                </div>

                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇬🇧</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameEn}
                    value={catNameEn}
                    onChange={(e) => setCatNameEn(e.target.value)}
                    onBlur={() => handleCategoryNameBlur('en')}
                    disabled={saving || (modalMode === 'editCategory' && isPredefinedCategory(editingCategoryId || ''))}
                  />
                </div>

                <div className={styles.langRow}>
                  <span className={styles.langFlag}>🇩🇪</span>
                  <input
                    className={styles.langInput}
                    placeholder={ts.nameDe}
                    value={catNameDe}
                    onChange={(e) => setCatNameDe(e.target.value)}
                    onBlur={() => handleCategoryNameBlur('de')}
                    disabled={saving || (modalMode === 'editCategory' && isPredefinedCategory(editingCategoryId || ''))}
                  />
                </div>
              </div>

              {/* Warning if predefined category */}
              {modalMode === 'editCategory' && isPredefinedCategory(editingCategoryId || '') && (
                <div className={styles.infoBanner}>
                  <Info className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <p className={styles.infoBannerText}>
                    {locale === 'vi' 
                      ? 'Đây là danh mục tiêu chuẩn của hệ thống, chỉ hỗ trợ bật/tắt hoạt động và sắp xếp thứ tự hiển thị.'
                      : locale === 'de'
                      ? 'Dies ist eine Standardkategorie des Systems, Name und Beschreibung können nicht geändert werden.'
                      : 'This is a standard system category. Localized names cannot be modified.'}
                  </p>
                </div>
              )}

              {/* Description */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{ts.categoryDescription}</label>
                <div className={styles.inputWrapperArea}>
                  <div className={`${styles.inputIconPrefixArea} ${styles.prefixGreen}`}>
                    <FileText className="w-4 h-4" />
                  </div>
                  <textarea
                    className={styles.inputFieldArea}
                    value={catDescription}
                    onChange={(e) => setCatDescription(e.target.value)}
                    disabled={saving || (modalMode === 'editCategory' && isPredefinedCategory(editingCategoryId || ''))}
                  />
                </div>
              </div>

              {/* Display Order + Active Toggle */}
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.displayOrder}</label>
                  <input
                    type="number"
                    className={styles.formInputOnly}
                    value={catDisplayOrder}
                    onChange={(e) => setCatDisplayOrder(Number(e.target.value))}
                    min={0}
                    disabled={saving}
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.active}</label>
                  <div className={styles.toggleRow}>
                    <label className={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        checked={catIsActive}
                        onChange={(e) => setCatIsActive(e.target.checked)}
                        disabled={saving}
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <button
                className={styles.submitBtnBlue}
                onClick={handleSaveCategory}
                disabled={saving}
              >
                {saving ? t.common.loading : t.common.save}
              </button>

              {/* Delete button (only for custom categories) */}
              {modalMode === 'editCategory' && !isPredefinedCategory(editingCategoryId || '') && (
                <button
                  type="button"
                  className={styles.deleteLinkBtn}
                  onClick={() => handleDeleteCategory(editingCategoryId!)}
                  disabled={saving}
                >
                  {locale === 'vi' ? 'Xoá danh mục' : locale === 'de' ? 'Kategorie löschen' : 'Delete Category'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          DRAWER: ADD / EDIT SERVICE
         ======================================================= */}
      {(modalMode === 'addService' || modalMode === 'editService') && (
        <div className={styles.drawerOverlay} onClick={() => setModalMode(null)}>
          <div className={styles.drawerContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>
                {modalMode === 'addService' 
                  ? ts.addService 
                  : ts.editService
                }
              </h2>
              <button 
                type="button" 
                className={styles.drawerCloseBtn}
                onClick={() => setModalMode(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={styles.drawerBody}>
              {/* FULL EDIT FORM FOR ALL SERVICES (predefined + custom) */}
                <>
                  {/* Service Name */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>{ts.serviceName}</label>
                    <div className={styles.inputWrapper}>
                      <div className={`${styles.inputIconPrefix} ${styles.prefixBlue}`}>
                        <Tag className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        className={styles.inputField}
                        placeholder="Ví dụ: Nail art theo yêu cầu"
                        value={svcNameVi}
                        onChange={(e) => {
                          setSvcNameVi(e.target.value);
                          setSvcNameEn(e.target.value);
                          setSvcNameDe(e.target.value);
                        }}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  {/* Category Dropdown Selection (only in ADD mode) */}
                  {modalMode === 'addService' && (
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.categories}</label>
                      <div className={styles.inputWrapper}>
                        <div className={`${styles.inputIconPrefix} ${styles.prefixOrange}`}>
                          <Folder className="w-4 h-4" />
                        </div>
                        <select
                          className={styles.selectField}
                          value={svcCategoryId}
                          onChange={(e) => setSvcCategoryId(e.target.value)}
                          disabled={saving}
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {getLocalizedName(c)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Duration Selector dropdown */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>{ts.duration}</label>
                    <div className={styles.inputWrapper}>
                      <div className={`${styles.inputIconPrefix} ${styles.prefixBlue}`}>
                        <Clock className="w-4 h-4" />
                      </div>
                      <select
                        className={styles.selectField}
                        value={svcDuration}
                        onChange={(e) => setSvcDuration(Number(e.target.value))}
                        disabled={saving}
                      >
                        <option value={15}>15 {ts.minutes}</option>
                        <option value={20}>20 {ts.minutes}</option>
                        <option value={30}>30 {ts.minutes}</option>
                        <option value={40}>40 {ts.minutes}</option>
                        <option value={45}>45 {ts.minutes}</option>
                        <option value={60}>60 {ts.minutes}</option>
                        <option value={75}>75 {ts.minutes}</option>
                        <option value={90}>90 {ts.minutes}</option>
                        <option value={120}>120 {ts.minutes}</option>
                      </select>
                    </div>
                  </div>

                  {/* Service Price & Currency */}
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.price}</label>
                      <div className={styles.inputWrapper}>
                        <div className={`${styles.inputIconPrefix} ${styles.prefixPurple}`}>
                          <Coins className="w-4 h-4" />
                        </div>
                        <input
                          type="number"
                          className={styles.inputField}
                          value={svcPrice}
                          onChange={(e) => setSvcPrice(Number(e.target.value))}
                          min={0}
                          step={0.5}
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.currency}</label>
                      <select
                        className={styles.formSelectOnly}
                        value={svcCurrency}
                        onChange={(e) => setSvcCurrency(e.target.value)}
                        disabled={saving}
                      >
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                        <option value="VND">VND (đ)</option>
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>{ts.serviceDescription}</label>
                    <div className={styles.inputWrapper}>
                      <div className={`${styles.inputIconPrefix} ${styles.prefixGreen}`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        className={styles.inputField}
                        placeholder={locale === 'vi' ? 'Mô tả ngắn về dịch vụ' : 'Short description of the service'}
                        value={svcDescription}
                        onChange={(e) => setSvcDescription(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  {/* Staff Type Selection (Standard config) */}
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.staffType}</label>
                      <select
                        className={styles.formSelectOnly}
                        value={svcStaffType}
                        onChange={(e) => setSvcStaffType(e.target.value as 'main' | 'junior' | 'any')}
                        disabled={saving}
                      >
                        <option value="any">{ts.any}</option>
                        <option value="main">{ts.main}</option>
                        <option value="junior">{ts.junior}</option>
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.type}</label>
                      <select
                        className={styles.formSelectOnly}
                        value={svcType}
                        onChange={(e) => setSvcType(e.target.value as 'standard' | 'addon')}
                        disabled={saving}
                      >
                        <option value="standard">{ts.standard}</option>
                        <option value="addon">{ts.addon}</option>
                      </select>
                    </div>
                  </div>

                  {/* Display Order & Active status */}
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.displayOrder}</label>
                      <input
                        type="number"
                        className={styles.formInputOnly}
                        value={svcDisplayOrder}
                        onChange={(e) => setSvcDisplayOrder(Number(e.target.value))}
                        min={0}
                        disabled={saving}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.active}</label>
                      <div className={styles.toggleRow}>
                        <label className={styles.toggleSwitch}>
                          <input
                            type="checkbox"
                            checked={svcIsActive}
                            onChange={(e) => setSvcIsActive(e.target.checked)}
                            disabled={saving}
                          />
                          <span className={styles.toggleTrack} />
                        </label>
                      </div>
                    </div>
                  </div>
                </>

              {/* Submit Button */}
              <button
                className={styles.submitBtnBlue}
                onClick={handleSaveService}
                disabled={saving}
              >
                {saving ? t.common.loading : modalMode === 'addService' ? (locale === 'vi' ? 'Tạo dịch vụ' : locale === 'de' ? 'Service erstellen' : 'Create Service') : t.common.save}
              </button>

              {/* Delete button (only for custom services in edit mode) */}
              {modalMode === 'editService' && (
                <button
                  type="button"
                  className={styles.deleteLinkBtn}
                  onClick={() => handleDeleteService(editingServiceId!)}
                  disabled={saving}
                >
                  {locale === 'vi' ? 'Xoá dịch vụ' : locale === 'de' ? 'Service löschen' : 'Delete Service'}
                </button>
              )}
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
