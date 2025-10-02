'use client';
import { openPortal } from '@/lib/billing';

export default function BillingButtons() {
  return (
    <div className="flex gap-2">
      <button onClick={openPortal} className="btn-outline">支払い設定（Portal）</button>
    </div>
  );
}
