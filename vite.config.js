import { defineConfig } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// หลัง build: ใส่รายชื่อไฟล์ทั้งหมด + เลขเวอร์ชันลง dist/sw.js เพื่อให้แอปทำงานออฟไลน์ได้ครบ
// (สคริปต์ถูกแยกเป็นไฟล์ จึงต้อง precache ด้วย ไม่งั้นเปิดแอปตอนไม่มีเน็ตครั้งแรกหลังอัปเดตจะโหลดไม่ขึ้น)
function swPrecache() {
  let outDir;
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const files = walk(outDir).map((p) => relative(outDir, p).split('\\').join('/')).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      const cdn = [...html.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)].map((m) => m[1]);
      const list = [...new Set(['./', ...files.map((f) => './' + f), ...cdn])];
      const h = createHash('sha1');
      for (const f of files) h.update(readFileSync(join(outDir, f)));
      const sw = readFileSync(swPath, 'utf8')
        .replace("'__BUILD_ID__'", JSON.stringify(h.digest('hex').slice(0, 10)))
        .replace(/\/\*PRECACHE_START\*\/\[\]\/\*PRECACHE_END\*\//, JSON.stringify(list));
      writeFileSync(swPath, sw);
      console.log(`[sw-precache] ${list.length} รายการ`);
    },
  };
}

export default defineConfig({
  base: './',                       // วางใน subfolder / GitHub Pages ได้
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [swPrecache()],
});
