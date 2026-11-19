
(function () {
  'use strict';
  const esc = s => (window.escapeHTML ? window.escapeHTML(s) : String(s == null ? '' : s));
  const PAGE = 200;
  let index = [], shown = 0, filtered = [];
  function buildIndex() {
    index = [];
    Object.values(db.products || {}).forEach(p => {
      if (p.isDeleted || p.isDisabled) return;
      (p.variants || []).forEach(v => index.push({ p, v, hay: (p.name + ' ' + (v.sizeName || '') + ' ' + (p.code || '') + ' ' + (v.sku || '') + ' ' + (v.barcode || '')).toLowerCase() }));
    });
    index.sort((a, b) => a.p.name.localeCompare(b.p.name, 'th') || (a.v.sizeName || '').localeCompare(b.v.sizeName || '', 'th'));
  }
  function ensureModal() {
    let m = document.getElementById('pos-pickpo'); if (m) return m;
    m = document.createElement('div'); m.id = 'pos-pickpo';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:rgba(15,23,42,.6);padding:10px;overflow:auto';
    m.innerHTML = '<div style="max-width:900px;margin:8px auto;background:#fff;border-radius:16px;padding:14px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">🔍 เลือกสินค้าที่จะสั่ง</b><button id="ppx-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:8px 12px;font-weight:700">ปิด</button></div>' +
      '<input id="pp-q" placeholder="ค้นหาชื่อ / ขนาด / SKU / บาร์โค้ด" autocomplete="off" style="width:100%;box-sizing:border-box;margin:10px 0;padding:10px;border:1px solid #cbd5e1;border-radius:10px;min-height:44px">' +
      '<div id="pp-count" style="font-size:12px;color:#64748b;margin-bottom:4px"></div>' +
      '<div style="overflow:auto;max-height:60vh"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9;position:sticky;top:0"><th style="padding:6px;text-align:left">สินค้า / ขนาด</th><th>SKU</th><th>คงเหลือ</th><th>ทุน</th><th></th></tr></thead><tbody id="pp-body"></tbody></table></div>' +
      '<button id="pp-more" style="display:none;width:100%;margin-top:8px;padding:10px;border-radius:10px;border:1px dashed #94a3b8;background:#fff;font-weight:700">แสดงเพิ่ม</button></div>';
    document.body.appendChild(m);
    const close = () => { m.style.display = 'none'; };
    document.getElementById('ppx-close').onclick = close;
    m.addEventListener('click', e => { if (e.target === m) close(); });
    let t = null;
    document.getElementById('pp-q').oninput = e => { clearTimeout(t); t = setTimeout(() => applyFilter(e.target.value), 150); };
    document.getElementById('pp-more').onclick = () => { shown += PAGE; drawRows(); };
    document.getElementById('pp-body').addEventListener('click', e => {
      const btn = e.target.closest('button[data-pid]'); if (!btn) return;
      window.selectPOProduct?.(btn.dataset.pid, btn.dataset.vid);
      close();
    });
    return m;
  }
  function applyFilter(q) {
    const term = (q || '').trim().toLowerCase();
    filtered = term ? index.filter(r => r.hay.includes(term)) : index;
    shown = PAGE; drawRows();
  }
  function drawRows() {
    const body = document.getElementById('pp-body');
    const slice = filtered.slice(0, shown);
    body.innerHTML = slice.map(r => {
      const st = Number(r.v.stock || 0);
      return '<tr style="border-top:1px solid #e2e8f0">' +
        '<td style="padding:6px">' + esc(r.p.name) + ((r.p.variants || []).length > 1 ? ' <span style="color:#64748b">(' + esc(r.v.sizeName || 'ปกติ') + ')</span>' : '') + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + esc(r.v.sku || r.p.code || '-') + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + (st <= Number(r.v.minStock || 0) ? '#b91c1c' : '#0f172a') + '">' + st + '</td>' +
        '<td style="text-align:right">' + Number(r.v.cost || 0).toFixed(2) + '</td>' +
        '<td><button data-pid="' + esc(r.p.id) + '" data-vid="' + esc(r.v.id) + '" style="padding:8px 12px;border-radius:10px;border:0;background:#4f46e5;color:#fff;font-weight:700">เลือก</button></td></tr>';
    }).join('') || '<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">ไม่พบสินค้า</td></tr>';
    document.getElementById('pp-count').textContent = 'แสดง ' + Math.min(shown, filtered.length) + ' จาก ' + filtered.length + ' ขนาด';
    document.getElementById('pp-more').style.display = filtered.length > shown ? 'block' : 'none';
  }
  function open() {
    buildIndex();
    const m = ensureModal();
    document.getElementById('pp-q').value = '';
    applyFilter('');
    m.style.display = 'block';
    setTimeout(() => document.getElementById('pp-q').focus(), 50);
  }
  // แตะช่องค้นหาสินค้าในหน้าสั่งซื้อ = เปิดตารางแทนดรอปดาวน์
  document.addEventListener('focusin', e => {
    if (e.target && e.target.id === 'po-product-search') { e.target.blur(); open(); }
  });
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'po-product-search') open();
  });
  window.openPOProductTable = open;
})();
