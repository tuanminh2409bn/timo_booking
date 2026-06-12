'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import Link from 'next/link';
import styles from './page.module.css';

interface BranchItem {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  isActive: boolean;
  createdAt?: string;
  businessId: string;
}

export default function BranchesManagementPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);

  // Sync branches from Firestore in real-time
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;

    const branchesRef = collection(db, 'branches');
    const unsubscribe = onSnapshot(branchesRef, (snap) => {
      const list: BranchItem[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as BranchItem);
      });
      // Sort by name or creation time if available
      list.sort((a, b) => a.name.localeCompare(b.name));
      setBranches(list);
      setLoading(false);
    }, (err) => {
      console.error("Error listening to branches:", err);
      setLoading(false);
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

  const handleToggleActive = async (branch: BranchItem) => {
    const nextStatus = !branch.isActive;
    const confirmMsg = locale === 'vi'
      ? `Bạn có chắc muốn ${nextStatus ? 'kích hoạt' : 'tạm khóa'} chi nhánh "${branch.name}"?`
      : locale === 'de'
      ? `Sind Sie sicher, dass Sie die Filiale "${branch.name}" ${nextStatus ? 'aktivieren' : 'deaktivieren'} möchten?`
      : `Are you sure you want to ${nextStatus ? 'activate' : 'deactivate'} the branch "${branch.name}"?`;

    if (!confirm(confirmMsg)) return;

    try {
      const branchRef = doc(db, 'branches', branch.id);
      await updateDoc(branchRef, {
        isActive: nextStatus
      });
    } catch (e) {
      console.error("Error toggling branch status:", e);
      alert(locale === 'vi' ? 'Cập nhật thất bại. Vui lòng kiểm tra phân quyền.' : 'Update failed. Please check permissions.');
    }
  };

  // Filter list
  const filteredBranches = branches.filter((b) => {
    const matchesSearch = 
      b.name.toLowerCase().includes(search.toLowerCase()) || 
      b.slug.toLowerCase().includes(search.toLowerCase()) ||
      b.address.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'active' && b.isActive) || 
      (statusFilter === 'inactive' && !b.isActive);

    return matchesSearch && matchesStatus;
  });

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>
            {locale === 'vi' ? 'Quản Lý Chi Nhánh' : locale === 'de' ? 'Filialen verwalten' : 'Branches Management'}
          </h1>
          <p className={styles.subtitle}>
            {locale === 'vi' 
              ? 'Xem, tìm kiếm, kiểm tra và thay đổi trạng thái hoạt động của toàn bộ chi nhánh salon nail.' 
              : locale === 'de' 
              ? 'Anzeigen, Suchen, Überprüfen und Ändern des Betriebsstatus aller Salonfilialen.'
              : 'View, search, audit, and toggle operation status of all nail salon branches.'}
          </p>
        </div>
      </div>

      {/* Controls Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={locale === 'vi' ? 'Tìm theo tên tiệm, slug, địa chỉ...' : locale === 'de' ? 'Suche nach Name, Slug, Adresse...' : 'Search by name, slug, address...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.filterTabs}>
          <button
            className={`${styles.filterTab} ${statusFilter === 'all' ? styles.filterTabActive : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            {locale === 'vi' ? 'Tất cả' : locale === 'de' ? 'Alle' : 'All'} ({branches.length})
          </button>
          <button
            className={`${styles.filterTab} ${statusFilter === 'active' ? styles.filterTabActive : ''}`}
            onClick={() => setStatusFilter('active')}
          >
            {locale === 'vi' ? 'Đang hoạt động' : locale === 'de' ? 'Aktiv' : 'Active'} ({branches.filter(b => b.isActive).length})
          </button>
          <button
            className={`${styles.filterTab} ${statusFilter === 'inactive' ? styles.filterTabActive : ''}`}
            onClick={() => setStatusFilter('inactive')}
          >
            {locale === 'vi' ? 'Tạm khóa' : locale === 'de' ? 'Inaktiv' : 'Inactive'} ({branches.filter(b => !b.isActive).length})
          </button>
        </div>
      </div>

      {/* Branches List */}
      <div className={styles.branchesList}>
        {loading ? (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <p>{locale === 'vi' ? 'Đang tải danh sách chi nhánh...' : locale === 'de' ? 'Filialliste wird geladen...' : 'Loading branches...'}</p>
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🏢</span>
            <p>{locale === 'vi' ? 'Không tìm thấy chi nhánh nào phù hợp.' : locale === 'de' ? 'Keine passenden Filialen gefunden.' : 'No branches found matching search criteria.'}</p>
          </div>
        ) : (
          filteredBranches.map((branch) => (
            <div key={branch.id} className={styles.branchCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h3 className={styles.branchName}>{branch.name}</h3>
                  <span className={styles.branchSlug}>slug: {branch.slug}</span>
                </div>
                <span className={`${styles.statusBadge} ${branch.isActive ? styles.badgeActive : styles.badgeInactive}`}>
                  {branch.isActive 
                    ? (locale === 'vi' ? 'Hoạt động' : locale === 'de' ? 'Aktiv' : 'Active') 
                    : (locale === 'vi' ? 'Tạm khóa' : locale === 'de' ? 'Inaktiv' : 'Suspended')}
                </span>
              </div>

              <div className={styles.cardBody}>
                <div className={styles.infoRow}>
                  <span className={styles.infoIcon}>📍</span>
                  <span className={styles.infoText}>{branch.address || 'N/A'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoIcon}>📞</span>
                  <span className={styles.infoText}>{branch.phone || 'N/A'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoIcon}>🔑</span>
                  <span className={styles.infoText}>Biz ID: {branch.businessId}</span>
                </div>
              </div>

              <div className={styles.cardActions}>
                <Link 
                  href={`/book/${branch.slug}`} 
                  className={styles.viewBtn} 
                  target="_blank"
                >
                  {locale === 'vi' ? 'Xem trang đặt lịch ↗' : locale === 'de' ? 'Buchungsseite anzeigen ↗' : 'View Booking Site ↗'}
                </Link>
                <button
                  className={`${styles.actionBtn} ${branch.isActive ? styles.btnDeactivate : styles.btnActivate}`}
                  onClick={() => handleToggleActive(branch)}
                >
                  {branch.isActive 
                    ? (locale === 'vi' ? 'Khóa chi nhánh' : locale === 'de' ? 'Filiale sperren' : 'Suspend Branch')
                    : (locale === 'vi' ? 'Kích hoạt' : locale === 'de' ? 'Aktivieren' : 'Activate Branch')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
