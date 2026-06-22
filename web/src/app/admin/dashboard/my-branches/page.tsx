'use client';

import React, { useState, useEffect } from 'react';
import { Plus, AlertTriangle, Store, MapPin, Phone, DollarSign, Euro, Clock, Calendar, X, Settings, Info } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  writeBatch,
  query,
  where,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';
import { demoCategories, demoServices } from '@/lib/seedData';
import { categoryTranslations, serviceTranslations } from '@/lib/i18n/serviceTranslations';

// ===== Interfaces =====
interface BranchData {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  currency: string;
  publicStaffSelection: boolean;
  minimumNoticeHours: number;
  bookingWindowDays: number;
  graceTimeMinutes: number;
  slotIntervalMinutes: number;
  absenceDeadlineTime: string;
  isActive: boolean;
  createdAt: string;
}

interface BusinessData {
  id: string;
  ownerUid: string;
  companyName: string;
  status: string;
  subscriptionPlan: 'starter' | 'professional' | 'enterprise';
  createdAt: string;
}

type ModalMode = 'add' | 'edit' | null;

interface Toast {
  message: string;
  type: 'success' | 'error';
}

// ===== Slugify helper =====
const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

// ===== Plan Limits =====
const PLAN_LIMITS: Record<string, number> = {
  starter: 1,
  professional: 3,
  enterprise: 10,
};

// ===== Component =====
export default function MyBranchesPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  // Data states
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);

  // UI states
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Form states - Branch Info
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCurrency, setFormCurrency] = useState('€');

  // Form states - Booking Settings
  const [formMinNotice, setFormMinNotice] = useState(2);
  const [formBookingWindow, setFormBookingWindow] = useState(30);
  const [formSlotInterval, setFormSlotInterval] = useState(30);
  const [formGraceTime, setFormGraceTime] = useState(15);
  const [formAbsenceDeadline, setFormAbsenceDeadline] = useState('08:00');
  const [formPublicStaff, setFormPublicStaff] = useState(true);
  const [formIsActive, setFormIsActive] = useState(true);

  const ts = t.admin.myBranches;

  // ===== Toast helper =====
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ===== Firestore: Real-time sync branches =====
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'owner') return;

    // Strategy: fetch branches from assignedBranches (most reliable)
    // If user has assignedBranches, listen to each branch doc individually
    const assignedBranches = user.assignedBranches || [];
    
    if (assignedBranches.length > 0) {
      // Listen to all assigned branches by their doc IDs
      const unsubscribes: (() => void)[] = [];
      const branchMap = new Map<string, BranchData>();

      assignedBranches.forEach((branchId) => {
        const branchRef = doc(db, 'branches', branchId);
        const unsub = onSnapshot(
          branchRef,
          (docSnap) => {
            if (docSnap.exists()) {
              branchMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as BranchData);
            } else {
              branchMap.delete(docSnap.id);
            }
            setBranches(Array.from(branchMap.values()));
            setLoading(false);
          },
          (err) => {
            console.error('Error listening to branch:', branchId, err);
            setLoading(false);
          }
        );
        unsubscribes.push(unsub);
      });

      return () => unsubscribes.forEach((u) => u());
    } else if (user.businessId) {
      // Fallback: query by businessId
      const branchesRef = collection(db, 'branches');
      const branchesQuery = query(branchesRef, where('businessId', '==', user.businessId));

      const unsubscribe = onSnapshot(
        branchesQuery,
        (snap) => {
          const list: BranchData[] = [];
          snap.forEach((docSnap) => {
            list.push({ id: docSnap.id, ...docSnap.data() } as BranchData);
          });
          setBranches(list);
          setLoading(false);
        },
        (err) => {
          console.error('Error listening to branches:', err);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } else {
      setLoading(false);
    }
  }, [user]);

  // ===== Firestore: Fetch business data =====
  useEffect(() => {
    if (!user || !user.businessId) return;

    const fetchBusiness = async () => {
      try {
        const businessRef = doc(db, 'businesses', user.businessId!);
        const snap = await getDoc(businessRef);
        if (snap.exists()) {
          setBusiness(snap.data() as BusinessData);
        }
      } catch (err) {
        console.error('Error fetching business:', err);
      }
    };

    fetchBusiness();
  }, [user]);

  // ===== Computed: plan limit =====
  const planLimit = business ? PLAN_LIMITS[business.subscriptionPlan] || 1 : 1;
  const isLimitReached = branches.length >= planLimit;

  const getPlanLabel = () => {
    if (!business) return '';
    switch (business.subscriptionPlan) {
      case 'starter': return ts.planStarter;
      case 'professional': return ts.planProfessional;
      case 'enterprise': return ts.planEnterprise;
      default: return '';
    }
  };

  const getPlanClass = () => {
    if (!business) return styles.planStarter;
    switch (business.subscriptionPlan) {
      case 'starter': return styles.planStarter;
      case 'professional': return styles.planProfessional;
      case 'enterprise': return styles.planEnterprise;
      default: return styles.planStarter;
    }
  };

  // ===== Reset form =====
  const resetForm = () => {
    setEditingBranchId(null);
    setFormName('');
    setFormAddress('');
    setFormPhone('');
    setFormCurrency('€');
    setFormMinNotice(2);
    setFormBookingWindow(30);
    setFormSlotInterval(30);
    setFormGraceTime(15);
    setFormAbsenceDeadline('08:00');
    setFormPublicStaff(true);
    setFormIsActive(true);
  };

  // ===== Open Add Modal =====
  const handleAddBranch = () => {
    resetForm();
    setModalMode('add');
  };

  // ===== Open Edit Modal =====
  const handleEditBranch = (branch: BranchData) => {
    setEditingBranchId(branch.id);
    setFormName(branch.name);
    setFormAddress(branch.address || '');
    setFormPhone(branch.phone || '');
    setFormCurrency(branch.currency || '€');
    setFormMinNotice(branch.minimumNoticeHours);
    setFormBookingWindow(branch.bookingWindowDays);
    setFormSlotInterval(branch.slotIntervalMinutes);
    setFormGraceTime(branch.graceTimeMinutes);
    setFormAbsenceDeadline(branch.absenceDeadlineTime || '08:00');
    setFormPublicStaff(branch.publicStaffSelection);
    setFormIsActive(branch.isActive);
    setModalMode('edit');
  };

  // ===== Save Branch (Create or Update) =====
  const handleSaveBranch = async () => {
    if (!user || !user.businessId || !formName.trim()) return;
    setSaving(true);

    try {
      if (modalMode === 'add') {
        // Create new branch with default categories and services
        const branchSlug = slugify(formName) || `branch-${Date.now()}`;
        const businessId = user.businessId;

        const batch = writeBatch(db);

        // Branch document
        const branchRef = doc(db, 'branches', branchSlug);
        batch.set(branchRef, {
          id: branchSlug,
          businessId,
          name: formName.trim(),
          slug: branchSlug,
          address: formAddress.trim(),
          phone: formPhone.trim(),
          currency: formCurrency,
          publicStaffSelection: true,
          minimumNoticeHours: 2,
          bookingWindowDays: 30,
          graceTimeMinutes: 15,
          slotIntervalMinutes: 30,
          absenceDeadlineTime: '08:00',
          isActive: true,
          createdAt: new Date().toISOString(),
        });

        // Default Categories từ Timo Nails Berlin (Glamour Nails Berlin)
        demoCategories.forEach((cat) => {
          const catRef = doc(db, 'branches', branchSlug, 'categories', cat.id);
          const viName = categoryTranslations['vi']?.[cat.id]?.name || cat.name;
          const enName = categoryTranslations['en']?.[cat.id]?.name || cat.name;
          const deName = categoryTranslations['de']?.[cat.id]?.name || cat.name;

          batch.set(catRef, {
            ...cat,
            branchId: branchSlug,
            businessId,
            nameLocalized: { vi: viName, en: enName, de: deName }
          });
        });

        // Default Services từ Timo Nails Berlin
        demoServices.forEach((svc) => {
          const svcRef = doc(db, 'branches', branchSlug, 'services', svc.id);
          const viName = serviceTranslations['vi']?.[svc.id]?.name || svc.name;
          const enName = serviceTranslations['en']?.[svc.id]?.name || svc.name;
          const deName = serviceTranslations['de']?.[svc.id]?.name || svc.name;

          batch.set(svcRef, {
            ...svc,
            branchId: branchSlug,
            businessId,
            currency: formCurrency,
            nameLocalized: { vi: viName, en: enName, de: deName },
            createdAt: new Date().toISOString()
          });
        });

        await batch.commit();

        // Add the new branchSlug to user's assignedBranches array
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          assignedBranches: arrayUnion(branchSlug),
        });

        showToast(ts.createSuccess, 'success');
      } else if (modalMode === 'edit' && editingBranchId) {
        // Update existing branch
        const branchRef = doc(db, 'branches', editingBranchId);
        await updateDoc(branchRef, {
          name: formName.trim(),
          address: formAddress.trim(),
          phone: formPhone.trim(),
          currency: formCurrency,
          minimumNoticeHours: formMinNotice,
          bookingWindowDays: formBookingWindow,
          slotIntervalMinutes: formSlotInterval,
          graceTimeMinutes: formGraceTime,
          absenceDeadlineTime: formAbsenceDeadline,
          publicStaffSelection: formPublicStaff,
          isActive: formIsActive,
        });
        showToast(ts.saveSuccess, 'success');
      }

      setModalMode(null);
    } catch (err) {
      console.error('Error saving branch:', err);
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Guard: only owner =====
  if (!user || user.role !== 'owner') {
    return null;
  }

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{ts.title}</h1>
          <p className={styles.subtitle}>{ts.subtitle}</p>
          <div className={styles.headerRow}>
            <span className={`${styles.planBadge} ${getPlanClass()}`}>
              {getPlanLabel()}
            </span>
            <span className={styles.limitText}>
              {branches.length} / {planLimit} {ts.branchLimit}
            </span>
          </div>
        </div>
        <button
          className={styles.addBranchBtn}
          onClick={handleAddBranch}
          disabled={isLimitReached}
        >
          <span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> {ts.addBranch}</span>
        </button>
      </div>

      {/* Limit Warning */}
      {isLimitReached && (
        <div className={styles.limitWarning} style={{ display: 'flex', alignItems: 'center' }}>
          <AlertTriangle className="w-4 h-4 text-yellow-600 mr-2" />
          <span>{ts.branchLimitReached}</span>
        </div>
      )}

      {/* Branch List */}
      {loading ? (
        <div className={styles.emptyState}>
          <p>{t.common.loading}</p>
        </div>
      ) : branches.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon} style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
            <Store className="w-12 h-12 text-gray-300" />
          </div>
          <p>{ts.noBranches}</p>
        </div>
      ) : (
        <div className={styles.branchGrid}>
          {branches.map((branch) => (
            <div
              key={branch.id}
              className={styles.branchCard}
              onClick={() => handleEditBranch(branch)}
            >
              {/* Card Header */}
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleGroup}>
                  <h3 className={styles.cardTitle}>{branch.name}</h3>
                  <p className={styles.cardSlug}>/{branch.slug}</p>
                </div>
                <span
                  className={`${styles.statusBadge} ${
                    branch.isActive ? styles.statusActive : styles.statusInactive
                  }`}
                >
                  {branch.isActive ? ts.active : ts.inactive}
                </span>
              </div>

              {/* Card Body */}
              <div className={styles.cardBody}>
                {branch.address && (
                  <div className={styles.cardInfoRow} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                    <span>{branch.address}</span>
                  </div>
                )}
                {branch.phone && (
                  <div className={styles.cardInfoRow} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    <span>{branch.phone}</span>
                  </div>
                )}
                <div className={styles.cardInfoRow} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Euro className="w-3.5 h-3.5 text-gray-400" />
                  <span>{branch.currency}</span>
                </div>
              </div>

              {/* Card Footer - Booking Settings Summary */}
              <div className={styles.cardFooter} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span className={`${styles.settingBadge} inline-flex items-center gap-1`}>
                  <Clock className="w-3.5 h-3.5" /> {branch.minimumNoticeHours}h notice
                </span>
                <span className={`${styles.settingBadge} inline-flex items-center gap-1`}>
                  <Calendar className="w-3.5 h-3.5" /> {branch.bookingWindowDays}d window
                </span>
                <span className={`${styles.settingBadge} inline-flex items-center gap-1`}>
                  <Clock className="w-3.5 h-3.5" /> {branch.slotIntervalMinutes}min slots
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== ADD/EDIT MODAL ===== */}
      {modalMode && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {modalMode === 'add' ? ts.addBranch : ts.editBranch}
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setModalMode(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Section: Branch Info */}
              <p className={`${styles.sectionTitle} ${styles.sectionTitleFirst}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Store className="w-4 h-4" />
                <span>{ts.branchInfo}</span>
              </p>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{ts.branchName} *</label>
                <input
                  className={styles.formInput}
                  placeholder={ts.branchName}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{ts.branchAddress}</label>
                <input
                  className={styles.formInput}
                  placeholder={ts.branchAddress}
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.branchPhone}</label>
                  <input
                    className={styles.formInput}
                    placeholder={ts.branchPhone}
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{ts.currency}</label>
                  <select
                    className={styles.formSelect}
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value)}
                  >
                    <option value="€">€ (EUR)</option>
                    <option value="$">$ (USD)</option>
                    <option value="£">£ (GBP)</option>
                    <option value="¥">¥ (JPY)</option>
                  </select>
                </div>
              </div>

              {/* Section: Booking Settings (only in edit mode) */}
              {modalMode === 'edit' && (
                <>
                  <p className={styles.sectionTitle}>
                    ⚙️ {ts.bookingSettings}
                  </p>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.minimumNoticeHours}</label>
                      <input
                        type="number"
                        className={styles.formInput}
                        value={formMinNotice}
                        onChange={(e) => setFormMinNotice(Number(e.target.value))}
                        min={0}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.bookingWindowDays}</label>
                      <input
                        type="number"
                        className={styles.formInput}
                        value={formBookingWindow}
                        onChange={(e) => setFormBookingWindow(Number(e.target.value))}
                        min={1}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.slotIntervalMinutes}</label>
                      <select
                        className={styles.formSelect}
                        value={formSlotInterval}
                        onChange={(e) => setFormSlotInterval(Number(e.target.value))}
                      >
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                        <option value={60}>60 min</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>{ts.graceTimeMinutes}</label>
                      <input
                        type="number"
                        className={styles.formInput}
                        value={formGraceTime}
                        onChange={(e) => setFormGraceTime(Number(e.target.value))}
                        min={0}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>{ts.absenceDeadlineTime}</label>
                    <input
                      type="time"
                      className={styles.formInput}
                      value={formAbsenceDeadline}
                      onChange={(e) => setFormAbsenceDeadline(e.target.value)}
                    />
                  </div>

                  {/* Public Staff Selection Toggle */}
                  <div className={styles.formGroup}>
                    <div className={styles.toggleRow}>
                      <span className={styles.toggleLabel}>{ts.publicStaffSelection}</span>
                      <label className={styles.toggleSwitch}>
                        <input
                          type="checkbox"
                          checked={formPublicStaff}
                          onChange={(e) => setFormPublicStaff(e.target.checked)}
                        />
                        <span className={styles.toggleTrack} />
                      </label>
                    </div>
                  </div>

                  {/* Active Toggle */}
                  <div className={styles.formGroup}>
                    <div className={styles.toggleRow}>
                      <span className={styles.toggleLabel}>
                        {formIsActive ? ts.active : ts.inactive}
                      </span>
                      <label className={styles.toggleSwitch}>
                        <input
                          type="checkbox"
                          checked={formIsActive}
                          onChange={(e) => setFormIsActive(e.target.checked)}
                        />
                        <span className={styles.toggleTrack} />
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* Default Categories Notice (only in add mode) */}
              {modalMode === 'add' && (
                <div className={styles.defaultNotice}>
                  <span className={styles.defaultNoticeIcon}>ℹ️</span>
                  <span>{ts.defaultCategories}</span>
                </div>
              )}

              {/* Submit */}
              <button
                className={styles.submitBtn}
                onClick={handleSaveBranch}
                disabled={saving || !formName.trim()}
              >
                {saving ? t.common.loading : t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
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
