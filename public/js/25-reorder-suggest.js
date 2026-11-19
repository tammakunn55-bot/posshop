
(function () {
  'use strict';
  const esc = s => (window.escapeHTML ? window.escapeHTML(s) : String(s == null ? '' : s));
  let rows = [];
  // สูตรแนะนำ: เติมให้ถึง 2 เท่าของขั้นต่ำ (ขั้นต่ำ 0 ให้สั่งอย่างน้อย 1)
  const suggest = v => Math.max(1, Math.ceil(Number(v.minStock || 0) * 2 - Number(v.stock || 0)));
  function collect() {
    const out = [];
    Object.values(db.products || {}).forEach(p => {
      if (p.isDeleted || p.isDisabled) return;
      (p.variants || []).forEach(v => {
        const min = Number(v.minStock || 0), st = Number(v.stock || 0);
        if (min > 0 && st <= min) out.push({ p, v, qty: suggest(v) });
      });
    });
    return out.sort((a, b) => (a.v.stock - a.v.minStock) - (b.v.stock - b.v.minStock));
  }
  function ensureModal() {
    let m = document.getElementById('pos-reorder'); if (m) return m;
    m = document.createElement('div'); m.id = 'pos-reorder';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:rgba(15,23,42,.6);padding:10px;overflow:auto';
    m.innerHTML = '<div style="max-width:900px;margin:8px auto;background:#fff;border-radius:16px;padding:14px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:16px">🛒 แนะนำการสั่งซื้อ</b><button id="ro-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:8px 12px;font-weight:700">ปิด</button></div>' +
      '<div id="ro-sum" style="font-size:13px;color:#64748b;margin:6px 0"></div>' +
      '<div style="overflow:auto;max-height:55vh"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9;position:sticky;top:0"><th style="padding:6px;text-align:left">สินค้า / ขนาด</th><th>คงเหลือ</th><th>ขั้นต่ำ</th><th>สั่ง</th><th>ทุน</th><th>✓</th></tr></thead><tbody id="ro-body"></tbody></table></div>' +
      '<div id="ro-msg" style="font-size:13px;color:#b91c1c;margin-top:6px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button id="ro-all" style="padding:10px 12px;border-radius:10px;border:0;background:#e0e7ff;color:#3730a3;font-weight:700">ติ๊กทั้งหมด</button>' +
      '<button id="ro-csv" style="padding:10px 12px;border-radius:10px;border:0;background:#dbeafe;color:#1e40af;font-weight:700">⬇️ ส่งออก CSV (ส่งซัพพลายเออร์)</button>' +
      '<button id="ro-add" style="flex:1;padding:12px;border-radius:12px;border:0;background:#059669;color:#fff;font-weight:800">✔ เพิ่มที่เลือกเข้าใบรับของ</button></div></div>';
    document.body.appendChild(m);
    const close = () => { m.style.display = 'none'; };
    document.getElementById('ro-close').onclick = close;
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.getElementById('ro-all').onclick = () => document.querySelectorAll('#ro-body .ro-chk').forEach(c => c.checked = true);
    document.getElementById('ro-csv').onclick = exportCsv;
    document.getElementById('ro-add').onclick = addChecked;
    return m;
  }
  function render() {
    const body = document.getElementById('ro-body'); body.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr'); tr.style.borderTop = '1px solid #e2e8f0'; tr.dataset.i = i;
      const multi = (r.p.variants || []).length > 1;
      tr.innerHTML = '<td style="padding:6px">' + esc(r.p.name) + (multi ? ' <span style="color:#64748b">(' + esc(r.v.sizeName || 'ปกติ') + ')</span>' : '') + '</td>' +
        '<td style="text-align:center;color:#b91c1c;font-weight:700">' + Number(r.v.stock || 0) + '</td>' +
        '<td style="text-align:center">' + Number(r.v.minStock || 0) + '</td>' +
        '<td><input class="ro-qty" type="number" min="1" value="' + r.qty + '" style="width:80px;padding:6px;border:1px solid #cbd5e1;border-radius:8px"></td>' +
        '<td><input class="ro-cost" type="number" min="0" value="' + Number(r.v.cost || 0) + '" style="width:90px;padding:6px;border:1px solid #cbd5e1;border-radius:8px"></td>' +
        '<td style="text-align:center"><input class="ro-chk" type="checkbox" checked style="width:22px;height:22px"></td>';
      body.appendChild(tr);
    });
    document.getElementById('ro-sum').textContent = rows.length ? `สินค้าที่ต้องสั่ง ${rows.length} รายการ (ติ๊กเลือกเฉพาะที่ต้องการ)` : 'ไม่มีสินค้าต่ำกว่าขั้นต่ำ';
  }
  function current() {
    return Array.from(document.querySelectorAll('#ro-body tr')).map(tr => {
      const i = +tr.dataset.i, r = rows[i];
      return { r, chk: tr.querySelector('.ro-chk').checked,
        qty: parseFloat(tr.querySelector('.ro-qty').value) || 0,
        cost: parseFloat(tr.querySelector('.ro-cost').value) || 0 };
    });
  }
  function addChecked() {
    const msg = document.getElementById('ro-msg'); msg.textContent = '';
    const picked = current().filter(x => x.chk);
    if (!picked.length) { msg.textContent = 'ยังไม่ได้ติ๊กเลือกรายการ'; return; }
    if (picked.some(x => x.qty <= 0)) { msg.textContent = 'จำนวนสั่งต้องมากกว่า 0'; return; }
    picked.forEach(({ r, qty, cost }) => {
      const total = (window.roundAmt ? window.roundAmt(qty * cost) : Math.round(qty * cost * 100) / 100);
      poTempItems.push({ productId: r.p.id, variantId: r.v.id,
        productName: r.p.name + ((r.p.variants || []).length > 1 ? ' (' + (r.v.sizeName || 'ปกติ') + ')' : ''), qty, cost, total });
    });
    window.renderPOCartList?.();
    document.getElementById('pos-reorder').style.display = 'none';
    window.showToast?.('เพิ่ม ' + picked.length + ' รายการเข้าใบรับแล้ว');
  }
  function exportCsv() {
    const data = current().filter(x => x.chk);
    if (!data.length) { document.getElementById('ro-msg').textContent = 'ยังไม่ได้ติ๊กเลือกรายการ'; return; }
    const head = ['สินค้า', 'ขนาด', 'SKU', 'คงเหลือ', 'ขั้นต่ำ', 'จำนวนที่สั่ง', 'ราคาทุน', 'รวม'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')];
    data.forEach(({ r, qty, cost }) => {
      lines.push([r.p.name, r.v.sizeName || 'ปกติ', r.v.sku || '', r.v.stock, r.v.minStock, qty, cost, (qty * cost).toFixed(2)].map(q).join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reorder-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  window.openReorderSuggest = function () {
    rows = collect();
    ensureModal();
    render();
    document.getElementById('pos-reorder').style.display = 'block';
  };
})();
