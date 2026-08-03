'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/lib/i18n';
import { registerHrmOwner } from '@/lib/hrmSession';
import styles from './page.module.css';

export default function RegisterPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [salonName, setSalonName] = useState('');
  const [address, setAddress] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!fullName.trim() || !email.trim() || password.length < 6 || !salonName.trim()) {
      setError(
        locale === 'vi'
          ? 'Vui lòng nhập đủ thông tin; mật khẩu phải có ít nhất 6 ký tự.'
          : 'Please complete all required fields; password must have at least 6 characters.',
      );
      return;
    }
    setLoading(true);
    try {
      await registerHrmOwner({
        name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim() || undefined,
        salonName: salonName.trim(),
        address: address.trim() || undefined,
      });
      setSuccess(
        locale === 'vi'
          ? 'Đã tạo tài khoản chủ tiệm và cửa hàng trên Firebase hiện tại. Bạn có thể đăng nhập ngay.'
          : 'Owner account and salon were created in the current Firebase. You can sign in now.',
      );
      window.setTimeout(() => router.push('/admin/login/'), 1800);
    } catch (failure: unknown) {
      const message = failure instanceof Error ? failure.message : '';
      setError(
        message.toLowerCase().includes('already')
          ? (locale === 'vi' ? 'Email này đã được sử dụng.' : 'This email is already in use.')
          : message || (locale === 'vi' ? 'Không thể đăng ký tài khoản.' : 'Registration failed.'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.registerCard}>
        <div className={styles.header}>
          <div className={styles.langWrapper}><LanguageSwitcher variant="light" /></div>
          <h1 className={styles.title}>{t.admin.register.title}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {locale === 'vi'
              ? 'Tạo tài khoản chủ tiệm trên hệ thống hiện tại'
              : locale === 'de'
                ? 'Inhaberkonto im aktuellen System erstellen'
                : 'Create an owner account in the current system'}
          </p>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}
        {success && <div className={styles.successBanner}>{success}</div>}

        <form onSubmit={submit} className={styles.registerForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.admin.register.fullNamePlaceholder} *</label>
            <input className={styles.formInput} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.admin.register.emailPlaceholder} *</label>
            <input className={styles.formInput} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.admin.register.passwordPlaceholder} *</label>
            <input className={styles.formInput} type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.admin.register.phonePlaceholder}</label>
            <input className={styles.formInput} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.admin.register.businessNamePlaceholder} *</label>
            <input className={styles.formInput} value={salonName} onChange={(event) => setSalonName(event.target.value)} required />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.admin.register.addressPlaceholder}</label>
            <input className={styles.formInput} value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" />
          </div>
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? t.common.loading : t.admin.register.submitBtn}
          </button>
        </form>

        <p className="text-center text-xs leading-5 text-gray-500">
          {locale === 'vi'
            ? 'Tài khoản nhân viên được chủ tiệm tạo trong mục Nhân sự để bảo đảm đúng phân quyền.'
            : 'Employee accounts are created by the owner in Staff settings.'}
        </p>
        <div className={styles.loginLinkWrapper}>
          <Link href="/admin/login" className={styles.loginLink}>{t.admin.register.loginLink}</Link>
        </div>
      </div>
    </div>
  );
}
