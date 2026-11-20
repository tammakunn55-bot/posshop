// รวม index.html + public/js/* + src/styles/* กลับเป็นไฟล์เดียว (dist-single/index.html)
// ใช้เมื่ออยากแจกจ่ายแบบไฟล์เดียวเหมือนเดิม:  npm run build:single
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'dist-single/index.html');
let html = readFileSync(resolve(root, 'index.html'), 'utf8');
const read = (rel, base) => readFileSync(resolve(root, base, rel), 'utf8');

html = html.replace(/<script([^>]*?) src="(js\/[^"]+)"><\/script>/g, (_, attrs, p) => `<script${attrs}>${read(p, 'public')}</script>`);
html = html.replace(/<link rel="stylesheet"([^>]*?) href="(src\/styles\/[^"]+)">/g, (_, attrs, p) => `<style${attrs}>${read(p, '.')}</style>`);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log('เขียน', outFile, (html.length / 1024).toFixed(0) + ' KB');
