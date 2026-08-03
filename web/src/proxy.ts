import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/admin/dashboard')) {
    return NextResponse.next();
  }

  const userRole = request.cookies.get('timmo_user_role')?.value;
  const isLoggedIn = request.cookies.get('timmo_is_logged_in')?.value === 'true';

  if (!isLoggedIn || !userRole) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (userRole === 'staff') {
    const isStaffPage =
      pathname === '/admin/dashboard' ||
      pathname === '/admin/dashboard/' ||
      pathname.startsWith('/admin/dashboard/bookings');

    if (!isStaffPage) {
      return NextResponse.redirect(new URL('/admin/dashboard/', request.url));
    }
  }

  if (
    (userRole === 'manager' || userRole === 'staff') &&
    pathname.startsWith('/admin/dashboard/analytics')
  ) {
    const fallbackUrl = new URL('/admin/dashboard/', request.url);
    fallbackUrl.searchParams.set('error', 'unauthorized_financial_access');
    return NextResponse.redirect(fallbackUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/dashboard/:path*'],
};
