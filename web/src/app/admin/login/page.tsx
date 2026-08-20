'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { HrmButton, HrmInput } from '@/components/hrm-ui';

export default function AdminLoginPage() {
  const { login } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleCustomLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setLoading(true);
    
    try {
      await login(email, password);
      router.push('/admin/dashboard/');
    } catch (e: unknown) {
      console.error(e);
      const message = e instanceof Error ? e.message : '';
      if (message === 'pending_superadmin' || message === 'pending_owner') {
        setError(locale === 'vi' ? 'Tài khoản của bạn đang chờ duyệt. Vui lòng liên hệ quản trị viên.' : 'Your account is pending approval. Please contact the administrator.');
      } else if (message === 'rejected') {
        setError(locale === 'vi' ? 'Tài khoản của bạn đã bị từ chối.' : 'Your account has been rejected.');
      } else {
        setError(t.admin.login.errorLogin);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh w-full overflow-x-hidden bg-[#fbfaf7] bg-[url('/assets/images/hrm-auth-bg.svg')] bg-cover bg-center">
      <div className="pointer-events-none absolute inset-0 bg-white/15" aria-hidden="true" />
      <section className="relative z-10 flex min-h-dvh w-full items-center justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-[420px] flex-col items-center">
        <div className="mb-6"><LanguageSwitcher variant="light" /></div>
        <h1 className="text-center text-5xl font-semibold tracking-normal" aria-label="Timmo">
          <span className="text-slate-700">tim</span><span className="text-cyan-400">mo</span>
        </h1>

        {error && (
          <div className="mt-5 w-full rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleCustomLogin} className="mt-7 flex w-full flex-col gap-4">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <HrmInput
              type="email"
              className="h-14 min-h-14 rounded-[1.25rem] pl-12 pr-4 text-base"
              placeholder={t.admin.login.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <HrmInput
              type={showPassword ? 'text' : 'password'}
              className="h-14 min-h-14 rounded-[1.25rem] pl-12 pr-13 text-base"
              placeholder={t.admin.login.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
            <button type="button" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-[var(--hrm-blue-700)]" defaultChecked />{locale === 'vi' ? 'Ghi nhớ đăng nhập' : 'Remember me'}</label>
            <Link href="/admin/forgot-password" className="text-sm text-[var(--hrm-blue-700)]">
              {locale === 'vi' ? 'Quên mật khẩu?' : locale === 'de' ? 'Passwort vergessen?' : 'Forgot password?'}
            </Link>
          </div>
          <HrmButton type="submit" disabled={loading} className="mt-3 min-h-14 w-full rounded-[1.25rem] text-base font-semibold">{loading ? t.common.loading : t.admin.login.submitBtn}</HrmButton>
          <p className="pt-1 text-center text-sm font-medium text-slate-500">{locale === 'vi' ? 'Chưa có tài khoản?' : 'No account?'}<Link href="/admin/register" className="ml-1 font-bold text-[var(--hrm-blue-700)] hover:text-[var(--hrm-blue-800)]">{locale === 'vi' ? 'Đăng ký' : 'Register'}</Link></p>
        </form>
      </div>
      </section>
    </main>
  );
}
