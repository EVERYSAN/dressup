import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: !!process.env.GEMINI_API_KEY });
}
