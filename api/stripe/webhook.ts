// /api/stripe/webhook.ts
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature']!;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${(e as Error).message}`);
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const user = await findUserByCustomer(sub.customer as string);
      const plan = mapPriceToPlan(sub.items.data[0].price.id);
      await db.subscriptions.upsert({
        user_id: user.id,
        plan,
        period_end: sub.current_period_end,
      });
      // 期間が変わったら credits をリセット
      await resetCreditsIfNewPeriod(user.id, plan, sub.current_period_end);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const user = await findUserByCustomer(sub.customer as string);
      await downgradeToFree(user.id);
      break;
    }
    // 追加で invoice.paid 等があれば処理
  }

  res.json({ received: true });
}
