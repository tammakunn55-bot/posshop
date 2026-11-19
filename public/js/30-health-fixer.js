/* ==========================================================================
   ตัวช่วยแก้ปัญหาข้อมูล (Health Fixer) — ต่อจาก "ตรวจสุขภาพข้อมูล"
   หลักการ: ไม่แก้อัตโนมัติ • อธิบายปัญหา + ให้เลือกวิธีแก้ • ติ๊กเลือกรายการเอง • ยืนยันพร้อมตัวอย่าง "ก่อน → หลัง"
            • บันทึกค่าเดิมของทุกการแก้ไว้ย้อนกลับได้ (ล่าสุด 15 ชุด) • เฉพาะเจ้าของร้าน
   กลุ่มที่รองรับ: ราคาขาย 0 บาท / ขายต่ำกว่าทุน-ตัวคูณผิด / ชื่อ-บาร์โค้ดซ้ำ / สต็อกไม่ตรงเซิร์ฟเวอร์ / รูปไม่มีเจ้าของ (ลบอย่างปลอดภัย)
   ========================================================================== */
(function () {
  'use strict';
  const D = () => window.db || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prods = () => Object.values(D().products || {}).filter(p => p && !p.isDeleted);
  const vlabel = (p, v) => p.name + (v.sizeName ? ' ' + v.sizeName : '');
  const suggest = (cost, marginPct, roundUp) => { const x = (+cost || 0) * (1 + (+marginPct || 0) / 100); return roundUp ? Math.ceil(x) : Math.round(x * 100) / 100; };

  // ---------------- ประวัติการแก้ + ย้อนกลับ ----------------
  const LOGK = 'pos_health_fix_log_v1';
  const loadLog = () => { try { return JSON.parse(localStorage.getItem(LOGK) || '[]'); } catch (e) { return []; } };
  const saveLog = (l) => { try { localStorage.setItem(LOGK, JSON.stringify(l.slice(-15))); } catch (e) { } };
  let batch = null;
  const begin = (label) => { batch = { id: Date.now(), label, ch: [] }; };
  // scope: 'p' สินค้า / 'v' ขนาด / 'f' หน่วยแบ่งขาย (อ้างด้วย index)
  function set(scope, ref, obj, key, val) {
    if (obj[key] === val) return false;
    batch.ch.push({ s: scope, p: ref.p, v: ref.v, fi: ref.fi, k: key, o: obj[key] === undefined ? null : obj[key], h: Object.prototype.hasOwnProperty.call(obj, key) });
    obj[key] = val; return true;
  }
  function commit() {
    if (!batch || !batch.ch.length) { batch = null; return 0; }
    const n = batch.ch.length, l = loadLog(); l.push(batch); saveLog(l); batch = null;
    window.persist?.(); window.syncProductsToSupabase?.(true); return n;
  }
  function resolve(c) {
    const p = D().products && D().products[c.p]; if (!p) return null;
    if (c.s === 'p') return p;
    const v = (p.variants || []).find(x => x.id === c.v); if (!v) return null;
    if (c.s === 'v') return v;
    return (v.fractions || [])[c.fi] || null;
  }
  function undoLast() {
    const l = loadLog(), b = l.pop(); if (!b) return 0; let n = 0;
    for (let i = b.ch.length - 1; i >= 0; i--) { const c = b.ch[i], o = resolve(c); if (!o) continue; if (c.h) o[c.k] = c.o; else delete o[c.k]; n++; }
    saveLog(l); window.persist?.(); window.syncProductsToSupabase?.(true); return n;
  }

  // ---------------- สแกนปัญหา ----------------
  function scanZero() {
    const rows = [];
    prods().forEach(p => (p.variants || []).forEach(v => { if (!(+v.price > 0)) rows.push({ p, v, label: vlabel(p, v), cost: +v.cost || 0 }); }));
    return rows;
  }
  function scanBelow() {
    const rows = [];
    prods().forEach(p => (p.variants || []).forEach(v => {
      const cost = +v.cost || 0;
      if (cost > 0 && +v.price > 0 && +v.price < cost) rows.push({ kind: 'v', p, v, label: vlabel(p, v), cost, price: +v.price });
      (v.fractions || []).forEach((f, fi) => {
        const m = +f.fractionMultiplier;
        if (!(m > 0)) rows.push({ kind: 'm', p, v, f, fi, label: vlabel(p, v) + ' › ' + (f.fractionName || 'หน่วยย่อย'), cost: 0, price: +f.fractionPrice || 0, mult: m });
        else if (cost > 0 && +f.fractionPrice > 0 && +f.fractionPrice < cost * m) rows.push({ kind: 'f', p, v, f, fi, label: vlabel(p, v) + ' › ' + (f.fractionName || 'หน่วยย่อย'), cost: cost * m, price: +f.fractionPrice });
      });
    }));
    return rows;
  }
  function scanDups() {
    const nm = new Map(), bc = new Map();
    prods().forEach(p => {
      const stock = (p.variants || []).reduce((a, v) => a + (+v.stock || 0), 0);
      (p.variants || []).forEach(v => {
        const key = String(p.name || '').trim().toLowerCase() + '|' + String(v.sizeName || '').trim().toLowerCase();
        if (!nm.has(key)) nm.set(key, new Map());
        if (!nm.get(key).has(p.id)) nm.get(key).set(p.id, { p, stock, price: +v.price || 0, size: v.sizeName || '' });
        const b = String(v.barcode || '').trim();
        if (b) { if (!bc.has(b)) bc.set(b, []); bc.get(b).push({ p, v, label: vlabel(p, v) }); }
      });
    });
    return {
      names: [...nm.entries()].filter(([, m]) => m.size > 1).map(([key, m]) => ({ key, items: [...m.values()] })),
      codes: [...bc.entries()].filter(([, a]) => new Set(a.map(x => x.v.id)).size > 1).map(([code, items]) => ({ code, items }))
    };
  }

  // ---------------- กรอบหน้าต่าง ----------------
  function frame() {
    let el = document.getElementById('hf-dlg');
    if (!el) {
      el = document.createElement('div'); el.id = 'hf-dlg'; el.className = 'hf-ov';
      el.innerHTML = '<div class="hf-card"><div class="hf-head"><div id="hf-title" class="hf-title"></div><button id="hf-x" class="hf-x" aria-label="ปิด">✕</button></div><div id="hf-body" class="hf-body"></div></div>';
      document.body.appendChild(el);
      el.querySelector('#hf-x').onclick = () => { el.remove(); window.runDataHealthCheck?.(); };
    }
    return el;
  }
  function screen(title, html, bind) {
    const el = frame(); el.querySelector('#hf-title').textContent = title;
    const b = el.querySelector('#hf-body'); b.innerHTML = html; b.scrollTop = 0;
    b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => SCREENS[x.dataset.go]());
    if (bind) bind(b);
  }
  const backBtn = '<button class="hf-btn" data-go="menu">← กลับเมนู</button>';
  const allBox = (b, sel) => { const boxes = [...b.querySelectorAll(sel)]; const on = boxes.some(x => !x.checked); boxes.forEach(x => x.checked = on); };
  const summary = (lines, total) => lines.slice(0, 6).join('\n') + (total > 6 ? `\n… และอีก ${total - 6} รายการ` : '');

  // ---------------- เมนู ----------------
  function menu() {
    const z = scanZero().length, bl = scanBelow().length, d = scanDups(), dn = d.names.length + d.codes.length, last = loadLog().slice(-1)[0];
    const item = (go, icon, t, desc, n) => `<button class="hf-menu" data-go="${go}"><span>${icon} ${t}<small>${desc}</small></span>${(go === 'orphan' || go === 'stock') ? '<span class="hf-badge">ตรวจเมื่อเปิด</span>' : `<span class="hf-badge ${n ? '' : 'ok'}">${n ? n + ' รายการ' : '✓ ไม่พบ'}</span>`}</button>`;
    screen('🛠️ ตัวช่วยแก้ปัญหาข้อมูล',
      `<p style="margin-bottom:10px">เลือกกลุ่มปัญหา ระบบจะอธิบาย ให้เลือกวิธีแก้ และแสดงตัวอย่างก่อนบันทึกทุกครั้ง ไม่แก้อะไรให้เองโดยไม่ถาม</p>
       ${item('zero', '💰', 'ราคาขายเป็น 0 บาท', 'ขายออกไปจะได้เงิน 0 บาท', z)}
       ${item('below', '📉', 'ขายต่ำกว่าทุน / ตัวคูณหน่วยแบ่งขายผิด', 'ขาดทุนทุกครั้งที่ขาย หรือหักสต็อกผิด', bl)}
       ${item('dups', '🧬', 'ชื่อ/ขนาดซ้ำ และบาร์โค้ดซ้ำ', 'ค้นหาสับสน สแกนบาร์โค้ดแล้วได้สินค้าผิดตัว', dn)}
       ${item('stock', '📦', 'สต็อกเครื่องนี้ไม่ตรงกับเซิร์ฟเวอร์', 'เกิดเมื่อใช้หลายเครื่อง/ออฟไลน์นาน (ต้องซิงก์ให้ครบก่อนตรวจ)', 0)}
       ${item('orphan', '🖼️', 'รูปบนเซิร์ฟเวอร์ที่ไม่มีเจ้าของ', 'ลบเพื่อประหยัดพื้นที่ (เทียบกับข้อมูลบนเซิร์ฟเวอร์ก่อน)', 0)}
       ${last ? `<div class="hf-group" style="margin-top:12px"><b>↩️ ย้อนกลับการแก้ล่าสุด</b><div class="sub" style="color:#64748b">${esc(last.label)} • ${last.ch.length} จุด • ${new Date(last.id).toLocaleString('th-TH')}</div><div class="hf-bar"><button class="hf-btn" id="hf-undo">ย้อนกลับชุดนี้</button></div></div>` : ''}`,
      (b) => {
        const u = b.querySelector('#hf-undo');
        if (u) u.onclick = () => { if (!confirm(`ย้อนกลับ "${last.label}" (${last.ch.length} จุด) เป็นค่าเดิม?`)) return; const n = undoLast(); window.showToast?.(`ย้อนกลับแล้ว ${n} จุด`); menu(); };
      });
  }

  // ---------------- 1) ราคาขายเป็น 0 ----------------
  function zeroScreen() {
    const rows = scanZero();
    if (!rows.length) return screen('💰 ราคาขายเป็น 0 บาท', '<div class="hf-note ok">✅ ไม่พบสินค้าที่ราคาขายเป็น 0 บาท</div><div class="hf-bar">' + backBtn + '</div>');
    const shown = rows.slice(0, 300);
    screen('💰 ราคาขายเป็น 0 บาท (' + rows.length + ' รายการ)',
      `<div class="hf-note"><b>ปัญหา:</b> สินค้าเหล่านี้ขายได้แต่ราคา 0 บาท ถ้าขายไปจะไม่ได้เงิน<br><b>วิธีแก้ที่เลือกได้:</b> ① เติมราคาจากต้นทุน+กำไร% ② กรอกราคาเองทีละรายการ ③ ปิดการขายสินค้าที่ยังไม่มีราคา (เก็บข้อมูลไว้ เปิดกลับได้) ④ ข้ามไว้</div>
       <div class="hf-bar"><label>กำไร <input id="hf-m" class="hf-in" style="width:64px" type="number" value="25"> %</label><label><input id="hf-r" type="checkbox" checked> ปัดขึ้นเป็นบาทเต็ม</label>
       <button class="hf-btn" id="hf-fill">เติมราคาจากทุน+กำไร (เฉพาะที่ติ๊ก)</button><button class="hf-btn" id="hf-all">เลือก/ยกเลิกทั้งหมด</button></div>
       <div class="hf-list">${shown.map((r, i) => `<div class="hf-row"><input type="checkbox" class="hf-c" data-i="${i}" checked><div class="grow">${esc(r.label)}<div class="sub">${r.cost > 0 ? 'ทุน ฿' + fmt(r.cost) : 'ไม่มีราคาทุน (เติมอัตโนมัติไม่ได้)'}</div></div><input class="hf-in hf-p" data-i="${i}" type="number" inputmode="decimal" placeholder="ราคาขาย"></div>`).join('')}</div>
       ${rows.length > shown.length ? `<div class="sub" style="margin-top:6px">แสดง ${shown.length} รายการแรก แก้ชุดนี้แล้วเปิดใหม่เพื่อทำชุดถัดไป</div>` : ''}
       <div class="hf-bar">${backBtn}<button class="hf-btn" id="hf-dis">ปิดการขายสินค้าที่ไม่มีราคา</button><button class="hf-btn pri" id="hf-save">บันทึกราคาที่กรอก</button></div>`,
      (b) => {
        const chk = () => [...b.querySelectorAll('.hf-c')], inp = (i) => b.querySelector(`.hf-p[data-i="${i}"]`);
        b.querySelector('#hf-all').onclick = () => allBox(b, '.hf-c');
        b.querySelector('#hf-fill').onclick = () => {
          const m = +b.querySelector('#hf-m').value, up = b.querySelector('#hf-r').checked; let n = 0;
          chk().forEach(c => { const r = shown[+c.dataset.i]; if (c.checked && r.cost > 0) { inp(c.dataset.i).value = suggest(r.cost, m, up); n++; } });
          window.showToast?.(n ? `เติมราคาให้ ${n} รายการ — ตรวจแล้วกด "บันทึก"` : 'ไม่มีรายการที่ติ๊กและมีราคาทุน');
        };
        b.querySelector('#hf-save').onclick = () => {
          const todo = []; chk().forEach(c => { const r = shown[+c.dataset.i], val = +inp(c.dataset.i).value; if (c.checked && val > 0) todo.push({ r, val }); });
          if (!todo.length) return window.showAlert?.('ยังไม่มีราคาให้บันทึก', 'กรอกราคาในช่อง หรือกด "เติมราคาจากทุน+กำไร" ก่อน', true);
          if (!confirm(`ตั้งราคาขาย ${todo.length} รายการ?\n\n` + summary(todo.map(t => `• ${t.r.label}: ฿0 → ฿${fmt(t.val)}`), todo.length) + '\n\n(ย้อนกลับได้จากเมนูตัวช่วย)')) return;
          begin('ตั้งราคาขายที่เป็น 0'); todo.forEach(t => set('v', { p: t.r.p.id, v: t.r.v.id }, t.r.v, 'price', t.val));
          const n = commit(); window.showToast?.(`ตั้งราคาแล้ว ${n} รายการ`); zeroScreen();
        };
        b.querySelector('#hf-dis').onclick = () => {
          const pick = new Map(); chk().forEach(c => { if (c.checked) pick.set(shown[+c.dataset.i].p.id, shown[+c.dataset.i].p); });
          const targets = [...pick.values()].filter(p => !p.isDisabled && (p.variants || []).every(v => !(+v.price > 0)));
          if (!targets.length) return window.showAlert?.('ไม่มีสินค้าที่ปิดได้', 'ปิดได้เฉพาะสินค้าที่ "ทุกขนาด" ยังไม่มีราคา (สินค้าที่มีบางขนาดมีราคาแล้วจะไม่ถูกปิด)', true);
          if (!confirm(`ปิดการขาย ${targets.length} สินค้า (ซ่อนจากหน้าขาย เก็บข้อมูลและสต็อกไว้)?\n\n` + summary(targets.map(p => '• ' + p.name), targets.length) + '\n\nเปิดกลับได้โดยย้อนกลับจากเมนูตัวช่วย')) return;
          begin('ปิดการขายสินค้าที่ไม่มีราคา'); targets.forEach(p => set('p', { p: p.id }, p, 'isDisabled', true));
          const n = commit(); window.showToast?.(`ปิดการขาย ${n} สินค้า`); zeroScreen();
        };
      });
  }

  // ---------------- 2) ขายต่ำกว่าทุน / ตัวคูณผิด ----------------
  function belowScreen() {
    const rows = scanBelow();
    if (!rows.length) return screen('📉 ขายต่ำกว่าทุน', '<div class="hf-note ok">✅ ไม่พบรายการขายต่ำกว่าทุน หรือตัวคูณหน่วยแบ่งขายที่ผิด</div><div class="hf-bar">' + backBtn + '</div>');
    const shown = rows.slice(0, 300), kindTxt = { v: 'ราคาขาย', f: 'ราคาแบ่งขาย', m: 'ตัวคูณผิด' };
    screen('📉 ขายต่ำกว่าทุน / ตัวคูณผิด (' + rows.length + ' รายการ)',
      `<div class="hf-note"><b>ปัญหา:</b> ราคาขาย (หรือราคาหน่วยแบ่งขาย) ต่ำกว่าทุน ขายทีไรขาดทุนทีนั้น หรือตัวคูณหน่วยแบ่งขาย ≤ 0 ทำให้ตัดสต็อกผิด<br><b>ข้อควรระวัง:</b> บางรายการตั้งใจขายต่ำกว่าทุน (เช่น ล้างสต็อก) — ติ๊กเฉพาะรายการที่ต้องการแก้ รายการที่ตัวคูณผิดให้กรอกค่าตัวคูณใหม่ (หน่วยหลัก ต่อ 1 หน่วยนี้)</div>
       <div class="hf-bar"><label>กำไร <input id="hf-m" class="hf-in" style="width:64px" type="number" value="20"> %</label><label><input id="hf-r" type="checkbox" checked> ปัดขึ้นเป็นบาทเต็ม</label>
       <button class="hf-btn" id="hf-fill">เติมราคาแนะนำ (ทุน+กำไร) เฉพาะที่ติ๊ก</button><button class="hf-btn" id="hf-all">เลือก/ยกเลิกทั้งหมด</button></div>
       <div class="hf-list">${shown.map((r, i) => `<div class="hf-row"><input type="checkbox" class="hf-c" data-i="${i}"><div class="grow">${esc(r.label)}<div class="sub">${kindTxt[r.kind]}: ${r.kind === 'm' ? 'ตัวคูณปัจจุบัน ' + esc(r.mult) : '฿' + fmt(r.price) + ' • ทุน ฿' + fmt(r.cost)}</div></div><input class="hf-in hf-p" data-i="${i}" type="number" inputmode="decimal" placeholder="${r.kind === 'm' ? 'ตัวคูณใหม่' : 'ราคาใหม่'}"></div>`).join('')}</div>
       <div class="hf-bar">${backBtn}<button class="hf-btn pri" id="hf-save">บันทึกค่าที่กรอก</button></div>`,
      (b) => {
        const chk = () => [...b.querySelectorAll('.hf-c')], inp = (i) => b.querySelector(`.hf-p[data-i="${i}"]`);
        b.querySelector('#hf-all').onclick = () => allBox(b, '.hf-c');
        b.querySelector('#hf-fill').onclick = () => {
          const m = +b.querySelector('#hf-m').value, up = b.querySelector('#hf-r').checked; let n = 0;
          chk().forEach(c => { const r = shown[+c.dataset.i]; if (c.checked && r.kind !== 'm') { inp(c.dataset.i).value = suggest(r.cost, m, up); n++; } });
          window.showToast?.(n ? `เติมราคาแนะนำ ${n} รายการ — ตรวจแล้วกด "บันทึก"` : 'ไม่มีรายการราคาที่ติ๊กไว้');
        };
        b.querySelector('#hf-save').onclick = () => {
          const todo = []; chk().forEach(c => { const r = shown[+c.dataset.i], val = +inp(c.dataset.i).value; if (c.checked && val > 0) todo.push({ r, val }); });
          if (!todo.length) return window.showAlert?.('ยังไม่มีค่าให้บันทึก', 'ติ๊กรายการและกรอกค่าใหม่ในช่องก่อน', true);
          if (!confirm(`แก้ ${todo.length} รายการ?\n\n` + summary(todo.map(t => t.r.kind === 'm' ? `• ${t.r.label}: ตัวคูณ ${t.r.mult} → ${t.val}` : `• ${t.r.label}: ฿${fmt(t.r.price)} → ฿${fmt(t.val)}`), todo.length) + '\n\n(ย้อนกลับได้จากเมนูตัวช่วย)')) return;
          begin('แก้ราคาต่ำกว่าทุน/ตัวคูณ');
          todo.forEach(t => {
            const { r, val } = t;
            if (r.kind === 'v') set('v', { p: r.p.id, v: r.v.id }, r.v, 'price', val);
            else set('f', { p: r.p.id, v: r.v.id, fi: r.fi }, r.f, r.kind === 'm' ? 'fractionMultiplier' : 'fractionPrice', val);
          });
          const n = commit(); window.showToast?.(`แก้แล้ว ${n} จุด`); belowScreen();
        };
      });
  }

  // ---------------- 3) ซ้ำ ----------------
  function dupsScreen() {
    const d = scanDups();
    if (!d.names.length && !d.codes.length) return screen('🧬 ข้อมูลซ้ำ', '<div class="hf-note ok">✅ ไม่พบชื่อ/ขนาดซ้ำ หรือบาร์โค้ดซ้ำ</div><div class="hf-bar">' + backBtn + '</div>');
    const names = d.names.slice(0, 60), codes = d.codes.slice(0, 60);
    screen('🧬 ข้อมูลซ้ำ (' + (d.names.length + d.codes.length) + ' กลุ่ม)',
      `<div class="hf-note"><b>ชื่อ/ขนาดซ้ำ:</b> เลือกตัวที่เก็บไว้ แล้วเลือกวิธีกับตัวที่เหลือ — เปลี่ยนชื่อต่อท้าย (2),(3) หรือปิดการขาย (เก็บข้อมูลไว้) ระบบไม่รวม/ลบสินค้าให้เพราะต้องย้ายสต็อกและประวัติด้วย ถ้าเป็นของชิ้นเดียวกันจริง ให้ปิดตัวที่ซ้ำ แล้วปรับสต็อกตัวที่เก็บให้รวมกัน<br><b>บาร์โค้ดซ้ำ:</b> เลือกตัวที่เป็นเจ้าของบาร์โค้ด ส่วนตัวอื่นจะถูกล้างบาร์โค้ดออก</div>
       ${names.length ? '<h4 style="font-weight:900;margin:10px 0 4px">ชื่อและขนาดซ้ำ</h4>' : ''}
       ${names.map((g, gi) => `<div class="hf-group">${g.items.map((it, ii) => `<label class="hf-row"><input type="radio" name="hn${gi}" value="${ii}" ${ii === 0 ? 'checked' : ''}><div class="grow">${esc(it.p.name)} ${esc(it.size)}<div class="sub">สต็อก ${it.stock} • ราคา ฿${fmt(it.price)} ${it.p.isDisabled ? '• (ปิดการขายอยู่)' : ''}</div></div></label>`).join('')}
         <div class="hf-bar"><span>กับตัวที่ไม่ได้เก็บ:</span><select class="hf-sel" data-ng="${gi}"><option value="skip">ข้ามไว้ก่อน</option><option value="rename">เปลี่ยนชื่อต่อท้าย (2)</option><option value="disable">ปิดการขาย</option></select></div></div>`).join('')}
       ${codes.length ? '<h4 style="font-weight:900;margin:10px 0 4px">บาร์โค้ดซ้ำ</h4>' : ''}
       ${codes.map((g, gi) => `<div class="hf-group"><div class="sub">บาร์โค้ด ${esc(g.code)}</div>${g.items.map((it, ii) => `<label class="hf-row"><input type="radio" name="hb${gi}" value="${ii}" ${ii === 0 ? 'checked' : ''}><div class="grow">${esc(it.label)}</div></label>`).join('')}
         <div class="hf-bar"><span>กับตัวอื่น:</span><select class="hf-sel" data-bg="${gi}"><option value="skip">ข้ามไว้ก่อน</option><option value="clear">ล้างบาร์โค้ดออก</option></select></div></div>`).join('')}
       <div class="hf-bar">${backBtn}<button class="hf-btn pri" id="hf-save">ใช้วิธีที่เลือก</button></div>`,
      (b) => {
        b.querySelector('#hf-save').onclick = () => {
          const acts = [], touched = new Set();   // สินค้าที่มีหลายขนาดอาจอยู่ในหลายกลุ่ม — แก้ครั้งเดียวต่อสินค้า
          names.forEach((g, gi) => {
            const mode = b.querySelector(`[data-ng="${gi}"]`).value; if (mode === 'skip') return;
            const keep = +b.querySelector(`input[name="hn${gi}"]:checked`).value; let k = 2;
            g.items.forEach((it, ii) => { if (ii === keep || touched.has(it.p.id)) return; touched.add(it.p.id); acts.push({ t: mode, it, n: k++ }); });
          });
          const codeActs = [];
          codes.forEach((g, gi) => {
            if (b.querySelector(`[data-bg="${gi}"]`).value === 'skip') return;
            const keep = +b.querySelector(`input[name="hb${gi}"]:checked`).value;
            g.items.forEach((it, ii) => { if (ii !== keep) codeActs.push({ it, code: g.code }); });
          });
          if (!acts.length && !codeActs.length) return window.showAlert?.('ยังไม่ได้เลือกวิธีแก้', 'เปลี่ยนตัวเลือก "ข้ามไว้ก่อน" ของกลุ่มที่ต้องการแก้', true);
          const lines = acts.map(a => a.t === 'rename' ? `• เปลี่ยนชื่อ "${a.it.p.name}" → "${a.it.p.name} (${a.n})"` : `• ปิดการขาย "${a.it.p.name}"` + (a.it.stock > 0 ? ` (สต็อก ${a.it.stock} — ควรโอนสต็อกก่อน)` : ''))
            .concat(codeActs.map(a => `• ล้างบาร์โค้ด ${a.code} ของ "${a.it.label}"`));
          if (!confirm(`ดำเนินการ ${lines.length} รายการ?\n\n` + summary(lines, lines.length) + '\n\n(ย้อนกลับได้จากเมนูตัวช่วย)')) return;
          begin('แก้ข้อมูลซ้ำ');
          acts.forEach(a => { if (a.t === 'rename') set('p', { p: a.it.p.id }, a.it.p, 'name', a.it.p.name + ' (' + a.n + ')'); else set('p', { p: a.it.p.id }, a.it.p, 'isDisabled', true); });
          codeActs.forEach(a => set('v', { p: a.it.p.id, v: a.it.v.id }, a.it.v, 'barcode', ''));
          const n = commit(); window.showToast?.(`แก้แล้ว ${n} จุด`); dupsScreen();
        };
      });
  }

  // ---------------- 4) รูปไม่มีเจ้าของ (ลบอย่างปลอดภัย) ----------------
  const BUCKET = 'product-images';
  const nameOf = (u) => { const t = String(u || '').split('?')[0].split('/').pop(); try { return decodeURIComponent(t); } catch (e) { return t; } };
  async function listAll(client) {
    let files = [], offset = 0, guard = 0; const PAGE = 1000;
    while (guard++ < 50) {
      const { data, error } = await client.storage.from(BUCKET).list('', { limit: PAGE, offset }); if (error) throw error;
      files = files.concat(data || []); if (!data || data.length < PAGE) break; offset += PAGE;
    }
    return files.filter(f => f.id);
  }
  async function serverUsed(client) {
    const used = new Set();
    for (const t of ['products', 'product_variants']) {
      for (let a = 0, g = 0; g++ < 100; a += 1000) {
        const { data, error } = await client.from(t).select('image_url').not('image_url', 'is', null).range(a, a + 999);
        if (error) throw error; (data || []).forEach(r => r.image_url && used.add(nameOf(r.image_url))); if (!data || data.length < 1000) break;
      }
    }
    return used;
  }
  async function orphanScreen() {
    const client = window.getSupabaseClient?.();
    if (!client) return screen('🖼️ รูปที่ไม่มีเจ้าของ', '<div class="hf-note">ยังไม่ได้เชื่อมต่อ Supabase — เชื่อมต่อในตั้งค่าก่อน</div><div class="hf-bar">' + backBtn + '</div>');
    if (navigator.onLine === false) return screen('🖼️ รูปที่ไม่มีเจ้าของ', '<div class="hf-note">ต้องออนไลน์เพื่อตรวจรูปบนเซิร์ฟเวอร์</div><div class="hf-bar">' + backBtn + '</div>');
    screen('🖼️ รูปที่ไม่มีเจ้าของ', '<p style="padding:20px;text-align:center">🔄 กำลังเทียบรูปกับข้อมูลบนเซิร์ฟเวอร์ (อาจใช้เวลาหลายสิบวินาที)…</p>');
    let files, used;
    try {
      files = await listAll(client); used = await serverUsed(client);
      prods().forEach(p => { if (p.imageUrl) used.add(nameOf(p.imageUrl)); (p.variants || []).forEach(v => { if (v.imageUrl) used.add(nameOf(v.imageUrl)); }); });
    } catch (e) {
      return screen('🖼️ รูปที่ไม่มีเจ้าของ', `<div class="hf-note bad"><b>เทียบข้อมูลกับเซิร์ฟเวอร์ไม่ได้</b> จึงไม่เสนอให้ลบ (กันลบรูปที่ยังใช้อยู่)<br>${esc((e && e.message) || e)}</div><div class="hf-bar">${backBtn}</div>`);
    }
    const orphans = files.filter(f => !used.has(f.name)), ratio = files.length ? orphans.length / files.length : 0;
    const age = (f) => { const t = Date.parse(f.created_at || f.updated_at || ''); return t ? Math.floor((Date.now() - t) / 86400000) : 9999; };
    const suspicious = ratio > 0.3;
    screen('🖼️ รูปที่ไม่มีเจ้าของ',
      `<div class="hf-note ${suspicious ? 'bad' : 'ok'}">ไฟล์ทั้งหมด <b>${files.length}</b> • ใช้งานอยู่ <b>${files.length - orphans.length}</b> • ไม่มีเจ้าของ <b>${orphans.length}</b> (${Math.round(ratio * 100)}%)<br>เทียบทั้งกับข้อมูลในเครื่องและตารางสินค้า/ขนาดบนเซิร์ฟเวอร์แล้ว
       ${suspicious ? '<br><b>⚠️ สัดส่วนสูงผิดปกติ</b> อาจมีรูปที่ผูกกับสินค้าแบบอื่นที่ระบบมองไม่เห็น (เช่น ยังไม่ได้ซิงก์) <b>ห้ามลบเป็นชุดใหญ่</b> ตรวจตัวอย่างไฟล์ก่อน' : ''}</div>
       <div class="hf-note"><b>การลบกู้คืนไม่ได้</b> ระบบจึงไม่ติ๊กให้ล่วงหน้า ตั้งเงื่อนไข "เก่ากว่ากี่วัน" แล้วเลือกเอง และต้องพิมพ์ยืนยันก่อนลบ แนะนำให้ส่งออกรายชื่อ (CSV) เก็บไว้ก่อน</div>
       <div class="hf-bar"><label>เฉพาะไฟล์ที่เก่ากว่า <input id="hf-age" class="hf-in" style="width:64px" type="number" value="14"> วัน</label><button class="hf-btn" id="hf-apply">ตั้งตัวกรอง</button>
       <button class="hf-btn" id="hf-csv">ส่งออกรายชื่อ (CSV)</button><button class="hf-btn" id="hf-all">เลือก/ยกเลิกทั้งหมดที่แสดง</button></div>
       <div class="hf-list" id="hf-files"></div>
       ${suspicious ? '<label class="hf-bar"><input type="checkbox" id="hf-ok"> ฉันตรวจแล้วว่ารูปที่จะลบไม่ได้ใช้งาน</label>' : ''}
       <div class="hf-bar">${backBtn}<button class="hf-btn warn" id="hf-del">ลบที่เลือก</button></div>`,
      (b) => {
        let list = [];
        const draw = () => {
          const days = +b.querySelector('#hf-age').value || 0;
          list = orphans.filter(f => age(f) >= days).slice(0, 500);
          b.querySelector('#hf-files').innerHTML = list.length ? list.map((f, i) => `<label class="hf-row"><input type="checkbox" class="hf-c" data-i="${i}"><div class="grow">${esc(f.name)}<div class="sub">${f.metadata && f.metadata.size ? Math.round(f.metadata.size / 1024) + ' KB • ' : ''}${age(f) === 9999 ? 'ไม่ทราบอายุ' : age(f) + ' วันที่แล้ว'}</div></div></label>`).join('') : '<p style="padding:14px;text-align:center;color:#64748b">ไม่มีไฟล์ตามเงื่อนไข</p>';
        };
        draw();
        b.querySelector('#hf-apply').onclick = draw;
        b.querySelector('#hf-all').onclick = () => allBox(b, '.hf-c');
        b.querySelector('#hf-csv').onclick = () => {
          const rows = ['name,size_kb,age_days'].concat(orphans.map(f => `"${String(f.name).replace(/"/g, '""')}",${f.metadata && f.metadata.size ? Math.round(f.metadata.size / 1024) : ''},${age(f) === 9999 ? '' : age(f)}`));
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'orphan-images-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
        };
        b.querySelector('#hf-del').onclick = async () => {
          const names = [...b.querySelectorAll('.hf-c')].filter(c => c.checked).map(c => list[+c.dataset.i].name);
          if (!names.length) return window.showAlert?.('ยังไม่ได้เลือกไฟล์', 'ติ๊กไฟล์ที่ต้องการลบก่อน', true);
          const ok = b.querySelector('#hf-ok'); if (ok && !ok.checked) return window.showAlert?.('ต้องยืนยันก่อน', 'ติ๊กช่อง "ฉันตรวจแล้วว่ารูปที่จะลบไม่ได้ใช้งาน"', true);
          if (!confirm(`จะลบรูป ${names.length} ไฟล์ถาวร กู้คืนไม่ได้\n\nตัวอย่าง:\n` + names.slice(0, 5).join('\n'))) return;
          const typed = prompt(`พิมพ์คำว่า ลบ เพื่อยืนยันการลบ ${names.length} ไฟล์`); if (typed !== 'ลบ') return window.showToast?.('ยกเลิกการลบ');
          let done = 0;
          try { for (let i = 0; i < names.length; i += 50) { const part = names.slice(i, i + 50); const { error } = await client.storage.from(BUCKET).remove(part); if (error) throw error; done += part.length; } }
          catch (e) { window.showAlert?.('ลบไม่สำเร็จบางส่วน', `ลบไปแล้ว ${done} ไฟล์ — ${(e && e.message) || e}`, true); }
          window.showToast?.(`ลบรูปแล้ว ${done} ไฟล์`); orphanScreen();
        };
      });
  }


  // ---------------- 5) สต็อกเครื่องนี้ไม่ตรงกับเซิร์ฟเวอร์ ----------------
  async function stockScreen() {
    const client = window.getSupabaseClient?.(), T = '📦 สต็อกไม่ตรงกับเซิร์ฟเวอร์';
    if (!client || navigator.onLine === false) return screen(T, '<div class="hf-note">ต้องเชื่อมต่อ Supabase และออนไลน์เพื่อเทียบสต็อก</div><div class="hf-bar">' + backBtn + '</div>');
    const pend = (D().syncQueue || []).filter(o => o.status !== 'done');
    if (pend.length) {
      return screen(T, `<div class="hf-note bad"><b>ยังมีรายการรอซิงก์ ${pend.length} รายการ</b> (ขาย/คืน/ปรับสต็อกที่ยังไม่ขึ้นเซิร์ฟเวอร์) ช่วงนี้สต็อกในเครื่องกับเซิร์ฟเวอร์ต่างกันเป็นเรื่องปกติ จึงยังไม่ตรวจ — ซิงก์ให้ครบก่อน แล้วค่อยกลับมาตรวจ<br>ถ้ารายการค้างเป็นสถานะ failed/needs_review ให้ไปจัดการที่หน้าตรวจสุขภาพข้อมูลก่อน</div><div class="hf-bar">${backBtn}<button class="hf-btn pri" id="hf-sync">ซิงก์ตอนนี้แล้วตรวจใหม่</button></div>`,
        (b) => { b.querySelector('#hf-sync').onclick = async () => { try { await window.flushSyncQueue?.(); } catch (e) { } stockScreen(); }; });
    }
    screen(T, '<p style="padding:20px;text-align:center">🔄 กำลังดึงสต็อกจากเซิร์ฟเวอร์…</p>');
    const server = new Map();
    try {
      for (let a = 0, g = 0; g++ < 100; a += 1000) {
        const { data, error } = await client.from('product_variants').select('id,stock_quantity').eq('is_active', true).order('id').range(a, a + 999);
        if (error) throw error; (data || []).forEach(r => server.set(r.id, +r.stock_quantity || 0)); if (!data || data.length < 1000) break;
      }
    } catch (e) { return screen(T, `<div class="hf-note bad">ดึงข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ<br>${esc((e && e.message) || e)}</div><div class="hf-bar">${backBtn}</div>`); }
    const rows = []; let notOnServer = 0, checked = 0;
    prods().forEach(p => (p.variants || []).forEach(v => {
      const sv = server.get(window.toUUID ? window.toUUID(v.id) : v.id);
      if (sv === undefined) { notOnServer++; return; }
      checked++; const loc = +v.stock || 0;
      if (Math.abs(loc - sv) > 0.0005) rows.push({ p, v, label: vlabel(p, v), local: loc, server: sv, diff: loc - sv });
    }));
    rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    const shown = rows.slice(0, 300), r4 = (n) => Math.round(n * 10000) / 10000;
    if (!rows.length) return screen(T, `<div class="hf-note ok">✅ ตรวจ ${checked} ขนาด สต็อกตรงกับเซิร์ฟเวอร์ทั้งหมด${notOnServer ? `<br>มี ${notOnServer} ขนาดที่ยังไม่มีบนเซิร์ฟเวอร์ (รอซิงก์สินค้า)` : ''}</div><div class="hf-bar">${backBtn}</div>`);
    screen(T + ' (' + rows.length + ' รายการ)',
      `<div class="hf-note"><b>ปัญหา:</b> ตรวจ ${checked} ขนาด พบ ${rows.length} ขนาดที่ตัวเลขในเครื่องนี้ต่างจากเซิร์ฟเวอร์ ทั้งที่ไม่มีรายการค้างซิงก์${notOnServer ? ` (อีก ${notOnServer} ขนาดยังไม่มีบนเซิร์ฟเวอร์)` : ''}<br><b>ค่าบนเซิร์ฟเวอร์คือค่ากลางที่ทุกเครื่องใช้ร่วมกัน</b> วิธีแก้ที่ทำได้ที่นี่คือปรับเครื่องนี้ให้ตรงเซิร์ฟเวอร์ (ย้อนกลับได้)<br><b>ถ้าเครื่องนี้ถูกต้องกว่า</b> (เช่น เพิ่งนับสต็อกจริง) อย่ากดปรับ ให้ใช้เมนูปรับสต็อกเพื่อแก้ค่าบนเซิร์ฟเวอร์ แล้วซิงก์ทุกเครื่อง</div>
       <div class="hf-bar"><button class="hf-btn" id="hf-all">เลือก/ยกเลิกทั้งหมด</button><button class="hf-btn" id="hf-csv">ส่งออก CSV</button></div>
       <div class="hf-list">${shown.map((r, i) => `<label class="hf-row"><input type="checkbox" class="hf-c" data-i="${i}"><div class="grow">${esc(r.label)}<div class="sub">เครื่องนี้ ${r4(r.local)} • เซิร์ฟเวอร์ ${r4(r.server)} • ต่าง ${r.diff > 0 ? '+' : ''}${r4(r.diff)}</div></div></label>`).join('')}</div>
       ${rows.length > shown.length ? `<div class="sub" style="margin-top:6px">แสดง 300 รายการที่ต่างมากที่สุด</div>` : ''}
       <div class="hf-bar">${backBtn}<button class="hf-btn pri" id="hf-save">ปรับเครื่องนี้ให้ตรงเซิร์ฟเวอร์ (ที่ติ๊ก)</button></div>`,
      (b) => {
        b.querySelector('#hf-all').onclick = () => allBox(b, '.hf-c');
        b.querySelector('#hf-csv').onclick = () => {
          const out = ['สินค้า,เครื่องนี้,เซิร์ฟเวอร์,ผลต่าง'].concat(rows.map(r => `"${r.label.replace(/"/g, '""')}",${r4(r.local)},${r4(r.server)},${r4(r.diff)}`));
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + out.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'stock-mismatch-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
        };
        b.querySelector('#hf-save').onclick = () => {
          const todo = [...b.querySelectorAll('.hf-c')].filter(c => c.checked).map(c => shown[+c.dataset.i]);
          if (!todo.length) return window.showAlert?.('ยังไม่ได้เลือก', 'ติ๊กรายการที่ต้องการปรับก่อน', true);
          if (!confirm(`ปรับสต็อกในเครื่องนี้ ${todo.length} รายการให้ตรงเซิร์ฟเวอร์?\n\n` + summary(todo.map(r => `• ${r.label}: ${r4(r.local)} → ${r4(r.server)}`), todo.length) + '\n\n(ไม่แก้ค่าบนเซิร์ฟเวอร์ • ย้อนกลับได้จากเมนูตัวช่วย)')) return;
          begin('ปรับสต็อกเครื่องนี้ให้ตรงเซิร์ฟเวอร์'); todo.forEach(r => set('v', { p: r.p.id, v: r.v.id }, r.v, 'stock', r.server));
          const n = commit(); window.showToast?.(`ปรับแล้ว ${n} รายการ`); stockScreen();
        };
      });
  }

  const SCREENS = { menu, zero: zeroScreen, below: belowScreen, dups: dupsScreen, stock: stockScreen, orphan: orphanScreen };
  window.openHealthFixer = function (name) {
    if (!window.canDo?.('ALL')) return window.showAlert?.('ไม่มีสิทธิ์', 'เฉพาะเจ้าของร้านเท่านั้นที่แก้ข้อมูลจากตัวช่วยนี้ได้', true);
    (SCREENS[name] || menu)();
  };

  // ปุ่ม "ลบทั้งหมด" เดิมลบโดยไม่เทียบข้อมูลบนเซิร์ฟเวอร์ → เปลี่ยนเป็นพาไปหน้าลบอย่างปลอดภัย
  window.deleteAllOrphanImages = function () { window.showToast?.('ใช้ตัวช่วยแก้ปัญหา → รูปที่ไม่มีเจ้าของ เพื่อลบอย่างปลอดภัย'); window.openHealthFixer('orphan'); };

  // วางปุ่มเปิดตัวช่วยไว้บนสุดของผลตรวจ
  const origRun = window.runDataHealthCheck;
  if (typeof origRun === 'function') {
    window.runDataHealthCheck = async function () {
      const r = await origRun.apply(this, arguments);
      try {
        const el = document.getElementById('health-check-results');
        if (el && !el.querySelector('#hf-launch')) {
          const d = scanDups(), n = scanZero().length + scanBelow().length + d.names.length + d.codes.length;
          el.insertAdjacentHTML('afterbegin', `<div class="hf-launch" id="hf-launch"><span>🛠️ ตัวช่วยแก้ปัญหา${n ? ` — พบที่แก้ได้ ${n} จุด` : ''}<br><span style="font-weight:400;color:#64748b">เลือกวิธีแก้เอง พร้อมตัวอย่างก่อนบันทึกและย้อนกลับได้</span></span><button class="hf-btn pri" onclick="window.openHealthFixer()">เปิดตัวช่วย</button></div>`);
        }
      } catch (e) { console.warn('health fixer launcher', e); }
      return r;
    };
  }

  // ---------------- ตรวจวิกฤตอัตโนมัติวันละครั้ง (ตอนเปิดกะ / เปิดแอป) ----------------
  // ตรวจเฉพาะสิ่งที่กระทบเงิน/สต็อกจริง: สต็อกติดลบ, คิวซิงก์ล้มเหลว/ค้างนาน — ถ้าพบจะเตือนในแอป และแจ้ง Telegram/LINE (ถ้าเปิดไว้) วันละครั้ง
  const DAILYK = 'pos_health_daily_v1', STUCK_MS = 6 * 3600 * 1000;
  function criticalScan() {
    const neg = [], q = (D().syncQueue || []);
    prods().forEach(p => (p.variants || []).forEach(v => { if ((+v.stock || 0) < 0) neg.push(vlabel(p, v) + ' (' + (+v.stock) + ')'); }));
    const stuck = q.filter(o => o.status === 'failed' || o.status === 'needs_review').length;
    const old = q.filter(o => !['done', 'failed', 'needs_review'].includes(o.status) && o.createdAt && Date.now() - o.createdAt > STUCK_MS).length;
    return { neg, negCount: neg.length, stuck, old, zero: scanZero().length, below: scanBelow().length };
  }
  async function dailyCheck(force) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      let st = {}; try { st = JSON.parse(localStorage.getItem(DAILYK) || '{}'); } catch (e) { }
      if (!force && st.date === today) return;
      const r = criticalScan(), critical = r.negCount > 0 || r.stuck > 0 || r.old > 0;
      localStorage.setItem(DAILYK, JSON.stringify({ date: today, critical }));
      if (!critical) return;
      if (window.canDo?.('ALL')) window.showToast?.(`⚠️ ตรวจสุขภาพข้อมูล: สต็อกติดลบ ${r.negCount} • ซิงก์ล้มเหลว ${r.stuck} • ค้างนาน ${r.old} — เปิดตัวช่วยแก้ปัญหา`);
      let nc = {}; try { nc = JSON.parse(localStorage.getItem('pos_notify_cfg_v1') || '{}'); } catch (e) { }
      if (nc.enabled && window.sendNotify && navigator.onLine !== false) await window.sendNotify('HEALTH_ALERT', { neg: r.neg.slice(0, 15), negCount: r.negCount, stuck: r.stuck, old: r.old, zero: r.zero, below: r.below });
    } catch (e) { console.warn('daily health check', e); }
  }
  setTimeout(() => dailyCheck(false), 60000);
  const origOpenShift = window.confirmOpenShift;
  if (typeof origOpenShift === 'function') window.confirmOpenShift = function () { const r = origOpenShift.apply(this, arguments); setTimeout(() => dailyCheck(false), 2500); return r; };
  window._hf = { scanZero, scanBelow, scanDups, begin, set, commit, undoLast, suggest, criticalScan, dailyCheck };   // สำหรับทดสอบ
})();
