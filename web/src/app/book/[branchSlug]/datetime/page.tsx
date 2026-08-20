'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBooking } from '@/lib/bookingContext';

/**
 * Compatibility route for links created by older Booking releases.
 * Date/time is now part of the HRM-aligned staff step, so the duplicate UI is
 * intentionally removed and old URLs are forwarded to the canonical screen.
 */
export default function DateTimePage() {
  const router = useRouter();
  const { state } = useBooking();

  useEffect(() => {
    if (state.branchSlug) {
      router.replace(`/book/${state.branchSlug}/staff`);
    }
  }, [router, state.branchSlug]);

  return null;
}
