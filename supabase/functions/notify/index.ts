// Supabase Edge Function: notify — ส่งแจ้งเตือนไป Telegram และ/หรือ LINE (Messaging API)
// token เก็บเป็น secret ฝั่งเซิร์ฟเวอร์ แอปส่งมาเฉพาะ "เหตุการณ์ + ข้อมูลโครงสร้าง" ข้อความประกอบที่นี่ (กันถูกใช้ส่งข้อความมั่ว)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const s = (v: unknown, n = 80) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);
const money = (n: unknown) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function compose(event: string, data: any, store: string): string | null {
  const head = store ? `🏪 ${s(store, 60)}\n` : "";
  if (event === "TEST") return `${head}✅ ทดสอบการแจ้งเตือนจาก SMART-POS`;
  if (event === "LOW_STOCK") {
    const items = Array.isArray(data?.items) ? data.items.slice(0, 40) : [];
    if (!items.length) return null;
    return `${head}⚠️ สินค้าใกล้หมด/หมดสต็อก ${items.length} รายการ\n` +
      items.map((i: any) => `• ${s(i.name)} — เหลือ ${s(i.stock, 12)} ${s(i.unit, 12)} (ขั้นต่ำ ${s(i.min, 12)})`).join("\n");
  }
  if (event === "HEALTH_ALERT") {
    const neg = Array.isArray(data?.neg) ? data.neg.slice(0, 15) : [];
    const n = (k: string) => Number(data?.[k]) || 0;
    const lines: string[] = [];
    if (n("negCount") > 0) lines.push(`• สต็อกติดลบ ${n("negCount")} รายการ:\n` + neg.map((x: unknown) => `   - ${s(x, 70)}`).join("\n"));
    if (n("stuck") > 0) lines.push(`• รายการซิงก์ล้มเหลว/รอตรวจ ${n("stuck")} รายการ`);
    if (n("old") > 0) lines.push(`• รายการค้างซิงก์เกิน 6 ชั่วโมง ${n("old")} รายการ`);
    if (n("zero") > 0) lines.push(`• สินค้าราคา 0 บาท ${n("zero")} รายการ`);
    if (n("below") > 0) lines.push(`• ขายต่ำกว่าทุน/ตัวคูณผิด ${n("below")} รายการ`);
    if (!lines.length) return null;
    return `${head}🩺 ตรวจสุขภาพข้อมูลประจำวัน พบปัญหา\n` + lines.join("\n");
  }
  if (event === "DAILY_SUMMARY") {
    const m = data?.methods && typeof data.methods === "object" ? Object.entries(data.methods).slice(0, 10) : [];
    return `${head}📊 สรุปยอดขาย ${s(data?.date, 20)}\nจำนวนบิล: ${Number(data?.count) || 0}\nยอดรวม: ฿${money(data?.total)}` +
      (m.length ? "\n" + m.map(([k, v]) => `  - ${s(k, 30)}: ฿${money(v)}`).join("\n") : "");
  }
  return null;
}

async function telegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return "skip";
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  if (!r.ok) throw new Error("telegram " + r.status);
  return "ok";
}

// LINE Notify ปิดบริการแล้ว (มี.ค. 2025) — ใช้ LINE Messaging API (push message) แทน
async function line(text: string) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN"), to = Deno.env.get("LINE_TO");
  if (!token || !to) return "skip";
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) throw new Error("line " + r.status);
  return "ok";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const text = compose(String(body?.event), body?.data, String(body?.store ?? ""));
    if (!text) return json({ error: "bad event" }, 400);

    const [t, l] = await Promise.allSettled([telegram(text), line(text)]);
    const res = { telegram: t.status === "fulfilled" ? t.value : "error", line: l.status === "fulfilled" ? l.value : "error" };
    if (res.telegram === "skip" && res.line === "skip") return json({ error: "ยังไม่ได้ตั้ง secret ของ Telegram หรือ LINE" }, 500);
    return json(res);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
