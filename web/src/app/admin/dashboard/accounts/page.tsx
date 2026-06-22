'use client';

import React, { useState, useEffect } from 'react';
import { Phone, Store } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

interface UserItem {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: 'superadmin' | 'owner' | 'manager' | 'staff';
  approvalStatus?: 'approved' | 'pending_superadmin' | 'pending_owner' | 'rejected';
  assignedBranches?: string[];
  businessId?: string;
  createdAt?: string;
}

interface BusinessPlan {
  subscriptionPlan: 'starter' | 'professional' | 'enterprise';
  companyName: string;
}

const PLAN_LABELS: Record<string, Record<string, string>> = {
  starter: { vi: 'Starter (1 tiệm)', de: 'Starter (1 Filiale)', en: 'Starter (1 branch)' },
  professional: { vi: 'Professional (3 tiệm)', de: 'Professional (3 Filialen)', en: 'Professional (3 branches)' },
  enterprise: { vi: 'Enterprise (10 tiệm)', de: 'Enterprise (10 Filialen)', en: 'Enterprise (10 branches)' },
};

export default function AccountsManagementPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [businessPlans, setBusinessPlans] = useState<Record<string, BusinessPlan>>({});

  // Sync users from Firestore in real-time
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;

    const usersRef = collection(db, 'users');
    const unsubscribe = onSnapshot(usersRef, (snap) => {
      const list: UserItem[] = [];
      snap.forEach((docSnap) => {
        list.push({ uid: docSnap.id, ...docSnap.data() } as UserItem);
      });
      // Sort by creation date descending if available, else by name
      list.sort((a, b) => {
        if (a.createdAt && b.createdAt) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return a.name.localeCompare(b.name);
      });
      setUsers(list);
      setLoading(false);
    }, (err) => {
      console.error("Error listening to users:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch business plans for owners
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;

    const businessesRef = collection(db, 'businesses');
    const unsubscribe = onSnapshot(businessesRef, (snap) => {
      const map: Record<string, BusinessPlan> = {};
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        map[docSnap.id] = {
          subscriptionPlan: d.subscriptionPlan || 'starter',
          companyName: d.companyName || '',
        };
      });
      setBusinessPlans(map);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user || user.role !== 'superadmin') {
    return (
      <div className={styles.deniedContainer}>
        <span className={styles.deniedIcon}>🔒</span>
        <h2>{locale === 'vi' ? 'Truy cập bị từ chối' : locale === 'de' ? 'Zugriff verweigert' : 'Access Denied'}</h2>
        <p>
          {locale === 'vi' 
            ? 'Bạn không có quyền xem trang này. Chỉ quản trị viên hệ thống mới có quyền truy cập.' 
            : locale === 'de' 
            ? 'Sie haben keine Berechtigung, diese Seite anzuzeigen. Nur Systemadministratoren haben Zugriff.'
            : 'You do not have permission to view this page. Only system administrators have access.'}
        </p>
      </div>
    );
  }

  const handleRoleChange = async (targetUid: string, newRole: any) => {
    const confirmMsg = locale === 'vi'
      ? `Bạn có chắc chắn muốn thay đổi vai trò tài khoản này thành "${newRole}"?`
      : locale === 'de'
      ? `Sind Sie sicher, dass Sie die Rolle dieses Kontos in "${newRole}" ändern möchten?`
      : `Are you sure you want to change this account's role to "${newRole}"?`;

    if (!confirm(confirmMsg)) return;

    try {
      const userRef = doc(db, 'users', targetUid);
      await updateDoc(userRef, {
        role: newRole
      });
    } catch (e) {
      console.error("Error updating user role:", e);
      alert(locale === 'vi' ? 'Cập nhật thất bại. Vui lòng kiểm tra phân quyền.' : 'Update failed. Please check permissions.');
    }
  };

  const handleStatusChange = async (targetUid: string, newStatus: any) => {
    try {
      const userRef = doc(db, 'users', targetUid);
      await updateDoc(userRef, {
        approvalStatus: newStatus
      });
    } catch (e) {
      console.error("Error updating user status:", e);
      alert(locale === 'vi' ? 'Cập nhật thất bại. Vui lòng kiểm tra phân quyền.' : 'Update failed. Please check permissions.');
    }
  };

  const handlePlanChange = async (businessId: string, newPlan: string) => {
    const confirmMsg = locale === 'vi'
      ? `Bạn có chắc chắn muốn thay đổi gói dịch vụ thành "${newPlan}"?`
      : `Are you sure you want to change the subscription plan to "${newPlan}"?`;
    if (!confirm(confirmMsg)) return;

    try {
      const businessRef = doc(db, 'businesses', businessId);
      await updateDoc(businessRef, {
        subscriptionPlan: newPlan
      });
    } catch (e) {
      console.error("Error updating plan:", e);
      alert(locale === 'vi' ? 'Cập nhật gói thất bại.' : 'Plan update failed.');
    }
  };

  // Filter list
  const filteredUsers = users.filter((u) => {
    const matchesSearch = 
      u.name.toLowerCase().includes(search.toLowerCase()) || 
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.phone.toLowerCase().includes(search.toLowerCase());

    const matchesRole = 
      roleFilter === 'all' || 
      u.role === roleFilter;

    const matchesStatus = 
      statusFilter === 'all' || 
      u.approvalStatus === statusFilter ||
      (statusFilter === 'none' && !u.approvalStatus);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'superadmin':
        return styles.badgeSuper;
      case 'owner':
        return styles.badgeOwner;
      case 'manager':
        return styles.badgeManager;
      default:
        return styles.badgeStaff;
    }
  };

  const getStatusBadgeClass = (status?: string) => {
    switch (status) {
      case 'approved':
        return styles.statusApproved;
      case 'pending_superadmin':
      case 'pending_owner':
        return styles.statusPending;
      case 'rejected':
        return styles.statusRejected;
      default:
        return styles.statusNone;
    }
  };

  const getStatusLabel = (status?: string) => {
    if (!status) return locale === 'vi' ? 'Mặc định' : 'Default';
    switch (status) {
      case 'approved':
        return locale === 'vi' ? 'Đã duyệt' : locale === 'de' ? 'Freigegeben' : 'Approved';
      case 'pending_superadmin':
        return locale === 'vi' ? 'Chờ SaaS duyệt' : locale === 'de' ? 'Wartet auf SaaS' : 'Pending SaaS';
      case 'pending_owner':
        return locale === 'vi' ? 'Chờ Chủ duyệt' : locale === 'de' ? 'Wartet auf Inhaber' : 'Pending Owner';
      case 'rejected':
        return locale === 'vi' ? 'Bị từ chối' : locale === 'de' ? 'Abgelehnt' : 'Rejected';
      default:
        return status;
    }
  };

  const SECTIONS: { role: string; icon: string; label: Record<string, string>; color: string; bg: string; border: string }[] = [
    { role: 'superadmin', icon: '🛡️', label: { vi: 'Quản trị viên hệ thống', de: 'System-Administratoren', en: 'System Admins' }, color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    { role: 'owner', icon: '👑', label: { vi: 'Chủ tiệm', de: 'Inhaber', en: 'Owners' }, color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    { role: 'manager', icon: '👔', label: { vi: 'Quản lý', de: 'Manager', en: 'Managers' }, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    { role: 'staff', icon: '💅', label: { vi: 'Nhân viên', de: 'Mitarbeiter', en: 'Staff' }, color: '#059669', bg: '#f0fdf4', border: '#a7f3d0' },
  ];

  const renderUserRow = (item: UserItem) => (
    <div
      key={item.uid}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        backgroundColor: item.uid === user.uid ? '#fefce8' : '#ffffff',
        borderRadius: '8px',
        border: `1px solid ${item.uid === user.uid ? '#fde68a' : '#e5e7eb'}`,
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      {/* Left: Name + Email */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '200px', flex: 1 }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%',
          backgroundColor: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '14px', fontWeight: 700, color: '#374151', flexShrink: 0,
        }}>
          {item.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
        </div>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
            {item.name} {item.uid === user.uid && <span style={{ fontSize: '11px', color: '#d97706' }}>(You)</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>{item.email}</div>
          {item.phone && <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '2px', marginTop: '2px' }}><Phone className="w-3 h-3 text-gray-400" /> {item.phone}</div>}
        </div>
      </div>

      {/* Center: Branch + Plan (for owners) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {item.assignedBranches && item.assignedBranches.length > 0 && (
          item.assignedBranches.map((slug) => (
            <span key={slug} style={{
              fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
              backgroundColor: '#f3f4f6', color: '#374151', fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: '3px'
            }}><Store className="w-3 h-3 text-gray-400" /> {slug}</span>
          ))
        )}
        {item.role === 'owner' && item.businessId && (
          <select
            className={styles.actionSelect}
            value={businessPlans[item.businessId]?.subscriptionPlan || 'starter'}
            onChange={(e) => handlePlanChange(item.businessId!, e.target.value)}
            style={{
              fontSize: '11px', padding: '3px 6px', borderRadius: '4px', fontWeight: 600,
              backgroundColor:
                (businessPlans[item.businessId]?.subscriptionPlan || 'starter') === 'enterprise' ? '#f3e8ff' :
                (businessPlans[item.businessId]?.subscriptionPlan || 'starter') === 'professional' ? '#dbeafe' : '#dcfce7',
            }}
          >
            <option value="starter">{PLAN_LABELS.starter[locale] || PLAN_LABELS.starter.en}</option>
            <option value="professional">{PLAN_LABELS.professional[locale] || PLAN_LABELS.professional.en}</option>
            <option value="enterprise">{PLAN_LABELS.enterprise[locale] || PLAN_LABELS.enterprise.en}</option>
          </select>
        )}
      </div>

      {/* Right: Status + Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className={`${styles.statusBadge} ${getStatusBadgeClass(item.approvalStatus)}`}>
          {getStatusLabel(item.approvalStatus)}
        </span>
        <select
          className={styles.actionSelect}
          value={item.approvalStatus || ''}
          onChange={(e) => handleStatusChange(item.uid, e.target.value || null)}
          disabled={item.uid === user.uid}
          style={{ fontSize: '11px', padding: '4px 6px' }}
        >
          <option value="approved">{locale === 'vi' ? 'Duyệt' : 'Approve'}</option>
          <option value="pending_superadmin">{locale === 'vi' ? 'SaaS Chờ' : 'SaaS Pending'}</option>
          <option value="pending_owner">{locale === 'vi' ? 'Chủ Chờ' : 'Owner Pending'}</option>
          <option value="rejected">{locale === 'vi' ? 'Khóa' : 'Suspend'}</option>
        </select>
        <select
          className={styles.actionSelect}
          value={item.role}
          onChange={(e) => handleRoleChange(item.uid, e.target.value as any)}
          disabled={item.uid === user.uid}
          style={{ fontSize: '11px', padding: '4px 6px' }}
        >
          <option value="superadmin">Superadmin</option>
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>
            {locale === 'vi' ? 'Quản Lý Tài Khoản' : locale === 'de' ? 'Konten verwalten' : 'Accounts Management'}
          </h1>
          <p className={styles.subtitle}>
            {locale === 'vi'
              ? `Tổng cộng ${users.length} tài khoản trên hệ thống`
              : locale === 'de'
              ? `Insgesamt ${users.length} Konten im System`
              : `Total ${users.length} accounts in the system`}
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={locale === 'vi' ? 'Tìm theo tên, email, sđt...' : 'Search by name, email, phone...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <p>{locale === 'vi' ? 'Đang tải danh sách tài khoản...' : 'Loading accounts...'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {SECTIONS.map((section) => {
            const sectionUsers = filteredUsers.filter(u => u.role === section.role);
            return (
              <div key={section.role} style={{
                borderRadius: '14px',
                border: `1px solid ${section.border}`,
                backgroundColor: section.bg,
                overflow: 'hidden',
              }}>
                {/* Section Header */}
                <div style={{
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: `1px solid ${section.border}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>{section.icon}</span>
                    <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: section.color }}>
                      {section.label[locale] || section.label.en}
                    </h2>
                    <span style={{
                      fontSize: '12px', fontWeight: 700,
                      backgroundColor: section.color, color: 'white',
                      padding: '2px 10px', borderRadius: '10px',
                    }}>
                      {sectionUsers.length}
                    </span>
                  </div>
                </div>

                {/* Section Body */}
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sectionUsers.length === 0 ? (
                    <div style={{
                      padding: '20px', textAlign: 'center', fontSize: '13px', color: '#9ca3af',
                    }}>
                      {locale === 'vi' ? 'Không có tài khoản nào' : 'No accounts'}
                    </div>
                  ) : (
                    sectionUsers.map(renderUserRow)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

