
/* ===== ศูนย์เครื่องมือ (UI) =====
   จุดเดียวที่รวมปุ่มเครื่องมือทั้งหมด แบ่ง 3 กลุ่ม: การทำงานหน้าร้าน / ระบบ / การแสดงผล
   โมดูลอื่นเพิ่มปุ่มได้ด้วย posHub.register({ id, group, icon, label, hint, run, visible, keepOpen })
   ไม่มีปุ่มลอยกระจายบนหน้าจออีกต่อไป */
(function () {
  'use strict';
  const GROUPS = [
    { id: 'ops', title: 'การทำงานหน้าร้าน' },
    { id: 'system', title: 'ระบบ' },
    { id: 'look', title: 'การแสดงผล' }
  ];
  const items = [];
  let root = null;
  const val = v => (typeof v === 'function' ? v() : v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function ensure() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'pos-hub';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'เมนูเครื่องมือ');
    root.innerHTML =
      '<div class="hub-backdrop" data-hub-close></div>' +
      '<section class="hub-sheet">' +
        '<div class="hub-grip" data-hub-close></div>' +
        '<div class="hub-head"><div><div class="hub-store" id="hub-store"></div><div class="hub-user" id="hub-user"></div></div>' +
        '<div class="hub-clock" id="clock">00:00:00</div></div>' +
        '<div class="hub-body" id="hub-body"></div>' +
      '</section>';
    root.addEventListener('click', e => {
      if (e.target.closest('[data-hub-close]')) return close();
      const tile = e.target.closest('[data-hub-item]');
      if (!tile) return;
      const it = items.find(x => x.id === tile.dataset.hubItem);
      if (!it) return;
      if (!it.keepOpen) close();
      try { it.run(); } catch (err) { console.warn('hub item', it.id, err); }
      if (it.keepOpen) render();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(root);
    return root;
  }

  function render() {
    ensure();
    const title = document.getElementById('store-name-title');
    const user = window.db && window.db.activeUser;
    document.getElementById('hub-store').textContent = (title && title.textContent) || 'Smart POS';
    document.getElementById('hub-user').textContent = user ? '👤 ' + user.name : '';
    document.getElementById('hub-body').innerHTML = GROUPS.map(g => {
      const list = items.filter(it => it.group === g.id && (!it.visible || it.visible()));
      if (!list.length) return '';
      return '<h3 class="hub-title">' + g.title + '</h3><div class="hub-grid">' + list.map(it =>
        '<button type="button" class="hub-tile" data-hub-item="' + esc(it.id) + '">' +
          '<span class="hub-ico">' + esc(val(it.icon)) + '</span>' +
          '<span class="hub-lbl">' + esc(it.label) + '</span>' +
          (it.hint ? '<span class="hub-hint">' + esc(val(it.hint)) + '</span>' : '') +
        '</button>').join('') + '</div>';
    }).join('');
  }

  function open() { render(); root.classList.add('open'); }
  function close() { if (root) root.classList.remove('open'); }

  window.posHub = {
    register(it) {
      const i = items.findIndex(x => x.id === it.id);
      if (i >= 0) items[i] = it; else items.push(it);
    },
    open, close
  };

  // เครื่องมือหลักที่ย้ายมาจากแถบหัวหน้าจอ
  const textOf = id => { const e = document.getElementById(id); return e ? String(e.textContent || '').trim() : ''; };
  window.posHub.register({ id: 'sync', group: 'ops', icon: '🔄', label: 'ซิงค์ข้อมูลตอนนี้',
    hint: () => textOf('offline-status-label'), run: () => window.forceSyncNow && window.forceSyncNow() });
  window.posHub.register({ id: 'lock', group: 'ops', icon: '🔒', label: 'ล็อก / สลับพนักงาน',
    hint: () => (window.db && window.db.activeUser ? window.db.activeUser.name : ''), run: () => window.lockPOS && window.lockPOS() });
  window.posHub.register({ id: 'settings', group: 'system', icon: '⚙️', label: 'ศูนย์การตั้งค่า',
    hint: 'ร้านค้า • ฐานข้อมูล', run: () => window.openMasterSettingsModal && window.openMasterSettingsModal() });
})();

