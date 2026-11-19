
/* Enterprise Management Repair Layer */
(function(){
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const sb=()=>window.getSupabase?.()||null;
const rolePerm=r=>r==='OWNER'?['ALL']:r==='MANAGER'?['SALE','PRODUCT_CREATE','PRODUCT_EDIT','PRODUCT_DELETE','PURCHASE_ORDER','GOODS_RECEIPT','REPORTS']:['SALE'];
function ensure(){if(!window.db)return;db.users=db.users||[];if(!db.users.some(u=>u.role==='OWNER'))db.users.unshift({id:'owner-local',name:'เจ้าของร้าน',needsPinSetup:true,role:'OWNER',permissions:['ALL'],protected:true});db.users.forEach(u=>{u.role=u.role||'CASHIER';u.permissions=u.permissions||rolePerm(u.role);});window.migratePlaintextPins?.();}
window.ensure = ensure; // เพิ่มขึ้นมา: ให้สคริปต์บล็อกอื่น (เช่นตัวช่วยตั้งค่าเริ่มต้น) เรียกใช้ได้ด้วย ของเดิม scope ปิดอยู่ในนี้ที่เดียว
let _persistFailAlertAt = 0;
let _persistTimer = null, _persistPending = false, _persistLastAt = 0;
const PERSIST_GAP_MS = 300;   // เขียนทั้งฐานถี่สุดทุก 300 มิลลิวินาที (เดิมทุกครั้งที่เรียก — ทำรายการเดียวเรียกหลายครั้งติดกัน)
const OFFLINE_IDB_NAME='smart-pos-offline-v2';
const OFFLINE_IDB_STORE='snapshots';
let _offlineIdb=null;
function openOfflineIdb(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not supported'));
  if(_offlineIdb) return _offlineIdb;
  _offlineIdb=new Promise((resolve,reject)=>{
    const req=indexedDB.open(OFFLINE_IDB_NAME,1);
    req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(OFFLINE_IDB_STORE))d.createObjectStore(OFFLINE_IDB_STORE);};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  });
  return _offlineIdb;
}
function idbPutSnapshot(serialized){
  return openOfflineIdb().then(d=>new Promise((resolve,reject)=>{
    const tx=d.transaction(OFFLINE_IDB_STORE,'readwrite');
    tx.objectStore(OFFLINE_IDB_STORE).put({serialized,savedAt:Date.now()},'main');
    tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'));
  }));
}
function idbGetSnapshot(){
  return openOfflineIdb().then(d=>new Promise((resolve,reject)=>{
    const tx=d.transaction(OFFLINE_IDB_STORE,'readonly'),req=tx.objectStore(OFFLINE_IDB_STORE).get('main');
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('IndexedDB read failed'));
  }));
}
// Awaitable durability barrier for money/stock transactions. A sale is not reported as safely
// saved until at least one local store accepted the complete state including its sync queue.
window.persistDurably = async function(){
  if(window.__factoryResetting) return {ok:false, localStorage:false, indexedDB:false, warning:true};
  const serialized=JSON.stringify(db,(k,v)=>k==='activeUser'?undefined:v);
  let localOk=false, idbOk=false;
  try{localStorage.setItem('pos_full_db_state',serialized);localOk=true;}catch(e){console.warn('localStorage durable write failed',e);try{localStorage.removeItem('pos_full_db_state');}catch(_){}}
  try{await idbPutSnapshot(serialized);idbOk=true;}catch(e){console.warn('IndexedDB durable write failed',e);}
  if(localOk||idbOk){ _persistPending=false; if(_persistTimer){clearTimeout(_persistTimer);_persistTimer=null;} }   // สำเนานี้ครอบคลุมรายการรอเขียนแล้ว
  return {ok:localOk||idbOk, localStorage:localOk, indexedDB:idbOk, warning:!idbOk};
};
function persist(){
  if(window.__factoryResetting) return;   // กำลังล้างข้อมูล: ห้ามเขียนกลับ
  window.posHooks.emit('persist');
  // ว่างอยู่ → เขียนทันที (พฤติกรรมเดิม) / เรียกถี่ติดกัน → รวมเป็นการเขียนครั้งเดียวท้ายช่วง
  const since=Date.now()-_persistLastAt;
  if(!_persistTimer && since>=PERSIST_GAP_MS){ persistNow(); return; }
  _persistPending=true;
  if(!_persistTimer) _persistTimer=setTimeout(()=>{ _persistTimer=null; if(_persistPending) persistNow(); }, Math.max(0,PERSIST_GAP_MS-since));
}
function persistFlush(){ if(_persistTimer){clearTimeout(_persistTimer);_persistTimer=null;} if(_persistPending) persistNow(); }
window.addEventListener('pagehide',persistFlush);
window.addEventListener('beforeunload',persistFlush);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) persistFlush(); });
function persistNow(){
  _persistPending=false; _persistLastAt=Date.now();
  if(window.__factoryResetting) return;
  let serialized='';
  try{
    serialized=JSON.stringify(db,(k,v)=>k==='activeUser'?undefined:v);
    localStorage.setItem('pos_full_db_state',serialized);
  }catch(e){
    console.warn('localStorage persist failed; IndexedDB backup will be attempted',e);
    try{localStorage.removeItem('pos_full_db_state');}catch(_){}   // กันเปิดครั้งหน้าไปโหลดสำเนาเก่าแทนสำเนาล่าสุดใน IndexedDB
  }
  if(serialized){
    idbPutSnapshot(serialized).catch(e=>{
      console.warn('IndexedDB snapshot failed',e);
      const now=Date.now();
      if(now-_persistFailAlertAt>10000){_persistFailAlertAt=now;window.showAlert
        ?window.showAlert('⚠️ สำรองข้อมูลออฟไลน์ไม่สำเร็จ','พื้นที่จัดเก็บในเครื่องอาจเต็มหรือถูกบล็อก ข้อมูลล่าสุดอาจไม่ปลอดภัย กรุณาซิงก์ขึ้น Supabase และสำรองข้อมูล',true)
        :alert('⚠️ สำรองข้อมูลออฟไลน์ไม่สำเร็จ กรุณาซิงก์และสำรองข้อมูล');}
    });
  }else{
    const now=Date.now();
    if(now-_persistFailAlertAt>10000){_persistFailAlertAt=now;window.showAlert
      ?window.showAlert('⚠️ บันทึกข้อมูลไม่สำเร็จ','ไม่สามารถแปลงข้อมูลเพื่อบันทึกได้ กรุณาหยุดทำรายการและสำรองข้อมูล',true)
      :alert('⚠️ บันทึกข้อมูลไม่สำเร็จ กรุณาสำรองข้อมูล');}
  }
}
try{
  const saved=JSON.parse(localStorage.getItem('pos_full_db_state')||'null');
  if(saved){ Object.assign(window.db||{}, saved); if(window.db)window.db.activeUser=null; }
  else {
    Object.assign(window.db||{}, JSON.parse(localStorage.getItem('pos_enterprise_state')||'{}'));
    // Recover the last durable snapshot when localStorage was cleared/evicted.
    // Recovery is guarded against overwriting newer local state.
    window.__offlineRestorePromise=idbGetSnapshot().then(snapshot=>{
      if(!snapshot||localStorage.getItem('pos_full_db_state')) return false;
      const recovered=JSON.parse(snapshot.serialized||'null');if(!recovered)return false;
      Object.assign(window.db||{},recovered);if(window.db)window.db.activeUser=null;
      try{localStorage.setItem('pos_full_db_state',snapshot.serialized);}catch(e){}
      setTimeout(()=>{window.persist?.();window.renderProducts?.();window.renderStockTable?.();window.renderSalesHistory?.();window.smartPOSOfflineStatus?.refresh?.();},0);
      console.warn('Recovered Smart POS state from IndexedDB snapshot');return true;
    }).catch(e=>{console.warn('Offline snapshot recovery unavailable',e);return false;});
  }
}catch(e){console.warn('Local state restore failed',e);}
window.persist=persist;
window.__closeOfflineIdb=function(){const p=_offlineIdb;_offlineIdb=null;return p?p.then(d=>d.close()).catch(()=>{}):Promise.resolve();};
const ok=p=>window.canDo(p)||(window.showAlert?.('ไม่มีสิทธิ์','บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',true),false);
ensure();

window.openUserManagerModal=window.switchSettingsTab?()=>window.switchSettingsTab('USERS'):function(){};
window.renderUserManagerList=function(){ensure();const c=document.getElementById('user-manager-list');if(!c)return;c.innerHTML=db.users.map(u=>`<div class="bg-slate-50 p-3 rounded-xl border flex justify-between"><div><b>${esc(u.name)}</b><span class="block text-[10px] text-indigo-600">${u.role==='OWNER'?'เจ้าของร้าน':u.role==='MANAGER'?'ผู้จัดการ':'พนักงานขาย'}</span></div><div class="flex gap-2"><button onclick="window.editUser('${u.id}')" class="text-indigo-600 font-bold">แก้ไข</button>${u.role==='OWNER'?'<span class="text-slate-400 text-[10px]">ป้องกันลบ</span>':`<button onclick="window.deleteUser('${u.id}')" class="text-rose-500 font-bold">ลบ</button>`}</div></div>`).join('');};

// Migrates any legacy plaintext `pin` field (from before this fix, including the hardcoded
// '0000' owner default) into a hashed `pinHash`, one time, so nothing plaintext lingers in
// memory/localStorage/Supabase going forward.
window.migratePlaintextPins=async function(){let changed=false;for(const u of (db.users||[])){if(u.pin&&!u.pinHash){u.pinHash=await window.makePinHash(u.pin);delete u.pin;changed=true;}}if(changed)persist();};

// ==========================================
// EMPLOYEE PIN LOGIN / LOCK SCREEN
// ==========================================
let _loginSelectedUserId=null, _loginPinBuffer='';

window.renderEmployeeLoginScreen=function(){
  ensure();
  const el=document.getElementById('login-employee-select');
  if(!el)return;
  el.innerHTML=(db.users||[]).filter(u=>u.active!==false).map(u=>`
    <button onclick="window.selectEmployeeForLogin('${u.id}')" class="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-indigo-50 rounded-2xl border text-left btn-touch transition-colors">
      <span class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-black flex-shrink-0">${esc((u.name||'?').charAt(0))}</span>
      <div><b class="block text-sm text-slate-800">${esc(u.name)}</b><span class="text-[10px] text-slate-400">${u.role==='OWNER'?'เจ้าของร้าน':u.role==='MANAGER'?'ผู้จัดการ':'พนักงานขาย'}</span></div>
    </button>
  `).join('');
  const nameEl=document.getElementById('login-store-name');
  if(nameEl)nameEl.innerText=db.storeName||'Smart POS';
};

window.selectEmployeeForLogin=function(id){
  _loginSelectedUserId=id; _loginPinBuffer='';
  const u=db.users.find(x=>x.id===id);
  document.getElementById('login-selected-name').innerText=u?(u.needsPinSetup&&!u.pinHash?u.name+' — ตั้ง PIN ใหม่ 6 หลัก':u.name):'';_pinSetupFirst=null;
  document.getElementById('login-employee-select').classList.add('hidden');
  document.getElementById('login-pin-pad').classList.remove('hidden');
  document.getElementById('login-pin-error').classList.add('hidden');
  window.renderPinDots();
};

window.backToEmployeeSelect=function(){
  _loginSelectedUserId=null; _loginPinBuffer='';
  document.getElementById('login-pin-pad').classList.add('hidden');
  document.getElementById('login-employee-select').classList.remove('hidden');
};

// ความยาว PIN ที่ใช้ตรวจ: ตั้งใหม่ = 6 หลัก / ผู้ใช้เดิมที่ PIN 4 หลักยังล็อกอินได้ (pinLen = 4)
// ถ้ายังไม่รู้ความยาว (บัญชีที่ซิงก์มาจากเครื่องอื่น) จะลองที่ 4 → 5 → 6 หลัก แล้วจำค่าไว้หลังล็อกอินสำเร็จ
window.PIN_LEN = 6; window.PIN_LEGACY_LEN = 4;
window.pinLenFor=function(u){
  if(!u)return window.PIN_LEN;
  if(u.needsPinSetup&&!u.pinHash)return window.PIN_LEN;
  return (u.pinLen>=4&&u.pinLen<=6)?u.pinLen:null;   // null = ยังไม่ทราบ
};
window.renderPinDots=function(){
  const u=(db.users||[]).find(x=>x.id===_loginSelectedUserId), L=window.pinLenFor(u);
  document.querySelectorAll('#login-pin-pad .pin-dot').forEach((dot,i)=>{
    dot.style.display=(L&&i>=L)?'none':'';
    dot.classList.toggle('bg-indigo-600',i<_loginPinBuffer.length);
    dot.classList.toggle('bg-slate-200',i>=_loginPinBuffer.length);
  });
};

window.pinPadInput=function(digit){
  if(_loginPinBuffer.length>=window.PIN_LEN)return;
  _loginPinBuffer+=digit;
  window.renderPinDots();
  const u=(db.users||[]).find(x=>x.id===_loginSelectedUserId), L=window.pinLenFor(u);
  if(L ? _loginPinBuffer.length===L : _loginPinBuffer.length>=window.PIN_LEGACY_LEN) window.verifyEmployeePin();
};
window.pinPadBackspace=function(){_loginPinBuffer=_loginPinBuffer.slice(0,-1);window.renderPinDots();};
window.pinPadClear=function(){_loginPinBuffer='';window.renderPinDots();};

let _pinSetupFirst = null;
// จำนวนครั้งที่กดผิดเก็บใน localStorage เพื่อให้รีเฟรชหน้า/ปิดเปิดแอปแล้วตัวนับไม่รีเซ็ต
// (ข้อจำกัด: ผู้ที่เข้าถึงเครื่องได้ยังล้าง localStorage เองได้ — ฝั่งเซิร์ฟเวอร์ยังล็อก 5 ครั้ง/15 นาทีตอนออนไลน์)
const _PIN_FAILS_KEY = 'pos_pin_fails_v1';
let _pinFails = (() => { try { return JSON.parse(localStorage.getItem(_PIN_FAILS_KEY) || '{}') || {}; } catch (e) { return {}; } })();
const _savePinFails = () => { try { localStorage.setItem(_PIN_FAILS_KEY, JSON.stringify(_pinFails)); } catch (e) {} };
  window.verifyEmployeePin = async function(){
    const u = db.users.find(x => x.id === _loginSelectedUserId);
    if (!u) return;
    const errEl = document.getElementById('login-pin-error');
    const showErr = (msg) => {
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); setTimeout(() => errEl.classList.add('hidden'), 2500); }
      _loginPinBuffer = ''; window.renderPinDots?.();
    };
    const pin = _loginPinBuffer;
    if (u.needsPinSetup && !u.pinHash) {            // ติดตั้งใหม่: ไม่มี PIN เริ่มต้น ต้องตั้งเองก่อนใช้งาน
      if (window.WEAK_PINS.includes(pin)) return showErr('PIN เดาง่ายเกินไป เลือกเลขอื่น');
      if (!_pinSetupFirst) {
        _pinSetupFirst = pin; _loginPinBuffer = ''; window.renderPinDots?.();
        document.getElementById('login-selected-name').innerText = u.name + ' — กรอก PIN อีกครั้งเพื่อยืนยัน';
        return;
      }
      if (_pinSetupFirst !== pin) {
        _pinSetupFirst = null;
        document.getElementById('login-selected-name').innerText = u.name + ' — ตั้ง PIN ใหม่ 6 หลัก';
        return showErr('PIN ทั้งสองครั้งไม่ตรงกัน เริ่มใหม่');
      }
      u.pinHash = await window.makePinHash(pin); u.pinLen = pin.length; delete u.needsPinSetup; _pinSetupFirst = null; window.persist?.();
    } else {
      const f = _pinFails[u.id] || { n: 0, until: 0 };
      if (Date.now() < f.until) return showErr('ลองผิดหลายครั้ง รออีก ' + Math.ceil((f.until - Date.now()) / 1000) + ' วินาที');
      const knownLen = window.pinLenFor(u);
      if (!(await window.verifyPinHash(pin, u.pinHash))) {
        f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(300000, 15000 * Math.pow(2, f.n - 5));
        _pinFails[u.id] = f; _savePinFails();
        if (!knownLen && pin.length < window.PIN_LEN && f.n < 5) { window.renderPinDots?.(); return; }   // ยังไม่ทราบความยาว: ให้พิมพ์ต่อ ไม่ล้างช่อง (แต่นับเป็นการลองผิดแล้ว)
        return showErr(f.n >= 5 ? 'ลองผิดหลายครั้ง ถูกพักการล็อกอินชั่วคราว' : 'PIN ไม่ถูกต้อง');
      }
      delete _pinFails[u.id]; _savePinFails();
      if (u.pinLen !== pin.length) { u.pinLen = pin.length; window.persist?.(); }   // จำความยาว PIN ไว้ใช้ครั้งหน้า
      if (u.pinHash && !u.pinHash.startsWith('pbkdf2$') && window.crypto && crypto.subtle) { u.pinHash = await window.makePinHash(pin); window.persist?.(); }   // อัปเกรด hash เก่าเป็น PBKDF2
    }
    const weak = window.WEAK_PINS.includes(pin);
    db.activeUser = u;
    _loginPinBuffer = '';
    document.getElementById('screen-employee-login').classList.add('hidden');
    window.resetIdleTimer?.();
    window.showToast?.(`สวัสดี ${u.name} 👋`);
    if (weak) window.showAlert?.('⚠️ PIN เดาง่าย', 'บัญชีนี้ใช้ PIN ที่เดาง่าย กรุณาเปลี่ยนที่ ตั้งค่า > ผู้ใช้งาน', true);
    else if (pin.length < window.PIN_LEN) window.showToast?.('แนะนำ: เปลี่ยน PIN เป็น 6 หลักที่ ตั้งค่า > ผู้ใช้งาน');
    window.posHooks.emit('auth:login', u);
  };

  window.lockPOS=function(){
  window.posHooks.emit('auth:lock');
  db.activeUser=null;
  window.backToEmployeeSelect();
  window.renderEmployeeLoginScreen();
  document.getElementById('screen-employee-login').classList.remove('hidden');
};


// Auto-lock after 10 minutes idle — protects against a cashier walking away from an
// unlocked terminal. Any click/touch/keypress resets the timer.
let _idleTimer=null;
window.resetIdleTimer=function(){
  clearTimeout(_idleTimer);
  if(db.activeUser){
    _idleTimer=setTimeout(()=>{window.lockPOS();window.showToast?.('ล็อกหน้าจออัตโนมัติเนื่องจากไม่มีการใช้งาน');},10*60*1000);
  }
};
['click','touchstart','keydown'].forEach(evt=>document.addEventListener(evt,()=>window.resetIdleTimer?.()));

document.addEventListener('DOMContentLoaded',()=>{setTimeout(()=>window.renderEmployeeLoginScreen?.(),0);});

// ==========================================
// PRODUCT FORM — modernized: photo capture, barcode scan-to-field, multiple sizes/variants
// per product added in one form, and split-sale ("แบ่งขาย") units manageable per variant.
let pmVariants = [];
let pmSelectedCats = []; // multi-category selection state for the product being edited

// สินค้าหนึ่งชิ้นเลือกได้หลายหมวดหมู่พร้อมกัน (ติ๊กได้หลายอัน) แทนแบบเดิมที่บังคับเลือกได้
// หมวดเดียว — ให้ผลลัพธ์ตรงกับตาราง product_categories (many-to-many) ที่ฝั่ง sync ไป
// Supabase คาดหวังไว้อยู่แล้ว ทำให้ค้นหา/กรองสินค้าจากหลายหมวดได้ง่ายขึ้นโดยไม่ต้อง
// สร้างสินค้าซ้ำหลายรายการสำหรับของชิ้นเดียวที่เข้าได้กับหลายหมวด
window.togglePmCategoryDropdown = function() {
  const box = document.getElementById('pm-category-dropdown');
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', function closeOnce(e) {
      if (!box.contains(e.target) && e.target.id !== 'pm-category-btn' && !document.getElementById('pm-category-btn').contains(e.target)) {
        box.classList.add('hidden');
        document.removeEventListener('click', closeOnce);
      }
    }), 0);
  }
};

window.renderPmCategoryDropdown = function() {
  const box = document.getElementById('pm-category-dropdown');
  const topLevel = (db.categories || []).filter(c => !c.parentId);
  const childrenOf = pid => (db.categories || []).filter(c => c.parentId === pid);
  const rowHtml = (c, indent) => `
    <label class="flex items-center gap-2 py-1.5 text-xs font-bold text-slate-600 cursor-pointer" style="padding-left:${indent * 14}px">
      <input type="checkbox" value="${esc(c.name)}" ${pmSelectedCats.includes(c.name) ? 'checked' : ''} onchange="window.togglePmCategory('${esc(c.name)}', this.checked)" class="w-4 h-4 rounded accent-emerald-600">
      ${indent ? '↳ ' : ''}${esc(c.icon || '📁')} ${esc(c.name)}
    </label>`;
  let html = '';
  topLevel.forEach(c => { html += rowHtml(c, 0); childrenOf(c.id).forEach(ch => html += rowHtml(ch, 1)); });
  box.innerHTML = html || `<p class="text-slate-400 text-[11px] py-2">ยังไม่มีหมวดหมู่ — เพิ่มได้ที่ปุ่ม 📁 จัดการหมวดหมู่</p>`;
  window.updatePmCategorySummary();
};

window.togglePmCategory = function(name, checked) {
  if (checked && !pmSelectedCats.includes(name)) pmSelectedCats.push(name);
  if (!checked) pmSelectedCats = pmSelectedCats.filter(n => n !== name);
  window.updatePmCategorySummary();
};

window.updatePmCategorySummary = function() {
  const el = document.getElementById('pm-category-summary');
  el.textContent = pmSelectedCats.length ? pmSelectedCats.join(', ') : 'เลือกหมวดหมู่';
};
let pmPhotoDataUrl = null;
let pmPhotoChanged = false;

window.handleProductPhotoSelect = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      const maxDim = 800;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      pmPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.75);
      pmPhotoChanged = true;
      document.getElementById('pm-photo-preview').src = pmPhotoDataUrl;
      document.getElementById('pm-photo-preview').classList.remove('hidden');
      document.getElementById('pm-photo-placeholder').classList.add('hidden');
      document.getElementById('pm-image').value = ''; // photo takes priority over emoji
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
};

// Typing an emoji cancels any selected photo, so it's always clear which one will be used.
window.updateProductEmojiPreview = function() {
  if (document.getElementById('pm-image').value.trim()) {
    pmPhotoDataUrl = null; pmPhotoChanged = true;
    document.getElementById('pm-photo-preview').classList.add('hidden');
    document.getElementById('pm-photo-placeholder').classList.remove('hidden');
  }
};

window.addProductVariantRow = function() {
  const name = document.getElementById('pmv-name').value.trim();
  const barcode = document.getElementById('pmv-barcode').value.trim();
  const cost = parseFloat(document.getElementById('pmv-cost').value) || 0;
  const price = parseFloat(document.getElementById('pmv-price').value) || 0;
  const stock = parseFloat(document.getElementById('pmv-stock').value) || 0;
  if (!name || price <= 0) return window.showAlert?.('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อขนาด/รุ่น และราคาขายให้ถูกต้อง', true);

  pmVariants.push({ id: 'v-' + Date.now() + Math.random().toString(36).slice(2, 5), sizeName: name, barcode, cost, price, stock, minStock: 5, fractions: [] });
  ['pmv-name', 'pmv-barcode', 'pmv-cost', 'pmv-price', 'pmv-stock'].forEach(id => document.getElementById(id).value = '');
  window.renderProductVariantList();
};

window.renderProductVariantList = function() {
  const container = document.getElementById('pm-variant-list');
  container.innerHTML = pmVariants.length ? pmVariants.map((v, idx) => `
    <div class="bg-slate-50 p-2.5 rounded-xl border text-xs">
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0">
          <b class="text-slate-800 block truncate">${escapeHTML(v.sizeName)}</b>
          <span class="text-[10px] text-slate-400">${v.barcode ? 'บาร์โค้ด ' + escapeHTML(v.barcode) : 'ไม่มีบาร์โค้ด'}</span>
        </div>
        ${pmVariants.length > 1 ? `<button onclick="window.splitPMVariantOut(${idx})" title="แยกออกเป็นสินค้าใหม่" class="flex-shrink-0 w-6 h-6 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center btn-touch">↗️</button>` : ''}
        <button onclick="window.removePMVariant(${idx})" class="text-rose-500 font-bold hover:bg-rose-50 rounded-lg w-6 h-6 flex items-center justify-center btn-touch">✕</button>
      </div>
      <div class="flex items-center gap-1.5 mt-1.5">
        <span class="text-slate-400 text-[10px]">ทุน</span>
        <input type="number" step="0.01" value="${v.cost}" oninput="window.updatePMVariantField(${idx},'cost',this.value)" class="w-16 border rounded-lg text-center py-1 outline-none">
        <span class="text-slate-400 text-[10px]">ขาย</span>
        <input type="number" step="0.01" value="${v.price}" oninput="window.updatePMVariantField(${idx},'price',this.value)" class="w-16 border rounded-lg text-center py-1 font-bold outline-none">
        <span class="text-slate-400 text-[10px]">สต็อก</span>
        <input type="number" step="0.01" value="${v.stock}" oninput="window.updatePMVariantField(${idx},'stock',this.value)" class="w-16 border rounded-lg text-center py-1 outline-none">
        <button onclick="window.openAddFractionModal(${idx})" title="ตั้งสินค้าแบ่งขาย" class="ml-auto flex-shrink-0 flex items-center gap-1 px-2 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold btn-touch whitespace-nowrap">✂️ ตั้งแบ่งขาย</button>
      </div>
      ${(v.fractions || []).length ? `<div class="flex flex-wrap gap-1 mt-1.5">${v.fractions.map((f, fi) => `
        <span class="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5 text-[10px] font-bold">
          ✂️ ${escapeHTML(f.fractionName)} ฿${f.fractionPrice}
          <button onclick="window.removePMFraction(${idx},${fi})" class="text-amber-400 hover:text-rose-500">✕</button>
        </span>`).join('')}</div>` : ''}
    </div>
  `).join('') : `<p class="text-center text-slate-400 font-bold py-4 text-xs">ยังไม่มีขนาด/รุ่น — เพิ่มอย่างน้อย 1 รายการด้านบน</p>`;
};

window.updatePMVariantField = function(idx, field, value) {
  if (!pmVariants[idx]) return;
  pmVariants[idx][field] = Math.max(0, parseFloat(value) || 0);
};

window.removePMVariant = function(idx) {
  pmVariants.splice(idx, 1);
  window.renderProductVariantList();
};

// "เอาสินค้าออกจากกลุ่ม" — splits one variant out of the product currently being edited into
// its own brand-new standalone product. Only offered when the product is already saved (has
// an id) and has more than one variant, since splitting the only variant or a not-yet-saved
// draft doesn't have anything meaningful to split from.
window.splitPMVariantOut = function(idx) {
  const pid = document.getElementById('product-edit-id').value;
  if (!pid || !db.products[pid]) return window.showAlert?.('บันทึกก่อน', 'กรุณาบันทึกสินค้านี้ก่อน แล้วค่อยแยกขนาดออกเป็นสินค้าใหม่', true);
  if (pmVariants.length <= 1) return;
  const v = pmVariants[idx];
  if (!confirm(`แยก "${v.sizeName}" ออกเป็นสินค้าใหม่แยกต่างหาก?`)) return;

  const parent = db.products[pid];
  const newId = 'p-' + Date.now();
  db.products[newId] = {
    id: newId, name: v.sizeName, code: window.getAutoSku(), cat: [...(parent.cat || [])],
    image: parent.image, imageUrl: parent.imageUrl,
    minStock: v.minStock || 5, variants: [{ ...v }]
  };
  pmVariants.splice(idx, 1);
  parent.variants = pmVariants.map(x => ({ ...x }));
  window.persist?.();
  window.renderProductVariantList();
  window.renderStockTable();
  window.renderSaleHome?.();
  window.showToast?.(`แยก "${v.sizeName}" เป็นสินค้าใหม่แล้ว`);
  window.syncProductsToSupabase?.(true);
};

window.openAddFractionModal = function(variantIdx) {
  document.getElementById('frac-variant-idx').value = variantIdx;
  document.getElementById('frac-name').value = '';
  document.getElementById('frac-ratio').value = '';
  document.getElementById('frac-price').value = '';
  document.getElementById('modal-add-fraction').classList.remove('hidden');
  document.getElementById('modal-add-fraction').classList.add('flex');
};

window.confirmAddFraction = function() {
  const idx = parseInt(document.getElementById('frac-variant-idx').value);
  const name = document.getElementById('frac-name').value.trim();
  const ratio = parseFloat(document.getElementById('frac-ratio').value) || 0;
  const price = parseFloat(document.getElementById('frac-price').value) || 0;
  if (!name || ratio <= 0 || price <= 0) return window.showAlert?.('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อ จำนวนหน่วยฐานที่ตัดสต็อกต่อ 1 หน่วยนี้ และราคาให้ถูกต้อง', true);
  if (!pmVariants[idx]) return;

  pmVariants[idx].fractions = pmVariants[idx].fractions || [];
  pmVariants[idx].fractions.push({ id: 'f-' + Date.now(), fractionName: name, fractionMultiplier: ratio, fractionPrice: price });
  window.closeModal('modal-add-fraction');
  window.renderProductVariantList();
};

window.removePMFraction = function(variantIdx, fracIdx) {
  pmVariants[variantIdx]?.fractions?.splice(fracIdx, 1);
  window.renderProductVariantList();
};

window.openProductModal = function(id) {
  if (id && !ok('PRODUCT_EDIT')) return;
  if (!id && !ok('PRODUCT_CREATE')) return;

  const p = id ? db.products[id] : null;
  pmSelectedCats = (p?.cat || []).slice();
  window.renderPmCategoryDropdown();
  const set = (k, v) => document.getElementById(k).value = v ?? '';
  set('product-edit-id', id || '');
  set('pm-name', p?.name);
  set('pm-sku', p?.code);

  pmPhotoDataUrl = null; pmPhotoChanged = false; window._pmDuplicateImageUrl = null;
  if (p?.imageUrl) {
    document.getElementById('pm-photo-preview').src = p.imageUrl;
    document.getElementById('pm-photo-preview').classList.remove('hidden');
    document.getElementById('pm-photo-placeholder').classList.add('hidden');
    set('pm-image', '');
  } else {
    document.getElementById('pm-photo-preview').classList.add('hidden');
    document.getElementById('pm-photo-placeholder').classList.remove('hidden');
    set('pm-image', p?.image || '');
  }

  // Load EVERY existing variant (not just the first) so editing a multi-size product doesn't
  // silently drop the rest of its sizes.
  pmVariants = p ? p.variants.map(v => ({ ...v, fractions: (v.fractions || []).map(f => ({ ...f })) })) : [];
  window.renderProductVariantList();
  ['pmv-name', 'pmv-barcode', 'pmv-cost', 'pmv-price', 'pmv-stock'].forEach(fid => document.getElementById(fid).value = '');

  document.getElementById('product-modal-title').textContent = p ? '✏️ แก้ไขสินค้า' : '➕ เพิ่มสินค้า';
  // Only useful when adding a brand-new product — editing is already about one specific item.
  const dupWrap = document.getElementById('pm-duplicate-wrap');
  if (dupWrap) dupWrap.classList.toggle('hidden', !!p);
  window.closeDuplicateProductPicker?.();

  const m = document.getElementById('modal-product-manager');
  m.classList.remove('hidden'); m.classList.add('flex');
};

// ---- "คัดลอกจากสินค้าเดิม" — fast-start a new product from an existing one's category,
// photo, and sizes, instead of typing everything from scratch. Stock resets to 0 (a clone
// is a distinct new catalog entry, not the same physical stock) and barcodes are cleared
// (barcodes must stay unique per item); everything else carries over for quick editing. ----
window.openDuplicateProductPicker = function() {
  document.getElementById('pm-duplicate-wrap').querySelector('button').classList.add('hidden');
  const search = document.getElementById('pm-duplicate-search');
  search.classList.remove('hidden');
  search.value = '';
  search.focus();
  window.filterDuplicateProductPicker();
};

window.closeDuplicateProductPicker = function() {
  const btn = document.getElementById('pm-duplicate-wrap')?.querySelector('button');
  if (btn) btn.classList.remove('hidden');
  document.getElementById('pm-duplicate-search')?.classList.add('hidden');
  document.getElementById('pm-duplicate-results')?.classList.add('hidden');
};

window.filterDuplicateProductPicker = function() {
  const q = (document.getElementById('pm-duplicate-search').value || '').trim().toLowerCase();
  const resultsEl = document.getElementById('pm-duplicate-results');
  const all = Object.values(db.products || {});
  let matches = q
    ? all.filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
    : all;
  matches = matches.slice(0, 40);

  resultsEl.innerHTML = matches.length ? matches.map(p => {
    const img = p.imageUrl
      ? `<img src="${escapeHTML(p.imageUrl)}" class="w-9 h-9 object-cover rounded-lg border flex-shrink-0">`
      : `<span class="w-9 h-9 flex items-center justify-center text-xl flex-shrink-0">${escapeHTML(p.image || '📦')}</span>`;
    return `
      <button type="button" onclick="window.applyProductDuplicate('${p.id}')" class="w-full flex items-center gap-2 p-2 hover:bg-indigo-50 text-left border-b last:border-0 btn-touch">
        ${img}
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xs text-slate-800 truncate">${escapeHTML(p.name)}</div>
          <div class="text-[10px] text-slate-400">SKU: ${escapeHTML(p.code || '-')} • ${p.variants.length} ขนาด</div>
        </div>
      </button>`;
  }).join('') : `<div class="p-4 text-center text-slate-400 text-xs font-bold">ไม่พบสินค้าที่ค้นหา</div>`;
  resultsEl.classList.remove('hidden');
};

window.applyProductDuplicate = function(sourceId) {
  const src = db.products[sourceId];
  if (!src) return;

  document.getElementById('pm-name').value = src.name + ' (สำเนา)';
  document.getElementById('pm-sku').value = ''; // auto-generated fresh on save — SKUs must stay unique
  pmSelectedCats = (src.cat || []).slice();
  window.renderPmCategoryDropdown();

  pmPhotoDataUrl = null; pmPhotoChanged = false; window._pmDuplicateImageUrl = null;
  if (src.imageUrl) {
    document.getElementById('pm-photo-preview').src = src.imageUrl;
    document.getElementById('pm-photo-preview').classList.remove('hidden');
    document.getElementById('pm-photo-placeholder').classList.add('hidden');
    document.getElementById('pm-image').value = '';
    // Carried over by URL reference only (it's already hosted) — saveProduct checks
    // window._pmDuplicateImageUrl before its normal upload logic, so this doesn't get
    // needlessly re-uploaded as a new file.
    window._pmDuplicateImageUrl = src.imageUrl;
  } else {
    document.getElementById('pm-photo-preview').classList.add('hidden');
    document.getElementById('pm-photo-placeholder').classList.remove('hidden');
    document.getElementById('pm-image').value = src.image || '';
  }

  // Clone every size — new ids, barcode cleared (must stay unique), stock reset to 0 (a
  // duplicate is a new catalog entry, not the same physical inventory), price/cost carried over.
  pmVariants = src.variants.map(v => ({
    id: 'v-' + Date.now() + Math.random().toString(36).slice(2, 5),
    sizeName: v.sizeName, unit: v.unit || 'ชิ้น', barcode: '', cost: v.cost, price: v.price, stock: 0, minStock: v.minStock || 5,
    fractions: (v.fractions || []).map(f => ({ id: 'f-' + Date.now() + Math.random().toString(36).slice(2, 5), fractionName: f.fractionName, fractionMultiplier: f.fractionMultiplier, fractionPrice: f.fractionPrice }))
  }));
  window.renderProductVariantList();

  window.closeDuplicateProductPicker();
  window.showToast?.(`คัดลอกจาก "${src.name}" แล้ว — ตรวจสอบและแก้ไขก่อนบันทึก`);
};

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('pm-duplicate-wrap');
  if (wrap && !wrap.contains(e.target)) window.closeDuplicateProductPicker?.();
});

window.saveProduct = async function() {
  const id = document.getElementById('product-edit-id').value;
  if (id && !ok('PRODUCT_EDIT')) return;
  if (!id && !ok('PRODUCT_CREATE')) return;

  const name = document.getElementById('pm-name').value.trim();
  if (!name) return window.showAlert?.('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อสินค้า', true);
  if (!pmVariants.length) return window.showAlert?.('ข้อมูลไม่ครบ', 'กรุณาเพิ่มขนาด/รุ่นอย่างน้อย 1 รายการ', true);

  let sku = document.getElementById('pm-sku').value.trim();
  if (!sku) sku = window.getAutoSku(); // fast entry: don't block on a SKU nobody typed in

  const p = id ? db.products[id] : null;
  const pid = id || ('p-' + Date.now());
  // ตรวจความซ้ำก่อนบันทึก: รหัสสินค้า / SKU ขนาด / บาร์โค้ด ต้องไม่ซ้ำกับสินค้าอื่น และชื่อ+ขนาดต้องไม่ซ้ำ
  // (ป้องกันการเขียนทับกันตอนนำเข้า/ซิงก์ และป้องกันสินค้าที่ขายสับสน)
  {
    const normK = s => String(s || '').trim().toLowerCase();
    const others = Object.values(db.products).filter(x => x.id !== pid);
    const codesOther = new Set(), skusOther = new Set(), barsOther = new Set(), fullOther = new Map();
    others.forEach(x => {
      if (x.code) codesOther.add(normK(x.code));
      (x.variants || []).forEach(v => {
        if (v.sku) skusOther.add(normK(v.sku));
        if (v.barcode) barsOther.add(String(v.barcode).trim());
        const key = normK(x.name) + '|' + normK(v.sizeName);
        if (!fullOther.has(key)) fullOther.set(key, x.name + (v.sizeName ? ' ' + v.sizeName : ''));
      });
    });
    const errs = [];
    if (codesOther.has(normK(sku))) errs.push(`รหัสสินค้า "${sku}" ซ้ำกับสินค้าอื่น — สินค้าแต่ละขนาดต้องมีรหัสของตัวเอง`);
    const seenSku = new Set(), seenBar = new Set(), seenFull = new Set();
    pmVariants.forEach(v => {
      const s = normK(v.sku), b = String(v.barcode || '').trim(), f = normK(name) + '|' + normK(v.sizeName);
      if (s) { if (seenSku.has(s) || skusOther.has(s)) errs.push(`SKU "${v.sku}" ซ้ำ`); seenSku.add(s); }
      if (b) { if (seenBar.has(b) || barsOther.has(b)) errs.push(`บาร์โค้ด "${b}" ซ้ำกับสินค้าอื่น`); seenBar.add(b); }
      if (seenFull.has(f) || fullOther.has(f)) errs.push(`มีสินค้า "${name}${v.sizeName ? ' ' + v.sizeName : ''}" อยู่แล้ว — ใส่ขนาดให้ต่างกันเพื่อไม่ให้สับสน`);
      seenFull.add(f);
    });
    if (errs.length) return window.showAlert?.('ข้อมูลซ้ำ', [...new Set(errs)].slice(0, 5).join('\n'), true);
  }


  let imageUrl = p?.imageUrl || null;
  let imageEmoji = document.getElementById('pm-image').value.trim() || (imageUrl ? '' : '📦');

  if (window._pmDuplicateImageUrl) {
    // Carried over from "คัดลอกจากสินค้าเดิม" — already a hosted URL, nothing to (re-)upload.
    imageUrl = window._pmDuplicateImageUrl;
    imageEmoji = '';
    window._pmDuplicateImageUrl = null;
  } else if (pmPhotoChanged) {
    if (pmPhotoDataUrl && /^https?:\/\//i.test(pmPhotoDataUrl)) { imageUrl = pmPhotoDataUrl; } else if (pmPhotoDataUrl) {
      // Try to upload the compressed photo to Supabase Storage so it's usable across devices;
      // fall back to keeping the compressed data URL locally if offline or upload fails.
      try {
        const c = sb();
        if (c) {
          const blob = await (await fetch(pmPhotoDataUrl)).blob();
          const path = `${pid}_${Date.now()}.jpg`;
          const { error: upErr } = await c.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
          if (!upErr) { const { data } = c.storage.from('product-images').getPublicUrl(path); imageUrl = data.publicUrl; }
          else { imageUrl = pmPhotoDataUrl; }
        } else {
          imageUrl = pmPhotoDataUrl;
        }
      } catch (e) { imageUrl = pmPhotoDataUrl; console.warn('product photo upload failed, kept locally', e); }
      imageEmoji = '';
    } else {
      imageUrl = null; // user cleared the photo in favor of an emoji
    }
  }

  const _oldProd = db.products[pid];
  db.products[pid] = {
    id: pid, name, code: sku, cat: pmSelectedCats.slice(),
    image: imageEmoji, imageUrl,
    minStock: pmVariants[0]?.minStock || 5,
    variants: pmVariants.map(v => ({ ...v }))
  };

  window.persist?.();
  window.closeModal('modal-product-manager');
  window.renderStockTable();
  window.renderSaleHome?.();
  window.populatePOPickers?.();
  window.showToast?.(id ? 'บันทึกการแก้ไขสินค้าสำเร็จ' : `เพิ่มสินค้าสำเร็จ (SKU: ${sku})`);

  // Best-effort background push — reuses the same product/variant/fraction mapping as the
  // periodic full sync, so there's no separate, possibly-drifting mapping logic to maintain here.
  if (_oldProd) {   // จำนวนที่แก้ในหน้าสินค้า → ส่งเป็นรายการปรับสต็อก (เซิร์ฟเวอร์ไม่รับการเขียนสต็อกตรงๆ แล้ว)
    pmVariants.forEach(nv => {
      const ov = (_oldProd.variants || []).find(x => x.id === nv.id);
      if (ov && roundStock(+ov.stock || 0) !== roundStock(+nv.stock || 0)) {
        window.enqueueSync({ type: 'adjust', payload: { variantId: nv.id, value: roundStock(+nv.stock || 0), reason: 'แก้ไขจำนวนในหน้าสินค้า', opRef: 'ADJ-' + Date.now() + '-' + window.getDeviceId() + '-' + nv.id } }, true);
      }
    });
  }
  window.syncProductsToSupabase?.(true)?.then?.(() => window.flushSyncQueue?.());
};

window.deleteProduct = async id => {
  if (!ok('PRODUCT_DELETE') || !confirm('ยืนยันการลบสินค้านี้?')) return;
  window.enqueueSync({ type: 'delete', payload: { kind: 'product', id, note: db.products[id]?.name || '' } });   // เดิมส่ง id ในเครื่องตรงๆ (ไม่ใช่ UUID) จึงไม่เคยลบสำเร็จ
  delete db.products[id];
  window.persist?.();
  window.renderStockTable();
  window.renderSaleHome?.();
  window.populatePOPickers?.();
};


window.confirmReceivePO=async function(){if(!ok('GOODS_RECEIPT'))return;const supplierId=document.getElementById('po-supplier-select').value;let docRef=document.getElementById('po-doc-ref').value.trim();const terms=parseInt(document.getElementById('po-credit-terms').value)||30;if(!supplierId)return window.showAlert?.('ข้อมูลไม่ครบ','กรุณาเลือกซัพพลายเออร์',true);if(!poTempItems?.length)return window.showAlert?.('ไม่มีรายการ','กรุณาเพิ่มรายการรับสินค้า',true);if((document.getElementById('po-pay-mode')?.value)==='CASH'&&!db.currentShift)return window.showAlert?.('ยังไม่ได้เปิดกะ','การจ่ายสดจากลิ้นชักต้องเปิดกะก่อน หรือเลือกวิธีชำระอื่น',true);
  // เลขที่ใบส่งของ is now optional — if the supplier's own delivery-note number wasn't typed
  // in, run our own sequential number automatically rather than blocking the whole receipt.
  if(!docRef){docRef=window.getGoodsReceiptNumber();document.getElementById('po-doc-ref').value=docRef;}
  const receipt={id:'GR-'+Date.now(),supplierId,docRef,terms,status:'RECEIVED',items:poTempItems.map(x=>({...x})),receivedAt:new Date().toISOString()};
  // Delivery-note attachments (multiple images and/or PDFs): upload each to Supabase Storage
  // when online so they survive a browser cache clear (this is accounting evidence, not
  // throwaway UI state); fall back to keeping the local copy on the record itself if offline
  // or if a particular upload fails, so nothing is ever silently lost either way.
  if(typeof poDeliveryNoteFiles!=='undefined'&&poDeliveryNoteFiles.length){
    receipt.deliveryNoteUrls=[];
    const c=sb();
    for(let i=0;i<poDeliveryNoteFiles.length;i++){
      const f=poDeliveryNoteFiles[i];
      const ext=f.mime==='application/pdf'?'pdf':'jpg';
      try{
        if(c){
          const blob=await (await fetch(f.dataUrl)).blob();
          const _tok=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():(Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2));const path=`${_tok}_${Date.now()}_${i}.${ext}`;
          const{error:upErr}=await c.storage.from('delivery-notes').upload(path,blob,{contentType:f.mime,upsert:true});
          if(!upErr){const{data}=c.storage.from('delivery-notes').getPublicUrl(path);receipt.deliveryNoteUrls.push(data.publicUrl);}
          else{receipt.deliveryNoteUrls.push(f.dataUrl);console.warn('delivery note upload failed, kept locally',upErr);}
        }else{
          receipt.deliveryNoteUrls.push(f.dataUrl); // offline fallback
        }
      }catch(e){receipt.deliveryNoteUrls.push(f.dataUrl);console.warn('delivery note upload error, kept locally',e);}
    }
  }
  db.purchaseOrders=db.purchaseOrders||[];db.purchaseOrders.push(receipt);for(const x of poTempItems){const p=db.products[x.productId],v=(p?.variants||[]).find(y=>y.id===x.variantId)||p?.variants?.[0];if(v){{const _os=Math.max(0,+v.stock||0),_q=+x.qty||0,_nc=+x.cost||0;if(_nc>0){v.cost=_os>0?roundAmt((_os*(+v.cost||0)+_q*_nc)/(_os+_q)):_nc;}v.stock=(+v.stock||0)+_q;}}}db.cashLedger=db.cashLedger||[];const _payMode=document.getElementById('po-pay-mode')?.value||'CREDIT';const _apTotal=roundAmt(poTempItems.reduce((a,x)=>a+x.total,0));const apEntry={id:'AP-'+Date.now(),type:'ACCOUNTS_PAYABLE',supplierId,docRef,amount:_apTotal,terms,status:_payMode==='CREDIT'?'OPEN':'PAID',paidAt:_payMode==='CREDIT'?null:receipt.receivedAt,payMethod:_payMode,createdAt:receipt.receivedAt};db.cashLedger.push(apEntry);if(_payMode==='CASH'&&db.currentShift){db.currentShift.movements=db.currentShift.movements||[];db.currentShift.movements.push({id:'MV-'+Date.now()+'-ap',type:'OUT',amount:_apTotal,note:'ซื้อสินค้า '+docRef,time:Date.now()});}persist();const itemsForSync=receipt.items;poTempItems.length=0;window.renderPOCartList();window.renderStockTable();window.renderPurchaseHistory();window.clearDeliveryNote?.();window.showToast?.('รับสินค้าเข้าคลังและบันทึกเจ้าหนี้สำเร็จ');document.getElementById('po-doc-ref').value='';{const _pm=document.getElementById('po-pay-mode');if(_pm)_pm.value='CREDIT';}
  // Best-effort authoritative push to Supabase via the proper purchase_orders →
  // purchase_order_items → receive_purchase_order RPC flow (the schema's real, atomic
  // receiving path — it locks rows, validates received quantity against ordered quantity, and
  // writes an inventory_movements audit entry). Runs in the background so the cashier flow
  // above never blocks on network; local stock/AP are already authoritative either way.
  window.enqueueSync({type:'receive',payload:{receiptId:receipt.id,apId:apEntry.id,payNow:apEntry.status==='PAID'}});
};

window.syncGoodsReceiptToSupabase=function(receipt,supplierId,docRef,terms,apEntry){window.enqueueSync({type:'receive',payload:{receiptId:receipt.id,apId:apEntry&&apEntry.id}});};

// Purchase history + accounts-payable panel (§2.3/2.7 of the manual — "รับสินค้าเข้าคลัง...ตั้งยอดเจ้าหนี้การค้าให้อัตโนมัติ")
window.renderPurchaseHistory=function(){
  const listEl=document.getElementById('po-history-list');
  if(listEl){
    const pos=(db.purchaseOrders||[]).slice().reverse();
    listEl.innerHTML=pos.length?pos.map(po=>{
      const supplier=db.suppliers[po.supplierId]?.name||po.supplierId||'-';
      const total=(po.items||[]).reduce((s,x)=>s+(x.total||0),0);
      const dt=new Date(po.receivedAt||po.createdAt).toLocaleString('th-TH');
      const itemsLabel=(po.items||[]).map(x=>`${esc(x.productName)} ×${x.qty}`).join(', ');
      const urls=po.deliveryNoteUrls||(po.deliveryNoteUrl?[po.deliveryNoteUrl]:[]); // deliveryNoteUrl = legacy single-file records from before multi-file support
      const noteThumbs=urls.map(u=>{
        const isPdf=/\.pdf($|\?)/i.test(u)||u.startsWith('data:application/pdf');
        return isPdf
          ?`<div data-url="${esc(u)}" onclick="window.open(this.dataset.url,'_blank','noopener')" class="w-12 h-12 flex items-center justify-center rounded-lg border bg-indigo-50 text-xl flex-shrink-0 cursor-pointer" title="เปิดไฟล์ PDF ใบส่งของ">📄</div>`
          :`<img src="${esc(u)}" data-url="${esc(u)}" onclick="window.open(this.dataset.url,'_blank','noopener')" class="w-12 h-12 object-cover rounded-lg border flex-shrink-0 cursor-pointer" title="ดูรูปใบส่งของ">`;
      }).join('');
      return `<div class="bg-slate-50 p-3 rounded-xl border text-xs flex gap-2">
        ${noteThumbs ? `<div class="flex flex-col gap-1 flex-shrink-0">${noteThumbs}</div>` : ''}
        <div class="flex-1 min-w-0">
          <div class="flex justify-between font-bold text-slate-800"><span>${esc(po.docRef||po.id)}</span><span class="text-indigo-600">${formatMoney(total)}</span></div>
          <div class="text-slate-400 text-[10px] flex justify-between mt-0.5"><span>${esc(supplier)}</span><span>${dt}</span></div>
          <div class="text-[10px] text-slate-500 mt-1">${itemsLabel}</div>
        </div>
      </div>`;
    }).join(''):`<p class="text-center text-slate-400 font-bold py-6">ยังไม่มีประวัติการรับสินค้า</p>`;
  }
  const apEl=document.getElementById('po-ap-list');
  if(apEl){
    const now=Date.now();
    const aps=(db.cashLedger||[]).filter(x=>x.type==='ACCOUNTS_PAYABLE').slice().reverse();
    apEl.innerHTML=aps.length?aps.map(ap=>{
      const supplier=db.suppliers[ap.supplierId]?.name||ap.supplierId||'-';
      const created=new Date(ap.createdAt);
      const due=new Date(created.getTime()+(ap.terms||30)*86400000);
      const daysLeft=Math.ceil((due-now)/86400000);
      const isPaid=ap.status==='PAID';
      const overdue=!isPaid&&daysLeft<0;
      const dueLabel=isPaid?'ชำระแล้ว':overdue?`เกินกำหนด ${Math.abs(daysLeft)} วัน`:`ครบกำหนดใน ${daysLeft} วัน`;
      return `<div class="p-3 rounded-xl border text-xs ${isPaid?'bg-slate-50 border-slate-200':overdue?'bg-rose-50 border-rose-200':'bg-amber-50 border-amber-200'}">
        <div class="flex justify-between font-bold text-slate-800"><span>${esc(supplier)}</span><span>${formatMoney(ap.amount)}</span></div>
        <div class="text-[10px] text-slate-500 flex justify-between mt-0.5">
          <span>${esc(ap.docRef||'')} | ครบกำหนด ${due.toLocaleDateString('th-TH')}</span>
          <span class="font-bold ${isPaid?'text-slate-400':overdue?'text-rose-600':'text-amber-600'}">${dueLabel}</span>
        </div>
        ${isPaid?'':`<button onclick="window.markAPPaid('${ap.id}')" class="mt-2 w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold btn-touch">✅ บันทึกว่าชำระแล้ว</button>`}
      </div>`;
    }).join(''):`<p class="text-center text-slate-400 font-bold py-6">ไม่มีรายการเจ้าหนี้ค้างชำระ</p>`;
  }
};
window.markAPPaid=function(id){if(!ok('ALL')&&!ok('GOODS_RECEIPT'))return;const ap=(db.cashLedger||[]).find(x=>x.id===id);if(!ap||ap.status==='PAID')return;if(!confirm('ยืนยันจ่ายเจ้าหนี้ '+formatMoney(ap.amount)+' ?'))return;let viaDrawer=false;if(db.currentShift&&confirm('จ่ายเป็นเงินสดจากลิ้นชักในกะนี้หรือไม่?\n\nตกลง = จ่ายจากลิ้นชัก (บันทึกเงินออกในกะ)\nยกเลิก = จ่ายด้วยวิธีอื่น เช่น โอน (ไม่กระทบเงินในลิ้นชัก)')){db.currentShift.movements=db.currentShift.movements||[];db.currentShift.movements.push({id:'MV-'+Date.now()+'-ap',type:'OUT',amount:roundAmt(ap.amount),note:'จ่ายเจ้าหนี้ '+(ap.docRef||''),time:Date.now()});viaDrawer=true;}ap.status='PAID';ap.paidAt=new Date().toISOString();ap.payMethod=viaDrawer?'CASH':'OTHER';persist();window.renderPurchaseHistory();window.showToast?.('บันทึกการชำระเงินเรียบร้อย');window.payAPRemote(id, viaDrawer?'CASH':'TRANSFER').then(()=>window.syncTransactionsToSupabase?.(true)).catch(e=>{ap.status='OPEN';ap.paidAt=null;ap.payMethod=null;persist();window.renderPurchaseHistory();window.showAlert?.('จ่ายเจ้าหนี้ยังไม่ถูกบันทึกในฐาน','ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อบันทึกการจ่าย ('+(e.message||e)+')',true);});};

  // บันทึกการจ่ายเจ้าหนี้ที่ฐานข้อมูล (ผ่านฟังก์ชันที่ตรวจสิทธิ์และลงเงินสดในกะ)
  window.payAPRemote = async function(apId, method){
    const c = window.getSupabaseClient?.();
    if (!c) return { skipped: true };
    // p_post_cash:false = เงินสดถูกบันทึกในลิ้นชักของแอปแล้ว ไม่ลงซ้ำในฐาน (ดู patch 007)
    const { data, error } = await c.rpc('pay_supplier', { p_ap_id: toUUID(apId), p_method: method, p_note: null, p_post_cash: false, p_session: window.posSessionToken() });
    if (error) throw error;
    return data;
  };

document.addEventListener('DOMContentLoaded',()=>{ensure();window.renderStockTable?.();});
})();
