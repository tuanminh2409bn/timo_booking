'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, LogOut, MapPin, Phone, Scissors } from 'lucide-react';
import { HRM_API_BASE_URL } from '@/lib/firebase/config';

type PortalBooking = {
  id: string;
  bookingCode: string;
  salonName: string;
  address?: Record<string, string>;
  workDate: string;
  startTime: number;
  status: string;
  canCancel: boolean;
  services: Array<{ name: string; price: number }>;
};

const portalFetch = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${HRM_API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...init.headers,
      ...(init.body && { 'Content-Type': 'application/json' }),
    },
  });
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
};

const timeLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export default function CustomerPortalPage() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'bookings'>('phone');
  const [items, setItems] = useState<PortalBooking[]>([]);
  const [debugOtp, setDebugOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadBookings = useCallback(async () => {
    const data = await portalFetch('/api/v1/customer/bookings') as { items?: PortalBooking[] };
    setItems(data.items ?? []);
    setStep('bookings');
  }, []);

  useEffect(() => {
    void loadBookings().catch(() => undefined);
  }, [loadBookings]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'Request failed'); }
    finally { setBusy(false); }
  };

  const requestOtp = () => run(async () => {
    const data = await portalFetch('/api/v1/customer/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }) as { debugOtp?: string };
    setDebugOtp(data.debugOtp ?? '');
    setStep('otp');
  });
  const verify = () => run(async () => {
    await portalFetch('/api/v1/customer/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp }),
    });
    await loadBookings();
  });
  const logout = () => run(async () => {
    await portalFetch('/api/v1/customer/auth/logout', { method: 'POST' });
    setItems([]);
    setOtp('');
    setStep('phone');
  });
  const cancel = (booking: PortalBooking) => run(async () => {
    if (!window.confirm('Cancel this booking?')) return;
    await portalFetch(`/api/v1/customer/bookings/${encodeURIComponent(booking.id)}/cancel`, {
      method: 'POST',
    });
    await loadBookings();
  });

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(
    () => items.filter((item) => item.workDate >= today && item.status !== 'cancelled'),
    [items, today],
  );
  const past = useMemo(
    () => items.filter((item) => item.workDate < today || item.status === 'cancelled'),
    [items, today],
  );

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-950">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-blue-600">Timmo</p>
            <h1 className="text-2xl font-black">My bookings</h1>
          </div>
          {step === 'bookings' && (
            <button onClick={() => void logout()} className="rounded-full bg-white p-3 text-gray-500 shadow-sm" aria-label="Log out">
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </header>

        {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {step !== 'bookings' && (
          <section className="rounded-[28px] border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Phone className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold">{step === 'phone' ? 'Sign in with phone' : 'Enter verification code'}</h2>
            <p className="mt-1 text-sm text-gray-500">No password is required.</p>
            {step === 'phone' ? (
              <div className="mt-5 space-y-3">
                <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+49 123 456 789" className="min-h-[48px] w-full rounded-xl border border-gray-200 px-4 outline-none focus:border-blue-500" />
                <button disabled={busy || !phone.trim()} onClick={() => void requestOtp()} className="min-h-[48px] w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50">Send SMS code</button>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {debugOtp && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Development OTP: {debugOtp}</p>}
                <input inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="000000" className="min-h-[48px] w-full rounded-xl border border-gray-200 px-4 text-center text-2xl font-bold tracking-[0.4em] outline-none focus:border-blue-500" />
                <button disabled={busy || otp.length !== 6} onClick={() => void verify()} className="min-h-[48px] w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50">Verify</button>
              </div>
            )}
          </section>
        )}

        {step === 'bookings' && (
          <div className="space-y-8">
            <BookingSection title="Upcoming bookings" items={upcoming} onCancel={cancel} />
            <BookingSection title="Past bookings" items={past} onCancel={cancel} />
          </div>
        )}
      </div>
    </main>
  );
}

function BookingSection({
  title,
  items,
  onCancel,
}: {
  title: string;
  items: PortalBooking[];
  onCancel: (booking: PortalBooking) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="space-y-3">
        {items.length === 0 && <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No bookings</div>}
        {items.map((booking) => {
          const address = booking.address ? Object.values(booking.address).filter(Boolean).join(', ') : '';
          const start = timeLabel(booking.startTime);
          const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${booking.salonName} booking`)}&dates=${booking.workDate.replaceAll('-', '')}T${start.replace(':', '')}00/${booking.workDate.replaceAll('-', '')}T${start.replace(':', '')}00&details=${encodeURIComponent(booking.services.map((service) => service.name).join(', '))}`;
          return (
            <article key={booking.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{booking.salonName}</h3>
                  <p className="mt-1 text-sm text-gray-500">{booking.workDate} · {start}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600">{booking.status}</span>
              </div>
              <div className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                <Scissors className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span>{booking.services.map((service) => service.name).join(', ') || 'Service'}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={calendarUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                  <CalendarPlus className="h-4 w-4" /> Add to calendar
                </a>
                {address && (
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700">
                    <MapPin className="h-4 w-4" /> Directions
                  </a>
                )}
                {booking.canCancel && (
                  <button onClick={() => onCancel(booking)} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Cancel</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
