// ---- /api/generate.ts の中の callImageEditAPI を差し替え ----
async function callImageEditAPI({
  prompt,
  image1,
  image2 = null,             // ← マスク等に使いたい場合だけ渡す
}: {
  prompt: string;
  image1: string;            // dataURL (data:<mime>;base64,<b64>)
  image2?: string | null;
}): Promise<{ data: string; mimeType: string }> {
  // 0) スモーク（配線検証用）：ECHO_GENERATE=true ならベース画像を返す
  if (process.env.ECHO_GENERATE === 'true') {
    const [mimePart, b64] = image1.split(';base64,');
    const mime = mimePart?.replace('data:', '') || 'image/png';
    return { data: b64 || image1, mimeType: mime };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set');

  // dataURL → { mime, b64 }
  const parse = (d?: string | null) => {
    if (!d) return null;
    const [m, b] = d.split(';base64,');
    return { mime: m.replace('data:', ''), b64: b };
  };
  const base = parse(image1);
  const mask = parse(image2);

  if (!base?.b64) throw new Error('invalid base image');

  // --- 候補エンドポイントを順に試す（404 は次へフォールバック） ---
  const candidates: Array<{
    url: string;
    body: any;
    pick: (json: any) => { b64?: string; mime?: string } | null;
  }> = [];

  // A) AI Studio Images API（編集）: images:edit
  candidates.push({
    url: `https://generativelanguage.googleapis.com/v1beta/images:edit?key=${API_KEY}`,
    body: {
      edit: {
        prompt,
        image: { imageBytes: base.b64 },          // ← bytes base64
        ...(mask ? { mask: { imageBytes: mask.b64 } } : {}),
      },
    },
    pick: (json: any) => {
      const img = json?.images?.[0];
      if (!img) return null;
      const mime = img?.content?.mimeType || img?.mimeType || 'image/png';
      const b64  = img?.content?.imageBytes || img?.b64 || null;
      return b64 ? { b64, mime } : null;
    },
  });

  // B) AI Studio Images API（生成）: images:generate（参照画像を使わず、プロンプトのみで生成したい時）
  candidates.push({
    url: `https://generativelanguage.googleapis.com/v1beta/images:generate?key=${API_KEY}`,
    body: {
      // 単純生成の例：ベース画像をテキストの “参考” にする場合はここを使わず A の edit を使う想定
      prompt,
    },
    pick: (json: any) => {
      const img = json?.images?.[0];
      if (!img) return null;
      const mime = img?.content?.mimeType || img?.mimeType || 'image/png';
      const b64  = img?.content?.imageBytes || img?.b64 || null;
      return b64 ? { b64, mime } : null;
    },
  });

  // 将来的に Vertex 版へ切替える場合は C) として projects/.../publishers/google/models/imagegeneration:edit を追加

  let lastText = '';
  for (const c of candidates) {
    const resp = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c.body),
    });

    const text = await resp.text().catch(() => '');
    lastText = text || lastText;

    if (resp.status === 404) {
      // 次の候補へ（ログは Vercel の Functions ログで確認）
      console.error('[Images API] 404 at', c.url, text);
      continue;
    }
    if (!resp.ok) {
      console.error('[Images API] error', resp.status, text);
      throw new Error(`Images API error ${resp.status}: ${text}`);
    }

    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* noop */ }

    const picked = c.pick(json);
    if (!picked?.b64) {
      console.error('[Images API] no image in response', json);
      throw new Error('Images API returned no image');
    }
    return { data: picked.b64, mimeType: picked.mime || 'image/png' };
  }

  // ここまで来たら候補は全部 NG
  throw new Error(`Images API error 404: ${lastText}`);
}
