// ตรวจโครงสร้างโปรเจกต์ (รันออฟไลน์ได้): ไวยากรณ์ JS ทุกไฟล์ + ไฟล์ที่ index.html อ้างถึงมีอยู่จริง + ไม่มีไฟล์ตกหล่น
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
let errors = 0;
const fail = (m) => { errors++; console.error('✗', m); };

const jsRefs = [...html.matchAll(/<script[^>]*? src="(js\/[^"]+)"/g)].map((m) => m[1]);
const cssRefs = [...html.matchAll(/<link rel="stylesheet"[^>]*? href="(src\/styles\/[^"]+)"/g)].map((m) => m[1]);

for (const p of jsRefs) {
  const f = resolve(root, 'public', p);
  if (!existsSync(f)) { fail('ไม่พบไฟล์ ' + p); continue; }
  try { new vm.Script(readFileSync(f, 'utf8'), { filename: p }); } catch (e) { fail(`${p}: ${e.message}`); }
}
for (const p of cssRefs) if (!existsSync(resolve(root, p))) fail('ไม่พบไฟล์ ' + p);

for (const [dir, refs] of [['public/js', jsRefs.map((p) => p.replace(/^js\//, ''))], ['src/styles', cssRefs.map((p) => p.replace(/^src\/styles\//, ''))]]) {
  for (const f of readdirSync(resolve(root, dir))) if (!refs.includes(f)) fail(`${dir}/${f} ไม่ได้ถูกอ้างใน index.html (ไฟล์ตกหล่น?)`);
}
if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) fail('index.html ยังมี <script> แบบ inline — ให้ย้ายไปไว้ใน public/js/');
if (/<style[^>]*>\s*\S/.test(html)) fail('index.html ยังมี <style> แบบ inline — ให้ย้ายไปไว้ใน src/styles/');

console.log(errors ? `พบปัญหา ${errors} จุด` : `ผ่าน: JS ${jsRefs.length} ไฟล์, CSS ${cssRefs.length} ไฟล์`);
process.exit(errors ? 1 : 0);
