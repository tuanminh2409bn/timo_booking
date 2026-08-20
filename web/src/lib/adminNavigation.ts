const DASHBOARD_HOME = '/admin/dashboard/';
const STAFF_PAGE = '/admin/dashboard/staff/';
const STORES_PAGE = '/admin/dashboard/my-branches/';

type AdminReturnContext =
  | { page: 'employee'; employeeId: string }
  | { page: 'stores' };

const addReturnContext = (path: string, context: AdminReturnContext) => {
  const url = new URL(path, 'https://timmo-booking.local');
  url.searchParams.set('returnTo', context.page);
  if (context.page === 'employee') url.searchParams.set('employeeId', context.employeeId);
  return `${url.pathname}${url.search}${url.hash}`;
};

export const withEmployeeReturn = (path: string, employeeId: string) =>
  addReturnContext(path, { page: 'employee', employeeId });

export const withStoresReturn = (path: string) =>
  addReturnContext(path, { page: 'stores' });

const currentSearchParams = () =>
  typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const getRequestedEmployeeId = () => currentSearchParams().get('employeeId')?.trim() ?? '';

export const getAdminBackTarget = (fallback = DASHBOARD_HOME) => {
  const params = currentSearchParams();
  if (params.get('returnTo') === 'employee') {
    const employeeId = params.get('employeeId')?.trim();
    if (employeeId) return `${STAFF_PAGE}?employeeId=${encodeURIComponent(employeeId)}`;
  }
  if (params.get('returnTo') === 'stores') return STORES_PAGE;
  return fallback;
};
