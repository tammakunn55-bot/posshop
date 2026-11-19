
(function () {
  'use strict';
  // EAN-13 ภายในร้าน ขึ้นต้น 28 (ไม่ซ้ำกับช่วง 20 ของฐาน และ 29 ที่ใช้ตอนนำเข้า)
  function check13(base12) {
    let t = 0;
    for (let i = 0; i < 12; i++) t += (+base12[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (t % 10)) % 10);
  }
  function fillMissingBarcodes() {
    if (!window.db || !db.products) return 0;
    const used = new Set();
    const blanks = [];
    Object.values(db.products).forEach(p => {
      if (p.isDeleted) return;
      (p.variants || []).forEach(v => {
        const b = String(v.barcode || '').trim();
        if (b) used.add(b); else blanks.push(v);
      });
    });
    if (!blanks.length) return 0;
    let seq = +(db.barcodeSeq || 0);
    let n = 0;
    blanks.forEach(v => {
      let code;
      do {
        seq += 1;
        const base = '28' + String(seq).padStart(10, '0');
        code = base + check13(base);
      } while (used.has(code));
      used.add(code);
      v.barcode = code;
      n++;
    });
    db.barcodeSeq = seq;
    return n;
  }
  window.posFillBarcodes = fillMissingBarcodes;

  // เติมก่อนบันทึกทุกครั้ง และก่อนซิงก์สินค้าขึ้นฐาน
  posHooks.on('persist', () => { try { fillMissingBarcodes(); } catch (e) { console.warn('barcode fill', e); } });
  posHooks.on('sync:products', () => { try { if (fillMissingBarcodes() > 0) persist(); } catch (e) {} });
  // เติมให้ทันทีเมื่อเปิดแอป
  document.addEventListener('DOMContentLoaded', () => { try { if (fillMissingBarcodes() > 0) window.persist?.(); } catch (e) {} });
})();
