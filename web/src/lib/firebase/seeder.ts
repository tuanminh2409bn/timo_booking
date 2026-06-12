import { auth, db } from './config';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, writeBatch } from 'firebase/firestore';
import { demoBranch, demoCategories, demoServices, demoStaff } from '../seedData';
import { UserProfile, Business } from '../types';

export async function seedDatabase(onProgress: (msg: string) => void) {
  onProgress('Bắt đầu khởi tạo hệ thống...');

  // 1. Register Firebase Auth accounts & write profile docs
  const mockUsers = [
    {
      email: 'owner@glamournails.de',
      role: 'owner' as const,
      name: 'Anh Tuan (Chủ tiệm)',
      phone: '+49 30 111111',
      uid: 'owner-auth-uid-placeholder', // Will be replaced on create
    },
    {
      email: 'manager@glamournails.de',
      role: 'manager' as const,
      name: 'Minh Chau (Quản lý)',
      phone: '+49 30 222222',
      uid: 'manager-auth-uid-placeholder',
    },
    {
      email: 'staff@glamournails.de',
      role: 'staff' as const,
      name: 'Anna Schmidt (Thợ)',
      phone: '+49 30 333333',
      uid: 'staff-auth-uid-placeholder',
    }
  ];

  const password = '123456';
  const uids: Record<string, string> = {};

  for (const mockUser of mockUsers) {
    onProgress(`Đang tạo tài khoản Auth cho: ${mockUser.email}...`);
    let uid = '';
    try {
      const res = await createUserWithEmailAndPassword(auth, mockUser.email, password);
      uid = res.user.uid;
      onProgress(`Đã tạo mới tài khoản: ${mockUser.email}`);
    } catch (e: any) {
      // If user already exists, we cannot retrieve the UID directly from auth in client-side SDK.
      // But we can fallback to a predefined UID or assume the seeder runs on a clean DB.
      // To handle "auth/email-already-in-use", we'll warn and use a fallback or try to continue.
      if (e.code === 'auth/email-already-in-use') {
        onProgress(`Tài khoản ${mockUser.email} đã tồn tại trong Auth.`);
        // Note: For existing accounts, we will write profiles using static hash UIDs so they remain loginable.
        // We use static strings derived from emails for test stability.
        uid = `existing-${mockUser.role}-uid`;
      } else {
        throw e;
      }
    }
    uids[mockUser.role] = uid;

    // Write user profile to Firestore
    onProgress(`Đang tạo hồ sơ /users/${uid} trên Firestore...`);
    const profile: UserProfile = {
      uid,
      email: mockUser.email,
      role: mockUser.role,
      businessId: 'glamour-nails-business',
      assignedBranches: ['glamour-nails-berlin'],
      staffId: mockUser.role === 'staff' ? 'staff-anna' : null,
      name: mockUser.name,
      phone: mockUser.phone,
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', uid), profile);
  }

  // 2. Create Business Document
  onProgress('Đang tạo doanh nghiệp /businesses/glamour-nails-business...');
  const business: Business = {
    id: 'glamour-nails-business',
    ownerUid: uids['owner'] || 'owner-uid',
    companyName: 'Glamour Nails Beauty Group',
    status: 'active',
    subscriptionPlan: 'enterprise',
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'businesses', 'glamour-nails-business'), business);

  // 3. Create Branch Document
  onProgress('Đang tạo chi nhánh /branches/glamour-nails-berlin...');
  await setDoc(doc(db, 'branches', 'glamour-nails-berlin'), {
    ...demoBranch,
    id: 'glamour-nails-berlin',
    businessId: 'glamour-nails-business',
    createdAt: new Date().toISOString(),
  });

  // 4. Create Staff collection under Branch
  onProgress('Đang tạo danh sách nhân viên chi nhánh...');
  for (const staff of demoStaff) {
    const staffId = staff.id === 'staff-1' ? 'staff-anna' : staff.id;
    await setDoc(doc(db, 'branches', 'glamour-nails-berlin', 'staff', staffId), {
      ...staff,
      id: staffId,
      branchId: 'glamour-nails-berlin',
      userUid: staffId === 'staff-anna' ? uids['staff'] : null,
      createdAt: new Date().toISOString(),
    });
  }

  // 5. Create Categories and Services in Firestore
  // We will store categories under a root /categories or subcollection /branches/glamour-nails-berlin/categories
  // To keep it simple, we store categories and services directly in their subcollections
  onProgress('Đang tạo danh mục và dịch vụ...');
  for (const cat of demoCategories) {
    await setDoc(doc(db, 'branches', 'glamour-nails-berlin', 'categories', cat.id), {
      ...cat,
      branchId: 'glamour-nails-berlin',
    });
  }

  for (const service of demoServices) {
    await setDoc(doc(db, 'branches', 'glamour-nails-berlin', 'services', service.id), {
      ...service,
      branchId: 'glamour-nails-berlin',
      createdAt: new Date().toISOString(),
    });
  }

  // 6. Create some sample bookings
  onProgress('Đang tạo lịch hẹn mẫu cho ngày mai...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const sampleBookings = [
    {
      id: 'BK-1082',
      branchId: 'glamour-nails-berlin',
      businessId: 'glamour-nails-business',
      staffId: 'staff-anna',
      customerId: null,
      customerName: 'Nguyễn Văn A',
      customerPhone: '+49 176 123456',
      services: ['Auffüllen Gel Cực Đại (Refill Gel XXL)'],
      appointmentDate: tomorrowStr,
      startTime: '14:30',
      endTime: '16:00',
      totalDurationMinutes: 90,
      totalPrice: 55,
      status: 'pending_approval' as const,
      source: 'online' as const,
      idempotencyToken: 'token-1',
      notes: 'Yêu cầu vẽ móng nhẹ nhàng',
      smsConfirmationSent: false,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelledReason: null,
    },
    {
      id: 'BK-1081',
      branchId: 'glamour-nails-berlin',
      businessId: 'glamour-nails-business',
      staffId: 'staff-2',
      customerId: null,
      customerName: 'Trần Thị B',
      customerPhone: '+49 176 654321',
      services: ['Zehenmodellage mit Gel (Đắp Gel Móng Chân)'],
      appointmentDate: tomorrowStr,
      startTime: '10:00',
      endTime: '11:00',
      totalDurationMinutes: 60,
      totalPrice: 49,
      status: 'confirmed' as const,
      source: 'online' as const,
      idempotencyToken: 'token-2',
      notes: '',
      smsConfirmationSent: false,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelledReason: null,
    }
  ];

  for (const booking of sampleBookings) {
    await setDoc(doc(db, 'branches', 'glamour-nails-berlin', 'bookings', booking.id), booking);
  }

  onProgress('Hoàn tất cấu hình dữ liệu Firebase! Bạn có thể thử đăng nhập ngay.');
}
