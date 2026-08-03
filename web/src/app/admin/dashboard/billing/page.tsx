'use client';

import { useEffect, useState } from 'react';
import { CreditCard, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { createCardCheckout } from '@/lib/adminHrmApi';

export default function BillingPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
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
      <header>
        <h1 className="text-2xl font-bold text-gray-950">
          {locale === 'vi' ? 'Thanh toán gói' : locale === 'de' ? 'Abonnement bezahlen' : 'Subscription billing'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {locale === 'vi' ? 'Thanh toán an toàn bằng thẻ qua Stripe Checkout.' : 'Secure card payment through Stripe Checkout.'}
        </p>
      </header>
      {status === 'success' && <div className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Payment completed successfully.</div>}
      {status === 'cancelled' && <div className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">Payment was cancelled.</div>}
      {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <div className="rounded-[28px] border border-blue-100 bg-white p-6 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <CreditCard className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-xl font-bold">Timmo Booking</h2>
        <p className="mt-2 text-sm text-gray-500">Salon booking, staff calendar and customer portal.</p>
        <button disabled={busy} onClick={() => void checkout()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50">
          <LockKeyhole className="h-4 w-4" />
          {busy ? '...' : (locale === 'vi' ? 'Thanh toán bằng thẻ' : 'Pay by card')}
        </button>
      </div>
    </section>
  );
}
