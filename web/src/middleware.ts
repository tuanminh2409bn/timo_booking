import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only run middleware on /admin/dashboard paths
  if (pathname.startsWith('/admin/dashboard')) {
    const userRole = request.cookies.get('timmo_user_role')?.value;
    const isLoggedIn = request.cookies.get('timmo_is_logged_in')?.value === 'true';

    // 1. If not logged in, redirect to login page
    if (!isLoggedIn || !userRole) {
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // 2. Strict check: Managers and Staff cannot access financial analytics pages
    if (pathname.startsWith('/admin/dashboard/analytics')) {
      if (userRole === 'manager' || userRole === 'staff') {
        const fallbackUrl = new URL('/admin/dashboard', request.url);
        fallbackUrl.searchParams.set('error', 'unauthorized_financial_access');
        return NextResponse.redirect(fallbackUrl);
      }
    }

    // 3. Staff accounts can only access schedule/personal booking views
    if (userRole === 'staff' && !pathname.startsWith('/admin/dashboard/my-schedule')) {
      const fallbackUrl = new URL('/admin/dashboard/my-schedule', request.url);
      return NextResponse.redirect(fallbackUrl);
    }
  }

  return NextResponse.next();
}

// Configure paths that will trigger this middleware
export const config = {
  matcher: ['/admin/dashboard/:path*'],
};
