
(function () {
  'use strict';
  const esc = (window.POS && window.POS.esc) || (x => String(x == null ? '' : x));

  // ---------- รายการสิทธิ์ (แหล่งเดียวของทั้งระบบ) ----------
  const PERMS = [
    { k: 'SALE',           g: 'การขาย',          l: 'ขายสินค้า / เพิ่มตะกร้า / พักบิล' },
    { k: 'DISCOUNT',       g: 'การขาย',          l: 'ให้ส่วนลด' },
    { k: 'CREDIT_SALE',    g: 'การขาย',          l: 'ขายเชื่อ (ค้างชำระ)' },
    { k: 'RETURN',         g: 'การขาย',          l: 'รับคืน / คืนเงิน' },
    { k: 'PRICE_OVERRIDE',  g: 'การขาย',          l: 'ขายต่ำกว่าราคาตั้ง' },
    { k: 'STOCK_NEGATIVE',  g: 'การขาย',          l: 'ขายเกินสต็อกที่มี' },
    { k: 'BACKDATE',        g: 'การขาย',          l: 'บันทึกบิลย้อนหลังเกิน 48 ชม.' },
    { k: 'SHIFT',          g: 'การขาย',          l: 'เปิด/ปิดกะ, เงินทอน, เงินเข้า-ออกลิ้นชัก' },
    { k: 'PRODUCT_CREATE', g: 'สินค้าและสต็อก',  l: 'เพิ่มสินค้า' },
    { k: 'PRODUCT_EDIT',   g: 'สินค้าและสต็อก',  l: 'แก้ไขสินค้า ราคา หมวด ขั้นต่ำ หน่วยย่อย' },
    { k: 'PRODUCT_DELETE', g: 'สินค้าและสต็อก',  l: 'ลบสินค้า / ลบหมวด' },
    { k: 'STOCK_ADJUST',   g: 'สินค้าและสต็อก',  l: 'ปรับสต็อก / ตรวจนับ' },
    { k: 'GOODS_RECEIPT',  g: 'สินค้าและสต็อก',  l: 'รับสินค้าเข้า' },
    { k: 'PURCHASE',       g: 'ซื้อและลูกหนี้',  l: 'ใบสั่งซื้อ / ซัพพลายเออร์ / จ่ายเจ้าหนี้' },
    { k: 'CUSTOMER_MANAGE',g: 'ซื้อและลูกหนี้',  l: 'เพิ่ม/แก้/ลบลูกค้า' },
    { k: 'CUSTOMER_PAY',   g: 'ซื้อและลูกหนี้',  l: 'รับชำระหนี้ลูกค้า' },
    { k: 'SETTINGS_STORE', g: 'ระบบ',            l: 'ตั้งค่าร้าน' },
    { k: 'USERS',          g: 'ระบบ',            l: 'จัดการผู้ใช้และสิทธิ์' },
    { k: 'SYNC_CONFIG',    g: 'ระบบ',            l: 'ตั้งค่าการเชื่อมฐานข้อมูล' },
    { k: 'DATA_RESET',     g: 'ระบบ',            l: 'ล้างข้อมูล / รีเซ็ตระบบ' }
  ];
  const PRESET = {
    OWNER: ['ALL'],
    MANAGER: ['SALE','DISCOUNT','CREDIT_SALE','RETURN','PRICE_OVERRIDE','STOCK_NEGATIVE','BACKDATE','SHIFT','PRODUCT_CREATE','PRODUCT_EDIT','PRODUCT_DELETE',
              'STOCK_ADJUST','GOODS_RECEIPT','PURCHASE','CUSTOMER_MANAGE','CUSTOMER_PAY','SETTINGS_STORE'],
    CASHIER: ['SALE']
  };
  const label = k => (PERMS.find(p => p.k === k) || { l: k }).l;

  // ---------- การตรวจสิทธิ์หลัก (แทนที่ canDo เดิม; ok() ของโค้ดเดิมเรียกผ่าน window.canDo) ----------
  function perms(u) {
    if (!u) return [];
    if (u.role === 'OWNER') return ['ALL'];
    return Array.isArray(u.permissions) ? u.permissions : (PRESET[u.role] || []);
  }
  window.posPerms = perms;
  window.canDo = function (p) {
    const u = window.db && window.db.activeUser;
    if (!u) {
      // ยังไม่มีใครล็อกอิน: อนุญาตเฉพาะตอนติดตั้งครั้งแรก (ยังไม่มีใครตั้ง PIN)
      return !((window.db && window.db.users) || []).some(x => x.pinHash);
    }
    const list = perms(u);
    return list.includes('ALL') || list.includes(p);
  };
  function denied(p) {
    window.showAlert?.('ไม่มีสิทธิ์', `บัญชีนี้ไม่มีสิทธิ์ "${label(p)}"\nให้ผู้จัดการหรือเจ้าของร้านล็อกอินเพื่อทำรายการนี้`, true);
    return undefined;
  }
  window.posDenied = denied;

  // ห่อฟังก์ชันที่อ่อนไหว: ไม่มีสิทธิ์ = ไม่ทำงาน ไม่มีการถาม PIN ซ้ำ
  function guard(name, perm) {
    const f = window[name];
    if (typeof f !== 'function' || f.__guard) return;
    const w = function () { return window.canDo(perm) ? f.apply(this, arguments) : denied(perm); };
    w.__guard = true; window[name] = w;
  }
  const MAP = {
    SALE: ['openCartModal', 'addUnifiedToCart', 'holdCurrentBill'],
    RETURN: ['openReturnModal', 'executeReturn', 'reviewReturn'],
    SHIFT: ['openShiftModal', 'confirmOpenShift', 'ensureShiftForClose', 'confirmCloseShift', 'openCashMovementModal',
            'confirmCashMovement', 'openCloseShiftReport', 'cancelCloseShift', 'healthFixCashAdjust'],
    PRODUCT_EDIT: ['openBulkCategoryModal', 'confirmBulkCategory', 'openBulkMinStockModal', 'confirmBulkMinStock',
                   'openMergeGroupModal', 'confirmMergeGroup', 'openAddFractionModal', 'confirmAddFraction',
                   'removePMFraction', 'saveCategory', 'editCategory', 'openCategoryModal', 'openBulkImageModal',
                   'startBulkImageImport'],
    PRODUCT_DELETE: ['deleteCategory'],
    STOCK_ADJUST: ['openBulkStockModal', 'confirmBulkStock', 'confirmOpeningStockImport'],
    GOODS_RECEIPT: ['confirmReceivePO'],
    PURCHASE: ['openSupplierManagerModal', 'saveSupplier', 'deleteSupplier', 'addItemToPOList', 'clearPOList',
               'updatePOItemField'],
    CUSTOMER_MANAGE: ['saveCustomer', 'deleteCustomer'],
    CUSTOMER_PAY: ['openReceivePaymentModal', 'confirmReceivePayment'],
    SETTINGS_STORE: ['saveStoreSettings', 'openMasterSettingsModal'],
    DATA_RESET: ['factoryReset'],
    SYNC_CONFIG: ['saveSupabaseConfig']
  };
  Object.keys(MAP).forEach(perm => MAP[perm].forEach(n => guard(n, perm)));

  // ---------- ผู้ใช้: ตัวช่วย ----------
  const db0 = () => window.db;
  function activeHolders(excludeId) {
    return (db0().users || []).filter(u => u.id !== excludeId && u.active !== false &&
      (u.role === 'OWNER' || perms(u).includes('ALL') || perms(u).includes('USERS')));
  }
  function persistAll() {
    window.persist?.();
    window.renderEmployeeLoginScreen?.();
    window.renderUserManagerList?.();
    window.syncProductsToSupabase?.(true).catch(e => console.warn('user sync', e));
  }

  // ---------- หน้า "ผู้ใช้และสิทธิ์" ----------
  let editingId = null, draft = null;
  function ensureModal() {
    let m = document.getElementById('pu-modal'); if (m) return m;
    m = document.createElement('div'); m.id = 'pu-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.6);padding:12px;overflow:auto';
    m.innerHTML = '<div id="pu-box" style="max-width:760px;margin:12px auto;background:#fff;border-radius:16px;padding:16px;font-family:Sarabun,sans-serif;color:#0f172a"></div>';
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    return m;
  }
  function close() { const m = document.getElementById('pu-modal'); if (m) m.style.display = 'none'; editingId = null; draft = null; }
  window.openUsersPanel = function () {
    if (!window.canDo('USERS')) return denied('USERS');
    ensureModal(); editingId = null; draft = null; renderList();
    document.getElementById('pu-modal').style.display = 'block';
  };
  function header(title) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:18px">${title}</b>` +
      `<button onclick="window.posUsersClose()" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ปิด</button></div>`;
  }
  window.posUsersClose = close;

  function renderList() {
    const users = db0().users || [];
    document.getElementById('pu-box').innerHTML = header('👥 ผู้ใช้และสิทธิ์') +
      `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button onclick="window.posUserEdit(null)" style="padding:10px 14px;border-radius:12px;border:0;background:#4f46e5;color:#fff;font-weight:800">+ เพิ่มผู้ใช้</button></div>` +
      users.map(u => {
        const list = perms(u), cnt = list.includes('ALL') ? 'ทุกสิทธิ์' : list.length + ' สิทธิ์';
        const off = u.active === false;
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin-bottom:6px;${off ? 'opacity:.55' : ''}">` +
          `<div><b>${esc(u.name)}</b> <span style="font-size:12px;color:#4338ca">${u.role === 'OWNER' ? 'เจ้าของร้าน' : u.role === 'MANAGER' ? 'ผู้จัดการ' : 'พนักงาน'}</span>` +
          `<div style="font-size:12px;color:#64748b">${cnt}${off ? ' • ปิดการใช้งาน' : ''}${!u.pinHash ? ' • ยังไม่ตั้ง PIN' : ''}</div></div>` +
          `<button onclick="window.posUserEdit('${u.id}')" style="padding:8px 12px;border-radius:10px;border:0;background:#eef2ff;color:#3730a3;font-weight:700">แก้ไข</button></div>`;
      }).join('') +
      `<div style="margin-top:10px;font-size:12px;color:#64748b">การล็อกอินใช้ชื่อกับ PIN ครั้งเดียวเมื่อเริ่มกะหรือหลังล็อก หลังจากนั้นทำรายการได้ตามสิทธิ์ที่กำหนดไว้ ไม่ต้องใส่ PIN ซ้ำ</div>`;
  }

  window.posUserEdit = function (id) {
    if (!window.canDo('USERS')) return denied('USERS');
    const u = id ? (db0().users || []).find(x => x.id === id) : null;
    if (id && !u) return;
    if (u && u.role === 'OWNER' && !(window.db.activeUser && window.db.activeUser.role === 'OWNER')) {
      return window.showAlert?.('ไม่อนุญาต', 'เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขบัญชีเจ้าของร้านได้', true);
    }
    editingId = id;
    draft = u ? { name: u.name, role: u.role, active: u.active !== false, perms: perms(u).slice() }
              : { name: '', role: 'CASHIER', active: true, perms: PRESET.CASHIER.slice() };
    renderEditor();
  };

  function renderEditor() {
    const isOwnerRow = editingId && (db0().users || []).find(x => x.id === editingId)?.role === 'OWNER';
    const me = window.db.activeUser;
    const canMakeOwner = me && me.role === 'OWNER';
    const groups = [...new Set(PERMS.map(p => p.g))];
    const roleOpts = ['CASHIER', 'MANAGER'].concat(canMakeOwner || isOwnerRow ? ['OWNER'] : [])
      .map(r => `<option value="${r}" ${draft.role === r ? 'selected' : ''}>${r === 'OWNER' ? 'เจ้าของร้าน' : r === 'MANAGER' ? 'ผู้จัดการ' : 'พนักงานขาย'}</option>`).join('');
    const all = draft.role === 'OWNER' || draft.perms.includes('ALL');
    const matrix = groups.map(g => `<div style="margin-top:8px"><div style="font-weight:800;color:#312e81;font-size:13px">${g}</div>` +
      PERMS.filter(p => p.g === g).map(p =>
        `<label style="display:flex;gap:8px;align-items:center;padding:6px 4px;font-size:14px"><input type="checkbox" data-perm="${p.k}" ${all || draft.perms.includes(p.k) ? 'checked' : ''} ${all ? 'disabled' : ''} style="width:18px;height:18px"> ${p.l}</label>`).join('') + '</div>').join('');
    document.getElementById('pu-box').innerHTML = header(editingId ? '✏️ แก้ไขผู้ใช้' : '➕ เพิ่มผู้ใช้') +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">` +
      `<label style="font-size:13px;font-weight:700">ชื่อ<input id="pu-name" value="${esc(draft.name)}" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px;margin-top:4px"></label>` +
      `<label style="font-size:13px;font-weight:700">PIN 6 หลัก ${editingId ? '(เว้นว่าง = ไม่เปลี่ยน)' : ''}<input id="pu-pin" inputmode="numeric" maxlength="6" type="password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px;margin-top:4px"></label>` +
      `<label style="font-size:13px;font-weight:700">บทบาท<select id="pu-role" ${isOwnerRow && !canMakeOwner ? 'disabled' : ''} style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px;margin-top:4px">${roleOpts}</select></label>` +
      `<label style="font-size:13px;font-weight:700;display:flex;align-items:end;gap:8px;padding-bottom:10px"><input id="pu-active" type="checkbox" ${draft.active ? 'checked' : ''} style="width:18px;height:18px"> ใช้งานได้</label></div>` +
      `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 4px"><button id="pu-preset" style="padding:8px 12px;border-radius:10px;border:1px solid #c7d2fe;background:#eef2ff;font-weight:700">ใช้ชุดสิทธิ์ตามบทบาท</button>` +
      `<button id="pu-all" style="padding:8px 12px;border-radius:10px;border:1px solid #c7d2fe;background:#fff;font-weight:700">เลือกทั้งหมด</button>` +
      `<button id="pu-none" style="padding:8px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;font-weight:700">ล้างทั้งหมด</button></div>` +
      `<div id="pu-matrix" style="border-top:1px solid #e2e8f0;padding-top:4px">${matrix}</div>` +
      `<div style="display:flex;gap:8px;margin-top:14px"><button id="pu-save" style="flex:1;padding:12px;border-radius:12px;border:0;background:#4f46e5;color:#fff;font-weight:800">✔ บันทึก</button>` +
      `<button onclick="window.posUsersBack()" style="padding:12px;border-radius:12px;border:0;background:#e2e8f0;font-weight:700">ย้อนกลับ</button></div>`;
    bindEditor();
  }
  window.posUsersBack = function () { editingId = null; draft = null; renderList(); };

  function bindEditor() {
    const roleSel = document.getElementById('pu-role');
    const readMatrix = () => Array.from(document.querySelectorAll('#pu-matrix input[data-perm]')).filter(i => i.checked).map(i => i.dataset.perm);
    roleSel.onchange = () => {
      draft.role = roleSel.value;
      draft.perms = PRESET[draft.role].slice();
      renderEditor();
    };
    document.getElementById('pu-preset').onclick = () => { draft.role = roleSel.value; draft.perms = PRESET[roleSel.value].slice(); renderEditor(); };
    document.getElementById('pu-all').onclick = () => { draft.perms = PERMS.map(p => p.k); renderEditor(); };
    document.getElementById('pu-none').onclick = () => { draft.perms = []; renderEditor(); };
    document.getElementById('pu-save').onclick = () => saveEditor(readMatrix());
  }

  async function saveEditor(checked) {
    const name = document.getElementById('pu-name').value.trim();
    const pin = document.getElementById('pu-pin').value.trim();
    const role = document.getElementById('pu-role').value;
    const active = document.getElementById('pu-active').checked;
    if (!name) return window.showAlert?.('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกชื่อ', true);
    if (!editingId && !/^\d{6}$/.test(pin)) return window.showAlert?.('ข้อมูลไม่ถูกต้อง', 'ผู้ใช้ใหม่ต้องมี PIN 6 หลักเป็นตัวเลข', true);
    if (pin && !/^\d{6}$/.test(pin)) return window.showAlert?.('ข้อมูลไม่ถูกต้อง', 'PIN ต้องเป็นตัวเลข 6 หลัก', true);
    if (pin && window.WEAK_PINS?.includes(pin)) return window.showAlert?.('PIN เดาง่ายเกินไป', 'เลือก PIN ที่ไม่ใช่เลขซ้ำหรือเรียงกัน', true);
    const me = window.db.activeUser;
    const target = editingId ? (db0().users || []).find(x => x.id === editingId) : null;
    if (target && target.role === 'OWNER' && role !== 'OWNER') return window.showAlert?.('ไม่อนุญาต', 'ไม่สามารถลดสิทธิ์เจ้าของร้านได้', true);
    if (role === 'OWNER' && !(me && me.role === 'OWNER')) return window.showAlert?.('ไม่อนุญาต', 'เฉพาะเจ้าของร้านเท่านั้นที่ตั้งบทบาทเจ้าของร้านได้', true);
    const newPerms = role === 'OWNER' ? ['ALL'] : checked;
    // ห้ามทำให้ไม่มีผู้ดูแลระบบที่ใช้งานได้เหลืออยู่
    const willManage = role === 'OWNER' || newPerms.includes('ALL') || newPerms.includes('USERS');
    const others = activeHolders(editingId);
    if (!(others.length > 0 || (willManage && active))) {
      return window.showAlert?.('ไม่อนุญาต', 'ต้องมีผู้ใช้ที่จัดการผู้ใช้และใช้งานได้อย่างน้อย 1 คนเสมอ', true);
    }
    if (target) {
      target.name = name; target.role = role; target.permissions = newPerms; target.active = active;
      if (pin) { target.pinHash = await window.makePinHash(pin); target.pinLen = pin.length; delete target.needsPinSetup; }
      delete target.pin;
    } else {
      db0().users.push({ id: 'u-' + Date.now(), name, role, permissions: newPerms, active, pinHash: await window.makePinHash(pin), pinLen: pin.length });
    }
    persistAll();
    window.showToast?.(`บันทึกผู้ใช้ "${name}" แล้ว`);
    renderList();
  }

  // ---------- เปลี่ยนปุ่มเดิมในแท็บผู้ใช้ให้มาที่หน้านี้ ----------
  window.saveUser = function () {
    const id = document.getElementById('edit-user-id')?.value || null;
    window.posUserEdit(id || null);
  };
  window.editUser = id => window.posUserEdit(id);
  window.deleteUser = function (id) {
    if (!window.canDo('USERS')) return denied('USERS');
    const u = (db0().users || []).find(x => x.id === id);
    if (!u) return;
    if (u.role === 'OWNER') return window.showAlert?.('ไม่อนุญาต', 'ไม่สามารถลบเจ้าของร้านได้', true);
    if (activeHolders(id).length === 0 && (u.role === 'OWNER' || perms(u).includes('ALL') || perms(u).includes('USERS')))
      return window.showAlert?.('ไม่อนุญาต', 'ต้องมีผู้จัดการผู้ใช้อย่างน้อย 1 คนเสมอ', true);
    if (!confirm(`ลบผู้ใช้ "${u.name}" ใช่หรือไม่?`)) return;
    db0().users = db0().users.filter(x => x.id !== id);
    persistAll();
  };

  // ---------- เครื่องมือ: ผู้ใช้และสิทธิ์ (แสดงเฉพาะผู้ที่มีสิทธิ์ USERS) ----------
  window.posHub.register({
    id: 'users', group: 'system', icon: '👥', label: 'ผู้ใช้และสิทธิ์',
    visible: () => window.canDo('USERS') && !!window.db.activeUser,
    run: () => window.openUsersPanel()
  });
})();
