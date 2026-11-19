
// ======================================================================
// เครื่องพิมพ์ใบเสร็จ ESC/POS (Web Serial / Bluetooth LE) • แจ้งเตือน Telegram/LINE (ผ่าน Edge Function "notify")
// • ใบตรวจนับสต็อก — โมดูลเสริมแยกส่วน ไม่แตะตรรกะขาย/สต็อกเดิม  (เปิดหน้าตั้งค่าด้วยปุ่มในหน้าใบเสร็จ หรือกด F9)
// ======================================================================
(function () {
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const loadCfg = (k, d) => { try { return Object.assign({}, d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return Object.assign({}, d); } };
  const saveCfg = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const PCFG = 'pos_escpos_cfg_v1', NCFG = 'pos_notify_cfg_v1';
  const pcfg = () => loadCfg(PCFG, { type: 'serial', width: 58, codepage: 20, baud: 9600, cut: true, drawer: false, auto: false });
  const ncfg = () => loadCfg(NCFG, { enabled: false, lowStock: true });

  // ---------- ESC/POS ----------
  const ZERO_W = (c) => c === 0x0E31 || (c >= 0x0E34 && c <= 0x0E3A) || (c >= 0x0E47 && c <= 0x0E4E);   // สระบน/ล่าง วรรณยุกต์ ไม่กินความกว้าง
  const vw = (s) => { let n = 0; for (const ch of s) if (!ZERO_W(ch.codePointAt(0))) n++; return n; };
  function enc(str) {   // Unicode → TIS-620 (ภาษาไทย) / ASCII; อักขระอื่นเป็น ?
    const out = [];
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      if (c < 128) out.push(c);
      else if (c >= 0x0E01 && c <= 0x0E3A) out.push(c - 0x0E01 + 0xA1);
      else if (c >= 0x0E3F && c <= 0x0E5B) out.push(c - 0x0E3F + 0xDF);
      else out.push(63);
    }
    return out;
  }
  function wrap(text, w) {
    const rows = []; let cur = '', cw = 0;
    for (const ch of String(text)) {
      const z = ZERO_W(ch.codePointAt(0));
      if (!z && cw >= w) { rows.push(cur); cur = ''; cw = 0; }
      cur += ch; if (!z) cw++;
    }
    if (cur) rows.push(cur); return rows.length ? rows : [''];
  }
  const padR = (s, w) => s + ' '.repeat(Math.max(0, w - vw(s)));
  const padL = (s, w) => ' '.repeat(Math.max(0, w - vw(s))) + s;
  const lr = (l, r, w) => { const gap = w - vw(l) - vw(r); return gap >= 1 ? l + ' '.repeat(gap) + r : l + '\n' + padL(r, w); };

  function buildReceipt(bill, cfg) {
    const W = cfg.width === 80 ? 48 : 32, db = window.db || {};
    const B = []; const push = (...a) => a.forEach(x => Array.isArray(x) ? B.push(...x) : B.push(x));
    const text = (s) => push(enc(s), 0x0A);
    const align = (n) => push(0x1B, 0x61, n), bold = (on) => push(0x1B, 0x45, on ? 1 : 0), size = (n) => push(0x1D, 0x21, n);
    const sep = () => text('-'.repeat(W));
    push(0x1B, 0x40, 0x1B, 0x74, cfg.codepage & 255);   // init + เลือก code page ไทย
    align(1); bold(true); size(0x11); wrap(db.storeName || 'ร้านค้า', Math.floor(W / 2)).forEach(text); size(0); bold(false);
    if (db.storeAddress) wrap(db.storeAddress, W).forEach(text);
    if (bill.taxMode === 'INCLUDED') { bold(true); text('ใบกำกับภาษีอย่างย่อ'); bold(false); text('เลขประจำตัวผู้เสียภาษี ' + (db.taxId || '-')); }
    align(0); sep();
    const cust = bill.customerId !== 'GENERAL' && db.customers && db.customers[bill.customerId] ? db.customers[bill.customerId].name : 'ลูกค้าทั่วไป';
    text('เลขที่: ' + bill.id); text('วันที่: ' + new Date(bill.time).toLocaleString('th-TH')); text('ลูกค้า: ' + cust); text('ชำระโดย: ' + (bill.method || '-')); sep();
    (bill.items || []).forEach(i => {
      wrap(i.name, W).forEach(text);
      text(lr('  ' + i.qty + ' x ' + money(i.price), money(i.qty * i.price), W));
    });
    sep();
    if (+bill.discount > 0) text(lr('ส่วนลด', '-' + money(bill.discount), W));
    if (bill.taxMode === 'INCLUDED' && bill.vatBase != null) { text(lr('มูลค่าก่อนภาษี', money(bill.vatBase), W)); text(lr('ภาษีมูลค่าเพิ่ม', money(bill.total - bill.vatBase), W)); }
    bold(true); size(0x01); text(lr('ยอดสุทธิ', money(bill.total), Math.floor(W / 1))); size(0); bold(false);
    align(1); push(0x0A); text('ขอบคุณที่ใช้บริการ'); push(0x0A, 0x0A, 0x0A);
    if (cfg.cut) push(0x1D, 0x56, 66, 3);
    if (cfg.drawer) push(0x1B, 0x70, 0, 25, 250);
    return new Uint8Array(B);
  }

  // ---------- การเชื่อมต่อ ----------
  const T = { type: null, port: null, writer: null, char: null, name: '' };
  const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
  async function connect() {
    const cfg = pcfg();
    if (cfg.type === 'ble') {
      if (!navigator.bluetooth) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Bluetooth (ใช้ Chrome/Edge บน Android หรือคอมพิวเตอร์)');
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      const server = await dev.gatt.connect(); let ch = null;
      for (const sv of await server.getPrimaryServices()) { for (const c of await sv.getCharacteristics()) { if (c.properties.write || c.properties.writeWithoutResponse) { ch = c; break; } } if (ch) break; }
      if (!ch) throw new Error('ไม่พบช่องเขียนข้อมูลของเครื่องพิมพ์ Bluetooth');
      Object.assign(T, { type: 'ble', char: ch, name: dev.name || 'Bluetooth' }); return;
    }
    if (!navigator.serial) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Serial (ใช้ Chrome/Edge บนคอมพิวเตอร์) หรือเลือกโหมด Bluetooth');
    let port = (await navigator.serial.getPorts())[0] || await navigator.serial.requestPort();
    try { await port.open({ baudRate: +cfg.baud || 9600 }); } catch (e) { if (!/already open/i.test(String(e && e.message))) throw e; }
    Object.assign(T, { type: 'serial', port, writer: port.writable.getWriter(), name: 'Serial' });
  }
  async function send(bytes) {
    if (!T.type) await connect();
    try {
      if (T.type === 'serial') { for (let i = 0; i < bytes.length; i += 1024) await T.writer.write(bytes.slice(i, i + 1024)); }
      else { for (let i = 0; i < bytes.length; i += 100) { const p = bytes.slice(i, i + 100); T.char.properties.writeWithoutResponse ? await T.char.writeValueWithoutResponse(p) : await T.char.writeValue(p); await new Promise(r => setTimeout(r, 20)); } }
    } catch (e) { try { T.writer?.releaseLock(); } catch (x) { } Object.assign(T, { type: null, port: null, writer: null, char: null }); throw e; }
  }
  window.escposPrintBill = async function (bill) {
    try { await send(buildReceipt(bill, pcfg())); window.showToast?.('ส่งไปเครื่องพิมพ์แล้ว'); }
    catch (e) { window.showAlert?.('พิมพ์ไม่สำเร็จ', String((e && e.message) || e), true); }
  };
  window.escposTestPrint = function () {
    return window.escposPrintBill({ id: 'TEST-0001', time: Date.now(), customerId: 'GENERAL', method: 'เงินสด', total: 1234.5, discount: 0,
      items: [{ name: 'ทดสอบพิมพ์ภาษาไทย ก่อน ท่อ PVC ยาว 4 เมตร', qty: 2, price: 50 }, { name: 'สายไฟ VAF 2x1.5 (เมตร)', qty: 10, price: 113.45 }] });
  };

  // ---------- แจ้งเตือน (เรียก Edge Function "notify": token เก็บเป็น secret ฝั่งเซิร์ฟเวอร์ ไม่อยู่ในแอป) ----------
  async function notify(event, data) {
    const c = window.getSupabaseClient?.(); if (!c || navigator.onLine === false) throw new Error('ต้องออนไลน์');
    const { data: res, error } = await c.functions.invoke('notify', { body: { event, data, store: (window.db && window.db.storeName) || '' } });
    if (error) throw error; return res;
  }
  window.sendNotify = notify;
  const todayKey = () => new Date().toISOString().slice(0, 10);
  function lowStockItems() {
    const out = [];
    Object.values((window.db && window.db.products) || {}).forEach(p => {
      if (!p || p.isDeleted || p.isDisabled) return;
      (p.variants || []).forEach(v => { if (v.parentVariantId) return; const min = +v.minStock >= 0 ? +v.minStock : 5, st = +v.stock || 0; if (st <= min) out.push({ id: v.id, name: p.name + ((p.variants || []).length > 1 ? ' (' + (v.sizeName || '') + ')' : ''), stock: st, min, unit: v.unit || 'ชิ้น' }); });
    });
    return out;
  }
  async function checkLowStock() {
    const cfg = ncfg(); if (!cfg.enabled || !cfg.lowStock || navigator.onLine === false) return;
    const seen = loadCfg('pos_notify_seen_v1', {}); const t = todayKey();
    const fresh = lowStockItems().filter(x => seen[x.id] !== t).slice(0, 30); if (!fresh.length) return;
    try { await notify('LOW_STOCK', { items: fresh.map(({ name, stock, min, unit }) => ({ name, stock, min, unit })) }); fresh.forEach(x => seen[x.id] = t); saveCfg('pos_notify_seen_v1', seen); }
    catch (e) { console.warn('low-stock notify', e); }
  }
  setTimeout(checkLowStock, 45000); setInterval(checkLowStock, 30 * 60 * 1000);
  window.sendDailySummary = async function () {
    const bills = Array.isArray(window.db.bills) ? window.db.bills : Object.values(window.db.bills || {});
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const today = bills.filter(b => b && b.time >= d0.getTime() && !(b.voided || b.isVoided || b.status === 'VOIDED'));
    const methods = {}; today.forEach(b => { methods[b.method || 'อื่นๆ'] = (methods[b.method || 'อื่นๆ'] || 0) + (+b.total || 0); });
    return notify('DAILY_SUMMARY', { date: d0.toLocaleDateString('th-TH'), count: today.length, total: today.reduce((s, b) => s + (+b.total || 0), 0), methods });
  };

  // ---------- ใบตรวจนับสต็อก (พิมพ์ผ่านหน้าต่างเอกสารเดิม) ----------
  window.printStocktakeSheet = function (filter) {
    const q = String(filter || '').trim().toLowerCase(); const rows = [];
    Object.values(window.db.products || {}).forEach(p => {
      if (!p || p.isDeleted || p.isDisabled) return;
      (p.variants || []).forEach(v => {
        const hay = (p.name + ' ' + (v.sizeName || '') + ' ' + (v.locationCode || '') + ' ' + (v.barcode || '')).toLowerCase();
        if (q && !hay.includes(q)) return; rows.push({ code: v.locationCode || '', name: p.name + ((p.variants || []).length > 1 || v.parentVariantId ? ' (' + (v.sizeName || 'ปกติ') + ')' : ''), unit: v.unit || 'ชิ้น', sys: +v.stock || 0 });
      });
    });
    rows.sort((a, b) => (a.code || '~').localeCompare(b.code || '~', 'en', { numeric: true }) || a.name.localeCompare(b.name, 'th'));
    const html = `<div class="p-3 bg-white text-slate-800" style="max-width:780px;margin:auto"><h2 class="font-bold text-base">ใบตรวจนับสต็อก${q ? ' — ' + esc(filter) : ''}</h2>
      <p class="text-[10px] text-slate-500 mb-2">${esc(window.db.storeName || '')} • พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} • ${rows.length} รายการ • ผู้นับ ................................ ผู้ตรวจ ................................</p>
      <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px;width:60px">ที่เก็บ</th><th style="border:1px solid #cbd5e1;padding:3px;text-align:left">สินค้า</th><th style="border:1px solid #cbd5e1;padding:3px;width:50px">หน่วย</th><th style="border:1px solid #cbd5e1;padding:3px;width:60px">ในระบบ</th><th style="border:1px solid #cbd5e1;padding:3px;width:70px">นับได้</th><th style="border:1px solid #cbd5e1;padding:3px;width:60px">ผลต่าง</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td style="border:1px solid #cbd5e1;padding:3px;text-align:center">${esc(r.code)}</td><td style="border:1px solid #cbd5e1;padding:3px">${esc(r.name)}</td><td style="border:1px solid #cbd5e1;padding:3px;text-align:center">${esc(r.unit)}</td><td style="border:1px solid #cbd5e1;padding:3px;text-align:right">${r.sys}</td><td style="border:1px solid #cbd5e1;padding:3px"></td><td style="border:1px solid #cbd5e1;padding:3px"></td></tr>`).join('') + '</tbody></table></div>';
    document.getElementById('print-document-area').innerHTML = html;
    const m = document.getElementById('modal-document-viewer'); m.classList.remove('hidden'); m.classList.add('flex');
    window.showToast?.('กดปุ่มพิมพ์ของหน้าต่างเอกสารเพื่อพิมพ์ใบตรวจนับ');
  };

  // ---------- หน้าตั้งค่า ----------
  window.openPeripheralSettings = function () {
    document.getElementById('periph-dlg')?.remove();
    const pc = pcfg(), nc = ncfg(), el = document.createElement('div');
    el.id = 'periph-dlg'; el.className = 'fixed inset-0 z-[320] bg-slate-900/70 flex items-center justify-center p-3';
    const sel = (id, opts, val) => `<select id="${id}" class="w-full border p-2 rounded-xl text-xs font-bold">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const chk = (id, label, on) => `<label class="flex items-center gap-2 text-xs font-bold"><input id="${id}" type="checkbox" ${on ? 'checked' : ''}> ${label}</label>`;
    el.innerHTML = `<div class="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-[1.5rem] p-5 shadow-2xl space-y-2">
      <h3 class="text-sm font-black">🖨️ เครื่องพิมพ์ใบเสร็จ (ESC/POS)</h3>
      ${sel('pp-type', [['serial', 'USB / Serial (Chrome, Edge บนคอมพิวเตอร์)'], ['ble', 'Bluetooth LE']], pc.type)}
      <div class="grid grid-cols-3 gap-2"><div><label class="text-[10px] text-slate-400">กระดาษ</label>${sel('pp-width', [[58, '58 มม.'], [80, '80 มม.']], pc.width)}</div>
      <div><label class="text-[10px] text-slate-400">Code page ไทย</label><input id="pp-cp" type="number" value="${pc.codepage}" class="w-full border p-2 rounded-xl text-xs font-bold"></div>
      <div><label class="text-[10px] text-slate-400">Baud</label><input id="pp-baud" type="number" value="${pc.baud}" class="w-full border p-2 rounded-xl text-xs font-bold"></div></div>
      ${chk('pp-cut', 'ตัดกระดาษหลังพิมพ์', pc.cut)}${chk('pp-drawer', 'เปิดลิ้นชักเงินหลังพิมพ์', pc.drawer)}${chk('pp-auto', 'พิมพ์อัตโนมัติหลังชำระเงิน', pc.auto)}
      <div class="flex gap-2"><button id="pp-conn" class="flex-1 py-2 bg-slate-100 rounded-xl text-xs font-bold">เชื่อมต่อ</button><button id="pp-test" class="flex-1 py-2 bg-amber-100 text-amber-800 rounded-xl text-xs font-bold">พิมพ์ทดสอบ</button></div>
      <p class="text-[9px] text-slate-400">ถ้าภาษาไทยเพี้ยน ลองเปลี่ยน Code page (ที่พบบ่อย 20, 21, 26, 255) แล้วพิมพ์ทดสอบใหม่</p>
      <hr><h3 class="text-sm font-black">🔔 แจ้งเตือน Telegram / LINE</h3>
      ${chk('nn-on', 'เปิดการแจ้งเตือน', nc.enabled)}${chk('nn-low', 'แจ้งสินค้าใกล้หมด (วันละครั้งต่อสินค้า)', nc.lowStock)}
      <div class="flex gap-2"><button id="nn-test" class="flex-1 py-2 bg-slate-100 rounded-xl text-xs font-bold">ส่งทดสอบ</button><button id="nn-sum" class="flex-1 py-2 bg-slate-100 rounded-xl text-xs font-bold">ส่งสรุปยอดวันนี้</button></div>
      <p class="text-[9px] text-slate-400">ต้องติดตั้ง Edge Function "notify" และตั้ง secret ฝั่ง Supabase ก่อน (ดู README ในโฟลเดอร์ supabase/functions/notify)</p>
      <hr><h3 class="text-sm font-black">📋 ใบตรวจนับสต็อก</h3>
      <div class="flex gap-2"><input id="st-filter" placeholder="กรอง: ชื่อ / ที่เก็บ เช่น A1 (เว้นว่าง = ทั้งหมด)" class="flex-1 border p-2 rounded-xl text-xs"><button id="st-print" class="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">สร้างใบนับ</button></div>
      <div class="flex gap-2 pt-1"><button id="pp-close" class="flex-1 py-2.5 bg-slate-100 rounded-xl text-xs font-bold">ปิด</button><button id="pp-save" class="flex-[2] py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold">บันทึก</button></div></div>`;
    document.body.appendChild(el);
    const $ = (id) => el.querySelector('#' + id);
    const save = () => {
      saveCfg(PCFG, { type: $('pp-type').value, width: +$('pp-width').value, codepage: +$('pp-cp').value || 0, baud: +$('pp-baud').value || 9600, cut: $('pp-cut').checked, drawer: $('pp-drawer').checked, auto: $('pp-auto').checked });
      saveCfg(NCFG, { enabled: $('nn-on').checked, lowStock: $('nn-low').checked });
    };
    const fail = (t) => (e) => window.showAlert?.(t, String((e && e.message) || e), true);
    $('pp-close').onclick = () => el.remove();
    $('pp-save').onclick = () => { save(); el.remove(); window.showToast?.('บันทึกการตั้งค่าแล้ว'); };
    $('pp-conn').onclick = () => { save(); Object.assign(T, { type: null }); connect().then(() => window.showToast?.('เชื่อมต่อแล้ว: ' + T.name)).catch(fail('เชื่อมต่อไม่สำเร็จ')); };
    $('pp-test').onclick = () => { save(); window.escposTestPrint(); };
    $('nn-test').onclick = () => { save(); notify('TEST', {}).then(() => window.showToast?.('ส่งทดสอบแล้ว')).catch(e => fail('ส่งไม่สำเร็จ')(/not found|404|Failed to send/i.test(String(e && e.message)) ? new Error('ยังไม่พบ Edge Function "notify" — กรุณา deploy ก่อน') : e)); };
    $('nn-sum').onclick = () => { save(); window.sendDailySummary().then(() => window.showToast?.('ส่งสรุปยอดแล้ว')).catch(fail('ส่งไม่สำเร็จ')); };
    $('st-print').onclick = () => { const f = $('st-filter').value; el.remove(); window.printStocktakeSheet(f); };
  };

  // ---------- ปุ่มในหน้าใบเสร็จ + พิมพ์อัตโนมัติ + F9 ----------
  const st = document.createElement('style'); st.textContent = '@media print{.escpos-actions{display:none!important}}'; document.head.appendChild(st);
  // ห่อ renderReceipt ไม่ว่าจะถูกกำหนดค่าก่อนหรือหลังโมดูลนี้โหลด
  const wrapRR = (fn) => {
    if (typeof fn !== 'function' || fn.__escpos) return fn;
    const w = function (bill) {
      const r = fn.apply(this, arguments);
      try {
        window._lastReceiptBill = bill;
        document.getElementById('print-document-area')?.insertAdjacentHTML('beforeend',
          `<div class="escpos-actions flex gap-2 mt-2"><button onclick="window.escposPrintBill(window._lastReceiptBill)" class="flex-1 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">🖨️ พิมพ์เครื่องพิมพ์ใบเสร็จ</button><button onclick="window.openPeripheralSettings()" class="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold">⚙️</button></div>`);
        if (pcfg().auto && bill && Date.now() - bill.time < 15000) window.escposPrintBill(bill);   // เฉพาะบิลที่เพิ่งขายเสร็จ ไม่พิมพ์ซ้ำตอนเปิดบิลเก่า
      } catch (e) { console.warn(e); }
      return r;
    };
    w.__escpos = true; return w;
  };
  let _rr = wrapRR(window.renderReceipt);
  Object.defineProperty(window, 'renderReceipt', { configurable: true, get() { return _rr; }, set(fn) { _rr = wrapRR(fn); } });
  window._escposBuild = buildReceipt;
  document.addEventListener('keydown', e => { if (e.key === 'F9') { e.preventDefault(); window.openPeripheralSettings(); } });
})();
