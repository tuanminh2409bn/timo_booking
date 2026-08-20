'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export function AdminPageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return <div key={pathname} className="admin-page-transition admin-page-fade">{children}</div>;
}
