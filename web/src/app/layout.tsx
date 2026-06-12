import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/authContext';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Timmo Booking - Modern Nail Salon Booking',
  description:
    'The modern booking platform built specifically for nail salons. Streamline appointments, manage staff, and delight your clients with 24/7 online booking.',
  keywords: [
    'nail salon booking',
    'nagelstudio buchung',
    'appointment scheduling',
    'salon management',
    'online booking',
  ],
  openGraph: {
    title: 'Timmo Booking - Modern Nail Salon Booking',
    description:
      'Streamline your nail salon appointments with a modern booking system. Your clients book online 24/7.',
    type: 'website',
    locale: 'de_DE',
    siteName: 'Timmo Booking',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Timmo Booking - Modern Nail Salon Booking',
    description:
      'Streamline your nail salon appointments with a modern booking system.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={inter.variable}>
      <body>
        <AuthProvider>
          <I18nProvider defaultLocale="de">{children}</I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
