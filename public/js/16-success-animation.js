
(function () {
  'use strict';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const money = (window.POS && window.POS.money) || (n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // ---------- ภาพยืนยันขายสำเร็จ ----------
  function ensureSuccess() {
    let el = document.getElementById('pos-success'); if (el) return el;
    el = document.createElement('div'); el.id = 'pos-success';
    el.innerHTML = '<div class="card"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="40"/>' +
      '<path d="M24 43 L37 56 L61 30"/></svg><div class="title">ขายสำเร็จ</div>' +
      '<div class="sub" id="pos-success-sub"></div><div class="big" id="pos-success-big"></div></div>';
    document.body.appendChild(el);
    return el;
  }
  // นับตัวเลขจากค่าเดิมไปค่าใหม่ใน 500 มิลลิวินาที
  let hideTimer = null;
  document.addEventListener('pos:sale-complete', e => {
    const d = e.detail || {};
    const el = ensureSuccess();
    document.getElementById('pos-success-sub').textContent = d.change > 0 ? 'เงินทอน' : 'ยอดรวม';
    const big = document.getElementById('pos-success-big');
    big.textContent = money(d.change > 0 ? d.change : d.total);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove('show'), 1800);
    if (navigator.vibrate) navigator.vibrate(30);
  });

  // ---------- นับตัวเลขยอดรวมและเงินทอนในหน้าชำระ ----------
  const watched = ['cart-grand-total', 'pay-cash-change'];
  let lastVal = {};
  function parseMoney(t) { const n = parseFloat(String(t || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function flash(el) { el.classList.remove('pos-count-flash'); void el.offsetWidth; el.classList.add('pos-count-flash'); }
  function watchTotals() {
    watched.forEach(id => {
      const el = document.getElementById(id); if (!el || el.dataset.posWatch) return;
      el.dataset.posWatch = '1';
      new MutationObserver(() => {
        const now = parseMoney(el.textContent);
        if (lastVal[id] !== undefined && now !== lastVal[id]) flash(el);
        lastVal[id] = now;
      }).observe(el, { childList: true, characterData: true, subtree: true });
      lastVal[id] = parseMoney(el.textContent);
    });
  }

  document.addEventListener('DOMContentLoaded', watchTotals);
  if (document.readyState !== 'loading') watchTotals();
})();
