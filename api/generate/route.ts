import { NextRequest, NextResponse } from "next/server";

// 重要：Edgeで不安定な場合は Node ランタイムに
export const runtime = "nodejs"; 
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = process.env.NANOBANANA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "APIキーが未設定です" }, { status: 500 });
  }

  const payload = await req.json();

  // ここを実際の外部APIに合わせて変更
  const res = await fetch("https://api.example.com/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    // VercelのServerlessでタイムアウト回避したい場合は適宜調整
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text || "外部APIエラー" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
