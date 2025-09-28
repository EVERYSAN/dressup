import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
    apiVersion: "2025-08-27.basil", // ここは必ず最新verにする
    typescript: true
})
