'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import {
  Branch,
  Service,
  Staff,
  BookingState,
  SelectedServiceItem,
  ServiceCategory,
  computeBookingTotals,
  hasConflict,
  MAX_MAIN_SERVICES,
} from './types';

// ═══════════════════════════════════════════════════
//  Actions
// ═══════════════════════════════════════════════════

type BookingAction =
  | { type: 'SET_BRANCH'; branch: Branch }
  | { type: 'SET_BRANCH_SLUG'; slug: string }
  | { type: 'INIT_STATE'; state: BookingState }
  // Multi-service actions
  | { type: 'ADD_MAIN_SERVICE'; category: ServiceCategory; service: Service }
  | { type: 'TOGGLE_EXTRA'; categoryId: string; extra: Service }
  | { type: 'REMOVE_CATEGORY'; categoryId: string }
  | { type: 'CLEAR_ALL_SERVICES' }
  // Staff (per-service in Spec V1)
  | { type: 'SELECT_STAFF'; staff: Staff | null; staffType: 'specific' | 'any' }
  | { type: 'SELECT_STAFF_FOR_SERVICE'; categoryId: string; staff: Staff | null; staffType: 'specific' | 'any' }
  | { type: 'CLEAR_STAFF' }
  // Date/Time
  | { type: 'SELECT_DATE'; date: string }
  | { type: 'SELECT_TIME'; time: string; bookingMode: 'instant' | 'request' }
  // Customer
  | { type: 'SET_CUSTOMER_INFO'; info: Partial<BookingState['customerInfo']> }
  // Flow control
  | { type: 'SET_STEP'; step: number }
  | { type: 'SET_SKIP_STAFF'; skip: boolean }
  | { type: 'RESET' };

// ═══════════════════════════════════════════════════
//  Initial State
// ═══════════════════════════════════════════════════

const initialState: BookingState = {
  branchSlug: '',
  branch: null,
  selectedServices: [],
  selectedStaff: null,
  selectedStaffType: 'any',
  selectedDate: null,
  selectedTime: null,
  bookingMode: 'instant',
  skipStaffSelection: false,
  customerInfo: {
    name: '',
    phone: '',
    email: '',
    password: '',
    notes: '',
    isReturning: false,
  },
  currentStep: 1,
};

// ═══════════════════════════════════════════════════
//  Reducer
// ═══════════════════════════════════════════════════

function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case 'SET_BRANCH':
      return { ...state, branch: action.branch, branchSlug: action.branch.slug || state.branchSlug };

    case 'SET_BRANCH_SLUG':
      return { ...state, branchSlug: action.slug };

    case 'INIT_STATE':
      return {
        ...action.state,
        branchSlug: state.branchSlug || action.state.branchSlug, // preserve URL-derived slug
        currentStep: state.currentStep,
      };

    // ── Multi-service: Add main service to a category ──
    case 'ADD_MAIN_SERVICE': {
      const { category, service } = action;
      const existingIdx = state.selectedServices.findIndex(
        (s) => s.categoryId === category.id
      );

      // Check conflict before adding
      if (existingIdx === -1 && hasConflict(state.selectedServices, category.conflictGroup)) {
        return state; // conflict — don't add
      }

      // Check max categories (Spec V1: max 2 main services)
      if (existingIdx === -1 && state.selectedServices.length >= MAX_MAIN_SERVICES) {
        return state; // max reached
      }

      const newItem: SelectedServiceItem = {
        categoryId: category.id,
        categoryName: category.name,
        mainService: service,
        extras: [],
        selectedStaff: null,              // Spec V1: per-service staff
        selectedStaffType: 'any',         // Spec V1: default to any
      };

      let newServices: SelectedServiceItem[];
      if (existingIdx >= 0) {
        // Replace main service in existing category (keep extras that are still valid)
        newServices = [...state.selectedServices];
        newServices[existingIdx] = {
          ...newItem,
          extras: state.selectedServices[existingIdx].extras,
        };
      } else {
        newServices = [...state.selectedServices, newItem];
      }

      return {
        ...state,
        selectedServices: newServices,
        // Clear staff & time when services change
        selectedStaff: null,
        selectedStaffType: 'any',
        selectedDate: null,
        selectedTime: null,
      };
    }

    // ── Toggle extra (Design/Extra) in a category ──
    case 'TOGGLE_EXTRA': {
      const { categoryId, extra } = action;
      const idx = state.selectedServices.findIndex(
        (s) => s.categoryId === categoryId
      );
      if (idx === -1) return state; // no main service in this category

      const current = state.selectedServices[idx];
      const hasExtra = current.extras.some((e) => e.id === extra.id);

      const newExtras = hasExtra
        ? current.extras.filter((e) => e.id !== extra.id)
        : [...current.extras, extra];

      const newServices = [...state.selectedServices];
      newServices[idx] = { ...current, extras: newExtras };

      return {
        ...state,
        selectedServices: newServices,
        selectedDate: null,
        selectedTime: null,
      };
    }

    // ── Remove entire category ──
    case 'REMOVE_CATEGORY': {
      return {
        ...state,
        selectedServices: state.selectedServices.filter(
          (s) => s.categoryId !== action.categoryId
        ),
        selectedStaff: null,
        selectedStaffType: 'any',
        selectedDate: null,
        selectedTime: null,
      };
    }

    // ── Clear all services ──
    case 'CLEAR_ALL_SERVICES':
      return {
        ...state,
        selectedServices: [],
        selectedStaff: null,
        selectedStaffType: 'any',
        selectedDate: null,
        selectedTime: null,
      };

    // ── Staff ──
    case 'SELECT_STAFF':
      return {
        ...state,
        selectedStaff: action.staff,
        selectedStaffType: action.staffType,
      };

    // Spec V1: Per-service staff selection
    case 'SELECT_STAFF_FOR_SERVICE': {
      const { categoryId, staff, staffType } = action;
      const idx = state.selectedServices.findIndex(s => s.categoryId === categoryId);
      if (idx === -1) return state;

      const newServices = [...state.selectedServices];
      newServices[idx] = {
        ...newServices[idx],
        selectedStaff: staff,
        selectedStaffType: staffType,
      };

      return {
        ...state,
        selectedServices: newServices,
        // Clear date/time when staff changes
        selectedDate: null,
        selectedTime: null,
      };
    }

    case 'CLEAR_STAFF':
      return { ...state, selectedStaff: null, selectedStaffType: 'any' };

    // ── Date/Time ──
    case 'SELECT_DATE':
      return { ...state, selectedDate: action.date, selectedTime: null };

    case 'SELECT_TIME':
      return {
        ...state,
        selectedTime: action.time,
        bookingMode: action.bookingMode,
      };

    // ── Customer ──
    case 'SET_CUSTOMER_INFO':
      return {
        ...state,
        customerInfo: { ...state.customerInfo, ...action.info },
      };

    // ── Flow ──
    case 'SET_STEP':
      return { ...state, currentStep: action.step };

    case 'SET_SKIP_STAFF':
      return { ...state, skipStaffSelection: action.skip };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ═══════════════════════════════════════════════════
//  Context
// ═══════════════════════════════════════════════════

interface BookingContextType {
  state: BookingState;
  dispatch: React.Dispatch<BookingAction>;
  /** Computed totals from selected services */
  totals: { totalDuration: number; totalPrice: number; serviceCount: number };
}

const BookingContext = createContext<BookingContextType | null>(null);

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(bookingReducer, initialState);

  // Load state from sessionStorage on mount
  React.useEffect(() => {
    const saved = sessionStorage.getItem('timmo_booking_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        dispatch({ type: 'INIT_STATE', state: parsed });
      } catch (e) {
        console.error('Error parsing booking state:', e);
      }
    }
  }, []);

  // Save state to sessionStorage on changes
  React.useEffect(() => {
    if (state.selectedServices.length === 0 && !state.selectedStaff && !state.selectedDate) {
      sessionStorage.removeItem('timmo_booking_state');
    } else {
      sessionStorage.setItem('timmo_booking_state', JSON.stringify(state));
    }
  }, [state]);

  const totals = computeBookingTotals(state.selectedServices);

  return (
    <BookingContext.Provider value={{ state, dispatch, totals }}>
      {children}
    </BookingContext.Provider>
  );
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) throw new Error('useBooking must be used within BookingProvider');
  return context;
}
