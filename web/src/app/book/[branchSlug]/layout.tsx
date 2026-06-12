import { ReactNode } from 'react';
import BookingLayoutClient from './BookingLayoutClient';

// Required for static export with dynamic [branchSlug] route
export function generateStaticParams() {
  return [{ branchSlug: 'glamour-nails-berlin' }];
}

export default function BookingLayout({ children }: { children: ReactNode }) {
  return <BookingLayoutClient>{children}</BookingLayoutClient>;
}
