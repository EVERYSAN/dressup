// /api/stripe/create-portal.ts
const portal = await stripe.billingPortal.sessions.create({
  customer: customerId,
  return_url: `${process.env.APP_URL}/settings`,
});
res.json({ url: portal.url });
