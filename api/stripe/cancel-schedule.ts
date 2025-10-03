// api/stripe/cancel-schedule.ts
// 予約済みのダウングレード等を取り消す API
// 認証: Authorization: Bearer <access_token>

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStripe, requireAuth, getCustomerId, ok, bad } from './_helpers'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization || req.headers.Authorization
  if (!authHeader || !`${authHeader}`.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing Bearer token' })
  }
  const accessToken = `${authHeader}`.slice('Bearer '.length)

  try {
    const stripe = getStripe()
    const { user, supabaseAdmin } = await requireAuth(accessToken)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const customerId = await getCustomerId(supabaseAdmin, user)
    if (!customerId) return res.status(404).json({ error: 'Customer not linked' })

    // 現サブスクリプション取得
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      expand: ['data.schedule'],
      limit: 10,
    })
    const active = subs.data.find(s => s.status !== 'canceled')
    if (!active) return ok(res, { canceled: false })

    const scheduleId = active.schedule?.id
    if (!scheduleId) return ok(res, { canceled: false })

    // 未来フェーズの削除 → 現状フェーズのみ残す（= 予約取り消し）
    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: 'release',
      phases: [
        {
          items: active.items.data.map(it => ({
            price: typeof it.price === 'string' ? it.price : it.price.id,
            quantity: it.quantity ?? 1,
          })),
          start_date: 'now',
          proration_behavior: 'none',
        },
      ],
    })

    return ok(res, { canceled: true })
  } catch (e: any) {
    console.error('[cancel-schedule] error', e?.message || e)
    return bad(res, 'Server error')
  }
}
