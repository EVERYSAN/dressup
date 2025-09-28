// /api/generate.ts
export default async function handler(req, res) {
  const user = await getUser(req);
  const u = await db.users.find(user.id);

  const remaining = u.credits_total - u.credits_used;
  if (remaining <= 0) return res.status(402).json({ error: 'No credits' }); // 402 Payment Required

  // 生成実行（Gemini/S3 等）
  // ...

  await db.users.update(user.id, { credits_used: u.credits_used + 1 });
  res.json({ ok: true, remaining: remaining - 1 });
}
