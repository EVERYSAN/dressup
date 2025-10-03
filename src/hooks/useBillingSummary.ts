// src/hooks/useBillingSummary.ts
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

type PendingChange = {
  hasPending: boolean;
  toPlan?: 'light'|'basic'|'pro';
  toPriceId?: string;
  effectiveDate?: number; // unix
};

type Usage = {
  plan: string;
  credits_total: number;
  credits_used: number;
  period_end: number | null;
};

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);

export function useBillingSummary() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [usage, setUsage]       = useState<Usage | null>(null);
  const [pending, setPending]   = useState<PendingChange>({ hasPending:false });

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');

      // users テーブル
      const { data: rows, error: e1 } = await supabase
        .from('users')
        .select('plan, credits_total, credits_used, period_end')
        .eq('email', user.email)
        .maybeSingle();
      if (e1) throw e1;
      if (rows) setUsage(rows as unknown as Usage);

      // 予約状況
      const res = await fetch('/api/stripe/pending-change');
      const pc = await res.json();
      setPending(pc);
    } catch (e: any) {
      setError(e.message || 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cancelSchedule = useCallback(async () => {
    const r = await fetch('/api/stripe/cancel-schedule', { method:'POST' });
    if (!r.ok) throw new Error(await r.text());
    await refresh();
  }, [refresh]);

  const periodDate =
    usage?.period_end ? new Date((usage.period_end as number) * 1000) : null;

  return {
    loading, error,
    usage,
    pending,
    periodDate,
    remaining:
      usage ? Math.max(0, usage.credits_total - usage.credits_used) : null,
    refresh,
    cancelSchedule,
  };
}
