# Edge Function: notify (แจ้งเตือน Telegram / LINE)

1. สร้างบอท Telegram ที่ @BotFather (ได้ token) แล้วหา chat id (ส่งข้อความหาบอทหรือเพิ่มบอทเข้ากลุ่ม แล้วเปิด `https://api.telegram.org/bot<TOKEN>/getUpdates`)
2. (ถ้าใช้ LINE) สร้าง Messaging API channel ได้ Channel access token และหา userId/groupId ที่จะรับข้อความ — LINE Notify ปิดบริการแล้ว
3. ตั้ง secret และ deploy:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=xxxx TELEGRAM_CHAT_ID=xxxx
supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=xxxx LINE_TO=xxxx   # ไม่ใช้ LINE ก็ข้ามได้
supabase functions deploy notify
```
4. ในแอปกด F9 → เปิด "การแจ้งเตือน" → "ส่งทดสอบ"

ฟังก์ชันต้องมี JWT ของผู้ใช้ที่ล็อกอินอยู่ (ค่าเริ่มต้นของ Supabase) ข้อความถูกประกอบที่ฝั่งเซิร์ฟเวอร์จากเหตุการณ์ที่กำหนดไว้เท่านั้น
