# SMART-POS (โครงสร้าง Vite)

ระบบ POS หน้าร้านแบบออฟไลน์ + ซิงก์ Supabase — แยกจากไฟล์เดียว 650 KB เป็นโปรเจกต์ที่แก้ไขเป็นส่วนๆ ได้
**โค้ดทุกบรรทัดเหมือนเดิม** (ประกอบกลับด้วย `npm run build:single` ได้ไฟล์ตรงกับต้นฉบับทุกไบต์)

## เริ่มใช้
```bash
npm install
npm run dev        # เปิด http://localhost:5173
npm run check      # ตรวจไวยากรณ์ JS + ไฟล์ที่อ้างถึงครบหรือไม่ (ไม่ต้องใช้เน็ต)
npm run build      # ได้โฟลเดอร์ dist/ พร้อม service worker (precache ครบ)
npm run build:single   # ได้ dist-single/index.html ไฟล์เดียวแบบเดิม
```
ต้องใช้ Node 18+  •  deploy: อัปโหลดเนื้อใน `dist/` (ตั้ง `base: './'` ไว้แล้ว วางใน subfolder / GitHub Pages ได้)

## โครงสร้าง
```
index.html              โครงหน้า (markup) + ลำดับการโหลดไฟล์ — ไม่มี script/style inline แล้ว
public/js/NN-*.js       โค้ดระบบ 31 ไฟล์ (โหลดตามเลขลำดับ — ห้ามสลับลำดับ)
public/sw.js            service worker (ตอน build จะเติมรายชื่อไฟล์ + เลขเวอร์ชันให้เอง)
src/styles/NN-*.css     สไตล์ 9 ไฟล์ (09-addons = คลาสเสริมของโมดูลใหม่ — CSS หลักเป็นแบบเขียนมือ ถ้าใช้คลาส Tailwind ใหม่ต้องเพิ่มกฎเองที่นี่) (Vite รวม/ย่อให้ตอน build)
sql/                    SQL ฐานข้อมูลรวมทุกแพตช์ (รันใน Supabase SQL Editor)
supabase/functions/notify   Edge Function แจ้งเตือน Telegram/LINE
tools/                  check.mjs (ตรวจโครงสร้าง) / inline.mjs (รวมเป็นไฟล์เดียว)
```

## ไฟล์ JS (ลำดับการโหลด)
| ไฟล์ | หน้าที่ |
|---|---|
| 00-debug-overlay | กล่องแสดง error (เปิดด้วย `?debug=1`) |
| 01-splash-timeout | ปิดหน้า splash อัตโนมัติ |
| 02-ui-hub | ศูนย์รวมปุ่มเครื่องมือ (`posHub.register`) |
| **03-core-app** | **แกนหลัก: ข้อมูล, ตะกร้า/ขาย, สต็อก, ซิงก์ Supabase, PIN, ใบเสร็จ** |
| 04-sql-compat-bridge | ตัวเชื่อมความเข้ากันได้กับสคีมา SQL |
| 05-enterprise-repair | ชั้นจัดการเสริม (ซ่อมแซม/ผู้จัดการ) |
| 06-shift-cash-drawer | เปิด-ปิดกะ ลิ้นชักเงิน |
| 07-product-export | ส่งออกสินค้า Excel/ZIP รูป |
| 08-data-health-check | ตรวจสุขภาพข้อมูล |
| 09-backup-restore | สำรอง/กู้คืน/รีเซ็ต |
| 10-sync-queue-pin | คิวซิงก์, seeding สต็อก/หนี้, PIN |
| 11-offline-readiness | แถบสถานะออฟไลน์ + ลงทะเบียน service worker |
| 12-activity-log | บันทึกกิจกรรม/ข้อผิดพลาด |
| 13-reports | รายงาน + ส่งออก CSV |
| 14-shelf-map, 15-location-picker | แผนผังชั้นวาง / เลือกที่เก็บ |
| 16-success-animation | แอนิเมชันขายสำเร็จ |
| 17-zone-stock-count | ตรวจนับสต็อกตามโซน |
| 18-users-permissions | ผู้ใช้และสิทธิ์ (PERMS) |
| 19-session-token | token เซสชันสำหรับตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ |
| 20-pvc-sizes, 21-internal-barcode | ขนาดมาตรฐาน PVC / บาร์โค้ดภายใน |
| 22-sound-voice-settings | เสียง/เสียงพูด |
| 23-multi-receive, 25-reorder-suggest, 26-pick-po | รับเข้าหลายรายการ / แนะนำสั่งซื้อ / เลือกใบสั่งซื้อ |
| 24-product-photo | รูปสินค้า |
| 27-keyboard-shortcuts | คีย์ลัด F2/F4/F8/Esc |
| 28-cut-pipe | ตัดท่อเป็นเมตร + เศษ (ต้องรัน SQL PATCH 015) |
| 29-printer-notify-stocktake | เครื่องพิมพ์ ESC/POS, แจ้งเตือน, ใบตรวจนับ (F9) |
| 30-health-fixer | ตัวช่วยแก้ปัญหาข้อมูล (ราคา 0, ขายต่ำกว่าทุน, ข้อมูลซ้ำ, ลบรูปอย่างปลอดภัย) — ย้อนกลับได้ |

## ข้อควรรู้ (อ่านก่อนแก้โครงสร้างต่อ)
- สคริปต์ทั้งหมดเป็น **classic script** ไม่ใช่ ES module โดยตั้งใจ: โค้ดเดิมใช้ตัวแปรระดับบนสุด (เช่น `const roundAmt` ใน 03-core-app) และ `window.*` ร่วมกัน ถ้าเปลี่ยนเป็น `type="module"` ทันทีระบบจะพัง การย้ายเป็น module ต้องทำทีละไฟล์: เริ่มจากไฟล์เล็กที่ไม่มีใครอ้างตัวแปรของมัน (เช่น 19, 21, 27) แล้วเปลี่ยนตัวแปรที่ใช้ร่วมกันให้เป็น `import/export`
- ไฟล์ใน `public/js` ไม่ถูกย่อ/รวมโดย Vite (ถูกคัดลอกไปตามเดิม) — ได้ประโยชน์ที่แก้เป็นไฟล์ๆ, cache แยกไฟล์, และ precache ในออฟไลน์
- `manifest.webmanifest` และไอคอน (`icon.svg`, `icon-192.png`, `icon-512.png`) อยู่ใน `public/` แล้ว (ไอคอนเริ่มต้น เปลี่ยนเป็นของร้านได้)
- `public/sw.js` เป็นเวอร์ชันเริ่มต้นที่เขียนใหม่ (เพราะไฟล์เดิมไม่ได้อยู่ในชุดที่ได้รับ) ถ้าคุณมี `sw.js` เดิมที่ปรับแต่งไว้ ให้ใช้ของเดิมแต่เพิ่มการ precache `./js/*` และ `./assets/*`
- เพิ่มไฟล์ JS/CSS ใหม่ = สร้างไฟล์ + เพิ่มแท็กใน `index.html` ตามลำดับที่ต้องการ แล้วรัน `npm run check`

## ฐานข้อมูล / Edge Function
- `sql/SMART-POS-FULL-v13_4.sql` รันทั้งไฟล์ได้ซ้ำ (patch 003–015: ตรวจสิทธิ์คืนสินค้ารายบุคคล, ตัดท่อ/เศษ)
- แจ้งเตือน: ดู `supabase/functions/notify/README.md`

## หมายเหตุการอัปเดตความปลอดภัย (v13.4.1)

- นำไฟล์ `sql/SMART-POS-FULL-v13_4.sql` ฉบับนี้ไปรันใน Supabase SQL Editor ก่อนเผยแพร่หน้าเว็บ
- `create_sale` ตรวจสิทธิ์ `SALE`, `DISCOUNT` และ `CREDIT_SALE` ที่ฐานข้อมูลอีกชั้น
- ผู้ทำรายการในบิลยึดจาก session ที่ผ่านการตรวจสอบ ไม่เชื่อ `p_user_id` ที่ส่งมาจาก browser
- ห้ามนำ `.env`, service_role key หรือรหัสผ่านขึ้น GitHub
- ทดสอบด้วยบัญชี OWNER และ CASHIER แยกกัน ทั้งกรณีขายปกติ ส่วนลด และขายเชื่อ
