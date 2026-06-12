'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

// ===== Interfaces =====

interface FirestoreStaffMember {
  id: string;
  name: string;
  initials: string;
  role: string;
  staffType: 'main' | 'junior';
  status: 'active' | 'inactive' | 'archived';
  rating?: number;
  languages?: string[];
  title?: string;
  serviceIds?: string[];
}

interface DisplayStaffMember {
  id: string;
  name: string;
  initials: string;
  staffType: 'main' | 'junior';
  role: 'staff' | 'manager';
  userUid: string | null;
  status: 'active' | 'inactive';
  rating: number;
  languages: string[];
  title: string;
  serviceIds: string[];
  workDays: number[];
  workHours: string;
}

interface BranchData {
  id: string;
  name: string;
  address: string;
}

interface WorkingHoursDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isWorking: boolean;
}

interface AbsenceData {
  id: string;
  staffId: string;
  branchId: string;
  absenceDate: string;
  startTime: string | null;
  endTime: string | null;
  isFullDay: boolean;
  note: string;
  createdBy: string;
  createdAt: string;
}

interface ServiceData {
  id: string;
  name: string;
  nameLocalized?: { vi?: string; en?: string; de?: string };
  durationMinutes: number;
  price: number;
  currency: string;
  categoryId: string;
  isActive: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

type DetailTab = 'profile' | 'hours' | 'services' | 'absences' | 'branches';

const WEEKDAY_LABELS = {
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  vi: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
};

const DEFAULT_WORKING_HOURS: WorkingHoursDay[] = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isWorking: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isWorking: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isWorking: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isWorking: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isWorking: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isWorking: false },
  { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', isWorking: false },
];

const getLanguageLabel = (lang: string, loc: string) => {
  const map: Record<string, Record<string, string>> = {
    German: { de: 'Deutsch', en: 'German', vi: 'Tiếng Đức' },
    Vietnamese: { de: 'Vietnamesisch', en: 'Vietnamese', vi: 'Tiếng Việt' },
    English: { de: 'Englisch', en: 'English', vi: 'Tiếng Anh' },
  };
  return map[lang]?.[loc] || lang;
};

const generateRandomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'TIMMO-INV-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export default function StaffManagementPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [staffList, setStaffList] = useState<DisplayStaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite states
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff');
  const [inviteStaffType, setInviteStaffType] = useState<'main' | 'junior'>('main');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Pending approvals state
  const [pendingStaff, setPendingStaff] = useState<any[]>([]);

  // Detail modal state
  const [selectedStaff, setSelectedStaff] = useState<DisplayStaffMember | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('profile');
  const [saving, setSaving] = useState(false);

  // Manager modal state (simple modal for owner to manage managers)
  const [selectedManager, setSelectedManager] = useState<DisplayStaffMember | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Profile form state
  const [editName, setEditName] = useState('');
  const [editStaffType, setEditStaffType] = useState<'main' | 'junior'>('main');
  const [editLanguages, setEditLanguages] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');

  // Working hours state
  const [workingHours, setWorkingHours] = useState<WorkingHoursDay[]>([]);
  const [hoursLoading, setHoursLoading] = useState(false);

  // Services state
  const [branchServices, setBranchServices] = useState<ServiceData[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  // Absence state
  const [absences, setAbsences] = useState<AbsenceData[]>([]);
  const [absenceDate, setAbsenceDate] = useState('');
  const [absenceFullDay, setAbsenceFullDay] = useState(true);
  const [absenceStartTime, setAbsenceStartTime] = useState('09:00');
  const [absenceEndTime, setAbsenceEndTime] = useState('18:00');
  const [absenceNote, setAbsenceNote] = useState('');

  // Branch assignment state (for managers)
  const [businessBranches, setBusinessBranches] = useState<BranchData[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const branchId = user?.assignedBranches?.[0] || 'glamour-nails-berlin';
  const ts = t.admin.staff;

  // Toast helper
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Helper: get localized service name
  const getLocalizedName = (item: { name: string; nameLocalized?: { vi?: string; en?: string; de?: string } }) => {
    if (item.nameLocalized) {
      const localized = item.nameLocalized[locale as 'vi' | 'en' | 'de'];
      if (localized) return localized;
    }
    return item.name;
  };

  // ===== Sync pending approvals =====
  useEffect(() => {
    if (!user || user.role !== 'owner') return;
    const brId = user.assignedBranches?.[0];
    if (!brId) return;

    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('assignedBranches', 'array-contains', brId),
      where('approvalStatus', '==', 'pending_owner')
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ uid: d.id, ...d.data() });
        });
        setPendingStaff(list);
      },
      (err) => {
        console.error('Error listening to pending staff:', err);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // ===== Sync staff from Firestore in real-time =====
  useEffect(() => {
    if (!user) return;
    const staffRef = collection(db, 'branches', branchId, 'staff');
    const unsubscribe = onSnapshot(
      staffRef,
      (snap) => {
        const list: DisplayStaffMember[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as FirestoreStaffMember;
          if (data.status !== 'archived') {
            const staffRole = (data.role as 'staff' | 'manager') || 'staff';
            list.push({
              id: data.id,
              name: data.name,
              initials: data.initials,
              staffType: data.staffType,
              role: staffRole,
              userUid: (data as any).userUid || null,
              status: data.status === 'active' ? 'active' : 'inactive',
              rating: data.rating || 5.0,
              languages: data.languages || ['German', 'Vietnamese'],
              title: data.title || '',
              serviceIds: data.serviceIds || [],
              workDays:
                data.staffType === 'main'
                  ? [0, 1, 2, 3, 4, 5]
                  : [0, 1, 2, 3, 4],
              workHours: '09:00 - 18:00',
            });
          }
        });
        setStaffList(list);
        setLoading(false);
      },
      (e) => {
        console.error('Error listening to staff:', e);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, branchId]);

  // ===== Sync branch services (for service assignment tab) =====
  useEffect(() => {
    if (!user || !branchId) return;
    const svcRef = collection(db, 'branches', branchId, 'services');
    const unsubscribe = onSnapshot(
      svcRef,
      (snap) => {
        const list: ServiceData[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name,
            nameLocalized: d.nameLocalized,
            durationMinutes: d.durationMinutes,
            price: d.price,
            currency: d.currency || 'EUR',
            categoryId: d.categoryId,
            isActive: d.isActive !== false,
          });
        });
        setBranchServices(list);
      },
      (err) => {
        console.error('Error listening to services:', err);
      }
    );
    return () => unsubscribe();
  }, [user, branchId]);

  // ===== Load working hours for selected staff =====
  const loadWorkingHours = useCallback(
    async (staffId: string) => {
      setHoursLoading(true);
      try {
        const whRef = collection(
          db,
          'branches',
          branchId,
          'staff',
          staffId,
          'workingHours'
        );
        const snap = await getDocs(whRef);
        if (snap.empty) {
          setWorkingHours([...DEFAULT_WORKING_HOURS]);
        } else {
          const days: WorkingHoursDay[] = [];
          snap.forEach((docSnap) => {
            const d = docSnap.data();
            days.push({
              dayOfWeek: d.dayOfWeek,
              startTime: d.startTime || '09:00',
              endTime: d.endTime || '18:00',
              isWorking: d.isWorking !== false,
            });
          });
          // Ensure all 7 days are present
          for (let i = 0; i < 7; i++) {
            if (!days.find((d) => d.dayOfWeek === i)) {
              days.push({
                dayOfWeek: i,
                startTime: '09:00',
                endTime: '18:00',
                isWorking: i < 5,
              });
            }
          }
          days.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
          setWorkingHours(days);
        }
      } catch (err) {
        console.error('Error loading working hours:', err);
        setWorkingHours([...DEFAULT_WORKING_HOURS]);
      } finally {
        setHoursLoading(false);
      }
    },
    [branchId]
  );

  // ===== Load absences for selected staff =====
  const loadAbsences = useCallback(
    async (staffId: string) => {
      try {
        const absRef = collection(
          db,
          'branches',
          branchId,
          'staff',
          staffId,
          'absences'
        );
        const snap = await getDocs(absRef);
        const list: AbsenceData[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as AbsenceData);
        });
        list.sort((a, b) => a.absenceDate.localeCompare(b.absenceDate));
        setAbsences(list);
      } catch (err) {
        console.error('Error loading absences:', err);
        setAbsences([]);
      }
    },
    [branchId]
  );

  // ===== Load branches for branch assignment (managers) =====
  const loadBranchesForAssignment = useCallback(
    async (staff: DisplayStaffMember) => {
      if (staff.role !== 'manager' || !user?.businessId) {
        setBusinessBranches([]);
        setSelectedBranchIds([]);
        return;
      }
      setBranchesLoading(true);
      try {
        // Fetch all branches belonging to this business
        const branchesRef = collection(db, 'branches');
        const q = query(branchesRef, where('businessId', '==', user.businessId));
        const snap = await getDocs(q);
        const list: BranchData[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || docSnap.id,
            address: d.address || '',
          });
        });
        setBusinessBranches(list);

        // Load current assignedBranches from user profile
        const userUid = staff.userUid;
        if (userUid) {
          const userDocRef = doc(db, 'users', userUid);
          const directDoc = await getDoc(userDocRef);
          if (directDoc.exists()) {
            const userData = directDoc.data();
            setSelectedBranchIds(userData.assignedBranches || []);
          } else {
            setSelectedBranchIds([]);
          }
        } else {
          // Fallback: query users by staffId
          const usersRef = collection(db, 'users');
          const uq = query(usersRef, where('staffId', '==', staff.id));
          const uSnap = await getDocs(uq);
          if (!uSnap.empty) {
            const userData = uSnap.docs[0].data();
            setSelectedBranchIds(userData.assignedBranches || []);
          } else {
            setSelectedBranchIds([]);
          }
        }
      } catch (err) {
        console.error('Error loading branches for assignment:', err);
        setBusinessBranches([]);
        setSelectedBranchIds([]);
      } finally {
        setBranchesLoading(false);
      }
    },
    [user]
  );

  // ===== Open staff detail modal =====
  const handleOpenDetail = useCallback(
    (staff: DisplayStaffMember) => {
      setSelectedStaff(staff);
      setDetailTab('profile');
      // Populate profile form
      setEditName(staff.name);
      setEditStaffType(staff.staffType);
      setEditLanguages(staff.languages.join(', '));
      setEditTitle(staff.title || '');
      setEditStatus(staff.status);
      // Populate service selection
      setSelectedServiceIds([...staff.serviceIds]);
      // Load subcollection data
      loadWorkingHours(staff.id);
      loadAbsences(staff.id);
      // Load branch assignment data for managers
      loadBranchesForAssignment(staff);
      // Reset absence form
      setAbsenceDate('');
      setAbsenceFullDay(true);
      setAbsenceStartTime('09:00');
      setAbsenceEndTime('18:00');
      setAbsenceNote('');
    },
    [loadWorkingHours, loadAbsences, loadBranchesForAssignment]
  );

  const handleCloseDetail = () => {
    setSelectedStaff(null);
  };

  // ===== Save Profile =====
  const handleSaveProfile = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      const staffDocRef = doc(db, 'branches', branchId, 'staff', selectedStaff.id);
      const langArray = editLanguages
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      await updateDoc(staffDocRef, {
        name: editName,
        staffType: editStaffType,
        languages: langArray,
        title: editTitle,
        status: editStatus,
        initials: editName
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
      });
      showToast(ts.saveSuccess, 'success');
    } catch (err) {
      console.error('Error saving profile:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Save Working Hours (batch) =====
  const handleSaveWorkingHours = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      for (const day of workingHours) {
        const docId = `day-${day.dayOfWeek}`;
        const docRef = doc(
          db,
          'branches',
          branchId,
          'staff',
          selectedStaff.id,
          'workingHours',
          docId
        );
        batch.set(docRef, {
          id: docId,
          staffId: selectedStaff.id,
          dayOfWeek: day.dayOfWeek,
          startTime: day.startTime,
          endTime: day.endTime,
          isWorking: day.isWorking,
        });
      }
      await batch.commit();
      showToast(ts.saveSuccess, 'success');
    } catch (err) {
      console.error('Error saving working hours:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Save Service Assignment =====
  const handleSaveServices = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      console.log('[DEBUG Save Services]', {
        staffId: selectedStaff.id,
        branchId,
        userUid: user.uid,
        userRole: user.role,
        userBusinessId: user.businessId,
        userAssignedBranches: user.assignedBranches,
        serviceIds: selectedServiceIds,
      });
      const staffDocRef = doc(db, 'branches', branchId, 'staff', selectedStaff.id);
      await updateDoc(staffDocRef, {
        serviceIds: selectedServiceIds,
      });
      showToast(ts.saveSuccess, 'success');
    } catch (err: any) {
      console.error('Error saving services:', err?.code, err?.message, err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Save Branch Assignment (for managers) =====
  const handleSaveBranchAssignment = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      let targetUid: string | null = selectedStaff.userUid;

      if (!targetUid) {
        // Fallback: find user doc by staffId
        const usersRef = collection(db, 'users');
        const uq = query(usersRef, where('staffId', '==', selectedStaff.id));
        const uSnap = await getDocs(uq);
        if (!uSnap.empty) {
          targetUid = uSnap.docs[0].id;
        }
      }

      if (!targetUid) {
        showToast(ts.saveError, 'error');
        return;
      }

      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        assignedBranches: selectedBranchIds,
      });
      showToast(ts.branchAssignmentSaved, 'success');
    } catch (err) {
      console.error('Error saving branch assignment:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Toggle branch selection =====
  const toggleBranchId = (branchIdToToggle: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchIdToToggle)
        ? prev.filter((id) => id !== branchIdToToggle)
        : [...prev, branchIdToToggle]
    );
  };

  // ===== Add Absence =====
  const handleAddAbsence = async () => {
    if (!selectedStaff || !user || !absenceDate) return;
    setSaving(true);
    try {
      const absId = `abs-${Date.now()}`;
      const absRef = doc(
        db,
        'branches',
        branchId,
        'staff',
        selectedStaff.id,
        'absences',
        absId
      );
      const absData: AbsenceData = {
        id: absId,
        staffId: selectedStaff.id,
        branchId,
        absenceDate,
        startTime: absenceFullDay ? null : absenceStartTime,
        endTime: absenceFullDay ? null : absenceEndTime,
        isFullDay: absenceFullDay,
        note: absenceNote,
        createdBy: user.uid || '',
        createdAt: new Date().toISOString(),
      };
      await setDoc(absRef, absData);
      // Refresh
      await loadAbsences(selectedStaff.id);
      // Reset form
      setAbsenceDate('');
      setAbsenceNote('');
      setAbsenceFullDay(true);
      showToast(ts.saveSuccess, 'success');
    } catch (err) {
      console.error('Error adding absence:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== Delete Absence =====
  const handleDeleteAbsence = async (absenceId: string) => {
    if (!selectedStaff || !confirm(ts.confirmDeleteAbsence)) return;
    try {
      const absRef = doc(
        db,
        'branches',
        branchId,
        'staff',
        selectedStaff.id,
        'absences',
        absenceId
      );
      await deleteDoc(absRef);
      await loadAbsences(selectedStaff.id);
      showToast(ts.saveSuccess, 'success');
    } catch (err) {
      console.error('Error deleting absence:', err);
      showToast(ts.saveError, 'error');
    }
  };

  // ===== Working Hours Helpers =====
  const updateWorkingHour = (
    dayOfWeek: number,
    field: keyof WorkingHoursDay,
    value: string | boolean
  ) => {
    setWorkingHours((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d
      )
    );
  };

  // ===== Toggle service selection =====
  const toggleServiceId = (serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  // ===== Existing handlers =====
  const handleToggleStatus = async (
    id: string,
    currentStatus: 'active' | 'inactive'
  ) => {
    if (!user) return;
    try {
      const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
      const staffDocRef = doc(db, 'branches', branchId, 'staff', id);
      await updateDoc(staffDocRef, { status: nextStatus });
    } catch (e) {
      console.error('Error updating staff status:', e);
    }
  };

  const handleApproveStaff = async (pendingUser: any) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', pendingUser.uid);
      await updateDoc(userRef, { approvalStatus: 'approved' });
      const staffId = pendingUser.staffId || `staff-${pendingUser.uid}`;
      const staffRef = doc(db, 'branches', branchId, 'staff', staffId);
      await updateDoc(staffRef, { status: 'active' });
      alert(
        locale === 'vi'
          ? 'Đã phê duyệt nhân viên!'
          : 'Staff member approved!'
      );
    } catch (e) {
      console.error('Error approving staff:', e);
    }
  };

  const handleRejectStaff = async (pendingUser: any) => {
    if (!user) return;
    if (
      !confirm(
        locale === 'vi'
          ? 'Bạn có chắc muốn từ chối đăng ký này?'
          : 'Are you sure you want to reject this registration?'
      )
    )
      return;
    try {
      const userRef = doc(db, 'users', pendingUser.uid);
      await updateDoc(userRef, { approvalStatus: 'rejected' });
      const staffId = pendingUser.staffId || `staff-${pendingUser.uid}`;
      const staffRef = doc(db, 'branches', branchId, 'staff', staffId);
      await updateDoc(staffRef, { status: 'archived' });
    } catch (e) {
      console.error('Error rejecting staff:', e);
    }
  };

  const handleGenerateInvite = async () => {
    if (!user?.assignedBranches?.[0]) return;
    const targetBranch = inviteBranchId || branchId;
    const code = generateRandomCode();
    try {
      const inviteRef = doc(db, 'invitations', code);
      await setDoc(inviteRef, {
        code,
        role: inviteRole,
        staffType: inviteRole === 'staff' ? inviteStaffType : 'main',
        branchId: targetBranch,
        businessId: user.businessId || '',
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      setGeneratedCode(code);
      setCopied(false);
    } catch (e) {
      console.error('Error generating invite:', e);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentWeekdayLabels =
    WEEKDAY_LABELS[locale as keyof typeof WEEKDAY_LABELS] || WEEKDAY_LABELS.en;

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{t.admin.staff.title}</h1>
          <p className={styles.subtitle}>{t.admin.staff.subtitle}</p>
        </div>
        {user?.role === 'owner' && (
          <button
            className={styles.inviteBtn}
            onClick={() => {
              setGeneratedCode('');
              setInviteBranchId(branchId);
              setShowInviteModal(true);
            }}
          >
            ➕{' '}
            {locale === 'vi'
              ? 'Tạo mã mời nhân viên'
              : locale === 'de'
              ? 'Einladungscode erstellen'
              : 'Invite Staff'}
          </button>
        )}
      </div>

      {/* Pending approvals section */}
      {pendingStaff.length > 0 && (
        <div
          style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fef3c7',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h2
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#92400e',
              margin: '0 0 16px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>⚠️</span>{' '}
            {locale === 'vi'
              ? 'Yêu cầu duyệt nhân sự mới'
              : 'Pending Staff Approvals'}{' '}
            ({pendingStaff.length})
          </h2>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {pendingStaff.map((pending) => (
              <div
                key={pending.uid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#ffffff',
                  border: '1px solid #f3f4f6',
                  borderRadius: '8px',
                  padding: '16px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: '#111827',
                    }}
                  >
                    {pending.name}
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#4b5563',
                      marginTop: '2px',
                    }}
                  >
                    ✉️ {pending.email} | 📞 {pending.phone || 'N/A'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleApproveStaff(pending)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#10b981',
                      color: '#ffffff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {locale === 'vi' ? 'Duyệt' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleRejectStaff(pending)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      backgroundColor: '#ffffff',
                      color: '#374151',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {locale === 'vi' ? 'Từ chối' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== MANAGERS SECTION (Owner Only) ===== */}
      {user?.role === 'owner' && (() => {
        const managerList = staffList.filter(s => s.role === 'manager');
        if (managerList.length === 0) return null;
        return (
          <div style={{
            marginBottom: '32px',
            backgroundColor: '#eff6ff',
            border: '1px solid #dbeafe',
            borderRadius: '14px',
            padding: '24px',
          }}>
            <h2 style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#1e40af',
              margin: '0 0 16px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span>👔</span>
              {locale === 'vi' ? 'Quản lý tiệm' : locale === 'de' ? 'Filialmanager' : 'Branch Managers'}
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: '#3b82f6',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '10px',
                marginLeft: '4px',
              }}>{managerList.length}</span>
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {managerList.map((mgr) => (
                <div
                  key={mgr.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}
                  onClick={() => setSelectedManager(mgr)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#93c5fd';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(59,130,246,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>{mgr.initials}</div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                        {mgr.name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span>👔 {locale === 'vi' ? 'Quản lý' : 'Manager'}</span>
                        <span>·</span>
                        <span>{mgr.languages.map((l) => getLanguageLabel(l, locale)).join(', ')}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      backgroundColor: mgr.status === 'active' ? '#dcfce7' : '#fee2e2',
                      color: mgr.status === 'active' ? '#166534' : '#991b1b',
                    }}>
                      {mgr.status === 'active'
                        ? (locale === 'vi' ? 'Đang hoạt động' : 'Active')
                        : (locale === 'vi' ? 'Ngừng hoạt động' : 'Inactive')}
                    </span>
                    <button
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        backgroundColor: '#ffffff',
                        color: '#374151',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStatus(mgr.id, mgr.status);
                      }}
                    >
                      {mgr.status === 'active'
                        ? (locale === 'vi' ? 'Vô hiệu hóa' : 'Deactivate')
                        : (locale === 'vi' ? 'Kích hoạt' : 'Activate')}
                    </button>
                    <span style={{ fontSize: '16px', color: '#9ca3af' }}>›</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ===== STAFF GRID (Thợ only) ===== */}
      {(() => {
        const staffOnlyList = staffList.filter(s => s.role !== 'manager');
        return (
          <>
            {user?.role === 'owner' && staffOnlyList.length > 0 && (
              <h2 style={{
                fontSize: '16px',
                fontWeight: 700,
                color: '#374151',
                margin: '0 0 16px 0',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <span>💅</span>
                {locale === 'vi' ? 'Thợ làm việc' : locale === 'de' ? 'Mitarbeiter' : 'Staff Members'}
                <span style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: '#111827',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  marginLeft: '4px',
                }}>{staffOnlyList.length}</span>
              </h2>
            )}
            <div className={styles.staffGrid}>
              {loading ? (
                <div className={styles.noBookings} style={{ gridColumn: '1 / -1' }}>
                  <p>{t.admin.staff.loading}</p>
                </div>
              ) : staffOnlyList.length === 0 ? (
                <div className={styles.noBookings} style={{ gridColumn: '1 / -1' }}>
                  <p>{t.admin.staff.empty}</p>
                </div>
              ) : (
                staffOnlyList.map((staff) => (
                  <div
                    key={staff.id}
                    className={`${styles.staffCard} ${styles.staffCardClickable}`}
                    onClick={() => handleOpenDetail(staff)}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.avatarCircle}>{staff.initials}</div>
                      <div className={styles.titleSection}>
                        <h3 className={styles.staffName}>{staff.name}</h3>
                        <span className={styles.roleLabel}>
                          {staff.staffType === 'main'
                            ? t.admin.staff.roleSenior
                            : t.admin.staff.roleJunior}
                        </span>
                      </div>
                      <span
                        className={`${styles.statusPill} ${
                          staff.status === 'active'
                            ? styles.statusActive
                            : styles.statusInactive
                        }`}
                      >
                        {staff.status === 'active'
                          ? t.admin.staff.statusActive
                          : t.admin.staff.statusInactive}
                      </span>
                    </div>

                    <div className={styles.cardBody}>
                      <div className={styles.detailRow}>
                        <span className={styles.label}>{t.admin.staff.labelRating}:</span>
                        <span className={styles.value}>⭐ {staff.rating.toFixed(1)} / 5.0</span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.label}>{t.admin.staff.labelLanguages}:</span>
                        <span className={styles.value}>
                          {staff.languages.map((lang) => getLanguageLabel(lang, locale)).join(', ')}
                        </span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.label}>{t.admin.staff.labelWorkDays}:</span>
                        <span className={styles.value}>
                          {staff.workDays.map((dayIdx) => currentWeekdayLabels[dayIdx]).join(', ')}
                        </span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.label}>{t.admin.staff.labelWorkHours}:</span>
                        <span className={styles.value}>⏰ {staff.workHours}</span>
                      </div>
                    </div>

                    <div className={styles.cardActions}>
                      <button
                        className={`${styles.actionBtn} ${
                          staff.status === 'active' ? styles.btnInactive : styles.btnActive
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(staff.id, staff.status);
                        }}
                      >
                        {staff.status === 'active'
                          ? t.admin.staff.btnDeactivate
                          : t.admin.staff.btnActivate}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        );
      })()}

      {/* ===== STAFF DETAIL MODAL ===== */}
      {selectedStaff && (
        <div className={styles.modalOverlay}>
          <div className={styles.detailModalContent}>
            {/* Header */}
            <div className={styles.detailModalHeader}>
              <div className={styles.avatarCircle}>
                {selectedStaff.initials}
              </div>
              <div className={styles.detailHeaderInfo}>
                <h2 className={styles.detailHeaderName}>
                  {ts.editStaff}
                </h2>
                <span className={styles.detailHeaderRole}>
                  {selectedStaff.name} ·{' '}
                  {selectedStaff.staffType === 'main'
                    ? ts.mainStaff
                    : ts.juniorStaff}
                </span>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={handleCloseDetail}
              >
                ✕
              </button>
            </div>

            {/* Tab Navigation */}
            <div className={styles.tabNav}>
              <button
                className={`${styles.tabBtn} ${
                  detailTab === 'profile' ? styles.tabBtnActive : ''
                }`}
                onClick={() => setDetailTab('profile')}
              >
                📋 {ts.profileTab}
              </button>
              <button
                className={`${styles.tabBtn} ${
                  detailTab === 'hours' ? styles.tabBtnActive : ''
                }`}
                onClick={() => setDetailTab('hours')}
              >
                🕐 {ts.workingHoursTab}
              </button>
              <button
                className={`${styles.tabBtn} ${
                  detailTab === 'services' ? styles.tabBtnActive : ''
                }`}
                onClick={() => setDetailTab('services')}
              >
                💅 {ts.servicesTab}
              </button>
              <button
                className={`${styles.tabBtn} ${
                  detailTab === 'absences' ? styles.tabBtnActive : ''
                }`}
                onClick={() => setDetailTab('absences')}
              >
                📅 {ts.absencesTab}
              </button>
              {selectedStaff.role === 'manager' && (
                <button
                  className={`${styles.tabBtn} ${
                    detailTab === 'branches' ? styles.tabBtnActive : ''
                  }`}
                  onClick={() => setDetailTab('branches')}
                >
                  🏢 {ts.branchAssignmentTab}
                </button>
              )}
            </div>

            {/* Tab Body */}
            <div className={styles.tabBody}>
              {/* ===== TAB 1: PROFILE ===== */}
              {detailTab === 'profile' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>{ts.staffName}</label>
                    <input
                      className={styles.formInput}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        {ts.staffType}
                      </label>
                      <select
                        className={styles.formSelect}
                        value={editStaffType}
                        onChange={(e) =>
                          setEditStaffType(
                            e.target.value as 'main' | 'junior'
                          )
                        }
                      >
                        <option value="main">{ts.mainStaff}</option>
                        <option value="junior">{ts.juniorStaff}</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        {ts.staffTitle}
                      </label>
                      <input
                        className={styles.formInput}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="e.g. Nail Technician"
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      {ts.languages}
                    </label>
                    <input
                      className={styles.formInput}
                      value={editLanguages}
                      onChange={(e) => setEditLanguages(e.target.value)}
                      placeholder="German, Vietnamese, English"
                    />
                    <p className={styles.formHint}>{ts.languagesHint}</p>
                  </div>

                  <div className={styles.toggleRow}>
                    <span className={styles.toggleLabel}>
                      {ts.activeStatus}:{' '}
                      {editStatus === 'active'
                        ? t.admin.staff.statusActive
                        : t.admin.staff.statusInactive}
                    </span>
                    <label className={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        checked={editStatus === 'active'}
                        onChange={(e) =>
                          setEditStatus(
                            e.target.checked ? 'active' : 'inactive'
                          )
                        }
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>

                  <button
                    className={styles.saveBtn}
                    onClick={handleSaveProfile}
                    disabled={saving}
                  >
                    {saving ? t.common.loading : t.common.save}
                  </button>
                </>
              )}

              {/* ===== TAB 2: WORKING HOURS ===== */}
              {detailTab === 'hours' && (
                <>
                  {hoursLoading ? (
                    <p>{t.common.loading}</p>
                  ) : (
                    <div className={styles.scheduleGrid}>
                      {workingHours.map((day) => (
                        <div
                          key={day.dayOfWeek}
                          className={`${styles.scheduleRow} ${
                            !day.isWorking ? styles.scheduleRowOff : ''
                          }`}
                        >
                          <span className={styles.scheduleDayName}>
                            {(ts.dayNames as readonly string[])[day.dayOfWeek]}
                          </span>
                          <div className={styles.scheduleToggle}>
                            <button
                              type="button"
                              className={`${styles.scheduleToggleBtn} ${
                                day.isWorking
                                  ? styles.scheduleToggleBtnOn
                                  : styles.scheduleToggleBtnOff
                              }`}
                              onClick={() =>
                                updateWorkingHour(
                                  day.dayOfWeek,
                                  'isWorking',
                                  !day.isWorking
                                )
                              }
                              title={
                                day.isWorking ? ts.working : ts.dayOff
                              }
                            />
                          </div>
                          {day.isWorking ? (
                            <>
                              <input
                                type="time"
                                className={styles.scheduleTimeInput}
                                value={day.startTime}
                                onChange={(e) =>
                                  updateWorkingHour(
                                    day.dayOfWeek,
                                    'startTime',
                                    e.target.value
                                  )
                                }
                              />
                              <input
                                type="time"
                                className={styles.scheduleTimeInput}
                                value={day.endTime}
                                onChange={(e) =>
                                  updateWorkingHour(
                                    day.dayOfWeek,
                                    'endTime',
                                    e.target.value
                                  )
                                }
                              />
                            </>
                          ) : (
                            <span className={styles.scheduleDayOff}>
                              {ts.dayOff}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    className={styles.saveBtn}
                    onClick={handleSaveWorkingHours}
                    disabled={saving || hoursLoading}
                  >
                    {saving ? t.common.loading : t.common.save}
                  </button>
                </>
              )}

              {/* ===== TAB 3: SERVICE ASSIGNMENT ===== */}
              {detailTab === 'services' && (
                <>
                  <p className={styles.serviceChecklistHint}>
                    {ts.selectServices}
                  </p>
                  {branchServices.length === 0 ? (
                    <div className={styles.emptyAbsences}>
                      {ts.noServicesAvailable}
                    </div>
                  ) : (
                    <div className={styles.serviceChecklist}>
                      {/* Select All checkbox */}
                      {(() => {
                        const activeServices = branchServices.filter((s) => s.isActive);
                        const allSelected = activeServices.length > 0 && activeServices.every((s) => selectedServiceIds.includes(s.id));
                        const someSelected = activeServices.some((s) => selectedServiceIds.includes(s.id)) && !allSelected;
                        return (
                          <div
                            className={`${styles.serviceCheckItem} ${styles.selectAllItem} ${allSelected ? styles.serviceCheckItemActive : ''}`}
                            onClick={() => {
                              if (allSelected) {
                                setSelectedServiceIds([]);
                              } else {
                                setSelectedServiceIds(activeServices.map((s) => s.id));
                              }
                            }}
                          >
                            <div
                              className={`${styles.serviceCheckbox} ${allSelected ? styles.serviceCheckboxChecked : ''} ${someSelected ? styles.serviceCheckboxPartial : ''}`}
                            >
                              {allSelected ? '✓' : someSelected ? '−' : ''}
                            </div>
                            <span className={styles.serviceCheckName} style={{ fontWeight: 600 }}>
                              {locale === 'vi' ? 'Chọn tất cả dịch vụ' : locale === 'de' ? 'Alle Dienste auswählen' : 'Select all services'}
                            </span>
                            <span className={styles.serviceCheckMeta}>
                              {selectedServiceIds.length}/{activeServices.length}
                            </span>
                          </div>
                        );
                      })()}
                      {branchServices
                        .filter((s) => s.isActive)
                        .map((svc) => {
                          const isSelected = selectedServiceIds.includes(
                            svc.id
                          );
                          return (
                            <div
                              key={svc.id}
                              className={`${styles.serviceCheckItem} ${
                                isSelected
                                  ? styles.serviceCheckItemActive
                                  : ''
                              }`}
                              onClick={() => toggleServiceId(svc.id)}
                            >
                              <div
                                className={`${styles.serviceCheckbox} ${
                                  isSelected
                                    ? styles.serviceCheckboxChecked
                                    : ''
                                }`}
                              >
                                {isSelected && '✓'}
                              </div>
                              <span className={styles.serviceCheckName}>
                                {getLocalizedName(svc)}
                              </span>
                              <span className={styles.serviceCheckMeta}>
                                {svc.durationMinutes}min · {svc.price}{' '}
                                {svc.currency}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  <button
                    className={styles.saveBtn}
                    onClick={handleSaveServices}
                    disabled={saving}
                  >
                    {saving ? t.common.loading : t.common.save}
                  </button>
                </>
              )}

              {/* ===== TAB 4: ABSENCES ===== */}
              {detailTab === 'absences' && (
                <div className={styles.absenceSection}>
                  {/* Add Absence Form */}
                  <div className={styles.absenceAddForm}>
                    <h4 className={styles.absenceAddTitle}>
                      ➕ {ts.addAbsence}
                    </h4>
                    <div className={styles.absenceFormRow}>
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>
                          {ts.absenceDate}
                        </label>
                        <input
                          type="date"
                          className={styles.formInput}
                          value={absenceDate}
                          onChange={(e) => setAbsenceDate(e.target.value)}
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <div className={styles.toggleRow}>
                          <span className={styles.toggleLabel}>
                            {ts.fullDay}
                          </span>
                          <label className={styles.toggleSwitch}>
                            <input
                              type="checkbox"
                              checked={absenceFullDay}
                              onChange={(e) =>
                                setAbsenceFullDay(e.target.checked)
                              }
                            />
                            <span className={styles.toggleTrack} />
                          </label>
                        </div>
                      </div>
                    </div>
                    {!absenceFullDay && (
                      <div className={styles.absenceFormRow}>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>
                            {ts.startTime}
                          </label>
                          <input
                            type="time"
                            className={styles.formInput}
                            value={absenceStartTime}
                            onChange={(e) =>
                              setAbsenceStartTime(e.target.value)
                            }
                          />
                        </div>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>
                            {ts.endTime}
                          </label>
                          <input
                            type="time"
                            className={styles.formInput}
                            value={absenceEndTime}
                            onChange={(e) =>
                              setAbsenceEndTime(e.target.value)
                            }
                          />
                        </div>
                      </div>
                    )}
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        {ts.absenceNote}
                      </label>
                      <input
                        className={styles.formInput}
                        value={absenceNote}
                        onChange={(e) => setAbsenceNote(e.target.value)}
                        placeholder={
                          locale === 'vi'
                            ? 'VD: Nghỉ ốm, nghỉ phép...'
                            : locale === 'de'
                            ? 'z.B. Krank, Urlaub...'
                            : 'e.g. Sick leave, vacation...'
                        }
                      />
                    </div>
                    <button
                      className={styles.absenceAddBtn}
                      onClick={handleAddAbsence}
                      disabled={saving || !absenceDate}
                    >
                      {saving ? t.common.loading : ts.addAbsence}
                    </button>
                  </div>

                  {/* Absences List */}
                  {absences.length === 0 ? (
                    <div className={styles.emptyAbsences}>
                      {ts.noAbsences}
                    </div>
                  ) : (
                    <div className={styles.absenceList}>
                      {absences.map((abs) => (
                        <div key={abs.id} className={styles.absenceItem}>
                          <div className={styles.absenceItemInfo}>
                            <span className={styles.absenceItemDate}>
                              📅 {abs.absenceDate}
                            </span>
                            <span className={styles.absenceItemDetail}>
                              {abs.isFullDay
                                ? ts.fullDay
                                : `${abs.startTime} - ${abs.endTime}`}
                              {abs.note && ` · ${abs.note}`}
                            </span>
                          </div>
                          <button
                            className={styles.absenceDeleteBtn}
                            onClick={() => handleDeleteAbsence(abs.id)}
                          >
                            {ts.deleteAbsence}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ===== TAB 5: BRANCH ASSIGNMENT (managers only) ===== */}
              {detailTab === 'branches' && selectedStaff.role === 'manager' && (
                <>
                  <p className={styles.serviceChecklistHint}>
                    {ts.selectBranches}
                  </p>
                  {branchesLoading ? (
                    <p>{t.common.loading}</p>
                  ) : businessBranches.length === 0 ? (
                    <div className={styles.emptyAbsences}>
                      {ts.noBranchesAvailable}
                    </div>
                  ) : (
                    <div className={styles.branchChecklist}>
                      {businessBranches.map((branch) => {
                        const isSelected = selectedBranchIds.includes(branch.id);
                        return (
                          <div
                            key={branch.id}
                            className={`${styles.branchCheckItem} ${
                              isSelected
                                ? styles.branchCheckItemActive
                                : ''
                            }`}
                            onClick={() => toggleBranchId(branch.id)}
                          >
                            <div
                              className={`${styles.serviceCheckbox} ${
                                isSelected
                                  ? styles.serviceCheckboxChecked
                                  : ''
                              }`}
                            >
                              {isSelected && '✓'}
                            </div>
                            <div className={styles.branchCheckInfo}>
                              <span className={styles.branchCheckName}>
                                {branch.name}
                              </span>
                              {branch.address && (
                                <span className={styles.branchCheckAddress}>
                                  {branch.address}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button
                    className={styles.saveBtn}
                    onClick={handleSaveBranchAssignment}
                    disabled={saving || branchesLoading}
                  >
                    {saving ? t.common.loading : t.common.save}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invitations Modal */}
      {showInviteModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {locale === 'vi'
                  ? 'Tạo mã mời nhân viên'
                  : locale === 'de'
                  ? 'Einladungscode erstellen'
                  : 'Generate Staff Invitation'}
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setShowInviteModal(false)}
              >
                ✕
              </button>
            </div>

            {!generatedCode ? (
              <div className={styles.modalBody}>
                {/* Branch selector - show when owner has multiple branches */}
                {(user?.assignedBranches?.length || 0) > 1 && (
                  <div className={styles.modalFormGroup}>
                    <label className={styles.modalLabel}>
                      {locale === 'vi'
                        ? '🏪 Chọn tiệm'
                        : locale === 'de'
                        ? '🏪 Filiale wählen'
                        : '🏪 Select Branch'}
                    </label>
                    <select
                      className={styles.modalSelect}
                      value={inviteBranchId}
                      onChange={(e) => setInviteBranchId(e.target.value)}
                    >
                      {(user?.assignedBranches || []).map((bid) => (
                        <option key={bid} value={bid}>{bid}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Show current branch info when only 1 branch */}
                {(user?.assignedBranches?.length || 0) <= 1 && (
                  <div style={{
                    padding: '10px 14px',
                    backgroundColor: '#f0fdf4',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#166534',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <span>🏪</span>
                    <span>{locale === 'vi' ? 'Tiệm:' : 'Branch:'} <strong>{branchId}</strong></span>
                  </div>
                )}

                <div className={styles.modalFormGroup}>
                  <label className={styles.modalLabel}>
                    {locale === 'vi'
                      ? 'Quyền hạn'
                      : locale === 'de'
                      ? 'Rolle'
                      : 'System Role'}
                  </label>
                  <select
                    className={styles.modalSelect}
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(e.target.value as any)
                    }
                  >
                    <option value="staff">
                      {locale === 'vi'
                        ? 'Nhân viên (Staff)'
                        : locale === 'de'
                        ? 'Mitarbeiter'
                        : 'Staff Member'}
                    </option>
                    <option value="manager">
                      {locale === 'vi'
                        ? 'Quản lý (Manager)'
                        : locale === 'de'
                        ? 'Manager'
                        : 'Manager'}
                    </option>
                  </select>
                </div>

                {inviteRole === 'staff' && (
                  <div className={styles.modalFormGroup}>
                    <label className={styles.modalLabel}>
                      {locale === 'vi'
                        ? 'Phân loại thợ'
                        : locale === 'de'
                        ? 'Mitarbeiter-Typ'
                        : 'Staff Practitioner Type'}
                    </label>
                    <select
                      className={styles.modalSelect}
                      value={inviteStaffType}
                      onChange={(e) =>
                        setInviteStaffType(e.target.value as any)
                      }
                    >
                      <option value="main">
                        {t.admin.staff.roleSenior}
                      </option>
                      <option value="junior">
                        {t.admin.staff.roleJunior}
                      </option>
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={handleGenerateInvite}
                >
                  {locale === 'vi'
                    ? 'Tạo mã mời'
                    : locale === 'de'
                    ? 'Code generieren'
                    : 'Generate Invitation Code'}
                </button>
              </div>
            ) : (
              <div className={styles.modalBody}>
                <div className={styles.inviteCodeBox}>
                  <div className={styles.inviteCode}>{generatedCode}</div>
                  <div className={styles.inviteInstructions}>
                    {locale === 'vi'
                      ? `Mã mời dành cho vai trò: ${
                          inviteRole === 'manager'
                            ? 'Quản lý'
                            : inviteStaffType === 'main'
                            ? 'Thợ chính'
                            : 'Thợ phụ'
                        }`
                      : locale === 'de'
                      ? `Einladungscode für: ${
                          inviteRole === 'manager'
                            ? 'Manager'
                            : inviteStaffType === 'main'
                            ? 'Hauptkraft (Senior)'
                            : 'Hilfskraft (Junior)'
                        }`
                      : `Invitation code configured for: ${
                          inviteRole === 'manager'
                            ? 'Manager'
                            : inviteStaffType === 'main'
                            ? 'Senior Practitioner'
                            : 'Junior Practitioner'
                        }`}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#6b7280',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    <span>🏪</span>
                    <span>{locale === 'vi' ? 'Tiệm:' : 'Branch:'} <strong>{inviteBranchId || branchId}</strong></span>
                  </div>
                </div>

                <button
                  type="button"
                  className={`${styles.copyBtn} ${
                    copied ? styles.copyBtnSuccess : ''
                  }`}
                  onClick={handleCopyCode}
                >
                  {copied
                    ? locale === 'vi'
                      ? 'Đã sao chép! ✓'
                      : locale === 'de'
                      ? 'Kopiert! ✓'
                      : 'Copied! ✓'
                    : locale === 'vi'
                    ? 'Sao chép mã mời'
                    : locale === 'de'
                    ? 'Code kopieren'
                    : 'Copy Invitation Code'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== MANAGER DETAIL MODAL (Owner Only - Simple) ===== */}
      {selectedManager && (
        <div className={styles.modalOverlay}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '480px',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }}>
            {/* Header */}
            <div style={{
              padding: '24px 24px 20px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
            }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '18px',
                fontWeight: 700,
                flexShrink: 0,
              }}>{selectedManager.initials}</div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                  {selectedManager.name}
                </h2>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>
                  👔 {locale === 'vi' ? 'Quản lý' : locale === 'de' ? 'Manager' : 'Manager'}
                </span>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setSelectedManager(null)}
              >✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px' }}>
              {/* Status */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                backgroundColor: selectedManager.status === 'active' ? '#f0fdf4' : '#fef2f2',
                borderRadius: '10px',
                marginBottom: '20px',
              }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                    {locale === 'vi' ? 'Trạng thái tài khoản' : 'Account Status'}
                  </div>
                  <div style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    color: selectedManager.status === 'active' ? '#166534' : '#991b1b',
                  }}>
                    {selectedManager.status === 'active'
                      ? (locale === 'vi' ? '✅ Đang hoạt động' : '✅ Active')
                      : (locale === 'vi' ? '❌ Đã vô hiệu hóa' : '❌ Deactivated')}
                  </div>
                </div>
                <button
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: selectedManager.status === 'active' ? '#ef4444' : '#22c55e',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  onClick={async () => {
                    await handleToggleStatus(selectedManager.id, selectedManager.status);
                    setSelectedManager({
                      ...selectedManager,
                      status: selectedManager.status === 'active' ? 'inactive' : 'active',
                    });
                  }}
                >
                  {selectedManager.status === 'active'
                    ? (locale === 'vi' ? 'Vô hiệu hóa' : 'Deactivate')
                    : (locale === 'vi' ? 'Kích hoạt' : 'Activate')}
                </button>
              </div>

              {/* Info */}
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '20px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                  {locale === 'vi' ? 'Thông tin' : 'Information'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                    <span style={{ color: '#6b7280' }}>{locale === 'vi' ? 'Ngôn ngữ' : 'Languages'}</span>
                    <span style={{ color: '#111827', fontWeight: 500 }}>
                      {selectedManager.languages.map((l) => getLanguageLabel(l, locale)).join(', ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                    <span style={{ color: '#6b7280' }}>{locale === 'vi' ? 'Chi nhánh quản lý' : 'Branch'}</span>
                    <span style={{ color: '#111827', fontWeight: 500 }}>
                      {branchId}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                    <span style={{ color: '#6b7280' }}>{locale === 'vi' ? 'Đánh giá' : 'Rating'}</span>
                    <span style={{ color: '#111827', fontWeight: 500 }}>
                      ⭐ {selectedManager.rating.toFixed(1)} / 5.0
                    </span>
                  </div>
                </div>
              </div>

              {/* Permissions summary */}
              <div style={{
                backgroundColor: '#eff6ff',
                borderRadius: '10px',
                padding: '16px',
                border: '1px solid #dbeafe',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af', marginBottom: '10px' }}>
                  {locale === 'vi' ? '🔑 Quyền quản lý' : '🔑 Permissions'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#374151' }}>
                  <div>✅ {locale === 'vi' ? 'Quản lý lịch hẹn' : 'Manage bookings'}</div>
                  <div>✅ {locale === 'vi' ? 'Quản lý thợ (chỉ xem thợ)' : 'Manage staff (staff only)'}</div>
                  <div>✅ {locale === 'vi' ? 'Quản lý dịch vụ' : 'Manage services'}</div>
                  <div>❌ {locale === 'vi' ? 'Quản lý chi nhánh' : 'Manage branches'}</div>
                  <div>❌ {locale === 'vi' ? 'Xem tài khoản quản lý khác' : 'View other managers'}</div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#374151',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedManager(null)}
              >
                {locale === 'vi' ? 'Đóng' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.type === 'success'
              ? styles.toastSuccess
              : styles.toastError
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
