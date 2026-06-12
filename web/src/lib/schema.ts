import { UserProfile, Business, Branch, Staff, Appointment } from './types';

/**
 * Timmo Booking Firestore Schema Documentation
 * 
 * This file serves as a reference for the Firestore Collections structure
 * and maps Firestore documents to their respective TypeScript interfaces.
 */

export interface FirestoreSchema {
  /**
   * Global Users collection (not branch specific)
   * Path: `/users/{uid}`
   */
  users: Record<string, UserProfile>;

  /**
   * Global Businesses (Tenants) collection
   * Path: `/businesses/{businessId}`
   */
  businesses: Record<string, Business>;

  /**
   * Branches (Salons) collection
   * Path: `/branches/{branchId}`
   */
  branches: Record<string, Branch & { businessId: string }>;

  /**
   * Staff subcollection inside a Branch
   * Path: `/branches/{branchId}/staff/{staffId}`
   */
  staff: Record<string, Record<string, Staff>>;

  /**
   * Bookings subcollection inside a Branch
   * Path: `/branches/{branchId}/bookings/{bookingId}`
   */
  bookings: Record<string, Record<string, Appointment>>;

  /**
   * Analytics & Revenue subcollection inside a Branch
   * Path: `/branches/{branchId}/analytics/{analyticsId}`
   * 
   * STRICT ACCESS: Only accessible by Business Owner ('owner') and Superadmin.
   */
  analytics: Record<string, Record<string, BranchAnalytics>>;
}

export interface BranchAnalytics {
  id: string; // e.g. YYYY-MM
  branchId: string;
  businessId: string;
  totalRevenue: number;
  completedBookings: number;
  noShowsCount: number;
  revenueByService: Record<string, number>; // Maps serviceId to accumulated revenue
  updatedAt: string;
}

/**
 * Helper to check if a user role has access to financial statistics.
 * As per request, Managers ('manager') and Staff ('staff') are restricted.
 */
export function canViewFinancialStatistics(role: string): boolean {
  return role === 'owner' || role === 'superadmin';
}

/**
 * Helper to check if a user role has access to basic quantity stats
 * (e.g. appointment counts). Managers and Owners have access, Staff does not.
 */
export function canViewBasicQuantityStats(role: string): boolean {
  return role === 'owner' || role === 'manager' || role === 'superadmin';
}
