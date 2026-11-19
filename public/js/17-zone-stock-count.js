
(function () {
  'use strict';
  const { CODE_RE, esc, money, allVariants, zoneOf, layoutInfo } = window.POS;

  // จำโซนและช่องล่าสุดที่ผู้ใช้แตะในแผนผัง เพื่อใช้กับปุ่มตรวจนับ
  let lastZone = null, lastCell = null;
  document.addEventListener('click', e => {
    const z = e.target.closest && e.target.closest('#pos-shelf-zones [data-zone]');
    const c = e.target.closest && e.target.closest('#pos-shelf-grid [data-code]');
    if (z && z.dataset.zone !== '+') lastZone = z.dataset.zone;
    if (c) { lastCell = c.dataset.code; lastZone = zoneOf(lastCell) || lastZone; }
  }, true);

  // ---------- 1) ตารางสินค้า: ค้นหาด้วยรหัสตำแหน่งได้ (เช่น A-2 หรือ A-2-3) ----------
  // (แก้ในโค้ดหลักแล้ว: isMatchSearch ตรวจ v.locationCode ด้วย)

  // ---------- 2) แผนผัง: แถบค้นหาสินค้าและปุ่มตรวจนับ ----------
  posHooks.on('shelf:open', () => ensureBar());
  function ensureBar() {
    const box = document.getElementById('pos-shelf-box');
    if (!box || document.getElementById('pos-v14-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'pos-v14-bar';
    bar.style.cssText = 'margin-bottom:10px;display:flex;flex-direction:column;gap:6px';
    bar.innerHTML = '<input id="pos-v14-find" placeholder="🔍 ค้นหาสินค้า แล้วไปยังช่องที่วาง" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px">' +
      '<div id="pos-v14-results" style="display:flex;flex-direction:column;gap:4px"></div>' +
      '<button id="pos-v14-count" style="padding:10px;border-radius:12px;border:0;background:#0f766e;color:#fff;font-weight:800">🧮 ตรวจนับโซน ' + (lastZone || '') + '</button>';
    box.insertBefore(bar, document.getElementById('pos-shelf-zones'));
    const find = bar.querySelector('#pos-v14-find');
    find.oninput = () => {
      const q = find.value.trim().toLowerCase();
      const out = document.getElementById('pos-v14-results');
      if (!q) { out.innerHTML = ''; return; }
      const hits = allVariants().filter(({ p, v }) =>
        ((p.name || '') + ' ' + (v.sizeName || '') + ' ' + (v.barcode || '')).toLowerCase().includes(q) && v.locationCode)
        .slice(0, 8);
      out.innerHTML = hits.length ? hits.map(({ p, v }) =>
        `<button data-code="${esc(v.locationCode)}" data-pid="${p.id}" data-vid="${v.id}" style="text-align:left;padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:#fff">` +
        `${esc(p.name)} (${esc(v.sizeName || 'ปกติ')}) <b style="color:#4338ca">📍 ${esc(v.locationCode)}</b> · คงเหลือ ${v.stock ?? 0}</button>`).join('')
        : '<div style="color:#64748b">ยังไม่พบสินค้าที่มีตำแหน่ง (สินค้าที่ยังไม่จัดวางจะค้นไม่เจอในแผนผัง)</div>';
      out.querySelectorAll('button[data-code]').forEach(b => b.onclick = () => goToCell(b.dataset.code, b));
    };
    bar.querySelector('#pos-v14-count').onclick = () => openCount(lastZone || Object.keys(layoutInfo())[0]);
  }
  // เลือกโซนและช่องในแผนผังโดยคลิกปุ่มเดิม (ทำงานตรงกับการแตะจริงทุกอย่าง) แล้วกระพริบช่องเป้าหมาย
  function goToCell(code, srcBtn) {
    const zone = zoneOf(code); if (!zone) return;
    const zb = document.querySelector(`#pos-shelf-zones [data-zone="${zone}"]`); if (zb) zb.click();
    const cb = document.querySelector(`#pos-shelf-grid [data-code="${code}"]`); if (cb) { cb.click(); cb.classList.add('pos-pulse'); cb.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    lastZone = zone; lastCell = code;
    if (srcBtn) srcBtn.blur();
  }

  // ---------- 3) ตรวจนับทั้งโซน: เทียบจำนวนนับได้กับระบบ แล้วบันทึกเป็นปรับสต็อก ----------
  let countEl = null;
  function ensureCount() {
    if (countEl) return countEl;
    countEl = document.createElement('div');
    countEl.id = 'pos-count-modal';
    countEl.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:rgba(15,23,42,.6);padding:12px;overflow:auto';
    countEl.innerHTML = '<div style="max-width:720px;margin:16px auto;background:#fff;border-radius:16px;padding:16px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b id="pc-title" style="font-size:17px"></b>' +
      '<button id="pc-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ปิด</button></div>' +
      '<div id="pc-body" style="max-height:60vh;overflow:auto"></div>' +
      '<div id="pc-summary" style="margin-top:10px;font-weight:700"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button id="pc-save" style="flex:1;padding:12px;border-radius:12px;border:0;background:#0f766e;color:#fff;font-weight:800">✔ บันทึกผลการนับ</button>' +
      '<button id="pc-cancel" style="padding:12px;border-radius:12px;border:0;background:#e2e8f0;font-weight:700">ยกเลิก</button></div></div>';
    document.body.appendChild(countEl);
    document.getElementById('pc-close').onclick = closeCount;
    document.getElementById('pc-cancel').onclick = closeCount;
    document.getElementById('pc-save').onclick = saveCount;
    return countEl;
  }
  function closeCount() { if (countEl) countEl.style.display = 'none'; }
  let countRows = [];
  function openCount(zone) {
    if (!zone) return window.showToast?.('ยังไม่มีโซนที่วางสินค้า');
    ensureCount();
    const rows = allVariants().filter(({ v }) => zoneOf(v.locationCode) === zone)
      .sort((a, b) => (a.v.locationCode || '').localeCompare(b.v.locationCode || '', 'en', { numeric: true }));
    countRows = rows.map(({ p, v }) => ({ pid: p.id, vid: v.id, code: v.locationCode, name: p.name, size: v.sizeName || 'ปกติ', system: +v.stock || 0, counted: +v.stock || 0 }));
    document.getElementById('pc-title').textContent = `🧮 ตรวจนับโซน ${zone} (${countRows.length} รายการ)`;
    if (!countRows.length) document.getElementById('pc-body').innerHTML = '<div style="color:#64748b">ยังไม่มีสินค้าในโซนนี้</div>';
    else {
      document.getElementById('pc-body').innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr style="background:#f1f5f9;text-align:left"><th style="padding:6px">ช่อง</th><th>สินค้า</th><th style="text-align:right">ระบบมี</th><th style="text-align:right;width:90px">นับได้</th><th style="text-align:right">ต่าง</th></tr>' +
        countRows.map((r, i) => `<tr style="border-top:1px solid #e2e8f0"><td style="padding:6px;font-weight:700;color:#312e81">${esc(r.code)}</td>` +
          `<td>${esc(r.name)} <span style="color:#64748b">(${esc(r.size)})</span></td>` +
          `<td style="text-align:right">${r.system}</td>` +
          `<td style="text-align:right"><input type="number" step="1" min="0" value="${r.counted}" data-i="${i}" style="width:80px;padding:4px;border:1px solid #cbd5e1;border-radius:8px;text-align:right"></td>` +
          `<td id="pc-d-${i}" style="text-align:right;font-weight:700">0</td></tr>`).join('') + '</table>';
      document.querySelectorAll('#pc-body input[data-i]').forEach(inp => inp.oninput = () => {
        const i = +inp.dataset.i; countRows[i].counted = Math.max(0, Math.round(+inp.value || 0));
        renderSummary();
      });
    }
    renderSummary();
    countEl.style.display = 'block';
  }
  function renderSummary() {
    let changed = 0, net = 0;
    countRows.forEach((r, i) => {
      const d = r.counted - r.system;
      const cell = document.getElementById('pc-d-' + i);
      if (cell) { cell.textContent = (d > 0 ? '+' : '') + d; cell.style.color = d === 0 ? '#64748b' : (d > 0 ? '#059669' : '#dc2626'); }
      if (d !== 0) { changed++; net += d; }
    });
    document.getElementById('pc-summary').textContent = changed
      ? `ต่างจากระบบ ${changed} รายการ · ผลสุทธิ ${net > 0 ? '+' : ''}${net} ชิ้น`
      : 'ตรงกับระบบทุกรายการ';
  }
  function saveCount() {
    const diffs = countRows.filter(r => r.counted !== r.system);
    if (!diffs.length) { window.showToast?.('ไม่มีรายการที่ต่างจากระบบ'); return closeCount(); }
    if (!confirm(`บันทึกผลการนับ ${diffs.length} รายการ ใช่หรือไม่?`)) return;
    const stamp = Date.now(), dev = window.getDeviceId?.() || 'dev';
    let seq = 0;
    diffs.forEach(r => {
      const f = (db.products[r.pid]?.variants || []).find(x => x.id === r.vid);
      if (!f) return;
      f.stock = Math.max(0, r.counted);
      seq++;
      window.enqueueSync?.({ type: 'adjust', payload: { variantId: r.vid, value: f.stock,
        reason: 'ตรวจนับโซน ' + zoneOf(r.code) + ' ระบบ ' + r.system + ' → นับได้ ' + r.counted,
        opRef: 'CNT-' + stamp + '-' + dev + '-' + seq } }, true);
    });
    db.stockCounts = db.stockCounts || [];
    db.stockCounts.push({ id: 'CNT-' + stamp, at: stamp, zone: zoneOf(diffs[0].code),
      changes: diffs.map(r => ({ variantId: r.vid, code: r.code, before: r.system, after: r.counted })) });
    window.persist?.();
    closeCount();
    window.renderStockTable?.();
    window.renderSaleHome?.();
    window.showToast?.(`บันทึกผลการนับ ${diffs.length} รายการแล้ว`);
    window.finishBulkSync?.('ตรวจนับ');
  }

})();
