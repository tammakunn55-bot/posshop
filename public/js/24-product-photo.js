
(function () {
  'use strict';
  function showPreview(url) {
    const pv = document.getElementById('pm-photo-preview'), ph = document.getElementById('pm-photo-placeholder');
    if (url) { pv.src = url; pv.classList.remove('hidden'); ph.classList.add('hidden'); }
    else { pv.classList.add('hidden'); ph.classList.remove('hidden'); }
    const em = document.getElementById('pm-image'); if (em && url) em.value = '';
  }
  window.pmPickFromGallery = function () {
    if (!window.posPickImage) return;
    const fake = { dataset: { img: '' }, querySelector: () => null,
      onPick: (url) => { pmPhotoDataUrl = url || null; pmPhotoChanged = true; showPreview(url || ''); } };
    window.posPickImage(fake);
  };
  window.pmUseUrl = function () {
    const v = (document.getElementById('pm-image-url').value || '').trim();
    if (!/^https?:\/\//i.test(v)) { window.showAlert?.('ลิงก์ไม่ถูกต้อง', 'ลิงก์รูปต้องขึ้นต้นด้วย https://', true); return; }
    pmPhotoDataUrl = v; pmPhotoChanged = true; showPreview(v);
  };
})();
