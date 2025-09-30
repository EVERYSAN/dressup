// /api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/genai';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// ====== 環境変数 ======
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;

// ====== Supabase Admin client ======
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

// ====== ユーティリティ ======
function parseDataUrl(dataUrl: string): { mimeType: string; dataBase64: string } {
  const m = /^data:([\w/+.-]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Invalid data URL');
  return { mimeType: m[1], dataBase64: m[2] };
}

function watermarkSVG(w: number, h: number, text = 'DRESSUPAI.APP — FREE · dressupai.app') {
  const fontSize = Math.round(Math.max(18, Math.min(36, w / 48)));
  const fill = 'rgba(0,0,0,0.14)';
  const stroke = 'rgba(255,255,255,0.14)';
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <pattern id="wm" width="320" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="60" font-family="Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"
        font-size="${fontSize}" fill="${fill}" stroke="${stroke}" stroke-width="1.2">${text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm)"/>
</svg>`;
}

// ====== 無料判定（Supabase/Stripe） ======
/**
 * 無料ユーザーなら true。
 * - Bearer JWT を Supabase で検証 → user.id
 * - profiles テーブル例： { id, subscription_tier, stripe_customer_id }
 * - Stripe で該当 customer の active/trialing な subscription があるか確認
 * - どちらも未設定や失敗時は安全側（無料）にフォールバック
 */
async function isFreePlan(req: VercelRequest): Promise<boolean> {
  try {
    if (!supabaseAdmin) return true; // 構成されてなければ無料扱い

    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth) return true;

    // JWT からユーザー確認
    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(auth);
    if (authErr || !authData?.user) return true;
    const userId = authData.user.id;

    // プロファイル取得（テーブル/カラム名はあなたの実装に合わせてください）
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('subscription_tier,stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();

    // tier で早期判定（DB に tier がある運用）
    const tier = String(profile?.subscription_tier || '').toLowerCase();
    if (['lite', 'basic', 'pro'].includes(tier)) return false;

    // Stripe で購読アクティブ確認（customer がある運用）
    const customerId = profile?.stripe_customer_id;
    if (stripe && customerId) {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        expand: ['data.items.data.price.product'],
        limit: 10,
      });
      const hasActive = subs.data.some(s =>
        ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status as any)
      );
      if (hasActive) return false;
    }

    // アクティブ無し → 無料
    return true;
  } catch {
    // 失敗時は安全側
    return true;
  }
}

// ====== Gemini 呼び出し（既存の振る舞いを維持） ======
async function callGemini(
  prompt: string,
  baseImage?: string,
  refImage?: string
): Promise<Buffer> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const client = new GoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
  const model = client.getGenerativeModel({ model: MODEL });

  const parts: any[] = [];
  if (baseImage) {
    const { mimeType, dataBase64 } = parseDataUrl(baseImage);
    parts.push({ inlineData: { mimeType, data: dataBase64 } });
  }
  if (refImage) {
    const { mimeType, dataBase64 } = parseDataUrl(refImage);
    parts.push({ inlineData: { mimeType, data: dataBase64 } });
  }
  parts.push({ text: prompt });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
  });

  // 画像パーツ抽出（テキスト応答のみはエラー）
  const candidates = (result as any)?.response?.candidates || [];
  for (const c of candidates) {
    const parts: any[] = c?.content?.parts || [];
    for (const p of parts) {
      const data = p?.inlineData?.data || p?.fileData?.data;
      const mime = p?.inlineData?.mimeType || p?.fileData?.mimeType;
      if (data && mime?.startsWith('image/')) {
        return Buffer.from(data, 'base64');
      }
    }
  }
  throw new Error('No image in response');
}

// ====== ハンドラ（元の機能＋透かし焼き込み） ======
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { prompt, baseImage, refImage } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // 1) 生成
    const rawBuffer = await callGemini(prompt, baseImage, refImage);

    // 2) 無料判定（Supabase/Stripe）
    const mustWatermark = await isFreePlan(req);

    // 3) 透かし焼き込み（無料のみ）
    let out = rawBuffer;
    if (mustWatermark) {
      const img = sharp(rawBuffer);
      const meta = await img.metadata();
      const w = meta.width ?? 1024;
      const h = meta.height ?? 1024;
      const svg = Buffer.from(watermarkSVG(w, h));
      out = await img.composite([{ input: svg, top: 0, left: 0 }]).png({ quality: 92 }).toBuffer();
    }

    // 4) 返却（PNG固定）
    return res.status(200).json({
      image: {
        data: out.toString('base64'),
        mimeType: 'image/png',
      },
      watermarked: mustWatermark,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const code =
      /not found|404/i.test(msg) ? 404 :
      /invalid|mime|argument|400/i.test(msg) ? 400 :
      500;
    return res.status(code).json({ error: msg });
  }
}
