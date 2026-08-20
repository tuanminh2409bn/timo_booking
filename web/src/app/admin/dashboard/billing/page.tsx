'use client';

import { useEffect, useState } from 'react';
import { CreditCard, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { createCardCheckout } from '@/lib/adminHrmApi';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmFeatureCard, HrmPageHeader } from '@/components/hrm-ui';
import { getAdminBackTarget } from '@/lib/adminNavigation';

export default function BillingPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    setStatus(new URLSearchParams(window.location.search).get('status'));
  }, []);

  if (user?.role !== 'owner') {
    return <div className="rounded-2xl bg-amber-50 p-5 text-amber-900">Only owners may manage billing.</div>;
  }

  const checkout = async () => {
    setBusy(true);
    setError('');
    try {
      window.location.assign(await createCardCheckout());
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Could not start payment');
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-xl space-y-5">
      <HrmPageHeader className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl" title={locale === 'vi' ? 'Thanh toán gói' : locale === 'de' ? 'Abonnement bezahlen' : 'Subscription billing'} onBack={() => router.push(getAdminBackTarget())} />
        <p className="text-sm text-gray-500">
          {locale === 'vi' ? 'Thanh toán an toàn bằng thẻ qua Stripe Checkout.' : 'Secure card payment through Stripe Checkout.'}
        </p>
      {status === 'success' && <div className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Payment completed successfully.</div>}
      {status === 'cancelled' && <div className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">Payment was cancelled.</div>}
      {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <HrmFeatureCard className="p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]">
          <CreditCard className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-xl font-bold">Timmo Booking</h2>
        <p className="mt-2 text-sm text-gray-500">Salon booking, staff calendar and customer portal.</p>
        <HrmButton disabled={busy} onClick={() => void checkout()} className="mt-6 min-h-11 w-full rounded-xl px-4 font-bold">
          <LockKeyhole className="h-4 w-4" />
          {busy ? '...' : (locale === 'vi' ? 'Thanh toán bằng thẻ' : 'Pay by card')}
        </HrmButton>
      </HrmFeatureCard>
    </section>
  );
}
