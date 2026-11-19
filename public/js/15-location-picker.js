
(function () {
  'use strict';
  const { CODE_RE, esc, money, soundOn, speak, allVariants, layoutInfo, itemsAt, findVariant, zoneOf, SFX } = window.POS;
  const MIN_SHELVES = 5, MIN_SLOTS = 6;

  // ---------- ตัวเลือกตำแหน่งแบบภาพ (ใช้ทั้งหน้าตารางและหน้าขาย) ----------
  function cellHtml(z, code, opts) {
    const n = itemsAt(code).length;
    const target = opts && opts.target === code;
    const pick = opts && opts.pickable;
    const cls = [target ? 'pos-pulse' : (pick && !n ? 'pos-pulse' : '')].join(' ');
    const bg = target ? '#4f46e5' : (n ? '#eef2ff' : '#f8fafc');
    const fg = target ? '#fff' : (n ? '#312e81' : '#64748b');
    const border = target ? '2px solid #312e81' : (n ? '1px solid #818cf8' : '1px dashed #cbd5e1');
    return `<button data-code="${code}" class="${cls}" style="min-height:50px;border-radius:10px;border:${border};background:${bg};color:${fg};padding:3px;font-size:11px;line-height:1.2;font-weight:700">` +
      `${target ? '<span class="pos-bob">📍</span>' : ''}<div>${code}</div><div style="font-weight:400;opacity:.85">${n ? n + ' รายการ' : 'ว่าง'}</div></button>`;
  }
  function gridHtml(zone, zones, opts) {
    const z = zones[zone];
    let h = `<div style="display:grid;grid-template-columns:40px repeat(${z.slots},minmax(0,1fr));gap:4px">`;
    h += '<div></div>' + Array.from({ length: z.slots }, (_, i) => `<div style="text-align:center;color:#64748b;font-size:11px;font-weight:700">${i + 1}</div>`).join('');
    for (let sh = 1; sh <= z.shelves; sh++) {
      h += `<div style="display:flex;align-items:center;justify-content:center;color:#64748b;font-size:11px;font-weight:700">ชั้น${sh}</div>`;
      for (let sl = 1; sl <= z.slots; sl++) h += cellHtml(zone, `${zone}-${sh}-${sl}`, opts);
    }
    return h + '</div>';
  }

  // ---------- ตัวเลือกตำแหน่ง (modal) ----------
  let pickerItems = [], pickerZone = null, pickerCell = null;
  function ensurePicker() {
    let m = document.getElementById('pos-picker-modal'); if (m) return m;
    m = document.createElement('div');
    m.id = 'pos-picker-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9996;background:rgba(15,23,42,.6);padding:12px;overflow:auto';
    m.innerHTML = '<div style="max-width:640px;margin:20px auto;background:#fff;border-radius:16px;padding:16px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b id="pp-title" style="font-size:17px"></b>' +
      '<button id="pp-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ปิด</button></div>' +
      '<div id="pp-zones" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>' +
      '<div id="pp-grid"></div><div id="pp-confirm" style="margin-top:12px"></div></div>';
    document.body.appendChild(m);
    document.getElementById('pp-close').onclick = () => { m.style.display = 'none'; };
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    return m;
  }
  function renderPicker() {
    const zones = layoutInfo();
    const names = Object.keys(zones).sort();
    if (!pickerZone || !zones[pickerZone]) pickerZone = names[0];
    document.getElementById('pp-zones').innerHTML = names.map(z =>
      `<button data-z="${z}" style="padding:8px 14px;border-radius:10px;border:1px solid #c7d2fe;font-weight:700;background:${z === pickerZone ? '#4f46e5' : '#eef2ff'};color:${z === pickerZone ? '#fff' : '#3730a3'}">โซน ${z}</button>`
    ).join('') + `<button data-z="+" style="padding:8px 14px;border-radius:10px;border:1px dashed #94a3b8;background:#fff;font-weight:700">+ โซนใหม่</button>`;
    document.querySelectorAll('#pp-zones button').forEach(b => b.onclick = () => {
      if (b.dataset.z === '+') {
        const last = names.length ? names[names.length - 1].charCodeAt(0) : 64;
        if (last >= 90) return; pickerZone = String.fromCharCode(last + 1);
      } else pickerZone = b.dataset.z;
      pickerCell = null; renderPicker();
    });
    document.getElementById('pp-grid').innerHTML = gridHtml(pickerZone, zones, { pickable: true, target: pickerCell });
    document.querySelectorAll('#pp-grid button').forEach(b => b.onclick = () => { pickerCell = b.dataset.code; renderPicker(); });
    renderConfirm();
  }
  function renderConfirm() {
    const el = document.getElementById('pp-confirm');
    if (!pickerCell) { el.innerHTML = '<div style="color:#64748b">แตะช่องที่ต้องการ (ช่องว่างกระพริบเพื่อแนะนำ)</div>'; return; }
    const occupants = itemsAt(pickerCell).filter(x => !pickerItems.some(i => i.vid === x.v.id)).length;
    el.innerHTML = `<div style="font-weight:800;margin-bottom:6px">วาง ${pickerItems.length} รายการที่ช่อง ${pickerCell}</div>` +
      (occupants ? `<div style="font-size:12px;color:#64748b;margin-bottom:6px">ช่องนี้มีสินค้าอยู่แล้ว ${occupants} รายการ (จะวางรวมกันได้)</div>` : '') +
      `<div style="display:flex;gap:8px"><button id="pp-ok" style="flex:1;padding:12px;border-radius:12px;background:#4f46e5;color:#fff;font-weight:800;border:0">✔ ยืนยันการวาง</button>` +
      `<button id="pp-cancel" style="padding:12px;border-radius:12px;background:#e2e8f0;font-weight:700;border:0">ยกเลิก</button></div>`;
    document.getElementById('pp-ok').onclick = applyPick;
    document.getElementById('pp-cancel').onclick = () => { pickerCell = null; renderPicker(); };
  }
  function applyPick() {
    const code = pickerCell; if (!code) return;
    let n = 0;
    pickerItems.forEach(({ pid, vid }) => {
      const f = findVariant(pid, vid);
      if (f) { f.v.locationCode = code; n++; }
    });
    window.persist?.();
    window.showToast?.(`วางสินค้า ${n} รายการที่ ${code} แล้ว`);
    speak('วางที่ช่อง ' + code);
    SFX_ok();
    document.getElementById('pos-picker-modal').style.display = 'none';
    pickerItems = [];
    window.renderStockTable?.();
    // ซิงก์ตำแหน่งขึ้นฐาน (ตำแหน่งจะถูกส่งพร้อมการซิงก์สินค้า)
    window.syncProductsToSupabase?.(true).catch(e => console.warn('location sync', e));
  }
  function SFX_ok() { SFX.ok(); }

  window.openLocationPicker = function (items, title) {
    pickerItems = items.map(x => ({ pid: x.pid, vid: x.vid }));
    pickerCell = null;
    const zoneFromItem = items.map(x => { const f = findVariant(x.pid, x.vid); return f && zoneOf(f.v.locationCode); }).find(Boolean);
    pickerZone = zoneFromItem || null;
    const m = ensurePicker();
    document.getElementById('pp-title').textContent = title || '📍 เลือกตำแหน่งวางสินค้า';
    m.style.display = 'block';
    renderPicker();
  };

  // ---------- คอลัมน์ "ตำแหน่ง" ในตารางสินค้า ----------
  window.posLocCell = function (pid, vid) {
    const f = findVariant(pid, vid); const code = f && f.v.locationCode;
    const btn = code
      ? `<span class="inline-block font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-0.5 text-[11px]">📍 ${esc(code)}</span>
         <button onclick="window.posMoveOne('${pid}','${vid}')" class="block text-[10px] text-indigo-600 font-bold mt-0.5 hover:underline">ย้าย</button>`
      : `<button onclick="window.posMoveOne('${pid}','${vid}')" class="text-[11px] font-bold text-slate-500 border border-dashed rounded-lg px-2 py-1">+ จัดวาง</button>`;
    return `<td class="p-3 text-center whitespace-nowrap">${btn}</td>`;
  };
  window.posMoveOne = function (pid, vid) { window.openLocationPicker([{ pid, vid }], '📍 จัดวาง/ย้ายตำแหน่ง'); };

  // ---------- ปุ่มในแถบเครื่องมือเมื่อเลือกหลายรายการ ----------
  function addBulkButtons() {
    const bar = document.getElementById('stock-bulk-toolbar');
    if (!bar || document.getElementById('pos-bulk-loc')) return;
    const wrap = document.createElement('span');
    wrap.id = 'pos-bulk-loc';
    wrap.style.cssText = 'display:inline-flex;gap:6px';
    wrap.innerHTML = '<button class="text-xs font-bold bg-white border px-3 py-1.5 rounded-lg btn-touch" data-a="place">📍 จัดวาง/ย้ายตำแหน่ง</button>' +
                     '<button class="text-xs font-bold bg-white border px-3 py-1.5 rounded-lg btn-touch" data-a="clear">🚫 นำออกจากตำแหน่ง</button>';
    const cancel = bar.querySelector('button[onclick="window.clearStockSelection()"]');
    bar.insertBefore(wrap, cancel || null);
    wrap.querySelector('[data-a="place"]').onclick = () => {
      const items = selectedVariantItems();
      if (!items.length) return window.showToast?.('เลือกสินค้าก่อน');
      window.openLocationPicker(items, `📍 วาง ${items.length} รายการ`);
    };
    wrap.querySelector('[data-a="clear"]').onclick = () => {
      const items = selectedVariantItems();
      if (!items.length) return window.showToast?.('เลือกสินค้าก่อน');
      items.forEach(({ pid, vid }) => { const f = findVariant(pid, vid); if (f) f.v.locationCode = null; });
      window.persist?.();
      window.showToast?.(`นำ ${items.length} รายการออกจากตำแหน่งแล้ว`);
      window.renderStockTable?.();
      window.syncProductsToSupabase?.(true).catch(() => {});
    };
  }
  function selectedVariantItems() {
    const out = [];
    try { selectedProductIds.forEach(pid => (db.products[pid]?.variants || []).forEach(v => out.push({ pid, vid: v.id }))); } catch (e) {}
    return out;
  }

  // ---------- นำทางหน้าขาย: แสดงช่องที่ต้องไปหยิบพร้อมอนิเมชัน ----------
  let guideEl = null, guideTimer = null;
  function showGuide(pname, code) {
    const zone = zoneOf(code); if (!zone) return;
    const zones = layoutInfo();
    if (!guideEl) {
      guideEl = document.createElement('div');
      guideEl.id = 'pos-guide';
      guideEl.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:70px;z-index:9992;width:min(92vw,380px);background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.3);padding:12px;font-family:Sarabun,sans-serif;color:#0f172a';
      document.body.appendChild(guideEl);
    }
    guideEl.className = 'pos-card-in';
    guideEl.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px">` +
      `<div><div style="font-size:12px;color:#64748b">ไปหยิบที่</div><div style="font-weight:800;font-size:18px;color:#312e81">📍 ช่อง ${esc(code)}</div>` +
      `<div style="font-size:12px;color:#475569">${esc(pname)}</div></div>` +
      `<button id="pos-guide-ok" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ตกลง</button></div>` +
      `<div style="overflow-x:auto">${gridHtml(zone, zones, { target: code })}</div>`;
    document.getElementById('pos-guide-ok').onclick = hideGuide;
    clearTimeout(guideTimer); guideTimer = setTimeout(hideGuide, 9000);
    speak('ไปที่ช่อง ' + code);
  }
  function hideGuide() { if (guideEl) guideEl.remove(); guideEl = null; clearTimeout(guideTimer); }

  posHooks.on('cart:add', e => {
    const f = findVariant(e.productId, e.variantId);
    if (f && f.v.locationCode && zoneOf(f.v.locationCode)) showGuide(f.p.name + ' (' + (f.v.sizeName || 'ปกติ') + ')', f.v.locationCode);
  });

  // ---------- ติดตั้งคอลัมน์/ปุ่มเมื่อตารางแสดงผล ----------
  posHooks.on('stock:render', addBulkButtons);
  document.addEventListener('DOMContentLoaded', addBulkButtons);
  if (document.readyState !== 'loading') addBulkButtons();
})();
