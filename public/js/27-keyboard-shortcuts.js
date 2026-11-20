
// ---------- คีย์ลัดสำหรับเครื่อง POS ที่ใช้คีย์บอร์ด/เครื่องยิงบาร์โค้ด ----------
// F2 = โฟกัสช่องค้นหา/สแกนบาร์โค้ด • F4 = เปิดตะกร้า/หน้าชำระเงิน • F8 = พักบิล • Esc = ปิดหน้าต่างบนสุด
(function () {
  const loginVisible = () => { const el = document.getElementById('screen-employee-login'); return el && !el.classList.contains('hidden'); };
  const visibleModals = () => Array.from(document.querySelectorAll('[id^="modal-"]')).filter(m => !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none');
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || loginVisible()) return;
    if (e.key === 'Escape') {
      const ms = visibleModals(); if (!ms.length) return;
      const top = ms.sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0)).pop();
      if (window.closeModal) { e.preventDefault(); window.closeModal(top.id); }
      return;
    }
    if (e.key === 'F2') {
      const el = document.getElementById('search-product'); if (!el) return;
      e.preventDefault(); el.focus(); el.select && el.select();
    } else if (e.key === 'F4') {
      e.preventDefault();
      const cart = document.getElementById('modal-cart');
      if (cart && cart.classList.contains('hidden') && window.openCartModal) window.openCartModal();   // เปิดแล้วเท่านั้น ไม่ยืนยันชำระให้เอง กันกดซ้ำ
    } else if (e.key === 'F8') {
      e.preventDefault(); window.holdCurrentBill?.();
    }
  });
})();
