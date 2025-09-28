'use client'; // Next.js App Router の場合
import { buy, openPortal } from '@/lib/billing';

export default function BillingButtons() {
  return (
    <div className="flex gap-2">
      <button onClick={() => buy('basic')} className="btn">Basicを購入</button>
      <button onClick={() => buy('pro')} className="btn">Proを購入</button>
      <button onClick={openPortal} className="btn-outline">支払い設定（Portal）</button>
    </div>
  );
}
