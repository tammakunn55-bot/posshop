
/* ==========================================
   DATA HEALTH CHECK (ตรวจสุขภาพข้อมูล) — สแกนหาความผิดปกติทั้งในเครื่องและบน Supabase
   Storage แล้วรายงานให้ดู ไม่แก้อะไรให้อัตโนมัติ (ป้องกันลบ/แก้ข้อมูลผิดโดยไม่ตั้งใจ)
   ========================================== */
(function(){
  function esc3(v){ return window.escapeHTML ? window.escapeHTML(v) : String(v ?? ''); }

  function issueCard(level, title, count, detail, fixAction, fixes){
    const style = level === 'error'
      ? 'bg-rose-50 border-rose-200 text-rose-700'
      : level === 'warn'
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-slate-50 border-slate-200 text-slate-600';
    const icon = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : 'ℹ️';
    const btns = [];
    // esc3 ทำให้เครื่องหมาย " ในคำสั่งกลายเป็น &quot; ปลอดภัยใน attribute (เดิม JSON ids ทำให้ปุ่มใช้ไม่ได้)
    if (fixAction) btns.push(`<button onclick="${esc3(fixAction)}" class="bg-white border rounded-lg px-2 py-1 text-[10px] font-bold hover:bg-slate-100 btn-touch">🧹 ล้างลิงก์ที่เสีย</button>`);
    (fixes || []).forEach(f => btns.push(`<button onclick="window.healthFix('${f.key}')" class="bg-white border rounded-lg px-2 py-1 text-[10px] font-bold hover:bg-slate-100 btn-touch">${esc3(f.label)}</button>`));
    return `<div class="border rounded-xl p-3 text-xs ${style}">
      <div class="flex justify-between items-start font-bold gap-2">
        <span>${icon} ${esc3(title)}</span>
        <span class="flex-none text-right whitespace-nowrap">${count} รายการ</span>
      </div>
      <div class="text-[10px] mt-1 opacity-80 leading-relaxed line-clamp-3 whitespace-pre-line">${esc3(detail)}</div>
      ${btns.length ? `<div class="flex flex-wrap gap-1.5 mt-2">${btns.join('')}</div>` : ''}
    </div>`;
  }

  // ล้างเฉพาะ "ลิงก์รูปที่เสีย" ทิ้ง (imageUrl) ของสินค้าที่ระบุ — ไม่แตะข้อมูลอื่นของสินค้าเลย ตัว
  // สินค้ายังอยู่ครบทุกอย่าง (ชื่อ ราคา สต็อก) แค่กลับไปโชว์ไอคอนแทนรูปที่เสีย อัปโหลดรูปใหม่ทีหลังได้
  // ปกติ ใช้ร่วมกันได้ทั้ง 2 กรณีที่ตรวจพบ: blob: URL ที่ตายแน่นอนหลัง reload, และรูปที่ยืนยันแล้วว่า
  // ไม่มีอยู่จริงบน Supabase Storage อีกต่อไป (ถูกลบไปหรือ path ผิด)
  // ---------- ปุ่มแก้ไขจากหน้าตรวจข้อมูล (ทุกอย่างมี confirm และบอกผลกระทบก่อนแก้) ----------
  window.healthFix = function(key){
    if (!window.canDo?.('ALL') && key !== 'sync-now') return window.showAlert?.('ไม่มีสิทธิ์', 'เฉพาะเจ้าของร้านเท่านั้นที่แก้ข้อมูลจากหน้านี้ได้', true);
    const save = () => { window.persist?.(); window.syncProductsToSupabase?.(true); };
    const finish = msg => { window.showToast?.(msg); window.runDataHealthCheck?.(); };
    const products = Object.values(db.products || {});
    if (key === 'neg-stock') {
      const targets = []; products.forEach(p => (p.variants || []).forEach(v => { if ((+v.stock || 0) < 0) targets.push(v); }));
      if (!targets.length) return finish('ไม่มีสต็อกติดลบแล้ว');
      if (!confirm(`ตั้งสต็อก ${targets.length} รายการที่ติดลบให้เป็น 0?\n\nนี่เป็นการปรับตัวเลขให้ตรงกับความจริงชั่วคราว ควรนับสินค้าจริงแล้วปรับให้ตรงภายหลัง`)) return;
      targets.forEach(v => { v.stock = 0; }); save(); return finish(`ตั้งสต็อกเป็น 0 แล้ว ${targets.length} รายการ`);
    }
    if (key === 'dup-sku') {
      const groups = {};
      products.forEach(p => { if (p.code) (groups[String(p.code).trim().toLowerCase()] ||= []).push(p); });
      const dups = Object.values(groups).filter(g => g.length > 1);
      if (!dups.length) return finish('ไม่มีรหัสซ้ำแล้ว');
      const taken = new Set(products.map(p => String(p.code || '').trim().toLowerCase()));
      const plan = [];
      dups.forEach(g => g.slice(1).forEach(p => {
        const size = String((p.variants || [])[0]?.sizeName || '').replace(/[^0-9A-Za-z\u0E00-\u0E7F.]/g, '') || 'X';
        let code = `${p.code}-${size}`, n = 2;
        while (taken.has(code.toLowerCase())) code = `${p.code}-${size}-${n++}`;
        taken.add(code.toLowerCase()); plan.push([p, code]);
      }));
      if (!confirm(`เปลี่ยนรหัสสินค้า ${plan.length} รายการที่ซ้ำ เช่น\n${plan.slice(0, 5).map(([p, c]) => `• ${p.name}: ${p.code} → ${c}`).join('\n')}\n\nถ้าใช้รหัสนี้ในบาร์โค้ดหรือป้ายราคาอยู่ ต้องแก้ตามด้วย ดำเนินการต่อ?`)) return;
      plan.forEach(([p, c]) => { p.code = c; }); save(); return finish(`เปลี่ยนรหัสซ้ำแล้ว ${plan.length} รายการ`);
    }
    if (key === 'fill-cost') {
      let n = 0;
      products.forEach(p => (p.variants || []).forEach(v => { if (!(+v.cost > 0) && +v.price > 0) { v.cost = Math.round(+v.price * 0.8 * 100) / 100; n++; } }));
      if (!n) return finish('ทุกขนาดมีราคาทุนแล้ว');
      if (!confirm(`ตั้งราคาทุนประมาณ 80% ของราคาขาย ${n} ขนาด?\n\nเป็นค่าประมาณเพื่อให้กำไรไม่ว่างเปล่า ควรแก้เป็นราคาทุนจริงเมื่อรับของครั้งถัดไป`)) return;
      save(); return finish(`ตั้งราคาทุนประมาณแล้ว ${n} ขนาด`);
    }
    if (key === 'orphan-customer') {
      const ids = new Set(Object.keys(db.customers || {}));
      const bills = (db.bills || []).filter(b => b.customerId && b.customerId !== 'GENERAL' && !ids.has(b.customerId));
      if (!bills.length) return finish('ไม่มีบิลที่อ้างลูกค้าที่ไม่มีแล้ว');
      if (!confirm(`ย้าย ${bills.length} บิลไปเป็น "ลูกค้าทั่วไป"?\n\nบิลเหล่านี้จะไม่ถูกนับในยอดค้างของลูกค้าคนใดคนหนึ่งอีก (ถ้าเป็นบิลขายเชื่อ ให้ตรวจยอดหนี้ก่อน)`)) return;
      bills.forEach(b => { b.customerId = 'GENERAL'; }); save(); return finish(`ย้ายบิลแล้ว ${bills.length} บิล`);
    }
    if (key === 'cash-adjust') return window.healthFixCashAdjust();
    if (key === 'debt-recalc') return window.healthFixDebt();
    if (key === 'sync-now') {
      if (!window.flushSyncQueue) return window.showAlert?.('ส่งไม่ได้', 'ยังไม่ได้เชื่อมต่อ Supabase', true);
      window.flushSyncQueue(false);
      setTimeout(() => finish('สั่งส่งข้อมูลที่ค้างแล้ว'), 1500);
      return;
    }
  };

  // ปรับยอดเงินสดของกะให้ตรงกับที่นับได้ ด้วยรายการปรับ (movement) ที่มีเหตุผล — ไม่แก้ยอดขายเดิม
  // ผลคือยอดคาดหวังของกะเท่ากับยอดที่นับ และประวัติยังเห็นว่ามีการปรับ
  window.healthFixCashAdjust = function(){
    if (typeof window.computeShiftSummary !== 'function') return;
    const todo = (db.shifts || []).filter(s => s.endTime && s.cashOnHand != null).map(s => {
      const sum = window.computeShiftSummary(s);
      return { s, diff: Math.round(((+s.cashOnHand || 0) - (+sum.expectedCash || 0)) * 100) / 100 };
    }).filter(x => Math.abs(x.diff) > 0.5);
    if (!todo.length) return window.runDataHealthCheck?.();
    const reason = prompt(`ปรับยอดเงินสด ${todo.length} กะให้ตรงกับที่นับ\nกรอกเหตุผล (จำเป็น):`, '');
    if (!reason || !reason.trim()) return;
    if (!confirm(`ยืนยันการปรับ ${todo.length} กะ?\nรายการปรับจะถูกบันทึกในประวัติกะ ไม่ลบยอดขายเดิม`)) return;
    todo.forEach(({ s, diff }) => {
      s.movements = s.movements || [];
      s.movements.push({ id: 'ADJ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), type: diff > 0 ? 'IN' : 'OUT', amount: Math.abs(diff), description: 'ปรับยอดตามการนับ: ' + reason.trim(), time: Date.now(), isAdjustment: true });
    });
    window.persist?.(); window.syncProductsToSupabase?.(true);
    window.showToast?.(`ปรับยอดเงินสด ${todo.length} กะแล้ว`);
    window.runDataHealthCheck?.();
  };

  // ปรับยอดหนี้ลูกค้าให้ตรงกับประวัติบิลขายเชื่อและการชำระ (แสดงค่าเดิม/ค่าใหม่ก่อนยืนยัน)
  window.healthFixDebt = function(){
    const expectedDebtOf = cid => {
      const bills = (db.bills || []).filter(b => b.customerId === cid && b.method === 'CREDIT');
      const ids = new Set(bills.map(b => b.id));
      const credit = bills.reduce((s, b) => s + (+b.total || 0), 0);
      const debtReturns = (db.returns || []).filter(r => r.isDebtReduction && ids.has(r.billId)).reduce((s, r) => s + (+r.amount || 0), 0);
      const paid = (db.cashLedger || []).filter(x => x.type === 'cash-in-ar' && x.refId === cid).reduce((s, x) => s + (+x.income || 0), 0);
      return Math.round((credit - debtReturns - paid) * 100) / 100;
    };
    const plan = Object.values(db.customers || {}).filter(c => !c._debtSeeded).map(c => ({ c, from: +c.debt || 0, to: expectedDebtOf(c.id) })).filter(x => Math.abs(x.from - x.to) > 0.5);
    if (!plan.length) return window.runDataHealthCheck?.();
    if (!confirm(`ปรับยอดหนี้ ${plan.length} ราย ให้ตรงกับประวัติบิล เช่น\n${plan.slice(0, 5).map(x => `• ${x.c.name}: ${x.from} → ${x.to}`).join('\n')}\n\nดำเนินการต่อ?`)) return;
    plan.forEach(x => { x.c.debt = x.to; x.c._debtAdjusted = Date.now(); });
    window.persist?.(); window.syncProductsToSupabase?.(true);
    window.showToast?.(`ปรับยอดหนี้ ${plan.length} รายการแล้ว`);
    window.runDataHealthCheck?.();
  };

  window.clearBrokenImageLinks = function(ids){
    if (!confirm(`ล้างลิงก์รูปที่เสียออกจากสินค้า ${ids.length} รายการ?\n\nสินค้ายังอยู่ครบเหมือนเดิมทุกอย่าง แค่เอารูปที่เสียออก จะกลับไปโชว์ไอคอนสินค้าเฉยๆ แทน — อัปโหลดรูปใหม่ทีหลังได้ตามปกติ`)) return;
    let cleared = 0;
    ids.forEach(id => { const p = db.products[id]; if (p) { p.imageUrl = null; cleared++; } });
    window.persist?.();
    window.syncProductsToSupabase?.(true);
    window.showToast?.(`ล้างลิงก์รูปที่เสียแล้ว ${cleared} รายการ`);
    window.runDataHealthCheck(); // รันเช็คใหม่ให้เห็นผลทันทีว่ารายการนี้หายไปแล้ว
  };

  // เพิ่มขึ้นมา: การ์ดพิเศษสำหรับ "รูปกำพร้าบน Supabase Storage" ที่มีปุ่มลบให้กดตรงนี้ได้เลย
  // แทนที่จะแค่รายงานชื่อไฟล์ไว้เฉยๆ แล้วให้ไปลบเองที่ Supabase Dashboard — เก็บรายชื่อไฟล์ไว้ใน
  // window._orphanImages เพื่อให้ deleteOrphanImage อ้างอิงด้วย index (ไม่ใช้ชื่อไฟล์ตรงๆ ใน
  // onclick กันปัญหาอักขระพิเศษในชื่อไฟล์ทำให้ HTML/JS พัง)
  function orphanImageCard(title, files){
    window._orphanImages = files.slice();
    if (!files.length) return `<div class="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-center text-[11px] font-bold" id="orphan-images-empty">✅ ลบรูปกำพร้าหมดแล้ว</div>`;
    const rows = files.map((name, idx) => `
      <div class="flex items-center justify-between gap-2 bg-white border rounded-lg px-2 py-1.5">
        <span class="text-[10px] text-slate-600 break-all flex-1">${esc3(name)}</span>
        <button onclick="window.deleteOrphanImage(${idx})" class="text-rose-500 text-[10px] font-bold px-2 py-1 hover:bg-rose-50 rounded btn-touch flex-none">🗑️ ลบ</button>
      </div>`).join('');
    return `<div class="border rounded-xl p-3 text-xs bg-slate-50 border-slate-200 text-slate-600" id="orphan-images-card">
      <div class="flex justify-between items-center font-bold mb-2 gap-2">
        <span>ℹ️ ${esc3(title)}</span>
        <button onclick="window.deleteAllOrphanImages()" class="text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 text-[10px] font-bold hover:bg-rose-100 btn-touch flex-none whitespace-nowrap">🗑️ ลบทั้งหมด (${files.length})</button>
      </div>
      <div class="space-y-1 max-h-48 overflow-y-auto">${rows}</div>
    </div>`;
  }

  window.renderOrphanImagesCard = function(){
    const card = document.getElementById('orphan-images-card');
    if (!card) return;
    card.outerHTML = orphanImageCard('รูปภาพบน Supabase Storage ที่ไม่มีสินค้าตัวไหนอ้างอิงแล้ว (ลบได้เพื่อประหยัดพื้นที่)', window._orphanImages || []);
  };

  window.deleteOrphanImage = async function(idx){
    const name = (window._orphanImages || [])[idx];
    if (!name) return;
    if (!confirm(`ลบไฟล์รูป "${name}" ออกจาก Supabase Storage ถาวร?\n\nการลบนี้ย้อนกลับไม่ได้`)) return;
    const client = window.getSupabaseClient?.();
    if (!client) return window.showAlert?.('ยังไม่ได้เชื่อมต่อ', 'ต้องเชื่อมต่อ Supabase ก่อนถึงจะลบรูปได้', true);
    try {
      const { error } = await client.storage.from('product-images').remove([name]);
      if (error) throw error;
      window._orphanImages = (window._orphanImages || []).filter(f => f !== name);
      window.renderOrphanImagesCard();
      window.showToast?.(`ลบไฟล์ "${name}" เรียบร้อย`);
    } catch (e) {
      console.error('delete orphan image failed', e);
      window.showAlert?.('ลบไม่สำเร็จ', String(e.message || e), true);
    }
  };

  window.deleteAllOrphanImages = async function(){
    const files = (window._orphanImages || []).slice();
    if (!files.length) return;
    if (!confirm(`ลบไฟล์รูปกำพร้าทั้งหมด ${files.length} ไฟล์ออกจาก Supabase Storage ถาวร?\n\nการลบนี้ย้อนกลับไม่ได้`)) return;
    const client = window.getSupabaseClient?.();
    if (!client) return window.showAlert?.('ยังไม่ได้เชื่อมต่อ', 'ต้องเชื่อมต่อ Supabase ก่อนถึงจะลบรูปได้', true);

    const CHUNK = 100;
    const failed = [];
    let doneCount = 0;
    const btn = document.querySelector('#orphan-images-card button[onclick="window.deleteAllOrphanImages()"]');
    for (let i = 0; i < files.length; i += CHUNK) {
      const chunk = files.slice(i, i + CHUNK);
      try {
        const { error } = await client.storage.from('product-images').remove(chunk);
        if (error) throw error;
        doneCount += chunk.length;
      } catch (e) {
        console.warn('orphan image chunk delete failed', e);
        failed.push(...chunk);
      }
      if (btn) btn.textContent = `🔄 กำลังลบ... ${doneCount + failed.length}/${files.length}`;
    }

    window._orphanImages = failed;
    window.renderOrphanImagesCard();
    if (failed.length) {
      window.showAlert?.('ลบไม่สำเร็จบางส่วน', `ลบสำเร็จ ${doneCount}/${files.length} ไฟล์ — เหลือ ${failed.length} ไฟล์ที่ลบไม่สำเร็จ (ยังอยู่ในรายการด้านล่าง กด "ลบทั้งหมด" อีกครั้งเพื่อลองใหม่เฉพาะไฟล์ที่เหลือได้)`, true);
    } else {
      window.showToast?.(`ลบรูปกำพร้าทั้งหมด ${files.length} ไฟล์เรียบร้อย`);
    }
  };

  window.runDataHealthCheck = async function(){
    const el = document.getElementById('health-check-results');
    if (!el) return;
    el.innerHTML = `<p class="text-center text-slate-400 font-bold py-4">🔄 กำลังตรวจสอบ...</p>`;
    try { await runHealthChecksInner(el); }
    catch (e) { console.error('health check failed', e); el.innerHTML = `<div class="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-xs font-bold">❌ ตรวจข้อมูลไม่สำเร็จ: ${esc3(String(e && e.message || e))}</div>`; }
  };
  async function runHealthChecksInner(el){

    const issues = [];
    const products = Object.values(db.products || {});

    // 1) ลิงก์รูปเสีย — เศษจากบัค URL.createObjectURL เก่า (ดู bulk image import) ที่ใช้ไม่ได้
    //    อีกต่อไปหลัง reload หน้าเว็บ ถ้ายังมีอยู่แปลว่าเป็นข้อมูลเก่าก่อนแก้บัคนี้
    const brokenImg = products.filter(p => p.imageUrl && p.imageUrl.startsWith('blob:'));
    if (brokenImg.length) issues.push({
      level: 'error', title: 'ลิงก์รูปภาพเสีย (blob: URL ที่ใช้ไม่ได้แล้ว)', count: brokenImg.length,
      detail: brokenImg.map(p => p.name).join(', '),
      fixAction: `window.clearBrokenImageLinks(${JSON.stringify(brokenImg.map(p => p.id))})`
    });

    // 2) สต็อกติดลบ — ปกติไม่ควรเกิดถ้าทุกจุดหักสต็อกถูกต้อง แปลว่ามีจุดหักซ้ำ/ข้ามการเช็คที่ไหนสักแห่ง
    const negStock = [];
    products.forEach(p => (p.variants || []).forEach(v => { if ((+v.stock || 0) < 0) negStock.push(`${escapeHTML(p.name)} (${escapeHTML(v.sizeName || '-')}): ${v.stock}`); }));
    if (negStock.length) issues.push({ level: 'error', title: 'สต็อกติดลบ', count: negStock.length, detail: negStock.join(', ') });

    // 3) บาร์โค้ดซ้ำกันระหว่างสินค้าคนละตัว — สแกนบาร์โค้ดตอนขายจะสุ่มหยิบตัวใดตัวหนึ่งผิดได้
    const barcodeMap = {};
    products.forEach(p => (p.variants || []).forEach(v => { if (v.barcode) (barcodeMap[String(v.barcode).trim()] ||= []).push(`${p.name}${v.sizeName ? ' ' + v.sizeName : ''}`); }));
    const dupBarcodes = Object.entries(barcodeMap).filter(([, owners]) => owners.length > 1);
    if (dupBarcodes.length) issues.push({ level: 'error', title: 'บาร์โค้ดซ้ำ (สแกนแล้วระบบอาจเลือกสินค้าผิดตัว)', count: dupBarcodes.length, detail: dupBarcodes.map(([bc, owners]) => `${bc}: ${owners.join(' / ')}`).join('\n') });

    // 3b) รหัสสินค้า (SKU) ซ้ำ และ SKU ของขนาด (variant) ซ้ำ — นำเข้า/ซิงก์จะเขียนทับกัน
    const codeMap = {}, vskuMap = {};
    products.forEach(p => {
      if (p.code) (codeMap[String(p.code).trim().toLowerCase()] ||= []).push(p.name);
      (p.variants || []).forEach(v => { if (v.sku) (vskuMap[String(v.sku).trim().toLowerCase()] ||= []).push(`${p.name}${v.sizeName ? ' ' + v.sizeName : ''}`); });
    });
    const dupCodes = Object.entries(codeMap).filter(([, names]) => names.length > 1);
    if (dupCodes.length) issues.push({ level: 'error', title: 'รหัสสินค้า (SKU) ซ้ำกันคนละสินค้า — สินค้าหลายขนาดควรมีรหัสแยกกัน', count: dupCodes.length, detail: dupCodes.map(([c, names]) => `${c}: ${names.join(' / ')}`).join('\n') });
    const dupVSku = Object.entries(vskuMap).filter(([, owners]) => owners.length > 1);
    if (dupVSku.length) issues.push({ level: 'error', title: 'SKU ของขนาดซ้ำกัน', count: dupVSku.length, detail: dupVSku.map(([c, owners]) => `${c}: ${owners.join(' / ')}`).join('\n') });

    // 3c) ชื่อ + ขนาดเหมือนกันในสินค้าคนละตัว (ขายแล้วสับสน)
    const fullMap = {};
    products.forEach(p => (p.variants || []).forEach(v => { const k = `${String(p.name).trim().toLowerCase()}|${String(v.sizeName || '').trim().toLowerCase()}`; (fullMap[k] ||= []).push(p.id); }));
    const dupFull = Object.entries(fullMap).filter(([, ids]) => new Set(ids).size > 1);
    if (dupFull.length) issues.push({ level: 'warn', title: 'ชื่อและขนาดเหมือนกันในสินค้าคนละตัว', count: dupFull.length, detail: dupFull.map(([k]) => k.replace('|', ' ')).join(', ') });

    // 4) สินค้าที่ไม่มีตัวเลือก/ไซซ์เลย — ขายหน้าร้านไม่ได้เพราะไม่มี variant ให้กดเลือก
    const noVariant = products.filter(p => !(p.variants || []).length);
    if (noVariant.length) issues.push({ level: 'warn', title: 'สินค้าที่ไม่มีตัวเลือก/ไซซ์เลย (ขายไม่ได้)', count: noVariant.length, detail: noVariant.map(p => p.name).join(', ') });

    // 4b) ขนาดที่ราคาขายเป็น 0 (ขายได้แต่ไม่มีราคา) และขนาดที่ไม่มีราคาทุน (กำไรจะคำนวณเกินจริง)
    const zeroPrice = [], noCost = [];
    products.forEach(p => (p.variants || []).forEach(v => {
      const label = `${p.name}${v.sizeName ? ' ' + v.sizeName : ''}`;
      if (!(+v.price > 0)) zeroPrice.push(label);
      else if (!(+v.cost > 0)) noCost.push(label);
    }));
    if (zeroPrice.length) issues.push({ level: 'warn', title: 'ขนาดที่ราคาขายเป็น 0 บาท', count: zeroPrice.length, detail: zeroPrice.slice(0, 50).join(', ') });
    if (noCost.length) issues.push({ level: 'info', title: 'ขนาดที่ยังไม่มีราคาทุน (กำไรในรายงานจะเกินจริง)', count: noCost.length, detail: noCost.slice(0, 50).join(', ') });

    // 4c) รายการรอส่งขึ้นเซิร์ฟเวอร์ที่ค้างอยู่
    const pendingSync = (db.syncQueue || []).filter(o => !['failed','needs_review'].includes(o.status)).length;
    const reviewSync = (db.syncQueue || []).filter(o => o.status === 'needs_review').length;
    const failedSync = (db.syncQueue || []).filter(o => o.status === 'failed').length;
    if (pendingSync) issues.push({ level: 'warn', title: 'รายการที่รอส่งขึ้นเซิร์ฟเวอร์', count: pendingSync, detail: 'รายการใหม่ที่ยังรอส่งตามปกติ' });
    if (reviewSync) issues.push({ level: 'warn', title: 'คิวเก่าที่ต้องตรวจสอบผู้ทำรายการ', count: reviewSync, detail: 'ยังไม่ส่งขึ้นเซิร์ฟเวอร์เพื่อป้องกันการลงบัญชีผิดคน ห้ามลบจนกว่าจะตรวจสอบรายการ' });
    if (failedSync) issues.push({ level: 'error', title: 'รายการซิงก์ที่ส่งไม่ผ่าน', count: failedSync, detail: 'เปิดป้ายสถานะซิงก์เพื่อดูสาเหตุและแก้ไขก่อนลองใหม่' });

    // 5) บิลที่มียอดเงินแต่ไม่มีรายการสินค้า — ร่องรอยข้อมูลเพี้ยน/เขียนไม่สมบูรณ์ตอน sync หรือ persist ล้มเหลว
    const emptyBills = (db.bills || []).filter(b => (!b.items || !b.items.length) && (+b.total || 0) > 0);
    if (emptyBills.length) issues.push({ level: 'error', title: 'บิลที่มียอดเงินแต่ไม่มีรายการสินค้า', count: emptyBills.length, detail: emptyBills.map(b => b.id).join(', ') });

    // 6) บิลอ้างอิงลูกค้าที่ไม่มีอยู่ในระบบแล้ว (เช่น ลบลูกค้าทิ้งหลังเคยขายเชื่อไปแล้ว)
    const customerIds = new Set(Object.keys(db.customers || {}));
    const orphanCustomerRefs = (db.bills || []).filter(b => b.customerId && b.customerId !== 'GENERAL' && !customerIds.has(b.customerId));
    if (orphanCustomerRefs.length) issues.push({ level: 'warn', title: 'บิลอ้างอิงลูกค้าที่ไม่มีในระบบแล้ว', count: orphanCustomerRefs.length, detail: orphanCustomerRefs.slice(0, 20).map(b => b.id).join(', ') });

    // 7) รูปภาพบน Supabase Storage เทียบกับสินค้าที่ใช้งานจริง (ต้องเชื่อมต่อ Supabase ไว้ก่อน)
    const client = window.getSupabaseClient?.();
    if (!client) issues.push({ level: 'info', title: 'ยังไม่ได้เชื่อมต่อ Supabase — ข้ามการตรวจรูปบนเซิร์ฟเวอร์', count: 0, detail: 'เชื่อมต่อในตั้งค่าแล้วกดตรวจใหม่เพื่อเทียบรูปกับ Storage' });
    if (client) {
      try {
        const PAGE = 1000;
        let files = [], offset = 0, guard = 0;
        while (guard++ < 50) {
          const { data: page, error: pageErr } = await client.storage.from('product-images').list('', { limit: PAGE, offset });
          if (pageErr) throw pageErr;
          files = files.concat(page || []);
          if (!page || page.length < PAGE) break;
          offset += PAGE;
        }
        {
          const realFiles = files.filter(f => f.id); // list() คืนโฟลเดอร์มาด้วยถ้ามี ต้องกรองเอาเฉพาะไฟล์จริง
          // รวมรูปของ "ขนาด/ตัวเลือก" (variant) ด้วย — เดิมนับเฉพาะรูประดับสินค้า ทำให้รูปที่ใช้งานอยู่ถูกรายงานเป็นรูปไม่มีเจ้าของ
          const usedUrls = new Set();
          products.forEach(p => { if (p.imageUrl) usedUrls.add(p.imageUrl); (p.variants || []).forEach(v => { if (v.imageUrl) usedUrls.add(v.imageUrl); }); });
          const orphanFiles = realFiles.filter(f => {
            const { data } = client.storage.from('product-images').getPublicUrl(f.name);
            return !usedUrls.has(data.publicUrl);
          });
          if (orphanFiles.length) issues.push({
            level: 'info',
            type: 'orphan-images',
            title: 'รูปภาพบน Supabase Storage ที่ไม่มีสินค้าตัวไหนอ้างอิงแล้ว (ลบได้เพื่อประหยัดพื้นที่)',
            count: orphanFiles.length,
            files: orphanFiles.map(f => f.name)
          });

          const fileNames = new Set(realFiles.map(f => f.name));
          const missingCloudImg = products.filter(p => p.imageUrl && p.imageUrl.includes('/product-images/') && !fileNames.has(decodeURIComponent(p.imageUrl.split('/').pop())));
          if (missingCloudImg.length) issues.push({
            level: 'error',
            title: 'สินค้าลิงก์ไปยังรูปที่ไม่มีอยู่จริงบน Storage แล้ว (ถูกลบไปหรือ path ผิด)',
            count: missingCloudImg.length,
            detail: missingCloudImg.map(p => p.name).join(', '),
            fixAction: `window.clearBrokenImageLinks(${JSON.stringify(missingCloudImg.map(p => p.id))})`
          });
        }
      } catch (e) {
        console.warn('storage health check failed', e);
        issues.push({ level: 'info', title: 'ตรวจสอบรูปภาพบน Supabase Storage ไม่สำเร็จ (เช็คการเชื่อมต่อเน็ต/สิทธิ์เข้าถึง bucket)', count: 1, detail: String(e.message || e) });
      }
    }

    // 8) เลขบิลซ้ำ — ยอดขายถูกนับสองครั้งในรายงาน
    const billIdCount = {};
    (db.bills || []).forEach(b => { billIdCount[b.id] = (billIdCount[b.id] || 0) + 1; });
    const dupBills = Object.entries(billIdCount).filter(([, n]) => n > 1);
    if (dupBills.length) issues.push({ level: 'error', title: 'เลขบิลซ้ำ (ยอดขายถูกนับซ้ำในรายงาน)', count: dupBills.length, detail: dupBills.map(([id, n]) => `${id} (${n} ครั้ง)`).join(', ') + '\nแก้ด้วยการลบบิลซ้ำในหน้าเอกสาร/ประวัติบิล' });

    // 9) ยอดบิลไม่ตรงกับผลรวมรายการสินค้า (ข้ามบิลที่มีการคืนสินค้า/ยกเลิกแล้ว)
    const billMismatch = [];
    (db.bills || []).forEach(b => {
      if (b.isRefunded || !Array.isArray(b.items) || !b.items.length) return;
      if (b.items.some(i => +i.returnedQty > 0)) return;
      const sumItems = b.items.reduce((s, i) => s + (+i.price || 0) * (+i.qty || 0), 0);
      const expect = Math.round((sumItems - (+b.discount || 0)) * 100) / 100;
      if (Math.abs(expect - (+b.total || 0)) > 0.5) billMismatch.push(`${b.id}: บันทึก ${b.total} / คำนวณได้ ${expect}`);
    });
    if (billMismatch.length) issues.push({ level: 'error', title: 'ยอดบิลไม่ตรงกับรายการสินค้า (ตรวจก่อนปิดยอดวัน)', count: billMismatch.length, detail: billMismatch.slice(0, 30).join('\n') + '\nถ้ามีโปรโมชั่นหรือส่วนลดรายรายการ ให้ตรวจบิลเองก่อนแก้' });

    // 10) ราคาหรือจำนวนติดลบ/เป็น 0 ในบิล — ทำให้ยอดขายและกำไรเพี้ยน
    const badLines = [];
    (db.bills || []).forEach(b => (b.items || []).forEach(i => {
      if ((+i.price || 0) < 0 || (+i.qty || 0) <= 0) badLines.push(`${b.id}: ${i.name || '-'}`);
    }));
    if (badLines.length) issues.push({ level: 'error', title: 'รายการในบิลที่ราคาติดลบหรือจำนวนไม่ถูกต้อง', count: badLines.length, detail: badLines.slice(0, 40).join('\n') });

    // ---------- การกระทบยอดบัญชี ----------
    const r2 = n => Math.round((+n || 0) * 100) / 100;
    const shiftDiffs = [];
    if (typeof window.computeShiftSummary === 'function') {
      (db.shifts || []).forEach(s => {
        if (!s.endTime || s.cashOnHand == null) return;   // กะที่ยังไม่ปิด/ยังไม่ได้นับ ยังเทียบไม่ได้
        const sum = window.computeShiftSummary(s);
        const diff = r2((+s.cashOnHand || 0) - (+sum.expectedCash || 0));
        if (Math.abs(diff) > 0.5) shiftDiffs.push({ shift: s, expected: sum.expectedCash, counted: s.cashOnHand, diff });
      });
    }
    if (shiftDiffs.length) issues.push({
      level: 'error', title: 'เงินสดในลิ้นชักไม่ตรงกับยอดขายสดในกะ', count: shiftDiffs.length,
      detail: shiftDiffs.slice(0, 30).map(x => `${new Date(x.shift.startTime).toLocaleString('th-TH')}: ควรมี ${x.expected} / นับได้ ${x.counted} (ส่วนต่าง ${x.diff > 0 ? '+' : ''}${x.diff})`).join('\n'),
      fixes: [{ key: 'cash-adjust', label: 'บันทึกรายการปรับยอดตามที่นับ (มีเหตุผล)' }]
    });

    const expectedDebt = cid => {
      const bills = (db.bills || []).filter(b => b.customerId === cid && b.method === 'CREDIT');
      const ids = new Set(bills.map(b => b.id));
      const credit = bills.reduce((s, b) => s + (+b.total || 0), 0);
      const debtReturns = (db.returns || []).filter(r => r.isDebtReduction && ids.has(r.billId)).reduce((s, r) => s + (+r.amount || 0), 0);
      const paid = (db.cashLedger || []).filter(x => x.type === 'cash-in-ar' && x.refId === cid).reduce((s, x) => s + (+x.income || 0), 0);
      return r2(credit - debtReturns - paid);
    };
    const debtMismatch = [], debtSeeded = [];
    Object.values(db.customers || {}).forEach(c => {
      const exp = expectedDebt(c.id), cur = r2(+c.debt || 0);
      if (Math.abs(exp - cur) <= 0.5) return;
      const line = `${c.name}: หนี้ในระบบ ${cur} / จากประวัติบิลและการชำระ ${exp}`;
      (c._debtSeeded ? debtSeeded : debtMismatch).push({ id: c.id, line });
    });
    if (debtMismatch.length) issues.push({
      level: 'error', title: 'ยอดหนี้ลูกค้าไม่ตรงกับบิลขายเชื่อและการชำระ', count: debtMismatch.length,
      detail: debtMismatch.slice(0, 30).map(x => x.line).join('\n'),
      fixes: [{ key: 'debt-recalc', label: 'ปรับยอดหนี้ให้ตรงกับประวัติบิล' }]
    });
    if (debtSeeded.length) issues.push({
      level: 'info', title: 'ยอดหนี้ยกมาจากระบบเซิร์ฟเวอร์ (เทียบกับประวัติบิลไม่ได้ทั้งหมด)', count: debtSeeded.length,
      detail: debtSeeded.slice(0, 30).map(x => x.line).join('\n') + '\nให้เจ้าของตรวจยอดยกมากับสมุดลูกหนี้จริง'
    });

    // ---------- การคืนสินค้า ----------
    const retByBill = {};
    (db.returns || []).forEach(r => { retByBill[r.billId] = (retByBill[r.billId] || 0) + (+r.amount || 0); });
    const overRefund = (db.bills || []).filter(b => (retByBill[b.id] || 0) > (+b.total || 0) + 0.5)
      .map(b => `${b.id}: คืนรวม ${r2(retByBill[b.id])} > ยอดบิล ${b.total}`);
    if (overRefund.length) issues.push({ level: 'error', title: 'คืนสินค้าเกินยอดบิล (อาจคืนซ้ำ)', count: overRefund.length, detail: overRefund.slice(0, 30).join('\n') + '\nตรวจรายการคืนในหน้าเอกสาร/ประวัติบิลก่อนแก้' });

    const overQty = [];
    (db.bills || []).forEach(b => (b.items || []).forEach(i => { if ((+i.returnedQty || 0) > (+i.qty || 0) + 0.0001) overQty.push(`${b.id}: ${i.name || '-'} คืน ${i.returnedQty} จากซื้อ ${i.qty}`); }));
    if (overQty.length) issues.push({ level: 'error', title: 'จำนวนที่คืนมากกว่าจำนวนที่ซื้อ', count: overQty.length, detail: overQty.slice(0, 30).join('\n') });

    const retIdCount = {};
    (db.returns || []).forEach(r => { retIdCount[r.id] = (retIdCount[r.id] || 0) + 1; });
    const dupNotes = Object.entries(retIdCount).filter(([, n]) => n > 1);
    if (dupNotes.length) issues.push({ level: 'error', title: 'เลขใบลดหนี้ซ้ำ', count: dupNotes.length, detail: dupNotes.map(([id, n]) => `${id} (${n} ครั้ง)`).join(', ') });

    // คืนซ้ำแบบเดียวกันเกือบพร้อมกัน (บิลเดียวกัน จำนวนเงินเท่ากัน ห่างกันไม่ถึง 60 วินาที)
    const dupReturnPairs = [];
    const sortedRet = (db.returns || []).slice().sort((a, b) => (a.time || 0) - (b.time || 0));
    for (let k = 1; k < sortedRet.length; k++) {
      const a = sortedRet[k - 1], b = sortedRet[k];
      if (a.billId === b.billId && r2(a.amount) === r2(b.amount) && Math.abs((b.time || 0) - (a.time || 0)) < 60000)
        dupReturnPairs.push(`${b.billId}: ${r2(b.amount)} (${a.id} / ${b.id})`);
    }
    if (dupReturnPairs.length) issues.push({ level: 'warn', title: 'คืนสินค้าซ้ำ (บิลเดียวกัน จำนวนเท่ากัน ห่างกันไม่ถึง 1 นาที)', count: dupReturnPairs.length, detail: dupReturnPairs.slice(0, 30).join('\n') + '\nถ้าเป็นการคืนจริงสองครั้ง ให้ตรวจสต็อกว่าตรงกับจำนวนที่คืนจริง' });

    // ผูกปุ่มแก้ไขกับหัวข้อที่แก้อัตโนมัติได้อย่างปลอดภัย (ที่เหลือแก้เองตามคำแนะนำในรายละเอียด)
    const FIX_RULES = [
      ['สต็อกติดลบ', [{ key: 'neg-stock', label: 'ตั้งสต็อกที่ติดลบเป็น 0' }]],
      ['รหัสสินค้า (SKU) ซ้ำ', [{ key: 'dup-sku', label: 'ตั้งรหัสใหม่ให้สินค้าที่ซ้ำ (ต่อท้ายด้วยขนาด)' }]],
      ['ขนาดที่ยังไม่มีราคาทุน', [{ key: 'fill-cost', label: 'ตั้งทุนเป็น 80% ของราคาขาย (ประมาณ)' }]],
      ['บิลอ้างอิงลูกค้า', [{ key: 'orphan-customer', label: 'ย้ายบิลไปเป็นลูกค้าทั่วไป' }]],
      ['รายการที่ยังไม่ได้ส่ง', [{ key: 'sync-now', label: 'ส่งข้อมูลที่ค้างตอนนี้' }]],
    ];
    issues.forEach(i => {
      if (i.fixes || i.type) return;
      const rule = FIX_RULES.find(([prefix]) => i.title.startsWith(prefix));
      if (rule) i.fixes = rule[1];
    });

    const summary = `<div class="text-[10px] text-slate-500 font-bold mb-1">ตรวจแล้ว ${products.length} สินค้า • ${products.reduce((n, p) => n + (p.variants || []).length, 0)} ขนาด/หน่วย • ${(db.bills || []).length} บิล • ${issues.length} หัวข้อที่พบ</div>`;
    el.innerHTML = summary + (issues.length
      ? issues.map(i => i.type === 'orphan-images' ? orphanImageCard(i.title, i.files) : issueCard(i.level, i.title, i.count, i.detail, i.fixAction, i.fixes)).join('')
      : `<div class="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 text-center text-xs font-bold">✅ ไม่พบความผิดปกติ ข้อมูลดูปกติดี</div>`);
  };
})();
