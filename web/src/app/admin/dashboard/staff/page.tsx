'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Clock, 
  Scissors, 
  Calendar, 
  Store, 
  ShieldAlert, 
  Mail, 
  Phone, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  ChevronRight, 
  ArrowLeft, 
  Settings, 
  Gem, 
  Globe, 
  Palmtree, 
  Tag, 
  CalendarDays,
  Sparkles
} from 'lucide-react';
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
import { getGermanTodayString } from '@/lib/timeUtils';
import styles from './page.module.css';

// ===== Helper Functions =====

const isFirstFiveBlockService = (name: string) => {
  const n = name.toLowerCase();
  return (
    n.includes('neumodellage mit gel') ||
    n.includes('auffüllen mit gel') ||
    n.includes('neumodellage mit acryl') ||
    n.includes('auffüllen mit acryl') ||
    n.includes('wimpern')
  );
};

const getStaffAvatarStyle = (name: string) => {
  const code = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const index = code % 5;
  switch (index) {
    case 0:
      return { backgroundColor: '#EFF6FF', color: '#1D4ED8' }; // blue
    case 1:
      return { backgroundColor: '#FAF5FF', color: '#7C3AED' }; // purple
    case 2:
      return { backgroundColor: '#FDF2F8', color: '#DB2777' }; // pink
    case 3:
      return { backgroundColor: '#F0FDF4', color: '#059669' }; // green
    case 4:
    default:
      return { backgroundColor: '#FEF3C7', color: '#D97706' }; // orange/yellow
  }
};

const getCategoryColorTheme = (id: string) => {
  switch (id) {
    case 'cat-gel':
      return { border: '#1D4ED8', text: '#1D4ED8', circleBg: '#EFF6FF' };
    case 'cat-auffuellen-gel':
      return { border: '#7C3AED', text: '#7C3AED', circleBg: '#FAF5FF' };
    case 'cat-acryl':
      return { border: '#059669', text: '#059669', circleBg: '#F0FDF4' };
    case 'cat-auffuellen-acryl':
      return { border: '#D97706', text: '#D97706', circleBg: '#FEF3C7' };
    case 'cat-zehen':
      return { border: '#EC4899', text: '#EC4899', circleBg: '#FDF2F8' };
    case 'cat-mani':
      return { border: '#0D9488', text: '#0D9488', circleBg: '#F0FDFA' };
    case 'cat-pedi':
      return { border: '#0284C7', text: '#0284C7', circleBg: '#F0F9FF' };
    case 'cat-wimpern':
      return { border: '#8B5CF6', text: '#8B5CF6', circleBg: '#F5F3FF' };
    case 'cat-abloesung':
      return { border: '#EF4444', text: '#EF4444', circleBg: '#FEF2F2' };
    default:
      return { border: '#4B5563', text: '#4B5563', circleBg: '#F3F4F6' };
  }
};

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

interface AbsencePeriod {
  id: string;
  ids: string[];
  startDate: string;
  endDate: string;
  note: string;
  isFullDay: boolean;
  startTime: string | null;
  endTime: string | null;
}

interface ServiceData {
  id: string;
  name: string;
  nameLocalized?: { vi?: string; en?: string; de?: string };
  description?: string;
  descriptionLocalized?: { vi?: string; en?: string; de?: string };
  durationMinutes: number;
  price: number;
  currency: string;
  categoryId: string;
  isActive: boolean;
}

interface CategoryData {
  id: string;
  name: string;
  nameLocalized?: { vi?: string; en?: string; de?: string };
  description?: string;
  descriptionLocalized?: { vi?: string; en?: string; de?: string };
  isActive: boolean;
  displayOrder: number;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

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

const getDatesInRange = (startStr: string, endStr: string) => {
  const dates = [];
  const start = new Date(startStr);
  const end = new Date(endStr);
  const temp = new Date(start);
  while (temp <= end) {
    dates.push(temp.toISOString().slice(0, 10));
    temp.setDate(temp.getDate() + 1);
  }
  return dates;
};

const groupConsecutiveAbsences = (list: AbsenceData[]): AbsencePeriod[] => {
  if (list.length === 0) return [];
  const sorted = [...list].sort((a, b) => a.absenceDate.localeCompare(b.absenceDate));
  
  const periods: AbsencePeriod[] = [];
  let currentPeriod: AbsencePeriod = {
    id: sorted[0].id,
    ids: [sorted[0].id],
    startDate: sorted[0].absenceDate,
    endDate: sorted[0].absenceDate,
    note: sorted[0].note,
    isFullDay: sorted[0].isFullDay,
    startTime: sorted[0].startTime,
    endTime: sorted[0].endTime,
  };
  
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prevDate = new Date(currentPeriod.endDate);
    const currDate = new Date(item.absenceDate);
    const diffTime = Math.abs(currDate.getTime() - prevDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1 && item.note === currentPeriod.note && item.isFullDay === currentPeriod.isFullDay) {
      currentPeriod.endDate = item.absenceDate;
      currentPeriod.ids.push(item.id);
    } else {
      periods.push(currentPeriod);
      currentPeriod = {
        id: item.id,
        ids: [item.id],
        startDate: item.absenceDate,
        endDate: item.absenceDate,
        note: item.note,
        isFullDay: item.isFullDay,
        startTime: item.startTime,
        endTime: item.endTime,
      };
    }
  }
  periods.push(currentPeriod);
  return periods;
};

const formatAbsencePeriodDate = (period: AbsencePeriod, loc: string) => {
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);
  
  const startDay = String(start.getDate()).padStart(2, '0');
  const endDay = String(end.getDate()).padStart(2, '0');
  
  const month = start.getMonth() + 1;
  const year = start.getFullYear();
  
  let monthStr = '';
  if (loc === 'vi') {
    monthStr = `Tháng ${month}, ${year}`;
  } else if (loc === 'de') {
    const monthNamesDe = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    monthStr = `${monthNamesDe[start.getMonth()]} ${year}`;
  } else {
    const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    monthStr = `${monthNamesEn[start.getMonth()]} ${year}`;
  }
  
  const dayText = period.startDate === period.endDate ? startDay : `${startDay} - ${endDay}`;
  return { dayText, monthStr };
};

// ===== Custom SVG Icons =====
const CategoryIcon = ({ id, className = "w-4 h-4" }: { id: string; className?: string }) => {
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
          <path d="M6 3h12l-1 9H7z" />
          <path d="M4 12h16a2 2 0 0 1 2 2v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-5a2 2 0 0 1 2-2z" />
          <circle cx="12" cy="17" r="1.5" />
        </svg>
      );
    case 'cat-auffuellen-acryl':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M7.5 10.5c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5z" />
          <path d="M11.5 7.5c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5z" />
          <path d="M16.5 10.5c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5z" />
          <path d="M6 14h12" />
        </svg>
      );
    case 'cat-zehen':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
          <path d="M9 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
          <path d="M13 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
          <path d="M17 8a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z" />
          <path d="M21 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          <path d="M4 13c1.5 0 3-1 4.5-1s2.5.5 3.5 1.5 2.5 1 4 1 3-1 4-2" />
          <path d="M3 13v6a2 2 0 0 0 2 2h13a3 3 0 0 0 3-3v-5" />
        </svg>
      );
    case 'cat-mani':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
          <path d="M14 10V5a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
          <path d="M10 10V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
          <path d="M6 14V9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v7" />
          <path d="M3 16c0 4 3 6 6 6h6c3 0 6-2 6-6V13l-3-2-3 2v-2l-3 1v-2l-3 1-3-1z" />
        </svg>
      );
    case 'cat-pedi':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
          <path d="M10.5 8.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z" />
          <path d="M14.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          <path d="M18 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          <path d="M3 13.5v5A3.5 3.5 0 0 0 6.5 22h10a3.5 3.5 0 0 0 3.5-3.5v-7" />
          <path d="M3 13.5c1.5-1 3.5-1.5 5.5-1s4.5 2 6 2 3.5-1.5 5-2.5" />
        </svg>
      );
    case 'cat-wimpern':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 10a10 10 0 0 0 20 0" />
          <path d="M6 11l-2 3" />
          <path d="M10 11.5L9 15" />
          <path d="M14 11.5l1 3.5" />
          <path d="M18 11l2 3" />
        </svg>
      );
    case 'cat-abloesung':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      );
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
  }
};

export default function StaffManagementPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  
  // Core lists
  const [staffList, setStaffList] = useState<DisplayStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // States matching mockup subpage
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<'profile' | 'hours' | 'services' | 'absences' | 'createAbsence' | 'branches' | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'inactive' | 'active'>('all');
  
  // Stats
  const [monthlyBookingsCount, setMonthlyBookingsCount] = useState<number>(0);

  // Invitation invite codes
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff');
  const [inviteStaffType, setInviteStaffType] = useState<'main' | 'junior'>('main');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Pending staff requests
  const [pendingStaff, setPendingStaff] = useState<any[]>([]);

  // Selected staff details
  const [selectedStaff, setSelectedStaff] = useState<DisplayStaffMember | null>(null);

  // Profile Drawer form state
  const [editName, setEditName] = useState('');
  const [editStaffType, setEditStaffType] = useState<'main' | 'junior'>('main');
  const [editLanguages, setEditLanguages] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');

  // Working Hours Drawer state
  const [workingHours, setWorkingHours] = useState<WorkingHoursDay[]>([]);
  const [hoursLoading, setHoursLoading] = useState(false);

  // Services Drawer state
  const [branchServices, setBranchServices] = useState<ServiceData[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  // Absences Drawer state
  const [absences, setAbsences] = useState<AbsenceData[]>([]);
  const [absenceStartDate, setAbsenceStartDate] = useState('');
  const [absenceEndDate, setAbsenceEndDate] = useState('');
  const [absenceFullDay, setAbsenceFullDay] = useState(true);
  const [absenceStartTime, setAbsenceStartTime] = useState('09:00');
  const [absenceEndTime, setAbsenceEndTime] = useState('18:00');
  const [absenceNote, setAbsenceNote] = useState('');

  // Branch assignment drawer state (for managers)
  const [businessBranches, setBusinessBranches] = useState<BranchData[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;

  const branchId = user?.assignedBranches?.[0] || 'glamour-nails-berlin';
  const ts = t.admin.staff;

  // Toast Helper
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const getLocalizedName = (item: { name: string; nameLocalized?: { vi?: string; en?: string; de?: string } }) => {
    if (item.nameLocalized) {
      const localized = item.nameLocalized[locale as 'vi' | 'en' | 'de'];
      if (localized) return localized;
    }
    return item.name;
  };

  const getLocalizedDescription = (item: { description?: string; descriptionLocalized?: { vi?: string; en?: string; de?: string } }) => {
    if (item.descriptionLocalized) {
      const localized = item.descriptionLocalized[locale as 'vi' | 'en' | 'de'];
      if (localized) return localized;
    }
    return item.description || '';
  };

  // Sync Pending Staff Approvals
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

  // Sync Staff Members in real-time
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

  // Sync Branch Services & Categories
  useEffect(() => {
    if (!user || !branchId) return;

    const catRef = collection(db, 'branches', branchId, 'categories');
    const unsubscribeCats = onSnapshot(
      catRef,
      (snap) => {
        const list: CategoryData[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || '',
            nameLocalized: d.nameLocalized,
            description: d.description || '',
            descriptionLocalized: d.descriptionLocalized,
            isActive: d.isActive !== false,
            displayOrder: d.displayOrder || 0,
          });
        });
        list.sort((a, b) => a.displayOrder - b.displayOrder);
        setCategories(list);
        setExpandedCategories(new Set(list.map(c => c.id)));
      },
      (err) => {
        console.error('Error listening to categories:', err);
      }
    );

    const svcRef = collection(db, 'branches', branchId, 'services');
    const unsubscribeSvcs = onSnapshot(
      svcRef,
      (snap) => {
        const list: ServiceData[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name,
            nameLocalized: d.nameLocalized,
            description: d.description || '',
            descriptionLocalized: d.descriptionLocalized,
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

    return () => {
      unsubscribeCats();
      unsubscribeSvcs();
    };
  }, [user, branchId]);

  // Load Working Hours
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

  // Load Absences
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

  // Load Branches (Managers only)
  const loadBranchesForAssignment = useCallback(
    async (staff: DisplayStaffMember) => {
      if (staff.role !== 'manager' || !user?.businessId) {
        setBusinessBranches([]);
        setSelectedBranchIds([]);
        return;
      }
      setBranchesLoading(true);
      try {
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

  // Query Monthly Bookings Count
  const fetchMonthlyBookings = useCallback(
    async (staffId: string) => {
      try {
        const bookingsRef = collection(db, 'branches', branchId, 'bookings');
        const q = query(bookingsRef, where('staffId', '==', staffId));
        const snap = await getDocs(q);
        const currentMonthPrefix = new Date().toISOString().slice(0, 7); // e.g. "2026-06"
        const count = snap.docs.filter(docSnap => {
          const data = docSnap.data();
          const date = data.appointmentDate || '';
          const status = data.status || '';
          return date.startsWith(currentMonthPrefix) && !status.includes('cancelled');
        }).length;
        setMonthlyBookingsCount(count);
      } catch (err) {
        console.error('Error fetching monthly bookings:', err);
        setMonthlyBookingsCount(0);
      }
    },
    [branchId]
  );

  // Open Detail Screen
  const handleOpenDetail = useCallback(
    (staff: DisplayStaffMember) => {
      setSelectedStaff(staff);
      setActiveStaffId(staff.id);
      
      // Populate fields
      setEditName(staff.name);
      setEditStaffType(staff.staffType);
      setEditLanguages(staff.languages.join(', '));
      setEditTitle(staff.title || '');
      setEditStatus(staff.status);
      setSelectedServiceIds([...staff.serviceIds]);
      
      // Sub-collections load
      loadWorkingHours(staff.id);
      loadAbsences(staff.id);
      loadBranchesForAssignment(staff);
      fetchMonthlyBookings(staff.id);
    },
    [loadWorkingHours, loadAbsences, loadBranchesForAssignment, fetchMonthlyBookings]
  );

  const handleCloseDetail = () => {
    setSelectedStaff(null);
    setActiveStaffId(null);
    setActiveDrawer(null);
  };

  // Save Profile
  const handleSaveProfile = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      const staffDocRef = doc(db, 'branches', branchId, 'staff', selectedStaff.id);
      const langArray = editLanguages
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      
      const initials = editName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

      await updateDoc(staffDocRef, {
        name: editName,
        staffType: editStaffType,
        languages: langArray,
        title: editTitle,
        status: editStatus,
        initials,
      });
      
      // Update selectedStaff state
      setSelectedStaff(prev => prev ? {
        ...prev,
        name: editName,
        staffType: editStaffType,
        languages: langArray,
        title: editTitle,
        status: editStatus,
        initials,
      } : null);

      showToast(ts.saveSuccess, 'success');
      setActiveDrawer(null);
    } catch (err) {
      console.error('Error saving profile:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Save Working Hours
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
      setActiveDrawer(null);
    } catch (err) {
      console.error('Error saving working hours:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Save Service Assignment
  const handleSaveServices = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      const staffDocRef = doc(db, 'branches', branchId, 'staff', selectedStaff.id);
      await updateDoc(staffDocRef, {
        serviceIds: selectedServiceIds,
      });
      
      // Update selectedStaff state
      setSelectedStaff(prev => prev ? { ...prev, serviceIds: selectedServiceIds } : null);

      showToast(ts.saveSuccess, 'success');
      setActiveDrawer(null);
    } catch (err: any) {
      console.error('Error saving services:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Save Branch Assignment
  const handleSaveBranchAssignment = async () => {
    if (!selectedStaff || !user) return;
    setSaving(true);
    try {
      let targetUid: string | null = selectedStaff.userUid;

      if (!targetUid) {
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
      setActiveDrawer(null);
    } catch (err) {
      console.error('Error saving branch assignment:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Toggle Branch selection
  const toggleBranchId = (branchIdToToggle: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchIdToToggle)
        ? prev.filter((id) => id !== branchIdToToggle)
        : [...prev, branchIdToToggle]
    );
  };

  // Add Absence (Range support)
  const handleAddAbsence = async () => {
    if (!selectedStaff || !user || !absenceStartDate) return;
    setSaving(true);
    try {
      const dates = getDatesInRange(absenceStartDate, absenceEndDate || absenceStartDate);
      const batch = writeBatch(db);
      const germanToday = getGermanTodayString();

      for (const date of dates) {
        const absId = `abs-${date}-${Date.now()}`;
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
          absenceDate: date,
          startTime: absenceFullDay ? null : absenceStartTime,
          endTime: absenceFullDay ? null : absenceEndTime,
          isFullDay: absenceFullDay,
          note: absenceNote,
          createdBy: user.uid || '',
          createdAt: new Date().toISOString(),
        };

        batch.set(absRef, absData);

        // Booking reconciliation
        const isPlannedLeave = date !== germanToday;
        if (isPlannedLeave) {
          const bookingsRef = collection(db, 'branches', branchId, 'bookings');
          const bookingsSnap = await getDocs(query(bookingsRef, where('appointmentDate', '==', date)));
          const bookingsOnDate: any[] = [];
          bookingsSnap.forEach(d => {
            const data = d.data();
            if (data.status !== 'cancelled' && data.status !== 'cancelled_by_salon' && data.status !== 'cancelled_by_customer') {
              bookingsOnDate.push({ id: d.id, ...data });
            }
          });

          const overlappingBookings = bookingsOnDate.filter(booking => {
            if (booking.staffId !== selectedStaff.id) return false;
            if (absenceFullDay) return true;

            const [bh, bm] = booking.startTime.split(':').map(Number);
            const bookingStart = bh * 60 + bm;
            const bookingEnd = bookingStart + (booking.totalDurationMinutes || 30);

            const [ash, asm] = absenceStartTime.split(':').map(Number);
            const [aeh, aem] = absenceEndTime.split(':').map(Number);
            const absStart = ash * 60 + asm;
            const absEnd = aeh * 60 + aem;

            return bookingStart < absEnd && bookingEnd > absStart;
          });

          if (overlappingBookings.length > 0) {
            const otherStaff = staffList.filter(s => s.id !== selectedStaff.id && s.status === 'active');
            const otherStaffDetails: Record<string, { workingHours: any[], absences: any[] }> = {};

            await Promise.all(otherStaff.map(async (staff) => {
              const hoursSnap = await getDocs(collection(db, 'branches', branchId, 'staff', staff.id, 'workingHours'));
              const absSnap = await getDocs(collection(db, 'branches', branchId, 'staff', staff.id, 'absences'));
              otherStaffDetails[staff.id] = {
                workingHours: hoursSnap.docs.map(d => d.data()),
                absences: absSnap.docs.map(d => d.data())
              };
            }));

            const isStaffAvailable = (staffId: string, dateStr: string, bookingStart: number, bookingEnd: number) => {
              const dateObj = new Date(dateStr + 'T00:00:00');
              const dayOfWeek = (dateObj.getDay() + 6) % 7;

              const details = otherStaffDetails[staffId];
              if (!details) return false;

              const schedule = details.workingHours.find(h => h.dayOfWeek === dayOfWeek);
              let isWorking = false;
              let workStart = 9 * 60;
              let workEnd = (dayOfWeek === 5 ? 16 : 18) * 60;

              if (schedule) {
                if (!schedule.isWorking) return false;
                isWorking = true;
                const [sh, sm] = schedule.startTime.split(':').map(Number);
                const [eh, em] = schedule.endTime.split(':').map(Number);
                workStart = sh * 60 + sm;
                workEnd = eh * 60 + em;
              } else {
                isWorking = dayOfWeek !== 6;
              }

              if (!isWorking || bookingStart < workStart || bookingEnd > workEnd) {
                return false;
              }

              const isAbsent = details.absences.some(abs => {
                if (abs.absenceDate !== dateStr) return false;
                if (abs.isFullDay) return true;
                if (abs.startTime && abs.endTime) {
                  const [sh, sm] = abs.startTime.split(':').map(Number);
                  const [eh, em] = abs.endTime.split(':').map(Number);
                  const absStart = sh * 60 + sm;
                  const absEnd = eh * 60 + em;
                  return bookingStart < absEnd && bookingEnd > absStart;
                }
                return false;
              });

              if (isAbsent) return false;

              const hasOverlap = bookingsOnDate.some(b => {
                if (b.staffId !== staffId) return false;
                const [bh, bm] = b.startTime.split(':').map(Number);
                const bStart = bh * 60 + bm;
                const bEnd = bStart + (b.totalDurationMinutes || 30);
                return bookingStart < bEnd && bookingEnd > bStart;
              });

              return !hasOverlap;
            };

            const getNextAvailableDate = async (staffId: string, baseDateStr: string, startTime: string) => {
              let hoursList: any[] = [];
              let absencesList: any[] = [];

              try {
                const hoursSnap = await getDocs(collection(db, 'branches', branchId, 'staff', staffId, 'workingHours'));
                hoursList = hoursSnap.docs.map(d => d.data());
                const absencesSnap = await getDocs(collection(db, 'branches', branchId, 'staff', staffId, 'absences'));
                absencesList = absencesSnap.docs.map(d => d.data());
              } catch (e) {
                console.error(e);
              }

              const baseDate = new Date(baseDateStr + 'T00:00:00');
              const [sh, sm] = startTime.split(':').map(Number);
              const slotStart = sh * 60 + sm;

              for (let i = 1; i <= 14; i++) {
                const checkDate = new Date(baseDate);
                checkDate.setDate(baseDate.getDate() + i);
                const checkDateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
                const dayOfWeek = (checkDate.getDay() + 6) % 7;

                const schedule = hoursList.find(h => h.dayOfWeek === dayOfWeek);
                let isWorking = false;
                let workStart = 9 * 60;
                let workEnd = (dayOfWeek === 5 ? 16 : 18) * 60;

                if (schedule) {
                  if (schedule.isWorking) {
                    isWorking = true;
                    const [hStart, mStart] = schedule.startTime.split(':').map(Number);
                    const [hEnd, mEnd] = schedule.endTime.split(':').map(Number);
                    workStart = hStart * 60 + mStart;
                    workEnd = hEnd * 60 + mEnd;
                  }
                } else {
                  isWorking = dayOfWeek !== 6;
                }

                if (!isWorking || slotStart < workStart || slotStart > workEnd) continue;

                const isAbsent = absencesList.some(abs => {
                  if (abs.absenceDate !== checkDateStr) return false;
                  if (abs.isFullDay) return true;
                  if (abs.startTime && abs.endTime) {
                    const [ash, asm] = abs.startTime.split(':').map(Number);
                    const [aeh, aem] = abs.endTime.split(':').map(Number);
                    return slotStart < aem * 60 && slotStart >= ash * 60;
                  }
                  return false;
                });

                if (isAbsent) continue;

                const bookingsSnap = await getDocs(query(collection(db, 'branches', branchId, 'bookings'), where('appointmentDate', '==', checkDateStr)));
                const dayBookings = bookingsSnap.docs.map(d => d.data());
                const hasOverlap = dayBookings.some((b: any) => {
                  if (b.staffId !== staffId || b.status === 'cancelled') return false;
                  const [bh, bm] = b.startTime.split(':').map(Number);
                  const bStart = bh * 60 + bm;
                  const bEnd = bStart + (b.totalDurationMinutes || 30);
                  return slotStart >= bStart && slotStart < bEnd;
                });

                if (!hasOverlap) {
                  return checkDateStr;
                }
              }

              const fallbackDate = new Date(baseDate);
              fallbackDate.setDate(baseDate.getDate() + 1);
              return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}-${String(fallbackDate.getDate()).padStart(2, '0')}`;
            };

            for (const booking of overlappingBookings) {
              const bookingRef = doc(db, 'branches', branchId, 'bookings', booking.id);

              if (booking.staffSelectionType === 'specific') {
                const suggestedDate = await getNextAvailableDate(selectedStaff.id, booking.appointmentDate, booking.startTime);
                batch.update(bookingRef, {
                  status: 'cancelled',
                  cancelledAt: new Date().toISOString(),
                  cancelledReason: locale === 'vi' 
                    ? 'Thợ nghỉ phép theo lịch' 
                    : locale === 'de' 
                    ? 'Mitarbeiter im geplanten Urlaub' 
                    : 'Staff on planned leave',
                  smsConfirmationSent: true,
                  suggestedRebookDate: suggestedDate
                });

                const logId = `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                const logRef = doc(db, 'branches', branchId, 'auditLogs', logId);
                batch.set(logRef, {
                  id: logId,
                  branchId,
                  appointmentId: booking.id,
                  eventType: 'cancelled_by_system',
                  actorUid: user.uid,
                  actorRole: 'system',
                  details: {
                    reason: 'staff_absence_reconciliation',
                    staffName: selectedStaff.name,
                    suggestedRebookDate: suggestedDate,
                    smsText: locale === 'vi'
                      ? `Lịch hẹn ${booking.services.join(', ')} lúc ${booking.startTime} ngày ${booking.appointmentDate} đã bị hủy do thợ nghỉ phép. Gợi ý lịch gần nhất có thể đặt lại: ngày ${suggestedDate} lúc ${booking.startTime}.`
                      : locale === 'de'
                      ? `Ihr Termin für ${booking.services.join(', ')} am ${booking.appointmentDate} um ${booking.startTime} wurde storniert, da der Mitarbeiter im Urlaub ist. Nächster freier Termin: ${suggestedDate} um ${booking.startTime}.`
                      : `Your appointment for ${booking.services.join(', ')} on ${booking.appointmentDate} at ${booking.startTime} was cancelled due to staff leave. Nearest suggestion: ${suggestedDate} at ${booking.startTime}.`
                  },
                  createdAt: new Date().toISOString()
                });
              } else {
                const [bh, bm] = booking.startTime.split(':').map(Number);
                const bookingStart = bh * 60 + bm;
                const bookingEnd = bookingStart + (booking.totalDurationMinutes || 30);

                const candidates = otherStaff.filter(staff => {
                  const hasFirstFiveBlock = booking.services.some((sName: string) => isFirstFiveBlockService(sName));
                  if (hasFirstFiveBlock && staff.staffType !== 'main') return false;

                  if (booking.serviceIds && booking.serviceIds.length > 0) {
                    return booking.serviceIds.every((id: string) => (staff.serviceIds || []).includes(id));
                  }
                  return true;
                });

                const sortedCandidates = [...candidates].sort((a, b) => {
                  const aType = a.staffType || 'main';
                  const bType = b.staffType || 'main';
                  if (aType === 'junior' && bType === 'main') return -1;
                  if (aType === 'main' && bType === 'junior') return 1;
                  return 0;
                });

                let newStaff = null;
                for (const candidate of sortedCandidates) {
                  if (isStaffAvailable(candidate.id, booking.appointmentDate, bookingStart, bookingEnd)) {
                    newStaff = candidate;
                    break;
                  }
                }

                if (newStaff) {
                  batch.update(bookingRef, {
                    staffId: newStaff.id,
                    staffName: newStaff.name
                  });

                  const logId = `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  const logRef = doc(db, 'branches', branchId, 'auditLogs', logId);
                  batch.set(logRef, {
                    id: logId,
                    branchId,
                    appointmentId: booking.id,
                    eventType: 'staff_reassigned',
                    actorUid: user.uid,
                    actorRole: 'system',
                    details: {
                      previousStaffId: selectedStaff.id,
                      previousStaffName: selectedStaff.name,
                      newStaffId: newStaff.id,
                      newStaffName: newStaff.name,
                      reason: 'staff_absence_reconciliation'
                    },
                    createdAt: new Date().toISOString()
                  });
                } else {
                  batch.update(bookingRef, {
                    status: 'pending_approval'
                  });

                  const logId = `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  const logRef = doc(db, 'branches', branchId, 'auditLogs', logId);
                  batch.set(logRef, {
                    id: logId,
                    branchId,
                    appointmentId: booking.id,
                    eventType: 'escalated_to_owner',
                    actorUid: user.uid,
                    actorRole: 'system',
                    details: {
                      reason: 'no_available_staff_during_absence_reconciliation',
                      absentStaffId: selectedStaff.id,
                      absentStaffName: selectedStaff.name
                    },
                    createdAt: new Date().toISOString()
                  });
                }
              }
            }
          }
        }
      }

      await batch.commit();

      // Refresh
      await loadAbsences(selectedStaff.id);
      
      // Reset form fields
      setAbsenceStartDate('');
      setAbsenceEndDate('');
      setAbsenceNote('');
      setAbsenceFullDay(true);
      setActiveDrawer(null);
      
      showToast(ts.saveSuccess, 'success');
    } catch (err) {
      console.error('Error adding absence:', err);
      showToast(ts.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Delete Absence Period (Atomic batch delete for multi-day periods)
  const handleDeleteAbsences = async (absenceIds: string[]) => {
    if (!selectedStaff || !confirm(ts.confirmDeleteAbsence)) return;
    try {
      const batch = writeBatch(db);
      for (const id of absenceIds) {
        const absRef = doc(
          db,
          'branches',
          branchId,
          'staff',
          selectedStaff.id,
          'absences',
          id
        );
        batch.delete(absRef);
      }
      await batch.commit();
      await loadAbsences(selectedStaff.id);
      showToast(ts.saveSuccess, 'success');
    } catch (err) {
      console.error('Error deleting absence:', err);
      showToast(ts.saveError, 'error');
    }
  };

  // Working Hours Helper
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

  // Toggle service selection
  const toggleServiceId = (serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  // Deactivate/Activate staff status
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

  // Approve Pending Staff Request
  const handleApproveStaff = async (pendingUser: any) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', pendingUser.uid);
      await updateDoc(userRef, { approvalStatus: 'approved' });
      const staffId = pendingUser.staffId || `staff-${pendingUser.uid}`;
      const staffRef = doc(db, 'branches', branchId, 'staff', staffId);
      await updateDoc(staffRef, { status: 'active' });
      alert(locale === 'vi' ? 'Đã phê duyệt nhân viên!' : 'Staff member approved!');
    } catch (e) {
      console.error('Error approving staff:', e);
    }
  };

  // Reject Pending Staff Request
  const handleRejectStaff = async (pendingUser: any) => {
    if (!user) return;
    if (!confirm(locale === 'vi' ? 'Bạn có chắc muốn từ chối đăng ký này?' : 'Are you sure you want to reject this registration?')) return;
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

  // Generate Invite Link
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

  const currentWeekdayLabels = WEEKDAY_LABELS[locale as keyof typeof WEEKDAY_LABELS] || WEEKDAY_LABELS.en;

  // Filtered staff list
  const filteredStaff = staffList.filter((staff) => {
    if (statusFilter === 'inactive') return staff.status === 'inactive';
    if (statusFilter === 'active') return staff.status === 'active';
    return true; // 'all'
  });

  // Pagination index math
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentStaffPage = filteredStaff.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredStaff.length / itemsPerPage) || 1;

  // Reset page index on filter change
  const handleSetFilter = (filter: 'all' | 'inactive' | 'active') => {
    setStatusFilter(filter);
    setCurrentPage(1);
  };

  return (
    <div className={styles.container}>
      {/* ========================================================= */}
      {/* SCREEN 1: STAFF LIST                                      */}
      {/* ========================================================= */}
      {activeStaffId === null && (
        <>
          {/* Header section matching mockup */}
          <div className={styles.pageHeader}>
            <button 
              type="button" 
              className={styles.backButtonIcon}
              onClick={() => router.push('/admin/dashboard')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className={styles.titleCenter}>
              {locale === 'vi' ? 'Nhân viên' : locale === 'de' ? 'Mitarbeiter' : 'Staff'}
            </h1>
            <button
              type="button"
              className={styles.addButtonIcon}
              onClick={() => {
                setGeneratedCode('');
                setInviteBranchId(branchId);
                setShowInviteModal(true);
              }}
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* Pending approvals section */}
          {pendingStaff.length > 0 && (
            <div className={styles.pendingSection}>
              <h2 className={styles.pendingSectionTitle}>
                <span>⚠️</span>{' '}
                {locale === 'vi' ? 'Yêu cầu duyệt nhân sự mới' : 'Pending Staff Approvals'} ({pendingStaff.length})
              </h2>
              <div className={styles.pendingList}>
                {pendingStaff.map((pending) => (
                  <div key={pending.uid} className={styles.pendingCard}>
                    <div>
                      <div className={styles.pendingName}>{pending.name}</div>
                      <div className={styles.pendingMeta}>
                        ✉️ {pending.email} | 📞 {pending.phone || 'N/A'}
                      </div>
                    </div>
                    <div className={styles.pendingActions}>
                      <button onClick={() => handleApproveStaff(pending)} className={styles.approveBtn}>
                        {locale === 'vi' ? 'Duyệt' : 'Approve'}
                      </button>
                      <button onClick={() => handleRejectStaff(pending)} className={styles.rejectBtn}>
                        {locale === 'vi' ? 'Từ chối' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter tabs matching mockup */}
          <div className={styles.filterTabsRow}>
            <button
              className={`${styles.filterTab} ${statusFilter === 'all' ? styles.filterTabActive : ''}`}
              onClick={() => handleSetFilter('all')}
            >
              {locale === 'vi' ? 'Tất cả' : locale === 'de' ? 'Alle' : 'All'}
            </button>
            <button
              className={`${styles.filterTab} ${statusFilter === 'inactive' ? styles.filterTabActive : ''}`}
              onClick={() => handleSetFilter('inactive')}
            >
              {locale === 'vi' ? 'Đã nghỉ' : locale === 'de' ? 'Inaktiv' : 'Inactive'}
            </button>
            <button
              className={`${styles.filterTab} ${statusFilter === 'active' ? styles.filterTabActive : ''}`}
              onClick={() => handleSetFilter('active')}
            >
              {locale === 'vi' ? 'Hoạt động' : locale === 'de' ? 'Aktiv' : 'Active'}
            </button>
          </div>

          {/* Staff members list cards */}
          <div className={styles.staffGridCol}>
            {loading ? (
              <div className={styles.loadingBox}>
                <p>{ts.loading}</p>
              </div>
            ) : currentStaffPage.length === 0 ? (
              <div className={styles.emptyBox}>
                <p>{ts.empty}</p>
              </div>
            ) : (
              currentStaffPage.map((staff) => {
                const avatarStyle = getStaffAvatarStyle(staff.name);
                return (
                  <div
                    key={staff.id}
                    className={styles.staffItemCard}
                    onClick={() => handleOpenDetail(staff)}
                  >
                    <div 
                      className={styles.staffAvatarCircle} 
                      style={avatarStyle}
                    >
                      {staff.initials}
                    </div>
                    <div className={styles.staffMainInfo}>
                      <h3 className={styles.staffNameText}>{staff.name}</h3>
                      <span className={styles.staffTitleLabel}>
                        {staff.title || (staff.role === 'manager' 
                          ? (locale === 'vi' ? 'Quản lý' : 'Manager') 
                          : (locale === 'vi' ? 'Thợ nail' : 'Nail Tech'))}
                      </span>
                    </div>

                    <div className={styles.staffStatusContainer}>
                      <span
                        className={`${styles.staffStatusPill} ${
                          staff.status === 'active' ? styles.statusGreen : styles.statusGray
                        }`}
                      >
                        <span className={styles.statusDot} />
                        {staff.status === 'active'
                          ? (locale === 'vi' ? 'Hoạt động' : locale === 'de' ? 'Aktiv' : 'Active')
                          : (locale === 'vi' ? 'Đã nghỉ' : locale === 'de' ? 'Inaktiv' : 'Inactive')}
                      </span>
                      <ChevronRight className={styles.cardChevron} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination control matching mockup */}
          {filteredStaff.length > itemsPerPage && (
            <div className={styles.paginationRow}>
              <button
                type="button"
                className={styles.pageArrow}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.pageNumberBtn} ${currentPage === p ? styles.pageNumberActive : ''}`}
                  onClick={() => setCurrentPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                className={styles.pageArrow}
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              >
                ›
              </button>
            </div>
          )}
        </>
      )}

      {/* ========================================================= */}
      {/* SCREEN 2: STAFF DETAIL PAGE                               */}
      {/* ========================================================= */}
      {activeStaffId !== null && selectedStaff && (
        <div className={styles.subPageWrapper}>
          {/* Header */}
          <div className={styles.pageHeader}>
            <button 
              type="button" 
              className={styles.backButtonIcon}
              onClick={handleCloseDetail}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className={styles.titleCenter}>
              {locale === 'vi' ? 'Chi tiết nhân viên' : locale === 'de' ? 'Mitarbeiterdetails' : 'Staff Details'}
            </h1>
            <button
              type="button"
              className={styles.addButtonIcon}
              onClick={() => setActiveDrawer('profile')}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {/* Profile Card Header */}
          <div className={styles.detailProfileHeader}>
            <div 
              className={styles.detailLargeAvatar} 
              style={getStaffAvatarStyle(selectedStaff.name)}
            >
              {selectedStaff.initials}
            </div>
            <div className={styles.detailProfileInfo}>
              <h2 className={styles.detailNameText}>{selectedStaff.name}</h2>
              <p className={styles.detailTitleText}>
                {selectedStaff.title || (selectedStaff.role === 'manager' 
                  ? (locale === 'vi' ? 'Quản lý' : 'Manager') 
                  : (locale === 'vi' ? 'Thợ nail' : 'Nail Tech'))}
              </p>
            </div>
            <span
              className={`${styles.staffStatusPill} ${
                selectedStaff.status === 'active' ? styles.statusGreen : styles.statusGray
              }`}
            >
              <span className={styles.statusDot} />
              {selectedStaff.status === 'active'
                ? (locale === 'vi' ? 'Hoạt động' : locale === 'de' ? 'Aktiv' : 'Active')
                : (locale === 'vi' ? 'Đã nghỉ' : locale === 'de' ? 'Inaktiv' : 'Inactive')}
            </span>
          </div>

          {/* Stats Row */}
          <div className={styles.statsCardGrid}>
            <div className={`${styles.statCard} ${styles.statBlueBorder}`}>
              <div className={`${styles.statIconCircle} ${styles.bgBlueCircle}`}>
                <CalendarDays className="w-5 h-5 text-blue-600" />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statLabel}>
                  {locale === 'vi' ? 'Book tháng' : locale === 'de' ? 'Monats-Buchungen' : 'Monthly Books'}
                </span>
                <span className={`${styles.statNumber} text-blue-600`}>
                  {monthlyBookingsCount}
                </span>
              </div>
            </div>

            <div className={`${styles.statCard} ${styles.statPurpleBorder}`}>
              <div className={`${styles.statIconCircle} ${styles.bgPurpleCircle}`}>
                <Sparkles className="w-5 h-5 text-purple-600" />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statLabel}>
                  {locale === 'vi' ? 'Dịch vụ' : locale === 'de' ? 'Dienste' : 'Services'}
                </span>
                <span className={`${styles.statNumber} text-purple-600`}>
                  {selectedStaff.serviceIds.length}
                </span>
              </div>
            </div>
          </div>

          {/* Detail Menu List */}
          <div className={styles.detailMenuBox}>
            {/* 1. Hồ sơ */}
            <div 
              className={styles.detailMenuItem}
              onClick={() => setActiveDrawer('profile')}
            >
              <div className={`${styles.menuIconBox} ${styles.bgBlueIcon}`}>
                <User className="w-5 h-5 text-blue-500" />
              </div>
              <div className={styles.menuTextContent}>
                <span className={styles.menuTitleText}>{ts.profileTab}</span>
                <span className={styles.menuDescText}>
                  {locale === 'vi' ? 'Xem và cập nhật thông tin' : locale === 'de' ? 'Profil bearbeiten' : 'View and update info'}
                </span>
              </div>
              <ChevronRight className={styles.menuChevron} />
            </div>

            {/* 2. Giờ làm */}
            <div 
              className={styles.detailMenuItem}
              onClick={() => setActiveDrawer('hours')}
            >
              <div className={`${styles.menuIconBox} ${styles.bgPurpleIcon}`}>
                <Clock className="w-5 h-5 text-purple-500" />
              </div>
              <div className={styles.menuTextContent}>
                <span className={styles.menuTitleText}>{locale === 'vi' ? 'Giờ làm' : ts.workingHoursTab}</span>
                <span className={styles.menuDescText}>
                  {locale === 'vi' ? 'Lịch làm việc' : locale === 'de' ? 'Arbeitszeitplan' : 'Working schedule'}
                </span>
              </div>
              <ChevronRight className={styles.menuChevron} />
            </div>

            {/* 3. Dịch vụ */}
            <div 
              className={styles.detailMenuItem}
              onClick={() => setActiveDrawer('services')}
            >
              <div className={`${styles.menuIconBox} ${styles.bgOrangeIcon}`}>
                <Scissors className="w-5 h-5 text-orange-500" />
              </div>
              <div className={styles.menuTextContent}>
                <span className={styles.menuTitleText}>{locale === 'vi' ? 'Dịch vụ' : ts.servicesTab}</span>
                <span className={styles.menuDescText}>
                  {locale === 'vi' ? 'Các dịch vụ chuyên môn' : locale === 'de' ? 'Spezialitäten' : 'Specialties'}
                </span>
              </div>
              <ChevronRight className={styles.menuChevron} />
            </div>

            {/* 4. Nghỉ phép */}
            <div 
              className={styles.detailMenuItem}
              onClick={() => setActiveDrawer('absences')}
            >
              <div className={`${styles.menuIconBox} ${styles.bgGreenIcon}`}>
                <Calendar className="w-5 h-5 text-green-500" />
              </div>
              <div className={styles.menuTextContent}>
                <span className={styles.menuTitleText}>{locale === 'vi' ? 'Nghỉ phép' : ts.absencesTab}</span>
                <span className={styles.menuDescText}>
                  {locale === 'vi' ? 'Lịch sử và số dư phép' : locale === 'de' ? 'Urlaubsverlauf' : 'Absence history'}
                </span>
              </div>
              <ChevronRight className={styles.menuChevron} />
            </div>

            {/* 5. Xin nghỉ phép */}
            <div 
              className={styles.detailMenuItem}
              onClick={() => setActiveDrawer('createAbsence')}
            >
              <div className={`${styles.menuIconBox} ${styles.bgTealIcon}`}>
                <Palmtree className="w-5 h-5 text-teal-500" />
              </div>
              <div className={styles.menuTextContent}>
                <span className={styles.menuTitleText}>{locale === 'vi' ? 'Xin nghỉ phép' : ts.addAbsence}</span>
                <span className={styles.menuDescText}>
                  {locale === 'vi' ? 'Tạo đơn xin nghỉ phép' : locale === 'de' ? 'Urlaubsantrag stellen' : 'Request time off'}
                </span>
              </div>
              <ChevronRight className={styles.menuChevron} />
            </div>

            {/* 6. Chi nhánh (Managers only) */}
            {selectedStaff.role === 'manager' && (
              <div 
                className={styles.detailMenuItem}
                onClick={() => setActiveDrawer('branches')}
              >
                <div className={`${styles.menuIconBox} ${styles.bgBlueIcon}`}>
                  <Store className="w-5 h-5 text-blue-500" />
                </div>
                <div className={styles.menuTextContent}>
                  <span className={styles.menuTitleText}>{locale === 'vi' ? 'Chi nhánh' : ts.branchAssignmentTab}</span>
                  <span className={styles.menuDescText}>
                    {locale === 'vi' ? 'Chi nhánh được phân công' : locale === 'de' ? 'Filialzuordnung' : 'Branch assignment'}
                  </span>
                </div>
                <ChevronRight className={styles.menuChevron} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* DRAWERS: BOTTOM SHEETS                                    */}
      {/* ========================================================= */}
      {activeDrawer !== null && selectedStaff && (
        <div className={styles.drawerOverlay} onClick={() => setActiveDrawer(null)}>
          <div 
            className={styles.bottomSheetContainer} 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div className={styles.sheetHandleLine} />

            {/* 1. DRAWER: PROFILE EDIT */}
            {activeDrawer === 'profile' && (
              <div className={styles.drawerContentBox}>
                <div className={styles.drawerHeaderRow}>
                  <div className={styles.drawerHeaderTitleGroup}>
                    <h2 className={styles.drawerCenterTitle}>
                      {locale === 'vi' ? 'Chỉnh sửa hồ sơ' : 'Edit Profile'}
                    </h2>
                    <p className={styles.drawerCenterSubtitle}>
                      {locale === 'vi' ? 'Cập nhật thông tin cơ bản của nhân viên' : 'Update basic employee information'}
                    </p>
                  </div>
                  <button 
                    type="button" 
                    className={styles.drawerCloseIconBtn} 
                    onClick={() => setActiveDrawer(null)}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Profile short card inside sheet */}
                <div className={styles.sheetMiniProfile}>
                  <div 
                    className={styles.miniAvatar} 
                    style={getStaffAvatarStyle(selectedStaff.name)}
                  >
                    {selectedStaff.initials}
                  </div>
                  <div className={styles.miniProfileText}>
                    <span className={styles.miniName}>{selectedStaff.name}</span>
                    <span className={styles.miniTitle}>
                      {selectedStaff.title || (selectedStaff.role === 'manager' ? 'Quản lý' : 'Thợ nail')}
                    </span>
                  </div>
                </div>

                <div className={styles.drawerBodyScroll}>
                  {/* Name field */}
                  <div className={styles.formFieldBlock}>
                    <label className={styles.formLabelText}>{ts.staffName}</label>
                    <div className={styles.inputBoxWithPrefix}>
                      <div className={`${styles.iconPrefixWrapper} ${styles.bgBlueCircle}`}>
                        <User className="w-4 h-4 text-blue-600" />
                      </div>
                      <input
                        type="text"
                        className={styles.formInputField}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={saving}
                      />
                      {editName && (
                        <button 
                          type="button" 
                          className={styles.clearInputBtn}
                          onClick={() => setEditName('')}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Practitioner Type field */}
                  <div className={styles.formFieldBlock}>
                    <label className={styles.formLabelText}>{ts.staffType}</label>
                    <div className={styles.inputBoxWithPrefix}>
                      <div className={`${styles.iconPrefixWrapper} ${styles.bgBlueCircle}`}>
                        <Gem className="w-4 h-4 text-blue-600" />
                      </div>
                      <select
                        className={styles.formSelectField}
                        value={editStaffType}
                        onChange={(e) => setEditStaffType(e.target.value as 'main' | 'junior')}
                        disabled={saving}
                      >
                        <option value="main">{ts.mainStaff}</option>
                        <option value="junior">{ts.juniorStaff}</option>
                      </select>
                    </div>
                  </div>

                  {/* Title field */}
                  <div className={styles.formFieldBlock}>
                    <label className={styles.formLabelText}>{ts.staffTitle}</label>
                    <div className={styles.inputBoxWithPrefix}>
                      <div className={`${styles.iconPrefixWrapper} ${styles.bgPurpleCircle}`}>
                        <Tag className="w-4 h-4 text-purple-600" />
                      </div>
                      <input
                        type="text"
                        className={styles.formInputField}
                        placeholder="e.g. Nail Technician"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  {/* Languages field */}
                  <div className={styles.formFieldBlock}>
                    <label className={styles.formLabelText}>{ts.languages}</label>
                    <div className={styles.inputBoxWithPrefix}>
                      <div className={`${styles.iconPrefixWrapper} ${styles.bgOrangeCircle}`}>
                        <Globe className="w-4 h-4 text-orange-600" />
                      </div>
                      <input
                        type="text"
                        className={styles.formInputField}
                        placeholder="German, Vietnamese"
                        value={editLanguages}
                        onChange={(e) => setEditLanguages(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                    <p className={styles.formLabelHint}>{ts.languagesHint}</p>
                  </div>

                  {/* Status Toggle switch */}
                  <div className={styles.sheetToggleContainer}>
                    <span className={styles.toggleLabelBold}>
                      {ts.activeStatus}:{' '}
                      {editStatus === 'active' ? t.admin.staff.statusActive : t.admin.staff.statusInactive}
                    </span>
                    <label className={styles.toggleSwitchBtn}>
                      <input
                        type="checkbox"
                        checked={editStatus === 'active'}
                        onChange={(e) => setEditStatus(e.target.checked ? 'active' : 'inactive')}
                        disabled={saving}
                      />
                      <span className={styles.toggleTrackLine} />
                    </label>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className={styles.sheetButtonsContainer}>
                  <button 
                    type="button" 
                    className={styles.submitBlueBtn}
                    onClick={handleSaveProfile}
                    disabled={saving}
                  >
                    {saving ? t.common.loading : (locale === 'vi' ? 'Lưu thay đổi' : t.common.save)}
                  </button>
                  <button 
                    type="button" 
                    className={styles.cancelWhiteBtn}
                    onClick={() => setActiveDrawer(null)}
                    disabled={saving}
                  >
                    {locale === 'vi' ? 'Hủy' : t.common.cancel}
                  </button>
                </div>
              </div>
            )}

            {/* 2. DRAWER: WORKING HOURS */}
            {activeDrawer === 'hours' && (
              <div className={styles.drawerContentBox}>
                <div className={styles.drawerHeaderRow}>
                  <h2 className={styles.drawerCenterTitle}>
                    {locale === 'vi' ? 'Giờ làm' : ts.workingHoursTab}
                  </h2>
                  <button 
                    type="button" 
                    className={styles.drawerCloseIconBtn} 
                    onClick={() => setActiveDrawer(null)}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className={styles.drawerBodyScroll}>
                  {hoursLoading ? (
                    <p className="text-center py-6">{t.common.loading}</p>
                  ) : (
                    <div className={styles.hoursScheduleGrid}>
                      {workingHours.map((day) => (
                        <div
                          key={day.dayOfWeek}
                          className={`${styles.dayScheduleRow} ${!day.isWorking ? styles.dayRowOff : ''}`}
                        >
                          <span className={styles.dayNameLabel}>
                            {(ts.dayNames as readonly string[])[day.dayOfWeek]}
                          </span>

                          <div className={styles.dayToggleBox}>
                            <label className={styles.toggleSwitchBtn}>
                              <input
                                type="checkbox"
                                checked={day.isWorking}
                                onChange={(e) => updateWorkingHour(day.dayOfWeek, 'isWorking', e.target.checked)}
                              />
                              <span className={styles.toggleTrackLine} />
                            </label>
                          </div>

                          {day.isWorking ? (
                            <div className={styles.timeInputsWrapper}>
                              <input
                                type="time"
                                className={styles.timeSelectField}
                                value={day.startTime}
                                onChange={(e) => updateWorkingHour(day.dayOfWeek, 'startTime', e.target.value)}
                              />
                              <span className={styles.timeDivider}>-</span>
                              <input
                                type="time"
                                className={styles.timeSelectField}
                                value={day.endTime}
                                onChange={(e) => updateWorkingHour(day.dayOfWeek, 'endTime', e.target.value)}
                              />
                            </div>
                          ) : (
                            <span className={styles.dayOffText}>{ts.dayOff}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Save */}
                <div className={styles.sheetButtonsContainer}>
                  <button
                    type="button"
                    className={styles.submitBlueBtn}
                    onClick={handleSaveWorkingHours}
                    disabled={saving || hoursLoading}
                  >
                    {saving ? t.common.loading : (locale === 'vi' ? 'Lưu' : t.common.save)}
                  </button>
                </div>
              </div>
            )}

            {/* 3. DRAWER: SERVICES ACCORDION ASSIGNMENT */}
            {activeDrawer === 'services' && (
              <div className={styles.drawerContentBox}>
                {/* Header employee summary */}
                <div className={styles.drawerMiniHeaderWithClose}>
                  <div className={styles.sheetMiniProfile}>
                    <div 
                      className={styles.miniAvatar} 
                      style={getStaffAvatarStyle(selectedStaff.name)}
                    >
                      {selectedStaff.initials}
                    </div>
                    <div className={styles.miniProfileText}>
                      <span className={styles.miniName}>{selectedStaff.name}</span>
                      <span className={styles.miniTitle}>
                        {selectedStaff.title || (selectedStaff.role === 'manager' ? 'Quản lý' : 'Thợ nail')}
                      </span>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    className={styles.drawerCloseIconBtn} 
                    onClick={() => setActiveDrawer(null)}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Subtitle instructions and Select All option */}
                <div className={styles.drawerHeaderSubInfo}>
                  <div className={styles.drawerTitleTextGroup}>
                    <h2 className={styles.sheetSectionTitle}>
                      {locale === 'vi' ? 'Dịch vụ có thể làm' : 'Services Can Do'}
                    </h2>
                    <p className={styles.sheetSectionSubtitle}>
                      {locale === 'vi' ? 'Chọn dịch vụ mà thợ có thể thực hiện' : 'Select services practitioner can perform'}
                    </p>
                  </div>
                  {(() => {
                    const activeServices = branchServices.filter((s) => s.isActive);
                    const allSelected = activeServices.length > 0 && activeServices.every((s) => selectedServiceIds.includes(s.id));
                    return (
                      <button
                        type="button"
                        className={styles.selectAllTextBtn}
                        onClick={() => {
                          if (allSelected) {
                            setSelectedServiceIds([]);
                          } else {
                            setSelectedServiceIds(activeServices.map((s) => s.id));
                          }
                        }}
                      >
                        {locale === 'vi' ? 'Chọn tất cả' : 'Select all'}
                      </button>
                    );
                  })()}
                </div>

                <div className={styles.drawerBodyScroll}>
                  {branchServices.length === 0 ? (
                    <div className={styles.emptyDrawerBox}>
                      <p>{ts.noServicesAvailable}</p>
                    </div>
                  ) : (
                    <div className={styles.accordionServicesWrapper}>
                      {categories.filter(c => c.isActive).map((cat) => {
                        const catServices = branchServices.filter(s => s.isActive && s.categoryId === cat.id);
                        if (catServices.length === 0) return null;

                        const isExpanded = expandedCategories.has(cat.id);
                        const catSelectedCount = catServices.filter(s => selectedServiceIds.includes(s.id)).length;
                        const theme = getCategoryColorTheme(cat.id);

                        return (
                          <div 
                            key={cat.id} 
                            className={styles.categoryAccordionSection}
                            style={{ borderLeftColor: theme.border }}
                          >
                            {/* Category Header Card matching mockup layout */}
                            <div
                              className={styles.accordionHeaderCard}
                              onClick={() => {
                                setExpandedCategories((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(cat.id)) next.delete(cat.id);
                                  else next.add(cat.id);
                                  return next;
                                });
                              }}
                            >
                              <div className={styles.catLeftInfoBox}>
                                <div 
                                  className={styles.catIconSquareCircle}
                                  style={{ backgroundColor: theme.circleBg, color: theme.text }}
                                >
                                  <CategoryIcon id={cat.id} className="w-5 h-5" />
                                </div>
                                <div className={styles.catNameSubGroup}>
                                  <span className={styles.catNameBoldText}>{getLocalizedName(cat)}</span>
                                  <span className={styles.catCountLabelText}>{catServices.length} {locale === 'vi' ? 'dịch vụ' : 'services'}</span>
                                </div>
                              </div>
                              <div className={styles.catRightArrowGroup}>
                                <span className={styles.selectedFractionLabel}>
                                  {catSelectedCount}/{catServices.length}
                                </span>
                                <span className={`${styles.accordionChevron} ${isExpanded ? styles.chevronRotated : ''}`}>
                                  ▾
                                </span>
                              </div>
                            </div>

                            {/* Service list items */}
                            {isExpanded && (
                              <div className={styles.accordionServicesBodyList}>
                                {catServices.map((svc) => {
                                  const isSelected = selectedServiceIds.includes(svc.id);
                                  return (
                                    <div
                                      key={svc.id}
                                      className={`${styles.serviceCheckRowItem} ${isSelected ? styles.rowSelectedActive : ''}`}
                                      onClick={() => toggleServiceId(svc.id)}
                                    >
                                      <div className={`${styles.customCheckboxPill} ${isSelected ? styles.customCheckActive : ''}`}>
                                        {isSelected && '✓'}
                                      </div>
                                      <span className={styles.serviceNameLeftText}>{getLocalizedName(svc)}</span>
                                      <span className={styles.serviceDurationRightText}>
                                        {svc.durationMinutes === 15 || svc.durationMinutes === 20 || svc.durationMinutes === 30 || svc.durationMinutes === 40 || svc.durationMinutes === 45 || svc.durationMinutes === 60 || svc.durationMinutes === 75 || svc.durationMinutes === 90 || svc.durationMinutes === 120
                                          ? `${svc.durationMinutes} ${locale === 'vi' ? 'phút' : 'min'}`
                                          : `+${svc.durationMinutes} ${locale === 'vi' ? 'phút' : 'min'}`}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer Save & Cancel */}
                <div className={styles.accordionFooterBar}>
                  <div className={styles.footerCountSummary}>
                    <span className={styles.footerSelectedCountTitle}>
                      {selectedServiceIds.length} {locale === 'vi' ? 'dịch vụ đã chọn' : 'services selected'}
                    </span>
                    <span className={styles.footerSelectedCountSubtitle}>
                      {locale === 'vi' ? 'Có thể thay đổi sau' : 'Can change later'}
                    </span>
                  </div>
                  <div className={styles.footerActionButtonsRow}>
                    <button 
                      type="button" 
                      className={styles.accordionCancelBtn}
                      onClick={() => setActiveDrawer(null)}
                    >
                      {locale === 'vi' ? 'Hủy' : 'Cancel'}
                    </button>
                    <button 
                      type="button" 
                      className={styles.accordionSaveBtn}
                      onClick={handleSaveServices}
                      disabled={saving}
                    >
                      {saving ? t.common.loading : (locale === 'vi' ? 'Lưu' : 'Save')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. DRAWER: ABSENCES HISTORY */}
            {activeDrawer === 'absences' && (
              <div className={styles.drawerContentBox}>
                <div className={styles.drawerHeaderRow}>
                  <div className={styles.headerLeftIconTitle}>
                    <div className={styles.pinkCircleMedical}>
                      <Palmtree className="w-5 h-5 text-pink-600" />
                    </div>
                    <h2 className={styles.drawerCenterTitle}>
                      {locale === 'vi' ? 'Lịch sử nghỉ phép' : ts.absencesTab}
                    </h2>
                  </div>
                  <button 
                    type="button" 
                    className={styles.drawerCloseIconBtn} 
                    onClick={() => setActiveDrawer(null)}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className={styles.drawerBodyScroll}>
                  {absences.length === 0 ? (
                    <div className={styles.emptyDrawerBox}>
                      <p>{ts.noAbsences}</p>
                    </div>
                  ) : (
                    <div className={styles.absencesHistoryList}>
                      {groupConsecutiveAbsences(absences).map((period) => {
                        const { dayText, monthStr } = formatAbsencePeriodDate(period, locale);
                        return (
                          <div key={period.id} className={styles.absenceItemPeriodCard}>
                            <div className={styles.absenceCardLeftBox}>
                              <div className={styles.pinkIconCircleCalendar}>
                                <CalendarDays className="w-4 h-4 text-pink-600" />
                              </div>
                              <div className={styles.absenceCardDatesGroup}>
                                <span className={styles.absenceCardDayText}>{dayText}</span>
                                <span className={styles.absenceCardMonthText}>{monthStr}</span>
                              </div>
                            </div>

                            <div className={styles.absenceCardMiddleDetails}>
                              <div className={styles.badgesAbsenceRow}>
                                <span className={styles.badgePinkAbsence}>
                                  {locale === 'vi' ? 'Nghỉ phép' : 'On leave'}
                                </span>
                                <span className={styles.badgeDaysDuration}>
                                  <Clock className="w-3 h-3 text-gray-500 mr-1" />
                                  {period.ids.length} {locale === 'vi' ? 'ngày' : 'days'}
                                </span>
                              </div>
                              {period.note && (
                                <p className={styles.absenceCardReasonText}>
                                  {locale === 'vi' ? 'Lý do' : 'Reason'}: {period.note}
                                </p>
                              )}
                            </div>

                            <button 
                              type="button" 
                              className={styles.trashDeleteIconButton}
                              onClick={() => handleDeleteAbsences(period.ids)}
                            >
                              <Trash2 className="w-4 h-4 text-gray-600" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer close */}
                <div className={styles.sheetButtonsContainer}>
                  <button 
                    type="button" 
                    className={styles.closeGrayBtn}
                    onClick={() => setActiveDrawer(null)}
                  >
                    {locale === 'vi' ? 'Đóng' : 'Close'}
                  </button>
                </div>
              </div>
            )}

            {/* 5. DRAWER: CREATE ABSENCE REQUEST */}
            {activeDrawer === 'createAbsence' && (
              <div className={styles.drawerContentBox}>
                <div className={styles.drawerHeaderRow}>
                  <div className={styles.headerLeftIconTitle}>
                    <div className={styles.pinkCircleMedical}>
                      <Calendar className="w-5 h-5 text-pink-600" />
                    </div>
                    <div className={styles.drawerHeaderTitleGroup}>
                      <h2 className={styles.drawerCenterTitle}>
                        {locale === 'vi' ? 'Tạo đơn nghỉ' : 'Request Time Off'}
                      </h2>
                      <p className={styles.drawerCenterSubtitle}>
                        {locale === 'vi' ? 'Tạo đơn nghỉ phép cho nhân viên' : 'Submit leave request for practitioner'}
                      </p>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    className={styles.drawerCloseIconBtn} 
                    onClick={() => setActiveDrawer(null)}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Employee Card Info inside Sheet */}
                <div className={styles.sheetMiniProfile} style={{ marginBottom: '20px' }}>
                  <div 
                    className={styles.miniAvatar} 
                    style={getStaffAvatarStyle(selectedStaff.name)}
                  >
                    {selectedStaff.initials}
                  </div>
                  <div className={styles.miniProfileText}>
                    <span className={styles.miniName}>{selectedStaff.name}</span>
                    <span className={styles.miniTitle}>
                      {selectedStaff.title || (selectedStaff.role === 'manager' ? 'Quản lý' : 'Thợ nail')}
                    </span>
                  </div>
                </div>

                <div className={styles.drawerBodyScroll}>
                  {/* From Date - To Date Row */}
                  <div className={styles.datesInputRowGrid}>
                    <div className={styles.formFieldBlock}>
                      <label className={styles.formLabelText}>
                        {locale === 'vi' ? 'Từ ngày' : 'From Date'}
                      </label>
                      <div className={styles.inputBoxWithPrefix}>
                        <input
                          type="date"
                          className={styles.formInputField}
                          value={absenceStartDate}
                          onChange={(e) => setAbsenceStartDate(e.target.value)}
                          disabled={saving}
                        />
                        <Calendar className="w-4 h-4 text-gray-400 absolute right-3 pointer-events-none" />
                      </div>
                    </div>

                    <div className={styles.formFieldBlock}>
                      <label className={styles.formLabelText}>
                        {locale === 'vi' ? 'Đến ngày' : 'To Date'}
                      </label>
                      <div className={styles.inputBoxWithPrefix}>
                        <input
                          type="date"
                          className={styles.formInputField}
                          value={absenceEndDate}
                          onChange={(e) => setAbsenceEndDate(e.target.value)}
                          disabled={saving}
                        />
                        <Calendar className="w-4 h-4 text-gray-400 absolute right-3 pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  {/* Full Day Toggle switch */}
                  <div className={styles.sheetToggleContainer} style={{ margin: '14px 0' }}>
                    <span className={styles.toggleLabelBold}>{ts.fullDay}</span>
                    <label className={styles.toggleSwitchBtn}>
                      <input
                        type="checkbox"
                        checked={absenceFullDay}
                        onChange={(e) => setAbsenceFullDay(e.target.checked)}
                        disabled={saving}
                      />
                      <span className={styles.toggleTrackLine} />
                    </label>
                  </div>

                  {/* Partial Time Inputs */}
                  {!absenceFullDay && (
                    <div className={styles.datesInputRowGrid} style={{ marginBottom: '14px' }}>
                      <div className={styles.formFieldBlock}>
                        <label className={styles.formLabelText}>{ts.startTime}</label>
                        <input
                          type="time"
                          className={styles.formInputField}
                          value={absenceStartTime}
                          onChange={(e) => setAbsenceStartTime(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                      <div className={styles.formFieldBlock}>
                        <label className={styles.formLabelText}>{ts.endTime}</label>
                        <input
                          type="time"
                          className={styles.formInputField}
                          value={absenceEndTime}
                          onChange={(e) => setAbsenceEndTime(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    </div>
                  )}

                  {/* Leave Reason Note */}
                  <div className={styles.formFieldBlock}>
                    <label className={styles.formLabelText}>{ts.absenceNote}</label>
                    <input
                      type="text"
                      className={styles.formInputField}
                      value={absenceNote}
                      onChange={(e) => setAbsenceNote(e.target.value)}
                      placeholder={locale === 'vi' ? 'Du lịch gia đình, nghỉ ốm...' : 'e.g. Vacation, sick leave...'}
                      disabled={saving}
                    />
                  </div>
                </div>

                {/* Footer Action Buttons */}
                <div className={styles.sheetButtonsContainer}>
                  <button
                    type="button"
                    className={styles.submitBlueBtn}
                    onClick={handleAddAbsence}
                    disabled={saving || !absenceStartDate}
                  >
                    {saving ? t.common.loading : (locale === 'vi' ? 'Tạo đơn' : 'Request')}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelWhiteBtn}
                    onClick={() => setActiveDrawer(null)}
                    disabled={saving}
                  >
                    {locale === 'vi' ? 'Hủy' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            {/* 6. DRAWER: BRANCH ASSIGNMENT (MANAGERS ONLY) */}
            {activeDrawer === 'branches' && selectedStaff.role === 'manager' && (
              <div className={styles.drawerContentBox}>
                <div className={styles.drawerHeaderRow}>
                  <div className={styles.drawerHeaderTitleGroup}>
                    <h2 className={styles.drawerCenterTitle}>
                      {locale === 'vi' ? 'Chi nhánh quản lý' : ts.branchAssignmentTab}
                    </h2>
                    <p className={styles.drawerCenterSubtitle}>
                      {locale === 'vi' ? 'Chọn các chi nhánh quản lý được phép truy cập' : ts.selectBranches}
                    </p>
                  </div>
                  <button 
                    type="button" 
                    className={styles.drawerCloseIconBtn} 
                    onClick={() => setActiveDrawer(null)}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className={styles.drawerBodyScroll}>
                  {branchesLoading ? (
                    <p className="text-center py-6">{t.common.loading}</p>
                  ) : businessBranches.length === 0 ? (
                    <div className={styles.emptyDrawerBox}>
                      <p>{ts.noBranchesAvailable}</p>
                    </div>
                  ) : (
                    <div className={styles.branchCheckListBlock}>
                      {businessBranches.map((branch) => {
                        const isSelected = selectedBranchIds.includes(branch.id);
                        return (
                          <div
                            key={branch.id}
                            className={`${styles.branchCheckRowItem} ${isSelected ? styles.rowSelectedActive : ''}`}
                            onClick={() => toggleBranchId(branch.id)}
                          >
                            <div className={`${styles.customCheckboxPill} ${isSelected ? styles.customCheckActive : ''}`}>
                              {isSelected && '✓'}
                            </div>
                            <div className={styles.branchNameAddressCol}>
                              <span className={styles.branchCheckNameText}>{branch.name}</span>
                              {branch.address && (
                                <span className={styles.branchCheckAddressText}>{branch.address}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer buttons */}
                <div className={styles.sheetButtonsContainer}>
                  <button
                    type="button"
                    className={styles.submitBlueBtn}
                    onClick={handleSaveBranchAssignment}
                    disabled={saving || branchesLoading}
                  >
                    {saving ? t.common.loading : (locale === 'vi' ? 'Lưu' : 'Save')}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelWhiteBtn}
                    onClick={() => setActiveDrawer(null)}
                    disabled={saving}
                  >
                    {locale === 'vi' ? 'Hủy' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* INVITATION GENERATION MODAL                               */}
      {/* ========================================================= */}
      {showInviteModal && (
        <div className={styles.modalOverlay} onClick={() => setShowInviteModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {locale === 'vi' ? 'Tạo mã mời nhân viên' : 'Generate Staff Invitation'}
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
                {/* Branch Selection */}
                {(user?.assignedBranches?.length || 0) > 1 && (
                  <div className={styles.formFieldBlock} style={{ marginBottom: '16px' }}>
                    <label className={styles.formLabelText}>{locale === 'vi' ? 'Chọn tiệm' : 'Select Branch'}</label>
                    <div className={styles.inputBoxWithPrefix}>
                      <div className={`${styles.iconPrefixWrapper} ${styles.bgOrangeCircle}`}>
                        <Store className="w-4 h-4 text-orange-600" />
                      </div>
                      <select
                        className={styles.formSelectField}
                        value={inviteBranchId}
                        onChange={(e) => setInviteBranchId(e.target.value)}
                      >
                        {(user?.assignedBranches || []).map((bid) => (
                          <option key={bid} value={bid}>{bid}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Show current branch info */}
                {(user?.assignedBranches?.length || 0) <= 1 && (
                  <div className={styles.branchHighlightBox}>
                    <Store className="w-4 h-4 text-[#166534]" />
                    <span>{locale === 'vi' ? 'Tiệm:' : 'Branch:'} <strong>{branchId}</strong></span>
                  </div>
                )}

                {/* Role */}
                <div className={styles.formFieldBlock} style={{ marginBottom: '16px' }}>
                  <label className={styles.formLabelText}>{locale === 'vi' ? 'Quyền hạn' : 'System Role'}</label>
                  <div className={styles.inputBoxWithPrefix}>
                    <div className={`${styles.iconPrefixWrapper} ${styles.bgPurpleCircle}`}>
                      <ShieldAlert className="w-4 h-4 text-purple-600" />
                    </div>
                    <select
                      className={styles.formSelectField}
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as any)}
                    >
                      <option value="staff">
                        {locale === 'vi' ? 'Nhân viên (Staff)' : 'Staff Member'}
                      </option>
                      <option value="manager">
                        {locale === 'vi' ? 'Quản lý (Manager)' : 'Manager'}
                      </option>
                    </select>
                  </div>
                </div>

                {/* Practitioner type */}
                {inviteRole === 'staff' && (
                  <div className={styles.formFieldBlock} style={{ marginBottom: '20px' }}>
                    <label className={styles.formLabelText}>{locale === 'vi' ? 'Phân loại thợ' : 'Staff Practitioner Type'}</label>
                    <div className={styles.inputBoxWithPrefix}>
                      <div className={`${styles.iconPrefixWrapper} ${styles.bgBlueCircle}`}>
                        <Gem className="w-4 h-4 text-blue-600" />
                      </div>
                      <select
                        className={styles.formSelectField}
                        value={inviteStaffType}
                        onChange={(e) => setInviteStaffType(e.target.value as any)}
                      >
                        <option value="main">{t.admin.staff.roleSenior}</option>
                        <option value="junior">{t.admin.staff.roleJunior}</option>
                      </select>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={styles.submitBlueBtn}
                  onClick={handleGenerateInvite}
                >
                  {locale === 'vi' ? 'Tạo mã mời' : 'Generate Invitation Code'}
                </button>
              </div>
            ) : (
              <div className={styles.modalBody}>
                <div className={styles.inviteCodeBox}>
                  <div className={styles.inviteCode}>{generatedCode}</div>
                  <div className={styles.inviteInstructions}>
                    {locale === 'vi'
                      ? `Mã mời dành cho vai trò: ${
                          inviteRole === 'manager' ? 'Quản lý' : inviteStaffType === 'main' ? 'Thợ chính' : 'Thợ phụ'
                        }`
                      : `Invitation code configured for: ${
                          inviteRole === 'manager' ? 'Manager' : inviteStaffType === 'main' ? 'Senior Practitioner' : 'Junior Practitioner'
                        }`}
                  </div>
                  <div className={styles.branchSubHighlight}>
                    <span>🏪</span>
                    <span>{locale === 'vi' ? 'Tiệm:' : 'Branch:'} <strong>{inviteBranchId || branchId}</strong></span>
                  </div>
                </div>

                <button
                  type="button"
                  className={`${styles.submitBlueBtn} ${copied ? styles.copyBtnSuccess : ''}`}
                  onClick={handleCopyCode}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {copied ? (locale === 'vi' ? 'Đã sao chép! ✓' : 'Copied! ✓') : (locale === 'vi' ? 'Sao chép mã mời' : 'Copy Invitation Code')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast popup */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
