import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { getUserFromRequest } from '../_utils/auth';
import { supabaseAdmin } from '../_utils/supabase';

const stripe = new Stripe(process.env.STRIPE_API_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { data, error } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', user.id).single();
  if (error || !data?.stripe_customer_id) return res.status(400).json({ error: 'no customer' });

  const portal = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${process.env.APP_URL}/settings`,
  });
  return res.status(200).json({ url: portal.url });
}
