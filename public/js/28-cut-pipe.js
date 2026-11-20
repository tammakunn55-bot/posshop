
// ---------- ตัดท่อเป็นเมตร + เศษแยกความยาว (ต้องรัน SQL PATCH 015) ----------
// เส้นเต็ม = หน่วยหลักเป็น "เส้น" ตั้งความยาวต่อเส้นและราคาต่อเมตร; ขายเป็นเมตรผ่านปุ่ม ✂️ → ระบบใช้เศษที่ยาวเท่ากัน
// หรือตัดจากเศษที่สั้นที่สุดที่ยาวพอ หรือตัดเส้นเต็ม แล้วเก็บเศษเป็นรุ่น "เศษ X ม." แยกความยาว (รวมเป็นเส้นไม่ได้)
(function () {
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Math.round((+n || 0) * 100) / 100).toFixed(2);
  const find = (pid, vid) => { const p = (window.db.products || {})[pid]; const v = p && (p.variants || []).find(x => x.id === vid); return { p, v }; };
  function dialog(html) {
    document.getElementById('cut-dlg')?.remove();
    const el = document.createElement('div');
    el.id = 'cut-dlg'; el.className = 'fixed inset-0 z-[300] bg-slate-900/70 flex items-center justify-center p-4';
    el.innerHTML = '<div class="bg-white w-full max-w-xs rounded-[1.5rem] p-5 shadow-2xl">' + html + '</div>';
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
    document.body.appendChild(el); return el;
  }
  const refresh = () => { ['renderProducts', 'renderSaleHome', 'renderStockTable'].forEach(f => { try { window[f]?.(); } catch (e) { } }); };

  window.openCutPipeSetup = function (pid, vid) {
    const { p, v } = find(pid, vid); if (!v) return;
    const el = dialog(`<h3 class="text-sm font-black mb-1">✂️ ตั้งค่าตัดท่อ</h3>
      <p class="text-[10px] text-slate-400 mb-3">${esc(p.name)} (${esc(v.sizeName || 'ปกติ')}) — สต็อกนับเป็น "เส้น" เศษที่เหลือจากการตัดจะเก็บแยกตามความยาว</p>
      <label class="text-[10px] text-slate-400">ความยาวต่อเส้น (เมตร)</label>
      <input id="cut-len" type="number" step="0.01" value="${+v.cutLength || ''}" placeholder="เช่น 4" class="w-full border p-2.5 rounded-xl text-xs font-bold mb-2">
      <label class="text-[10px] text-slate-400">ราคาขายต่อเมตร (บาท)</label>
      <input id="cut-ppm" type="number" step="0.01" value="${+v.cutPricePerM || ''}" placeholder="เช่น 20" class="w-full border p-2.5 rounded-xl text-xs font-bold mb-3">
      <div class="flex gap-2"><button id="cut-cancel" class="flex-1 py-2.5 bg-slate-100 rounded-xl text-xs font-bold">ยกเลิก</button>
      <button id="cut-save" class="flex-[2] py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold">บันทึก</button></div>`);
    el.querySelector('#cut-cancel').onclick = () => el.remove();
    el.querySelector('#cut-save').onclick = async () => {
      const len = parseFloat(el.querySelector('#cut-len').value), ppm = parseFloat(el.querySelector('#cut-ppm').value);
      if (!(len > 0) || !(ppm >= 0)) return window.showAlert?.('ข้อมูลไม่ครบ', 'กรอกความยาวต่อเส้นและราคาต่อเมตรให้ถูกต้อง', true);
      v.cutLength = len; v.cutPricePerM = ppm; if (!v.unit) v.unit = 'เส้น';
      window.persist?.(); el.remove(); refresh();
      window.showToast?.('บันทึกการตั้งค่าตัดท่อแล้ว');
      try { await window.syncProductsToSupabase?.(true); } catch (e) { console.warn(e); }
    };
  };

  window.openCutPipe = function (pid, vid) {
    const { p, v } = find(pid, vid); if (!v) return;
    if (!(+v.cutLength > 0)) return window.openCutPipeSetup(pid, vid);
    const rem = (p.variants || []).filter(x => x.parentVariantId && window.toUUID(x.parentVariantId) === window.toUUID(v.id) && +x.stock > 0)
      .sort((a, b) => a.pieceLength - b.pieceLength);
    const remHtml = rem.length ? '<div class="text-[10px] text-slate-500 mb-2">เศษที่มี: ' + rem.map(x => `${x.pieceLength} ม. × ${x.stock}`).join(' • ') + '</div>' : '';
    const el = dialog(`<h3 class="text-sm font-black mb-1">✂️ ตัดท่อขายเป็นเมตร</h3>
      <p class="text-[10px] text-slate-400 mb-2">${esc(p.name)} • เส้นละ ${v.cutLength} ม. • ฿${money(v.cutPricePerM)}/ม. • เส้นเต็มเหลือ ${v.stock}</p>${remHtml}
      <label class="text-[10px] text-slate-400">ลูกค้าต้องการกี่เมตร</label>
      <input id="cut-want" type="number" step="0.01" inputmode="decimal" class="w-full border p-2.5 rounded-xl text-sm font-black mb-1">
      <div id="cut-price" class="text-[11px] font-bold text-emerald-600 mb-3">ราคา ฿0.00</div>
      <div class="flex gap-2"><button id="cut-cancel" class="flex-1 py-2.5 bg-slate-100 rounded-xl text-xs font-bold">ยกเลิก</button>
      <button id="cut-go" class="flex-[2] py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold">✂️ ตัดและใส่ตะกร้า</button></div>`);
    const inp = el.querySelector('#cut-want'); setTimeout(() => inp.focus(), 50);
    inp.oninput = () => { el.querySelector('#cut-price').textContent = 'ราคา ฿' + money((parseFloat(inp.value) || 0) * (+v.cutPricePerM || 0)); };
    el.querySelector('#cut-cancel').onclick = () => el.remove();
    const go = el.querySelector('#cut-go');
    go.onclick = async () => {
      const L = Math.round((parseFloat(inp.value) || 0) * 1000) / 1000;
      if (!(L > 0)) return window.showAlert?.('ข้อมูลไม่ถูกต้อง', 'กรอกความยาวที่ต้องการ', true);
      if (L > +v.cutLength) return window.showAlert?.('ยาวเกินไป', `ความยาวต่อเส้น ${v.cutLength} เมตร`, true);
      const c = window.getSupabaseClient?.();
      if (!c || navigator.onLine === false) return window.showAlert?.('ต้องออนไลน์', 'การตัดท่อต้องบันทึกเศษบนเซิร์ฟเวอร์ ขณะออฟไลน์ตัดท่อไม่ได้', true);
      go.disabled = true; go.textContent = 'กำลังตัด…';
      try {
        try { await window.syncProductsToSupabase?.(true); } catch (e) { console.warn(e); }   // ให้เซิร์ฟเวอร์รู้ cut_length ก่อน
        const ref = 'cut-' + ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
        const { data, error } = await c.rpc('cut_stock', { p_full_variant: window.toUUID(v.id), p_length: L, p_op_ref: ref, p_session: window.posSessionToken?.() || null });
        if (error) throw error;
        (data.variants || []).forEach(row => {
          const lv = p.variants.find(x => window.toUUID(x.id) === row.id);
          const chg = (data.changes || []).find(x => x.id === row.id);
          if (lv) { if (chg) lv.stock = Math.round(((+lv.stock || 0) + chg.delta) * 10000) / 10000; }
          else p.variants.push({ id: row.id, sizeName: row.variant_name, unit: row.unit || 'ท่อน', cost: +row.cost_price || 0, price: +row.price || 0,
            stock: +row.stock_quantity || 0, minStock: 0, barcode: '', sku: '', _seeded: true, fractions: [], parentVariantId: row.parent_variant_id, pieceLength: +row.piece_length });
        });
        const piece = p.variants.find(x => window.toUUID(x.id) === data.piece_variant_id);
        window.persist?.(); el.remove(); refresh();
        if (piece) window.addUnifiedToCart(pid, piece.id, null);
        const msg = data.action === 'USE_EXISTING' ? 'ใช้เศษที่มีอยู่' : data.action === 'CUT_REMNANT' ? 'ตัดจากเศษแล้ว' : 'ตัดจากเส้นเต็มแล้ว';
        window.showToast?.(`${msg} ${L} ม.` + (data.remainder_variant_id ? ' (เหลือเศษเก็บไว้)' : ''));
      } catch (e) {
        go.disabled = false; go.textContent = '✂️ ตัดและใส่ตะกร้า';
        const m = String((e && e.message) || e);
        window.showAlert?.('ตัดท่อไม่สำเร็จ', /cut_stock|schema cache|does not exist/i.test(m) ? 'ฐานข้อมูลยังไม่มีฟังก์ชันตัดท่อ กรุณารัน SQL PATCH 015 ก่อน' : m, true);
      }
    };
  };
})();
