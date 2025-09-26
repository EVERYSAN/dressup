import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";           // 重要
export const dynamic = "force-dynamic";    // キャッシュ無効

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY; // ← Vercel名と一致させる
  if (!apiKey) {
    return NextResponse.json({ error: "APIキーが未設定です" }, { status: 500 });
  }

  const payload = await req.json(); // { contents: [...]} 等、フロントから渡す

  // Generative Language API へサーバーからプロキシ
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + encodeURIComponent(apiKey);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return NextResponse.json(json, { status: res.status });
  } catch {
    // APIがHTMLやプレーンを返したときの保険
    return new NextResponse(text, { status: res.status, headers: { "Content-Type": "text/plain" } });
  }
}
