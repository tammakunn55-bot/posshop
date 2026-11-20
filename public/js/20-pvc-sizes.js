
(function () {
  'use strict';
  const esc = s => (window.escapeHTML ? window.escapeHTML(s) : String(s == null ? '' : s));
  // ขนาดมาตรฐานของท่อ/ข้อต่อ PVC เรียงจากเล็กไปใหญ่
  const STD = ['4 หุน (1/2")', '6 หุน (3/4")', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '4"'];
  function sizeKey(name) {
    const s = String(name || '').trim();
    if (s.startsWith('4 หุน')) return 0.5;
    if (s.startsWith('6 หุน')) return 0.75;
    const m = s.match(/^(\d+)?(?:[\s-]+(\d+)\/(\d+))?\s*"?/);
    if (!m) return 999;
    const whole = m[1] ? +m[1] : 0;
    const frac = m[2] && m[3] ? +m[2] / +m[3] : 0;
    return whole + frac || 999;
  }
  function ensureModal() {
    let m = document.getElementById('pos-addsize-modal'); if (m) return m;
    m = document.createElement('div'); m.id = 'pos-addsize-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9996;background:rgba(15,23,42,.6);padding:12px;overflow:auto';
    m.innerHTML = '<div style="max-width:820px;margin:12px auto;background:#fff;border-radius:16px;padding:16px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b id="pas-title" style="font-size:17px"></b>' +
      '<button id="pas-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ปิด</button></div>' +
      '<div style="font-size:13px;font-weight:700;margin:8px 0 4px">ขนาดที่มีอยู่ (แก้ไขหรือลบได้)</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tbody id="pas-existing"></tbody></table></div>' +
      '<div style="font-size:13px;font-weight:700;margin:12px 0 4px">เพิ่มขนาดมาตรฐาน (ติ๊กเลือก)</div>' +
      '<div id="pas-std" style="display:flex;flex-wrap:wrap;gap:6px"></div>' +
      '<div style="font-size:13px;font-weight:700;margin:12px 0 4px">เพิ่มขนาดอื่น</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><tbody id="pas-rows"></tbody></table>' +
      '<button id="pas-add-row" style="margin-top:6px;padding:8px 12px;border-radius:10px;border:1px dashed #94a3b8;background:#fff;font-weight:700">+ เพิ่มแถว</button>' +
      '<div id="pas-msg" style="color:#b91c1c;font-size:13px;margin-top:8px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button id="pas-save" style="flex:1;padding:12px;border-radius:12px;border:0;background:#4f46e5;color:#fff;font-weight:800">✔ บันทึกการเปลี่ยนแปลง</button>' +
      '<button id="pas-cancel" style="padding:12px;border-radius:12px;border:0;background:#e2e8f0;font-weight:700">ยกเลิก</button></div></div>';
    document.body.appendChild(m);
    const close = () => { m.style.display = 'none'; };
    document.getElementById('pas-close').onclick = close;
    document.getElementById('pas-cancel').onclick = close;
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.getElementById('pas-add-row').onclick = () => addRow({});
    document.getElementById('pas-save').onclick = save;
    return m;
  }
  const INP = 'width:100%;box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:8px';
  function addRow(d) {
    const tr = document.createElement('tr'); tr.style.borderTop = '1px solid #e2e8f0';
    tr.innerHTML = `<td style="padding:4px"><input class="pas-size" value="${esc(d.size || '')}" placeholder="เช่น 1-1/2&quot;" style="${INP}"></td>` +
      `<td><input class="pas-cost" type="number" value="${d.cost ?? ''}" placeholder="ทุน" style="${INP}"></td>` +
      `<td><input class="pas-price" type="number" value="${d.price ?? ''}" placeholder="ขาย" style="${INP}"></td>` +
      `<td><input class="pas-stock" type="number" value="${d.stock ?? 10}" style="${INP}"></td>` +
      `<td><input class="pas-min" type="number" value="${d.min ?? 3}" style="${INP}"></td>` +
      `<td><button class="pas-del" style="border:0;background:#fee2e2;color:#991b1b;border-radius:8px;padding:6px 10px;font-weight:700">ลบ</button></td>`;
    tr.querySelector('.pas-del').onclick = () => tr.remove();
    document.getElementById('pas-rows').appendChild(tr);
  }
  function render(p) {
    // ขนาดที่มีอยู่ เรียงตามลำดับขนาด
    const ex = (p.variants || []).slice().sort((a, b) => sizeKey(a.sizeName) - sizeKey(b.sizeName));
    const exEl = document.getElementById('pas-existing'); exEl.innerHTML = '';
    ex.forEach(v => {
      const tr = document.createElement('tr'); tr.dataset.vid = v.id; tr.style.borderTop = '1px solid #e2e8f0';
      tr.innerHTML = `<td style="padding:4px"><input class="e-size" value="${esc(v.sizeName || 'ปกติ')}" style="${INP}"></td>` +
        `<td><input class="e-cost" type="number" value="${v.cost ?? 0}" style="${INP}"></td>` +
        `<td><input class="e-price" type="number" value="${v.price ?? 0}" style="${INP}"></td>` +
        `<td><input class="e-stock" type="number" value="${v.stock ?? 0}" style="${INP}"></td>` +
        `<td><input class="e-min" type="number" value="${v.minStock ?? 0}" style="${INP}"></td>` +
        `<td style="white-space:nowrap"><img class="e-thumb" src="" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;vertical-align:middle;background:#f8fafc"> <button class="e-img" style="border:0;background:#e0e7ff;color:#3730a3;border-radius:8px;padding:6px 8px;font-weight:700">🖼️</button></td>` +
        `<td><button class="e-del" style="border:0;background:#fee2e2;color:#991b1b;border-radius:8px;padding:6px 10px;font-weight:700">ลบ</button></td>`;
      tr.querySelector('.e-del').onclick = () => { tr.dataset.delete = tr.dataset.delete === '1' ? '' : '1'; tr.style.opacity = tr.dataset.delete ? '.4' : '1'; };
      tr.dataset.img = v.imageUrl || '';
      setThumb(tr);
      tr.querySelector('.e-img').onclick = () => pickImage(tr);
      exEl.appendChild(tr);
    });
    // ปุ่มขนาดมาตรฐาน: ตั้งติ๊กไว้เฉพาะที่ยังไม่มี
    const have = new Set((p.variants || []).map(v => (v.sizeName || '').trim()));
    const stdEl = document.getElementById('pas-std'); stdEl.innerHTML = '';
    STD.forEach(sz => {
      const lb = document.createElement('label');
      lb.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px';
      const has = have.has(sz);
      lb.innerHTML = `<input type="checkbox" class="std-chk" value="${esc(sz)}" ${has ? 'disabled' : ''}> ${esc(sz)}${has ? ' ✓มีแล้ว' : ''}`;
      lb.querySelector('input').onchange = (e) => { if (e.target.checked) { addRow({ size: sz }); e.target.checked = false; e.target.disabled = true; } };
      stdEl.appendChild(lb);
    });
  }

  function setThumb(tr) {
    if (typeof tr.onPick === 'function') tr.onPick(tr.dataset.img || '');
    const img = tr.querySelector('.e-thumb'); if (!img) return;
    if (tr.dataset.img) { img.src = tr.dataset.img; img.style.display = ''; } else { img.removeAttribute('src'); img.style.display = 'none'; }
  }
  function ensurePicker() {
    let m = document.getElementById('pos-imgpick'); if (m) return m;
    m = document.createElement('div'); m.id = 'pos-imgpick';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.6);padding:12px;overflow:auto';
    m.innerHTML = '<div style="max-width:720px;margin:12px auto;background:#fff;border-radius:16px;padding:14px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">🖼️ เลือกรูปของขนาดนี้</b><button id="pip-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ปิด</button></div>' +
      '<div style="margin:10px 0;display:flex;gap:6px;align-items:center"><input id="pip-q" placeholder="ค้นหาชื่อไฟล์หรือรหัส" style="flex:1;padding:9px;border:1px solid #cbd5e1;border-radius:10px;min-height:40px">' +
      '<label style="padding:9px 12px;background:#4f46e5;color:#fff;border-radius:10px;font-weight:700;cursor:pointer">📷 อัปโหลด<input id="pip-file" type="file" accept="image/*" style="display:none"></label></div>' +
      '<div id="pip-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:58vh;overflow:auto"></div>' +
      '<div id="pip-msg" style="font-size:13px;color:#b91c1c;margin-top:6px"></div>' +
      '<button id="pip-clear" style="margin-top:10px;width:100%;padding:12px;border-radius:12px;border:0;background:#fee2e2;color:#991b1b;font-weight:800">ลบรูปของขนาดนี้</button></div>';
    document.body.appendChild(m);
    document.getElementById('pip-close').onclick = () => { m.style.display = 'none'; };
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    return m;
  }
  let _pickTr = null, _pickFiles = [];
  function urlOf(name) {
    const c = window.getSupabaseClient?.(); if (!c) return null;
    return c.storage.from('product-images').getPublicUrl(name).data.publicUrl;
  }
  function renderPickGrid(q) {
    const grid = document.getElementById('pip-grid'); grid.innerHTML = '';
    const term = (q || '').trim().toLowerCase();
    _pickFiles.filter(f => !term || f.name.toLowerCase().includes(term)).slice(0, 1000).forEach(f => {
      const url = urlOf(f.name); if (!url) return;
      const b = document.createElement('button'); b.type = 'button';
      b.style.cssText = 'border:2px solid ' + (_pickTr && _pickTr.dataset.img === url ? '#4f46e5' : '#e2e8f0') + ';border-radius:10px;padding:4px;background:#fff';
      b.innerHTML = '<img src="' + url + '" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px"><div style="font-size:10px;word-break:break-all;color:#475569">' + esc(f.name) + '</div>';
      b.onclick = () => { _pickTr.dataset.img = url; setThumb(_pickTr); ensurePicker().style.display = 'none'; };
      grid.appendChild(b);
    });
  }
  async function pickImage(tr) {
    _pickTr = tr;
    const m = ensurePicker(); m.style.display = 'block';
    const msg = document.getElementById('pip-msg'); msg.textContent = 'กำลังโหลดคลังรูป...';
    const c = window.getSupabaseClient?.();
    try {
      // ดึงทุกหน้า (Storage ส่งทีละไม่เกิน 1000 รายการ)
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await c.storage.from('product-images').list('', { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
        msg.textContent = `กำลังโหลดคลังรูป... ${all.length} ไฟล์`;
      }
      _pickFiles = all.filter(f => f.name && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
      msg.textContent = `คลังรูป ${_pickFiles.length} ไฟล์`;
    } catch (e) { _pickFiles = []; msg.textContent = 'โหลดคลังรูปไม่ได้: ' + (e.message || e); }
    renderPickGrid('');
    document.getElementById('pip-q').oninput = e => renderPickGrid(e.target.value);
    document.getElementById('pip-clear').onclick = () => { tr.dataset.img = ''; setThumb(tr); m.style.display = 'none'; };
    document.getElementById('pip-file').onchange = async e => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const c2 = window.getSupabaseClient?.();
      msg.textContent = 'กำลังอัปโหลด...';
      const name = `size-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      try {
        const { error } = await c2.storage.from('product-images').upload(name, file, { contentType: file.type || 'image/jpeg', upsert: false });
        if (error) throw error;
        tr.dataset.img = urlOf(name); setThumb(tr); m.style.display = 'none';
      } catch (err) { msg.textContent = 'อัปโหลดไม่สำเร็จ: ' + (err.message || err); }
    };
  }

  window.posPickImage = pickImage;
  function selectedPid() {
    const ids = (typeof selectedProductIds !== 'undefined' && selectedProductIds) ? Array.from(selectedProductIds) : [];
    return ids.length === 1 ? ids[0] : null;
  }
  window.openAddSizes = function () {
    if (!window.canDo || !window.canDo('PRODUCT_EDIT')) return window.posDenied?.('PRODUCT_EDIT');
    const pid = selectedPid();
    if (!pid) return window.showAlert?.('เลือกไม่ถูกต้อง', 'เลือกสินค้า 1 รายการ แล้วกดเพิ่มขนาด', true);
    const p = db.products[pid]; if (!p) return;
    const m = ensureModal();
    document.getElementById('pas-title').textContent = '📐 ขนาดของ: ' + p.name;
    document.getElementById('pas-rows').innerHTML = '';
    document.getElementById('pas-msg').textContent = '';
    render(p);
    m.style.display = 'block';
  };
  function save() {
    const pid = selectedPid(); if (!pid) return;
    const p = db.products[pid]; if (!p) return;
    const msg = document.getElementById('pas-msg');
    const num = (el, def) => { const x = parseFloat(el.value); return isNaN(x) ? def : x; };
    // 1) แถวที่มีอยู่: แก้ไข หรือ ลบ
    const keep = [];
    const exRows = Array.from(document.querySelectorAll('#pas-existing tr'));
    for (const tr of exRows) {
      const v = (p.variants || []).find(x => x.id === tr.dataset.vid); if (!v) continue;
      if (tr.dataset.delete === '1') continue;
      const size = tr.querySelector('.e-size').value.trim() || 'ปกติ';
      const price = num(tr.querySelector('.e-price'), 0);
      if (!(price > 0)) { msg.textContent = `ขนาด "${size}" ต้องมีราคาขายมากกว่า 0`; return; }
      v.sizeName = size; v.cost = num(tr.querySelector('.e-cost'), 0); v.price = price;
      v.stock = num(tr.querySelector('.e-stock'), 0); v.minStock = num(tr.querySelector('.e-min'), 0);
      if (tr.dataset.img !== undefined) v.imageUrl = tr.dataset.img || null;
      keep.push(v);
    }
    const deleting = exRows.filter(tr => tr.dataset.delete === '1').map(tr => tr.dataset.vid);
    if (deleting.length && keep.length === 0) { msg.textContent = 'ต้องเหลือขนาดอย่างน้อย 1 รายการ'; return; }
    // 2) แถวใหม่: ติ๊กมาตรฐาน + แถวอื่น
    const names = new Set(keep.map(v => (v.sizeName || '').trim().toLowerCase()));
    const add = [];
    const pushNew = (size, cost, price, stock, min) => {
      const k = size.toLowerCase();
      if (!size) { msg.textContent = 'ทุกแถวต้องมีชื่อขนาด'; return false; }
      if (names.has(k)) { msg.textContent = `ขนาด "${size}" ซ้ำ`; return false; }
      if (!(price > 0)) { msg.textContent = `ขนาด "${size}" ต้องมีราคาขายมากกว่า 0`; return false; }
      names.add(k);
      add.push({ id: 'v-' + Date.now() + '-' + add.length + '-' + Math.random().toString(36).slice(2, 5), sizeName: size,
        unit: p.unit || 'ชิ้น', barcode: '', cost: cost || 0, price, stock: stock ?? 10, minStock: min ?? 3, fractions: [] });
      return true;
    };
    for (const tr of document.querySelectorAll('#pas-rows tr')) {
      const size = tr.querySelector('.pas-size').value.trim();
      if (!size && !tr.querySelector('.pas-price').value) continue;
      if (!pushNew(size, num(tr.querySelector('.pas-cost'), 0), num(tr.querySelector('.pas-price'), 0),
        num(tr.querySelector('.pas-stock'), 10), num(tr.querySelector('.pas-min'), 3))) return;
    }
    // 3) เขียนลงสินค้า แล้วเรียงตามลำดับขนาด
    p.variants = keep.concat(add).sort((a, b) => sizeKey(a.sizeName) - sizeKey(b.sizeName));
    window.persist?.();
    document.getElementById('pos-addsize-modal').style.display = 'none';
    window.renderStockTable?.();
    window.showToast?.(`บันทึกแล้ว: เพิ่ม ${add.length} ลบ ${deleting.length} ขนาดของ "${p.name}"`);
    window.syncProductsToSupabase?.(true).catch(e => console.warn('sizes sync', e));
  }
  function ensureButton() {
    const bar = document.getElementById('stock-bulk-toolbar');
    if (!bar || document.getElementById('pos-addsize-btn')) return;
    const b = document.createElement('button'); b.id = 'pos-addsize-btn';
    b.className = 'text-xs font-bold bg-white border px-3 py-1.5 rounded-lg btn-touch';
    b.textContent = '📐 ขนาด (เพิ่ม/แก้/ลบ)';
    b.onclick = () => window.openAddSizes();
    bar.appendChild(b);
  }
  posHooks.on('stock:render', ensureButton);
  document.addEventListener('DOMContentLoaded', ensureButton);
  if (document.readyState !== 'loading') ensureButton();
})();
