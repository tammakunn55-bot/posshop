
(function () {
  'use strict';
  const esc = s => (window.escapeHTML ? window.escapeHTML(s) : String(s == null ? '' : s));
  function allRows() {
    const out = [];
    Object.values(db.products || {}).forEach(p => {
      if (p.isDeleted || p.isDisabled) return;
      (p.variants || []).forEach(v => out.push({ p, v }));
    });
    return out.sort((a, b) => a.p.name.localeCompare(b.p.name, 'th') || (a.v.sizeName || '').localeCompare(b.v.sizeName || '', 'th'));
  }
  let rows = [];
  function ensureModal() {
    let m = document.getElementById('pos-mrecv'); if (m) return m;
    m = document.createElement('div'); m.id = 'pos-mrecv';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:rgba(15,23,42,.6);padding:10px;overflow:auto';
    m.innerHTML = '<div style="max-width:900px;margin:8px auto;background:#fff;border-radius:16px;padding:14px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:16px">📋 เลือกสินค้ารับเข้าคลังหลายรายการ</b><button id="mrv-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:8px 12px;font-weight:700">ปิด</button></div>' +
      '<input id="mrv-q" placeholder="ค้นหาชื่อ / ขนาด / รหัส / บาร์โค้ด" style="width:100%;box-sizing:border-box;margin:10px 0;padding:10px;border:1px solid #cbd5e1;border-radius:10px;min-height:44px">' +
      '<div style="overflow:auto;max-height:58vh"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9;position:sticky;top:0"><th style="padding:6px;text-align:left">สินค้า / ขนาด</th><th>คงเหลือ</th><th>จำนวนรับ</th><th>ราคาทุน</th><th>✓</th></tr></thead><tbody id="mrv-body"></tbody></table></div>' +
      '<div id="mrv-msg" style="font-size:13px;color:#b91c1c;margin-top:6px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button id="mrv-add" style="flex:1;padding:12px;border-radius:12px;border:0;background:#059669;color:#fff;font-weight:800">✔ เพิ่มที่เลือกเข้าใบรับ</button>' +
      '<button id="mrv-cancel" style="padding:12px;border-radius:12px;border:0;background:#e2e8f0;font-weight:700">ยกเลิก</button></div></div>';
    document.body.appendChild(m);
    const close = () => { m.style.display = 'none'; };
    document.getElementById('mrv-close').onclick = close;
    document.getElementById('mrv-cancel').onclick = close;
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.getElementById('mrv-q').oninput = e => render(e.target.value);
    document.getElementById('mrv-add').onclick = addChecked;
    return m;
  }
  function render(q) {
    const term = (q || '').trim().toLowerCase();
    const body = document.getElementById('mrv-body'); body.innerHTML = '';
    rows.filter(r => !term || (r.p.name + ' ' + (r.v.sizeName || '') + ' ' + (r.v.sku || '') + ' ' + (r.v.barcode || '')).toLowerCase().includes(term))
      .slice(0, 400).forEach(r => {
        const tr = document.createElement('tr'); tr.style.borderTop = '1px solid #e2e8f0'; tr.dataset.pid = r.p.id; tr.dataset.vid = r.v.id;
        tr.innerHTML = '<td style="padding:6px">' + esc(r.p.name) + ((r.p.variants || []).length > 1 ? ' <span style="color:#64748b">(' + esc(r.v.sizeName || 'ปกติ') + ')</span>' : '') + '</td>' +
          '<td style="text-align:center">' + Number(r.v.stock || 0) + '</td>' +
          '<td><input class="mrv-qty" type="number" min="0" placeholder="0" style="width:90px;padding:6px;border:1px solid #cbd5e1;border-radius:8px"></td>' +
          '<td><input class="mrv-cost" type="number" min="0" value="' + Number(r.v.cost || 0) + '" style="width:100px;padding:6px;border:1px solid #cbd5e1;border-radius:8px"></td>' +
          '<td style="text-align:center"><input class="mrv-chk" type="checkbox" style="width:22px;height:22px"></td>';
        body.appendChild(tr);
      });
  }
  function addChecked() {
    const msg = document.getElementById('mrv-msg'); msg.textContent = '';
    let n = 0;
    for (const tr of document.querySelectorAll('#mrv-body tr')) {
      const chk = tr.querySelector('.mrv-chk'); if (!chk || !chk.checked) continue;
      const qty = parseFloat(tr.querySelector('.mrv-qty').value) || 0;
      const cost = parseFloat(tr.querySelector('.mrv-cost').value) || 0;
      if (qty <= 0) { msg.textContent = 'ทุกแถวที่ติ๊กต้องระบุจำนวนรับมากกว่า 0'; return; }
      const p = db.products[tr.dataset.pid]; const v = p && (p.variants || []).find(x => x.id === tr.dataset.vid);
      if (!p || !v) continue;
      const total = (window.roundAmt ? window.roundAmt(qty * cost) : Math.round(qty * cost * 100) / 100);
      poTempItems.push({ productId: p.id, variantId: v.id, productName: p.name + ((p.variants || []).length > 1 ? ' (' + (v.sizeName || 'ปกติ') + ')' : ''), qty, cost, total });
      n++;
    }
    if (!n) { msg.textContent = 'ยังไม่ได้ติ๊กเลือกรายการ'; return; }
    window.renderPOCartList?.();
    document.getElementById('pos-mrecv').style.display = 'none';
    window.showToast?.('เพิ่ม ' + n + ' รายการเข้าใบรับแล้ว');
  }
  window.openMultiReceive = function () {
    rows = allRows();
    const m = ensureModal();
    document.getElementById('mrv-q').value = '';
    render('');
    m.style.display = 'block';
  };
})();
