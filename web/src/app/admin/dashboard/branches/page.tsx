'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Store } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { HrmCard, HrmPageHeader } from '@/components/hrm-ui';
import {
  fetchPlatformStores,
  updatePlatformStore,
  type PlatformStore,
} from '@/lib/adminHrmApi';

export default function PlatformStoresPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<PlatformStore[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setItems(await fetchPlatformStores()), []);
  useEffect(() => {
    if (user?.role === 'superadmin') void load().catch(console.error);
  }, [user, load]);
  if (user?.role !== 'superadmin') return <div className="rounded-2xl bg-red-50 p-5 text-red-800">Platform admin access required.</div>;

  const toggle = async (store: PlatformStore) => {
    setBusy(true);
    try {
      await updatePlatformStore(store.id, store.status === 'active' ? 'disabled' : 'active');
      await load();
    } finally { setBusy(false); }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <HrmPageHeader className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl" title={locale === 'vi' ? 'Cửa hàng hệ thống' : 'Platform stores'} onBack={() => router.push('/admin/dashboard/')} />
      <p className="text-sm text-slate-500">{items.length} stores in the current Firebase</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((store) => (
          <HrmCard key={store.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]"><Store className="h-5 w-5 stroke-[1.8]" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-bold">{store.name}</h2>
                <p className="mt-1 flex items-center gap-1 truncate text-sm text-gray-500"><MapPin className="h-3.5 w-3.5" /> {store.addressText || '—'}</p>
                <p className="mt-2 truncate text-xs text-gray-400">Owner: {store.ownerId}</p>
              </div>
              <button disabled={busy} onClick={() => void toggle(store)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${store.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {store.status}
              </button>
            </div>
          </HrmCard>
        ))}
      </div>
    </section>
  );
}
