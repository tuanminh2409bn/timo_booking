'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { hasConflict, MAX_MAIN_SERVICES, shouldSkipStaffSelection } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { Service, ServiceCategory, Staff } from '@/lib/types';
import styles from './page.module.css';


export default function ServiceSelectionPage() {
  const router = useRouter();

  const { t, locale } = useI18n();
  const { getCategoryName, getCategoryDescription, getServiceName, getServiceDescription } = useServiceTranslation();
  const { state, dispatch } = useBooking();
  const branchSlug = state.branchSlug;
  
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Listen to categories from Firestore
  useEffect(() => {
    if (!branchSlug) return;
    const categoriesRef = collection(db, 'branches', branchSlug, 'categories');
    const unsubscribe = onSnapshot(categoriesRef, (snap) => {
      const list: ServiceCategory[] = [];
      snap.forEach(doc => {
        list.push(doc.data() as ServiceCategory);
      });
      // Sort categories by display order
      list.sort((a, b) => a.displayOrder - b.displayOrder);
      setCategories(list);
      // Expand categories by default
      setExpandedCategories(new Set(list.map(c => c.id)));
      setLoading(false);
    }, (e) => {
      console.error('Error listening to categories:', e);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [branchSlug]);

  // Listen to services from Firestore
  useEffect(() => {
    if (!branchSlug) return;
    const servicesRef = collection(db, 'branches', branchSlug, 'services');
    const unsubscribe = onSnapshot(servicesRef, (snap) => {
      const list: Service[] = [];
      snap.forEach(doc => {
        list.push(doc.data() as Service);
      });
      // Sort services by display order
      list.sort((a, b) => a.displayOrder - b.displayOrder);
      setServices(list);
    }, (e) => {
      console.error('Error listening to services:', e);
    });
    return () => unsubscribe();
  }, [branchSlug]);

  // Fetch staff from Firestore
  useEffect(() => {
    if (!branchSlug) return;
    const fetchStaff = async () => {
      try {
        const staffSnap = await getDocs(collection(db, 'branches', branchSlug, 'staff'));
        if (!staffSnap.empty) {
          setStaffList(staffSnap.docs.map(doc => doc.data() as Staff));
        }
      } catch (e) {
        console.error('Error fetching staff:', e);
      }
    };
    fetchStaff();
  }, [branchSlug]);

  // ── Localized labels ──
  const localLabels = useMemo(() => ({
    noPreference: {
      de: 'Beliebiger Mitarbeiter',
      en: 'No preference',
      vi: 'Bất kỳ ai',
    }[locale] || 'No preference',
    chooseStaff: {
      de: 'Mitarbeiter auswählen:',
      en: 'Choose professional:',
      vi: 'Chọn thợ:',
    }[locale] || 'Choose professional:',
    continueBtn: {
      de: 'Weiter zur Terminauswahl',
      en: 'Continue to date & time',
      vi: 'Tiếp tục chọn ngày & giờ',
    }[locale] || 'Continue to date & time',
    selectStaffFirst: {
      de: 'Bitte wählen Sie einen Mitarbeiter',
      en: 'Please select a staff member',
      vi: 'Vui lòng chọn thợ cho dịch vụ',
    }[locale] || 'Please select a staff member',
  }), [locale]);

  // ── Filter services by search query ──
  const filteredServices = useMemo(() => {
    if (!searchQuery.trim()) return services;
    const q = searchQuery.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [searchQuery, services]);

  // ── Build category list with their services ──
  const categoriesWithServices = useMemo(() => {
    return categories
      .filter((cat) => cat.isActive)
      .map((cat) => ({
        ...cat,
        services: filteredServices.filter((s) => s.categoryId === cat.id && s.isActive),
      }))
      .filter((cat) => cat.services.length > 0);
  }, [categories, filteredServices]);

  // ── Helpers to check selected state ──
  const getSelectedItem = useCallback(
    (categoryId: string) =>
      state.selectedServices.find((s) => s.categoryId === categoryId) ?? null,
    [state.selectedServices]
  );

  const isMainSelected = useCallback(
    (categoryId: string, serviceId: string) => {
      const item = state.selectedServices.find((s) => s.categoryId === categoryId);
      return item?.mainService.id === serviceId;
    },
    [state.selectedServices]
  );

  const isExtraSelected = useCallback(
    (categoryId: string, serviceId: string) => {
      const item = state.selectedServices.find((s) => s.categoryId === categoryId);
      return item?.extras.some((e) => e.id === serviceId) ?? false;
    },
    [state.selectedServices]
  );

  const categoryHasMainSelected = useCallback(
    (categoryId: string) => {
      return state.selectedServices.some((s) => s.categoryId === categoryId);
    },
    [state.selectedServices]
  );

  // ── Determine disabled categories ──
  const getCategoryDisableReason = useCallback(
    (category: ServiceCategory): 'conflict' | 'max' | null => {
      // If category is already selected, it's not disabled
      if (state.selectedServices.some((s) => s.categoryId === category.id)) {
        return null;
      }
      // Check conflict
      if (hasConflict(state.selectedServices, category.conflictGroup)) {
        return 'conflict';
      }
      // Check max categories
      if (state.selectedServices.length >= MAX_MAIN_SERVICES) {
        return 'max';
      }
      return null;
    },
    [state.selectedServices]
  );

  // ── Get the conflicting group name for display ──
  const getConflictGroupLabel = useCallback(
    (category: ServiceCategory): string => {
      if (!category.conflictGroup) return '';
      // The conflict is with the opposite group
      const oppositeGroup = category.conflictGroup === 'gel' ? 'acryl' : 'gel';
      return oppositeGroup === 'gel' ? 'Gel' : 'Acryl';
    },
    []
  );

  // ── Toggle category expand/collapse ──
  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // ── Handle selecting a main service (NO NAVIGATION) ──
  const handleSelectMain = (category: ServiceCategory, service: Service) => {
    // If this service is already the main service, remove the entire category
    if (isMainSelected(category.id, service.id)) {
      dispatch({ type: 'REMOVE_CATEGORY', categoryId: category.id });
    } else {
      dispatch({ type: 'ADD_MAIN_SERVICE', category, service });
      // DO NOT navigate — stay on page, show staff picker inline
    }
  };

  // ── Handle toggling an extra/addon ──
  const handleToggleExtra = (categoryId: string, extra: Service) => {
    dispatch({ type: 'TOGGLE_EXTRA', categoryId, extra });
  };

  // ── Per-service staff selection handlers ──
  const handleSelectAnyForService = (categoryId: string) => {
    dispatch({ type: 'SELECT_STAFF_FOR_SERVICE', categoryId, staff: null, staffType: 'any' });
  };

  const handleSelectStaffForService = (categoryId: string, staff: Staff) => {
    dispatch({ type: 'SELECT_STAFF_FOR_SERVICE', categoryId, staff, staffType: 'specific' });
  };

  // ── Get staff eligible for a specific service ──
  const getStaffForService = useCallback((serviceId: string): Staff[] => {
    // Find service data to check staffType
    const service = services.find(s => s.id === serviceId);
    const svcStaffType = (service as any)?.staffType || 'any';
    
    return staffList.filter(
      (s) => {
        if (s.status !== 'active') return false;
        if (!(s.serviceIds || []).includes(serviceId)) return false;
        // Filter by service's required staff type
        if (svcStaffType === 'main' && s.staffType !== 'main') return false;
        if (svcStaffType === 'junior' && s.staffType !== 'junior') return false;
        return true;
      }
    );
  }, [staffList, services]);

  // ── Check if skip staff selection (auto-assign categories like Pediküre) ──
  const skipStaffSelection = useMemo(() => {
    return shouldSkipStaffSelection(state.selectedServices, categories);
  }, [state.selectedServices, categories]);

  // ── Check if can continue ──
  const canContinue = useMemo(() => {
    if (state.selectedServices.length === 0) return false;
    if (skipStaffSelection) return true;
    // Every service must have staff selected (either 'any' or specific)
    return state.selectedServices.every(item => 
      item.selectedStaffType === 'any' || item.selectedStaff !== null
    );
  }, [state.selectedServices, skipStaffSelection]);

  // ── Handle continue ──
  const handleContinue = () => {
    if (!canContinue) return;
    router.push(`/book/${branchSlug}/staff`);
  };

  // ── Build the badge text for a category ──
  const getCategoryBadgeText = (categoryId: string): string | null => {
    const item = getSelectedItem(categoryId);
    if (!item) return null;

    const extraCount = item.extras.length;
    if (extraCount === 0) {
      return '1 selected';
    }
    return `1 main + ${extraCount} extra`;
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t.booking.services.title}</h1>

      {/* Search */}
      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}>🔍</span>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t.booking.services.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Categories */}
      {categoriesWithServices.length > 0 ? (
        <div className={styles.categories}>
          {categoriesWithServices.map((category) => {
            const isExpanded = expandedCategories.has(category.id);
            const disableReason = getCategoryDisableReason(category);
            const isDisabled = disableReason !== null;
            const badgeText = getCategoryBadgeText(category.id);
            const hasMain = categoryHasMainSelected(category.id);
            const selectedItem = getSelectedItem(category.id);

            // Split services: main services (non-addon) and extras (addon)
            const mainServices = category.services.filter((s) => !s.isAddon);
            const extraServices = category.services.filter((s) => s.isAddon);

            return (
              <div
                key={category.id}
                className={`${styles.categoryCard} ${isDisabled ? styles.categoryDisabled : ''}`}
              >
                <div
                  className={styles.categoryHeader}
                  onClick={() => !isDisabled && toggleCategory(category.id)}
                >
                  <div className={styles.categoryInfo}>
                    <span className={styles.categoryName}>
                      {getCategoryName(category.id, category.name)}
                    </span>
                    <span className={styles.categoryDescription}>
                      {getCategoryDescription(category.id, category.description)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Conflict badge */}
                    {disableReason === 'conflict' && (
                      <span className={styles.categoryConflictBadge}>
                        ⚠ Konflikt mit {getConflictGroupLabel(category)}
                      </span>
                    )}
                    {/* Max reached badge */}
                    {disableReason === 'max' && (
                      <span className={styles.categoryMaxBadge}>
                        Max {MAX_MAIN_SERVICES}
                      </span>
                    )}
                    <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}>
                      ▾
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className={styles.serviceList}>
                    {/* Main services */}
                    {mainServices.map((service) => {
                      const selected = isMainSelected(category.id, service.id);

                      return (
                        <div key={service.id}>
                          <div className={styles.serviceItem}>
                            <div className={styles.serviceDetails}>
                              <div className={styles.serviceName}>
                                {getServiceName(service.id, service.name)}
                              </div>
                              <div className={styles.serviceDescription}>
                                {getServiceDescription(service.id, service.description)}
                              </div>
                              <div className={styles.serviceMeta}>
                                <span className={styles.serviceDuration}>
                                  {t.booking.services.item.duration.replace(
                                    '{duration}',
                                    String(service.durationMinutes)
                                  )}
                                </span>
                                <span className={styles.metaDot} />
                                <span className={styles.servicePrice}>
                                  €{service.price}
                                </span>
                              </div>
                            </div>
                            <button
                              className={`${styles.selectButton} ${
                                selected ? styles.selectedButton : ''
                              }`}
                              onClick={() => handleSelectMain(category, service)}
                            >
                              {selected
                                ? t.booking.services.item.selected
                                : t.booking.services.item.add}
                            </button>
                          </div>

                          {/* ── Inline Staff Picker (only for selected service) ── */}
                          {selected && !skipStaffSelection && (
                            <div className={styles.inlineStaffPicker}>
                              <div className={styles.staffPickerLabel}>
                                {localLabels.chooseStaff}
                              </div>
                              <div className={styles.staffPickerGrid}>
                                {/* "Any staff" option */}
                                <div
                                  className={`${styles.staffPickerCard} ${
                                    selectedItem?.selectedStaffType === 'any' && !selectedItem?.selectedStaff
                                      ? styles.staffPickerCardSelected
                                      : ''
                                  }`}
                                  onClick={() => handleSelectAnyForService(category.id)}
                                >
                                  <div className={styles.staffPickerAvatar}>
                                    <span>👥</span>
                                  </div>
                                  <div className={styles.staffPickerName}>
                                    {localLabels.noPreference}
                                  </div>
                                </div>

                                {/* Individual staff cards */}
                                {getStaffForService(service.id).map((staff) => {
                                  const isStaffChosen = 
                                    selectedItem?.selectedStaffType === 'specific' && 
                                    selectedItem?.selectedStaff?.id === staff.id;
                                  
                                  return (
                                    <div
                                      key={staff.id}
                                      className={`${styles.staffPickerCard} ${
                                        isStaffChosen ? styles.staffPickerCardSelected : ''
                                      }`}
                                      onClick={() => handleSelectStaffForService(category.id, staff)}
                                    >
                                      <div className={styles.staffPickerAvatar}>
                                        <span>{staff.initials}</span>
                                      </div>
                                      <div className={styles.staffPickerName}>
                                        {staff.name}
                                      </div>
                                      {staff.staffType && (
                                        <div className={styles.staffPickerBadge}>
                                          {staff.staffType === 'main' ? '⭐' : '🔹'}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Extra/addon services */}
                    {extraServices.map((service) => {
                      const selected = isExtraSelected(category.id, service.id);
                      const addonDisabled = !hasMain;

                      return (
                        <div
                          key={service.id}
                          className={`${styles.serviceItem} ${addonDisabled ? styles.addonDisabled : ''}`}
                        >
                          <div className={styles.serviceDetails}>
                            <div className={styles.serviceName}>
                              {getServiceName(service.id, service.name)}
                            </div>
                            <div className={styles.serviceDescription}>
                              {getServiceDescription(service.id, service.description)}
                            </div>
                            <div className={styles.serviceMeta}>
                              <span className={styles.serviceDuration}>
                                +{t.booking.services.item.duration.replace(
                                  '{duration}',
                                  String(service.durationMinutes)
                                )}
                              </span>
                              <span className={styles.metaDot} />
                              <span className={styles.servicePrice}>
                                €{service.price}
                              </span>
                            </div>
                          </div>
                          <button
                            className={`${styles.extraButton} ${
                              selected ? styles.extraButtonSelected : ''
                            }`}
                            disabled={addonDisabled}
                            onClick={() => handleToggleExtra(category.id, service)}
                          >
                            {selected ? '✓ Extra' : t.booking.services.item.add}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.noResults}>
          <div className={styles.noResultsIcon}>💅</div>
          <p className={styles.noResultsText}>No services found</p>
        </div>
      )}

      {/* ── Floating Continue Button ── */}
      {state.selectedServices.length > 0 && (
        <div className={styles.floatingFooter}>
          <div className={styles.floatingFooterInner}>
            <div className={styles.footerSummary}>
              <span className={styles.footerServiceCount}>
                {state.selectedServices.length} {
                  locale === 'de' ? 'Dienst(e)' : locale === 'vi' ? 'dịch vụ' : 'service(s)'
                }
              </span>
            </div>
            <button
              className={`${styles.continueButton} ${!canContinue ? styles.continueButtonDisabled : ''}`}
              onClick={handleContinue}
              disabled={!canContinue}
            >
              {canContinue ? localLabels.continueBtn : localLabels.selectStaffFirst}
              {canContinue && <span className={styles.continueArrow}>→</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
