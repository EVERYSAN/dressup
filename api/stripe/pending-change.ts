// api/stripe/pending-change.ts
// ダウングレード等の「保留中変更」を Stripe Subscription Schedule から読み出す API
// 認証: Authorization: Bearer <access_token> （フロントは supabase.auth.getSession() で取得）

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStripe, requireAuth, getCustomerId, ok, bad } from './_helpers'
import { planFromPriceId } from './_planMap'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1) 認証（Authorization ヘッダ必須）
  const authHeader = req.headers.authorization || req.headers.Authorization
  if (!authHeader || !`${authHeader}`.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing Bearer token' })
  }
  const accessToken = `${authHeader}`.slice('Bearer '.length)

  try {
    // 2) Stripe/Supabase 周りの準備
    const stripe = getStripe()
    const { user, supabaseAdmin } = await requireAuth(accessToken) // サーバ側でJWTを検証
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    // 3) user → stripe_customer_id 取得（users テーブル or auth.users → users）
    const customerId = await getCustomerId(supabaseAdmin, user)
    if (!customerId) return res.status(404).json({ error: 'Customer not linked' })

    // 4) 現在のサブスクリプションを取得
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      expand: ['data.schedule', 'data.items.data.price'],
      limit: 10,
    })
    const active = subs.data.find(s => s.status !== 'canceled')
    if (!active) return ok(res, { pending: null })

    // 5) 予約変更は subscription.schedule の current_phase/next_release などに出る
    //    ここでは schedule の phases を見て「未来のフェーズ」があれば pending として返す
    const scheduleId = active.schedule?.id
    if (!scheduleId) return ok(res, { pending: null })

    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId, {
      expand: ['phases.items.price'],
    })

    // schedule.phases のうち、start_date が「今より未来」のフェーズを拾う
    const now = Math.floor(Date.now() / 1000)
    const future = schedule.phases?.find(p => (typeof p.start_date === 'number' ? p.start_date : 0) > now)

    if (!future) {
      return ok(res, { pending: null })
    }

    // 6) 未来フェーズの先頭アイテムの price から “どのプランへ行くか” を判定
    const nextPriceId =
      future.items?.[0]?.price && typeof future.items[0].price !== 'string'
        ? future.items[0].price.id
        : (future.items?.[0]?.price as string | undefined)

    const nextPlan = nextPriceId ? planFromPriceId(nextPriceId) : null

    return ok(res, {
      pending: {
        next_plan: nextPlan, // 'light' | 'basic' | 'pro' | null
        next_price_id: nextPriceId ?? null,
        start_date_unix: typeof future.start_date === 'number' ? future.start_date : null,
        proration_behavior: schedule?.phases?.[0]?.proration_behavior ?? null,
      },
    })
  } catch (e: any) {
    console.error('[pending-change] error', e?.message || e)
    return bad(res, 'Server error')
  }
}
