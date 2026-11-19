
/* ==========================================
   PRODUCT EXPORT — Excel table with clickable image links (labelled with the product
   name instead of a raw URL) and a ZIP download of the actual image files renamed to
   the product/variant name.
   ========================================== */
(function(){
  function safeFileName(s){
    return String(s || 'สินค้า').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80);
  }

  // ใช้ ExcelJS แทน SheetJS สำหรับตัวนี้โดยเฉพาะ เพราะไลบรารี SheetJS รุ่นฟรีที่โหลดใช้ในแอป
  // (xlsx.full.min.js) ไม่รองรับการฝังรูปภาพจริงลงในไฟล์ .xlsx ได้ (รองรับแค่ข้อความ/สูตร/ลิงก์)
  // — ExcelJS รองรับ addImage() ทำให้เห็นรูปจริงในตารางเพื่อตรวจสอบเบื้องต้นได้ทันทีโดยไม่ต้อง
  // คลิกลิงก์ทีละแถว ส่วนคอลัมน์ "ลิงก์รูปภาพ" ยังคงเป็น hyperlink ที่คลิกได้เหมือนเดิมด้วย
  // ---------- ส่งออกรายการสินค้า: 1 แถว = 1 ขนาด หรือ 1 หน่วยย่อย (ตามที่ตกลง) ----------
  window.PRODUCT_SHEET_COLUMNS = ['ลำดับ','หมวดหมู่หลัก','หมวดหมู่ย่อย','รูปสินค้า','รหัสสินค้า (SKU)','รหัสบาร์โค้ด','ชื่อสินค้า','ขนาด/รุ่น','หน่วย','ราคาทุน','ราคาขาย','กลุ่มสินค้า','ประเภทแถว','รหัสสินค้าหลัก','จำนวนหน่วยฐานต่อ 1 หน่วยนี้','จำนวนคงเหลือ','ขั้นต่ำ','สถานะ'];
  window.exportProductsToExcel = async function(){
    try { await window.posLoadLib('exceljs'); } catch (e) { return window.showAlert?.('ผิดพลาด', e.message, true); }
    const catByName = new Map((db.categories || []).map(c => [c.name, c]));
    const catById = new Map((db.categories || []).map(c => [c.id, c]));
    const mainSub = p => {
      const c = catByName.get((p.cat || [])[0]);
      if (c && c.parentId) return { main: (catById.get(c.parentId) || {}).name || '', sub: c.name };
      return { main: c ? c.name : ((p.cat || [])[0] || ''), sub: '' };
    };
    const used = new Set();
    const uniq = s => { let u = s, n = 2; while (used.has(u.toLowerCase())) u = `${s}-${n++}`; used.add(u.toLowerCase()); return u; };
    const imgName = p => { if (p.imageFile) return p.imageFile; if (!p.imageUrl) return ''; try { return decodeURIComponent(new URL(p.imageUrl, location.href).pathname.split('/').pop()); } catch (_) { return ''; } };
    const products = Object.values(db.products || {}).filter(p => !p.isDeleted).sort((a, b) => naturalCompare(a.name, b.name));
    const wb = new ExcelJS.Workbook();
    const rows = [];
    products.forEach(p => {
      const vs = (p.variants || []).length ? p.variants : [{ sizeName: 'ปกติ', barcode: '', cost: 0, price: 0, stock: 0, fractions: [] }];
      const multi = vs.length > 1, { main, sub } = mainSub(p), status = p.isDisabled ? 'ไม่ใช้' : 'ใช้';
      vs.forEach((v, idx) => {
        const size = (v.sizeName || '').trim() || 'ปกติ';
        const sku = uniq(v.sku ? String(v.sku) : (multi ? `${p.code || p.id}-${String(idx + 1).padStart(2, '0')}` : String(p.code || p.id)));
        const disp = p.name + (size !== 'ปกติ' && size !== '-' ? ' ' + size : '');
        rows.push({ prod: p, type: 'หลัก', main, sub, img: imgName(p), sku, bar: v.barcode || '', name: disp, size, unit: v.unit || p.unit || 'ชิ้น', cost: +v.cost || 0, price: +v.price || 0, group: p.name, parent: '', ratio: '', stock: +v.stock || 0, min: +(v.minStock ?? p.minStock ?? 5), status });
        (v.fractions || []).forEach((f, k) => {
          const mult = +f.fractionMultiplier || 0;
          rows.push({ type: 'หน่วยย่อย', main, sub, img: '', sku: uniq(`${sku}-S${k + 1}`), bar: f.barcode || '', name: disp, size, unit: f.fractionName || '', cost: '', price: +f.fractionPrice || 0, group: p.name, parent: sku, ratio: mult > 0 ? mult : '', stock: '', min: '', status });
        });
      });
    });
    // รูปสินค้า: ฝังรูปขนาดย่อ (≤ 240px) ลงในไฟล์ทุกแถว "หลัก" เพื่อให้ไฟล์เดียวมีทั้งข้อมูลและรูป
    const thumbCache = new Map();
    const thumbFor = async url => {
      if (!url) return null;
      if (thumbCache.has(url)) return thumbCache.get(url);
      let out = null;
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
        const res = await fetch(url, { signal: ctl.signal, mode: 'cors' }); clearTimeout(to);
        if (res.ok) {
          const bmp = await createImageBitmap(await res.blob());
          const k = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
          const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
          cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
          const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
          out = blob ? await blob.arrayBuffer() : null;
        }
      } catch (_) { out = null; }
      thumbCache.set(url, out);
      return out;
    };
    let withPhoto = 0;
    const imgIdByUrl = new Map();
    // (ต้องสร้าง wb ก่อนบล็อกนี้)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type !== 'หลัก') continue;
      const url = r.prod && r.prod.imageUrl;
      if (!url) continue;
      if (!imgIdByUrl.has(url)) {
        const buf = await thumbFor(url);
        imgIdByUrl.set(url, buf ? wb.addImage({ buffer: buf, extension: 'jpeg' }) : null);
      }
      const id = imgIdByUrl.get(url);
      if (id === null || id === undefined) continue;
      r.imgId = id; withPhoto++;
    }

    const ws = wb.addWorksheet('รายการสินค้า');
    const cols = window.PRODUCT_SHEET_COLUMNS;
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    rows.forEach((r, i) => {
      const rr = ws.addRow([i + 1, r.main, r.sub, r.img, r.sku, r.bar, r.name, r.size, r.unit, r.cost === '' ? '' : r.cost, r.price, r.group, r.type, r.parent, r.ratio, r.stock, r.min, r.status]);
      if (r.imgId !== undefined) {
        rr.height = 52;
        ws.addImage(r.imgId, { tl: { col: 3.08, row: rr.number - 1 + 0.08 }, ext: { width: 48, height: 48 } });
      }
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
    [8, 12, 12, 22, 16, 16, 36, 12, 10, 10, 10, 30, 12, 16, 16, 12, 10, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const last = rows.length + 1;
    ws.dataValidations.add(`M2:M${last}`, { type: 'list', allowBlank: true, formulae: ['"หลัก,หน่วยย่อย"'] });
    ws.dataValidations.add(`R2:R${last}`, { type: 'list', allowBlank: true, formulae: ['"ใช้,ไม่ใช้"'] });
    const guide = wb.addWorksheet('คำอธิบาย');
    [['คอลัมน์', 'ความหมายและกฎ'],
     ['ประเภทแถว', 'หลัก = สินค้า 1 ขนาด  •  หน่วยย่อย = หน่วยแบ่งขายของขนาดที่อ้างใน "รหัสสินค้าหลัก"'],
     ['รหัสสินค้า (SKU)', 'ต้องไม่ซ้ำทุกแถว สินค้าหลายขนาดจะต่อท้ายด้วยเลขลำดับ เช่น 00080-01, 00080-02'],
     ['กลุ่มสินค้า', 'ชื่อกลุ่มเดียวกัน = สินค้าขนาดต่างกันของชุดเดียวกัน และใช้รูปร่วมกันได้'],
     ['จำนวนหน่วยฐานต่อ 1 หน่วยนี้', 'หน่วยหลักของสินค้า = หน่วยเล็กที่สุดที่ตัดสต็อก เช่น หน่วยหลักคือ "เมตร" ขายยกเส้น 1 เส้น = 4 เมตร ใส่ 4 (ขายแบ่งเมตรละให้ใส่ 1) ใช้กับแถวหน่วยย่อยเท่านั้น'],
     ['สถานะ', 'ใช้ = ขายได้  •  ไม่ใช้ = ซ่อนจากหน้าขาย (ตั้งที่ทั้งกลุ่มสินค้า)'],
     ['การนำเข้า', 'แถวที่ไม่ผ่านการตรวจจะถูกข้าม และแสดงเหตุผลก่อนยืนยัน ไม่มีการเขียนทับแถวที่ไม่ผ่าน']
    ].forEach(r => guide.addRow(r));
    guide.getRow(1).font = { bold: true }; guide.getColumn(1).width = 30; guide.getColumn(2).width = 100;
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `รายการสินค้า-${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    window.showToast?.(`ส่งออก ${rows.length} แถว • มีรูป ${withPhoto} แถว`);
  };

  // Downloads every product photo as a ZIP, with each file renamed to the product
  // (and variant, if more than one size/color) name instead of its original filename.
  // Only works for images reachable over HTTP(S) or already embedded as data URLs — a
  // photo that only exists on someone else's device (never uploaded) can't be fetched.
  window.exportProductImagesZip = async function(){
    try { await window.posLoadLib('jszip'); } catch (e) { return window.showAlert?.('ผิดพลาด', e.message, true); }
    const withPhotos = Object.values(db.products || {}).filter(p => p.imageUrl);
    if (!withPhotos.length) return window.showAlert?.('ไม่มีรูปภาพ', 'ยังไม่มีสินค้าที่แนบรูปภาพไว้ (imageUrl)', true);

    window.showToast?.(`กำลังดาวน์โหลดรูปภาพ ${withPhotos.length} รายการ...`);
    const zip = new JSZip();
    const usedNames = {};
    let okCount = 0, failCount = 0;

    for (const p of withPhotos) {
      try {
        const res = await fetch(p.imageUrl);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        let ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        if (p.imageUrl.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)) ext = p.imageUrl.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)[1].toLowerCase();
        let base = safeFileName(p.name);
        let fileName = `${base}.${ext}`;
        let n = 2;
        while (usedNames[fileName]) { fileName = `${base}-${n}.${ext}`; n++; }
        usedNames[fileName] = true;
        zip.file(fileName, blob);
        okCount++;
      } catch (e) {
        failCount++;
      }
    }

    if (!okCount) return window.showAlert?.('ดาวน์โหลดไม่สำเร็จ', 'ไม่สามารถดึงรูปภาพได้เลยสักรูป — อาจติด CORS หรือรูปเป็นไฟล์ในเครื่องที่ยังไม่ได้อัปโหลด', true);
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `รูปสินค้า-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    window.showToast?.(`ดาวน์โหลดสำเร็จ ${okCount} รูป${failCount ? ` (พลาด ${failCount} รูป)` : ''}`);
  };
})();
