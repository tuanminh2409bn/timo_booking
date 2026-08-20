'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getFirebaseAppCheckToken, HRM_API_BASE_URL } from '@/lib/firebase/config';
import { useI18n } from '@/lib/i18n';
import { Mail } from 'lucide-react';
import { HrmButton, HrmInput } from '@/components/hrm-ui';

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const appCheckToken = await getFirebaseAppCheckToken();
  const response = await fetch(`${HRM_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(appCheckToken && { 'X-Firebase-AppCheck': appCheckToken }),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
};

export default function ForgotPasswordPage() {
  const { locale } = useI18n();
  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Request failed');
    } finally { setBusy(false); }
  };

  const requestOtp = () => run(async () => {
    await post('/api/v1/auth/forgot-password/request-otp', { email });
    setStep('otp');
  });
  const verifyOtp = () => run(async () => {
    const result = await post<{ resetToken: string }>(
      '/api/v1/auth/forgot-password/verify-otp',
      { email, otp },
    );
    setResetToken(result.resetToken);
    setStep('password');
  });
  const reset = () => run(async () => {
    await post('/api/v1/auth/forgot-password/reset-password', { resetToken, password });
    setStep('done');
  });

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-[#fbfaf7] bg-[url('/assets/images/hrm-auth-bg.svg')] bg-cover bg-center p-4">
      <section className="w-full max-w-[420px]">
        <h1 className="pt-5 text-center text-2xl font-bold text-slate-950 sm:pt-12">
          {locale === 'vi' ? 'Đặt lại mật khẩu' : locale === 'de' ? 'Passwort zurücksetzen' : 'Reset password'}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {locale === 'vi'
            ? 'Mã OTP gồm 6 số sẽ được gửi tới email tài khoản.'
            : 'A six-digit OTP will be sent to the account email.'}
        </p>

        {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {step === 'email' && (
          <div className="mt-6 space-y-4">
            <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><HrmInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="h-14 min-h-14 rounded-[1.25rem] pl-12 text-base" /></div>
            <HrmButton disabled={busy || !email.trim()} onClick={() => void requestOtp()} className="min-h-14 w-full rounded-[1.25rem] text-base font-semibold">
              {locale === 'vi' ? 'Gửi mã OTP' : 'Send OTP'}
            </HrmButton>
          </div>
        )}
        {step === 'otp' && (
          <div className="mt-6 space-y-4">
            <HrmInput inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="000000" className="h-14 min-h-14 rounded-[1.25rem] text-center text-2xl font-bold tracking-[0.4em]" />
            <HrmButton disabled={busy || otp.length !== 6} onClick={() => void verifyOtp()} className="min-h-14 w-full rounded-[1.25rem] text-base font-semibold">
              {locale === 'vi' ? 'Xác nhận mã' : 'Verify code'}
            </HrmButton>
          </div>
        )}
        {step === 'password' && (
          <div className="mt-6 space-y-4">
            <HrmInput type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={locale === 'vi' ? 'Mật khẩu mới' : 'New password'} className="h-14 min-h-14 rounded-[1.25rem] text-base" />
            <HrmButton disabled={busy || password.length < 6} onClick={() => void reset()} className="min-h-14 w-full rounded-[1.25rem] text-base font-semibold">
              {locale === 'vi' ? 'Đổi mật khẩu' : 'Change password'}
            </HrmButton>
          </div>
        )}
        {step === 'done' && (
          <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            {locale === 'vi' ? 'Đổi mật khẩu thành công.' : 'Password changed successfully.'}
          </div>
        )}

        <Link href="/admin/login" className="mt-6 block min-h-14 rounded-[1.25rem] bg-white py-4 text-center text-base font-semibold text-slate-700">
          {locale === 'vi' ? 'Quay lại đăng nhập' : 'Back to sign in'}
        </Link>
      </section>
    </main>
  );
}
