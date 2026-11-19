
      // ==========================================
      // MASTER APPLICATION LOGIC & STATE
      // ==========================================
      const roundAmt = (num) => {
        const n = parseFloat(num) || 0;
        return Number(Math.round(Number(n + 'e2')) + 'e-2');
      };
      const roundStock = (num) => {
        const n = parseFloat(num) || 0;
        return Number(Math.round(Number(n + 'e4')) + 'e-4');
      };
      const formatMoney = (val) => "฿" + roundAmt(val).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
window.formatMoney = formatMoney;

      // จุดเชื่อมกลางของระบบ: ฟังก์ชันหลักประกาศเหตุการณ์ (emit) ส่วนเสียง/แผนผังชั้นวาง/ปุ่มเสริมรับฟัง (on)
      // แทนการห่อฟังก์ชันซ้อนกันหลายชั้น
      // โหลดไลบรารีหนักเฉพาะตอนกดใช้ (สแกนบาร์โค้ด / นำเข้า-ส่งออก Excel / ZIP) แทนการโหลดตอนเปิดแอป
      window.posLoadLib = (function () {
        const LIBS = {
          qrcode:  { g: 'Html5Qrcode', src: 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js' },
          xlsx:    { g: 'XLSX',        src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' },
          jszip:   { g: 'JSZip',       src: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js' },
          exceljs: { g: 'ExcelJS',     src: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js' }
        };
        const pending = {};
        return function (name) {
          const lib = LIBS[name];
          if (!lib) return Promise.reject(new Error('ไม่รู้จักไลบรารี ' + name));
          if (window[lib.g]) return Promise.resolve(true);
          if (pending[name]) return pending[name];
          return pending[name] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = lib.src;
            s.onload = () => resolve(true);
            s.onerror = () => { delete pending[name]; s.remove(); reject(new Error('โหลดไลบรารี ' + lib.g + ' ไม่สำเร็จ — ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต')); };
            document.head.appendChild(s);
          });
        };
      })();

      window.posHooks = (function () {
        const subs = {};
        return {
          on(name, fn) { (subs[name] = subs[name] || []).push(fn); },
          emit(name, arg) { (subs[name] || []).slice().forEach(fn => { try { fn(arg); } catch (e) { console.warn('hook ' + name, e); } }); }
        };
      })();

      // SHA-256 hash for employee PINs — PINs must never be stored or synced as plaintext.
      window.hashPin = async function(pin) {
        const str = String(pin);
        if (crypto?.subtle) {
          try {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
          } catch (e) {
            console.warn('crypto.subtle.digest failed, falling back to non-crypto hash:', e);
          }
        }
        const h1 = fnv1a(str, 0x1000193).toString(16).padStart(8, '0');
        const h2 = fnv1a(str + '\u0005', 0x2000193).toString(16).padStart(8, '0');
        const h3 = fnv1a(str + '\u0006', 0x3000193).toString(16).padStart(8, '0');
        const h4 = fnv1a(str + '\u0007', 0x4000193).toString(16).padStart(8, '0');
        return h1 + h2 + h3 + h4;
      };

      // FNV-1a 32-bit — เร็ว, sync, กระจายบิตดีพอสำหรับปั้น id ให้ดูสุ่ม (ไม่ใช่ crypto hash
      // แท้ๆ แต่พอสำหรับจุดประสงค์นี้เพราะรันกับ 4 seed คนละค่ากัน ไม่ได้พึ่ง seed เดียว)
      function fnv1a(str, seed) {
        let h = seed >>> 0;
        for (let i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
      }

      function toUUID(str) {
        if (!str) return null;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(str)) return str;
        const h1 = fnv1a(str, 0x811c9dc5).toString(16).padStart(8, '0');
        const h2 = fnv1a(str + '\u0001', 0x9e3779b9).toString(16).padStart(8, '0');
        const h3 = fnv1a(str + '\u0002', 0x85ebca6b).toString(16).padStart(8, '0');
        const h4 = fnv1a(str + '\u0003', 0xc2b2ae35).toString(16).padStart(8, '0');
        const c = h1 + h2 + h3 + h4; // 32 hex chars รวม = 128 บิต เอนโทรปีอิสระจริง
        return `${c.slice(0,8)}-${c.slice(8,12)}-4${c.slice(13,16)}-8${c.slice(17,20)}-${c.slice(20,32)}`;
      }
      window.toUUID = toUUID;

      // PERF FIX (#8): เดิมพิมพ์ค้นหาในตารางสต็อกทีเดียวก็ re-render ทั้งตารางทันที ถ้าสินค้าเยอะ
      // (หลักพันรายการ) จะกระตุกทุกตัวอักษรที่พิมพ์ — หน่วงไว้ 200ms ให้พิมพ์เสร็จก่อนค่อย render
      window.debouncedRenderStockTable = (function(){
        let t = null;
        return function(){
          clearTimeout(t);
          t = setTimeout(() => window.renderStockTable?.(), 200);
        };
      })();

      function escapeHTML(str) {
        if (!str) return '';
        return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      }

      function naturalCompare(a, b) {
        const chunk = s => (s || '').toString().match(/\d+|\D+/g) || [];
        const ca = chunk(a), cb = chunk(b);
        const len = Math.max(ca.length, cb.length);
        for (let i = 0; i < len; i++) {
          const xa = ca[i] || '', xb = cb[i] || '';
          const na = /^\d+$/.test(xa), nb = /^\d+$/.test(xb);
          if (na && nb) {
            const diff = parseInt(xa, 10) - parseInt(xb, 10);
            if (diff !== 0) return diff;
          } else {
            const diff = xa.localeCompare(xb, 'th');
            if (diff !== 0) return diff;
          }
        }
        return 0;
      }

      // GLOBAL STATE DB
      let db = {
        storeName: "",
        storeAddress: "",
        promptPayId: "",
        categories: [],
        products: {},
        customers: {},
        suppliers: {},
        users: [],
        bills: [], cashLedger: [], counters: { dailyBillNum: 0, lastBillDate: "" }
      };

      let cart = [];
      let activeCategory = null;
      let activePayMethod = 'CASH';
      let stockSortBy = 'name';
      let stockSortDir = 'asc';
      let poTempItems = [];
      let pendingImportList = [];
      let scanner = null;

      window.db = db;
      window.cart = cart;

      // ==========================================
      // BULK IMAGE IMPORT WITH JSON MAPPING IMPLEMENTATION
      // ==========================================
      window.openBulkImageModal = function() {
        document.getElementById('modal-bulk-image').classList.remove('hidden');
        document.getElementById('modal-bulk-image').classList.add('flex');
      };

      window.startBulkImageImport = async function() {
        const jsonInput = document.getElementById('bulk-json-input');
        const filesInput = document.getElementById('bulk-image-files-input');
        const btn = document.getElementById('btn-start-bulk-image');
        const progressWrap = document.getElementById('bulk-image-progress-wrap');
        const progressBar = document.getElementById('bulk-image-progress-bar');
        const progressText = document.getElementById('bulk-image-progress-text');

        if (!jsonInput.files[0]) return window.showAlert("ข้อมูลไม่ครบ", "กรุณาเลือกไฟล์ image mapping.json", true);
        if (!filesInput.files.length) return window.showAlert("ข้อมูลไม่ครบ", "กรุณาเลือกไฟล์รูปภาพสินค้าอย่างน้อย 1 ไฟล์", true);

        let mappingData = {};
        try {
          const jsonText = await jsonInput.files[0].text();
          mappingData = JSON.parse(jsonText);
        } catch (err) {
          return window.showAlert("ไฟล์ JSON ไม่ถูกต้อง", "ไม่สามารถอ่านโครงสร้างไฟล์ JSON ได้", true);
        }

        const imageFilesMap = {};
        Array.from(filesInput.files).forEach(f => {
          imageFilesMap[f.name] = f;
        });

        const entries = Object.entries(mappingData);
        if (entries.length === 0) return window.showAlert("ไม่มีข้อมูล", "ไฟล์ JSON ไม่มีรายการจับคู่รูปภาพ", true);

        btn.disabled = true;
        btn.innerText = "กำลังประมวลผล...";
        progressWrap.classList.remove('hidden');

        let successCount = 0;
        let cloudCount = 0;
        let localOnlyCount = 0;
        let skippedNoUpload = 0;
        let processedCount = 0;
        const client = window.getSupabaseClient();

        for (const [productName, fileName] of entries) {
          processedCount++;
          const pct = Math.round((processedCount / entries.length) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.innerText = `${processedCount} / ${entries.length} - กำลังประมวลผล: ${productName}`;

          const file = imageFilesMap[fileName];
          if (!file) continue;

          // Find product by name
          const _nm = (t) => String(t || '').normalize('NFC').trim();
        const p = Object.values(db.products).find(x => _nm(x.name) === _nm(productName));
          if (!p) continue;

          // Upload to Supabase storage if client exists
          let publicUrl = '';
          if (client) {
            try {
              const path = `product-${p.id}-${Date.now()}.${file.name.split('.').pop()}`;
              const { error: upErr } = await client.storage.from('product-images').upload(path, file, { upsert: true });
              if (upErr) throw upErr;
              const { data } = client.storage.from('product-images').getPublicUrl(path);
              publicUrl = data.publicUrl;
            } catch (e) { console.warn('product image upload failed', p.id, e); }
          }

          if (publicUrl) {
            p.imageUrl = publicUrl; cloudCount++;
          } else if (entries.length > 30) {
            skippedNoUpload++; continue;   // รูปจำนวนมากเก็บเป็น base64 ในเครื่องไม่ได้ (เกินโควตา 5MB ทำให้ข้อมูลหาย) ต้องอัปโหลดขึ้น Supabase เท่านั้น
          } else {
            p.imageUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => resolve('');
              reader.readAsDataURL(file);
            });
            if (p.imageUrl) localOnlyCount++; else { skippedNoUpload++; continue; }
          }
          if (p.imageUrl) successCount++;
        }

        btn.disabled = false;
        btn.innerText = "🚀 เริ่มจับคู่และนำเข้ารูปภาพ";
        window.persist?.();
        await window.syncProductsToSupabase?.(true);   // รอให้บันทึก image_url ขึ้น Cloud ก่อนรายงานว่าสำเร็จ
        window.closeModal('modal-bulk-image');
        window.renderStockTable();
        window.renderSaleHome?.();
        window.showAlert("สรุปการนำเข้ารูปภาพ", `จับคู่ได้ ${successCount}/${entries.length} รายการ\nอัปโหลดขึ้น Supabase สำเร็จ ${cloudCount} รายการ\nเก็บไว้เฉพาะเครื่องนี้ ${localOnlyCount} รายการ (อุปกรณ์อื่นยังไม่เห็นรูป)\nข้าม/อ่านไฟล์ไม่สำเร็จ ${skippedNoUpload} รายการ` + (skippedNoUpload ? `\n\nตรวจสอบการเชื่อมต่อและสิทธิ์ Storage แล้วลองนำเข้าเฉพาะรายการที่ยังขาด` : ''), skippedNoUpload > 0 || localOnlyCount > 0);
      };

      // ==========================================
      // CATEGORY, USER & SUPPLIER MANAGERS
      // ==========================================
      window.openCategoryModal = function() {
        window.renderCategoryManagerList();
        window.renderCategoryParentOptions();
        document.getElementById('edit-cat-id').value = '';
        document.getElementById('modal-category').classList.remove('hidden');
        document.getElementById('modal-category').classList.add('flex');
      };

      // มาตรฐานทั่วไปสำหรับหมวดหมู่สินค้าคือโครงสร้างต้นไม้แบบ parent/child ชั้นเดียวหรือหลายชั้น
      // (เช่น "เครื่องมือช่าง" > "สว่าน" > "สว่านไร้สาย") — ที่นี่รองรับหมวดหมู่ย่อยด้วยฟิลด์
      // parentId บนตัวหมวดหมู่เอง ส่วนสินค้าหนึ่งชิ้นผูกกับ "หมวดหมู่" ได้หลายรายการพร้อมกัน
      // (ผ่าน p.cat ที่เป็น array อยู่แล้ว — ตรงกับตาราง product_categories แบบ many-to-many
      // ที่ระบบซิงก์ไป Supabase คาดหวังไว้ตั้งแต่แรก) จึงค้นหาสินค้าเจอได้จากหลายเส้นทาง
      // โดยไม่ต้องเลือกว่าสินค้าจะ "อยู่หมวดไหนหมวดเดียว" อีกต่อไป
      window.renderCategoryParentOptions = function(excludeId) {
        const sel = document.getElementById('cat-parent-input');
        const topLevel = db.categories.filter(c => !c.parentId && c.id !== excludeId);
        sel.innerHTML = `<option value="">— หมวดหมู่หลัก (ไม่มีแม่) —</option>` +
          topLevel.map(c => `<option value="${c.id}">${escapeHTML(c.icon || '📁')} ${escapeHTML(c.name)}</option>`).join('');
      };

      window.renderCategoryManagerList = function() {
        const container = document.getElementById('cat-manager-list');
        const topLevel = db.categories.filter(c => !c.parentId);
        const childrenOf = pid => db.categories.filter(c => c.parentId === pid);
        const rowHtml = (c, indent) => `
          <div class="bg-slate-50 p-2.5 rounded-xl border flex justify-between items-center" style="margin-left:${indent * 16}px">
            <div class="flex items-center gap-2 min-w-0">
              ${indent ? '<span class="text-slate-300">↳</span>' : ''}
              <span class="text-base">${escapeHTML(c.icon || '📁')}</span>
              <b class="truncate">${escapeHTML(c.name)}</b>
            </div>
            <div class="flex-shrink-0 flex gap-2">
              <button onclick="window.editCategory('${c.id}')" class="text-indigo-600 font-bold hover:underline">แก้ไข</button>
              <button onclick="window.deleteCategory('${c.id}')" class="text-rose-500 font-bold hover:underline">ลบ</button>
            </div>
          </div>`;
        let html = '';
        topLevel.forEach(c => {
          html += rowHtml(c, 0);
          childrenOf(c.id).forEach(child => { html += rowHtml(child, 1); });
        });
        container.innerHTML = html || `<p class="text-center text-slate-400 font-bold py-3">ยังไม่มีหมวดหมู่</p>`;
      };

      window.editCategory = function(id) {
        const c = db.categories.find(x => x.id === id);
        if (!c) return;
        document.getElementById('edit-cat-id').value = c.id;
        document.getElementById('cat-name-input').value = c.name;
        document.getElementById('cat-icon-input').value = c.icon || '';
        document.getElementById('cat-color-input').value = c.color || '#6366f1';
        window.renderCategoryParentOptions(c.id); // exclude self from the parent list — a category can't be its own parent
        document.getElementById('cat-parent-input').value = c.parentId || '';
      };

      window.saveCategory = function() {
        const editId = document.getElementById('edit-cat-id').value;
        const name = document.getElementById('cat-name-input').value.trim();
        const icon = document.getElementById('cat-icon-input').value.trim() || '📁';
        const color = document.getElementById('cat-color-input').value;
        const parentId = document.getElementById('cat-parent-input').value || null;
        if (!name) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อหมวดหมู่", true);
        if (parentId === editId) return window.showAlert("ผิดพลาด", "หมวดหมู่ไม่สามารถเป็นแม่ของตัวเองได้", true);

        if (editId) {
          const c = db.categories.find(x => x.id === editId);
          if (c) { c.name = name; c.icon = icon; c.color = color; c.parentId = parentId; }
        } else {
          db.categories.push({ id: 'cat-' + Date.now(), name, icon, color, parentId });
        }
        document.getElementById('edit-cat-id').value = '';
        document.getElementById('cat-name-input').value = '';
        document.getElementById('cat-icon-input').value = '';
        window.persist?.();
        window.renderCategoryManagerList();
        window.renderCategoryParentOptions();
        window.renderSaleHome?.();
        window.showToast("บันทึกหมวดหมู่สำเร็จ");
      };

      window.deleteCategory = function(id) {
        const cat = db.categories.find(c => c.id === id);
        if (!cat) return;
        // ก่อนลบ: ปลดหมวดหมู่ย่อยของหมวดนี้ให้กลายเป็นหมวดหมู่หลักแทน (ไม่ลบตาม เพื่อไม่ให้
        // ข้อมูลหายเป็นลูกโซ่โดยไม่ตั้งใจ) และเอาชื่อหมวดหมู่นี้ออกจากทุกสินค้าที่เคยผูกไว้
        // ไม่งั้นสินค้าจะยังมีชื่อหมวดหมู่ที่ไม่มีอยู่จริงค้างอยู่ใน p.cat
        db.categories.forEach(c => { if (c.parentId === id) c.parentId = null; });
        Object.values(db.products || {}).forEach(p => {
          if (p.cat && p.cat.includes(cat.name)) p.cat = p.cat.filter(n => n !== cat.name);
        });
        db.categories = db.categories.filter(c => c.id !== id);
        window.persist?.();
        window.renderCategoryManagerList();
        window.renderCategoryParentOptions?.();
        window.renderStockTable?.();
        window.renderSaleHome?.();
        window.showToast("ลบหมวดหมู่สำเร็จ");
      };

      // Employee management now lives inline in the Settings > USERS tab (see switchSettingsTab)
      // instead of a separate floating modal, matching the other management panels.

      window.saveSupplier = function() {
        const name = document.getElementById('supplier-name-input').value.trim();
        const terms = parseInt(document.getElementById('supplier-terms-input').value) || 30;
        if (!name) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อซัพพลายเออร์", true);

        const id = 'SUP-' + Date.now().toString(36).toUpperCase();
        db.suppliers[id] = { id, name, terms };
        document.getElementById('supplier-name-input').value = '';
        window.persist?.();
        window.renderSettingsSuppliers?.();
        window.populatePOPickers?.();
        window.showToast("บันทึกซัพพลายเออร์สำเร็จ");
      };

      window.deleteSupplier = function(id) {
        delete db.suppliers[id];
        window.persist?.();
        window.renderSettingsSuppliers?.();
        window.populatePOPickers?.();
        window.showToast("ลบซัพพลายเออร์สำเร็จ");
      };

      // ==========================================
      // SUPABASE HELPER FUNCTIONS & IMPLEMENTATION
      // ==========================================
      window.getConfiguredSupabaseUrl = function() {
        return localStorage.getItem('pos_supabase_url') || "";
      };

      window.getConfiguredSupabaseAnonKey = function() {
        return localStorage.getItem('pos_supabase_anon_key') || "";
      };

      let _supabaseClient = null;
      window.getSupabaseClient = function() {
        if (_supabaseClient) return _supabaseClient;
        const url = window.getConfiguredSupabaseUrl();
        const key = window.getConfiguredSupabaseAnonKey();
        if (!url || !key) return null;
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
          _supabaseClient = window.supabase.createClient(url, key);
        }
        return _supabaseClient;
      };

      window.updateSupabaseBadge = function(isSynced) {
        window.posCloudOk = !!isSynced;
        window.smartPOSOfflineStatus?.refresh();
      };

      window.saveSupabaseConfig = function() {
        const urlEl = document.getElementById('set-supabase-url');
        const keyEl = document.getElementById('set-supabase-key');
        const url = urlEl ? urlEl.value.trim() : '';
        const key = keyEl ? keyEl.value.trim() : '';

        if (!url || !key) {
          window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกทั้ง Project URL และ anon public key", true);
          return;
        }

        localStorage.setItem('pos_supabase_url', url);
        localStorage.setItem('pos_supabase_anon_key', key);
        _supabaseClient = null;

        window.showToast("บันทึกการเชื่อมต่อ Supabase เรียบร้อย");
        window.refreshAuthStatus();
      };

      // ==========================================
      // STORE-LEVEL SUPABASE AUTH (Tier 1 of the login design)
      // ==========================================
      // The anon key alone only grants Postgres the `anon` role. Every RLS policy in the
      // schema is `TO authenticated`, so without an actual signed-in session, every read/write
      // to Supabase is silently rejected — this is what makes signing in mandatory, not optional.
      // Cashiers still just use a 4-digit PIN (see the employee login screen below); only the
      // store owner needs this real email/password account, and only once per device (the
      // Supabase JS client persists the session in localStorage and auto-refreshes it).
      // เพิ่มขึ้นมา: เดิมมีแค่ storeSignIn (signInWithPassword) ซึ่งใช้ได้เฉพาะกับบัญชีที่มีอยู่แล้ว
      // เท่านั้น — ร้านที่เพิ่งเริ่มใช้แอปนี้ครั้งแรกไม่มีทางสร้างบัญชีแรกได้เลยจากในแอป (ต้องไปสร้าง
      // เองใน Supabase Dashboard ซึ่งไม่มีเอกสารบอกไว้ที่ไหนเลย) ฟังก์ชันนี้ปิดช่องโหว่นั้น
      function getOwnerBootstrapFields() {
        return {
          storeName: (document.getElementById('store-name-input')?.value || '').trim(),
          phone: (document.getElementById('store-phone-input')?.value || '').trim(),
          address: (document.getElementById('store-address-input')?.value || '').trim(),
          province: (document.getElementById('store-province-input')?.value || '').trim(),
          postalCode: (document.getElementById('store-postal-input')?.value || '').trim(),
          taxId: (document.getElementById('store-taxid-input')?.value || '').trim(),
          name: (document.getElementById('store-owner-name')?.value || '').trim(),
          pin: (document.getElementById('store-owner-pin')?.value || '').trim(),
          pinConfirm: (document.getElementById('store-owner-pin-confirm')?.value || '').trim()
        };
      }

      function setStoreAuthBusy(busy) {
        ['store-signup-btn','store-signin-btn'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.disabled = !!busy; el.classList.toggle('opacity-60', !!busy); el.classList.toggle('pointer-events-none', !!busy); }
        });
      }

      window.storeSignUp = async function() {
        const client = window.getSupabaseClient();
        if (!client) return window.showAlert("ยังไม่ได้ตั้งค่า", "กรุณากรอก Project URL และ anon public key แล้วบันทึกก่อน", true);
        const email = document.getElementById('store-auth-email').value.trim();
        const password = document.getElementById('store-auth-password').value;
        const owner = getOwnerBootstrapFields();
        if (!email || !password) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกอีเมลและรหัสผ่าน", true);
        if (password.length < 6) return window.showAlert("รหัสผ่านสั้นเกินไป", "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", true);
        if (!owner.storeName) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อร้าน", true);
        if (!owner.name) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อเจ้าของร้าน", true);
        if (!/^\d{6}$/.test(owner.pin)) return window.showAlert("PIN ไม่ถูกต้อง", "PIN เจ้าของร้านต้องเป็นตัวเลข 6 หลัก", true);
        if (window.WEAK_PINS?.includes(owner.pin)) return window.showAlert("PIN เดาง่ายเกินไป", "กรุณาเลือก PIN ที่ไม่ใช่เลขซ้ำหรือเลขเรียงกัน", true);
        if (owner.pin !== owner.pinConfirm) return window.showAlert("PIN ไม่ตรงกัน", "กรุณายืนยัน PIN ให้ตรงกัน", true);
        setStoreAuthBusy(true);
        try {
          const pinHash = await window.makePinHash(owner.pin);
          const { data, error } = await client.auth.signUp({
            email, password,
            options: { data: { store_name: owner.storeName, store_phone: owner.phone, store_email: email, store_address: owner.address, store_province: owner.province, store_postal_code: owner.postalCode, store_tax_id: owner.taxId, owner_name: owner.name, owner_pin_hash: pinHash, setup_version: 'single-shop-v1' } }
          });
          if (error) throw error;
          document.getElementById('store-auth-password').value = '';
          document.getElementById('store-owner-pin').value = '';
          document.getElementById('store-owner-pin-confirm').value = '';
          if (data.session) {
            window.showToast("สมัครบัญชีร้านสำเร็จ กำลังตั้งค่าสิทธิ์เจ้าของร้านอัตโนมัติ");
            await window.refreshAuthStatus();
            const ownerReady = await window.checkAndBootstrapOwner?.();
            if (ownerReady) await window.forceSyncNow?.();
          } else {
            window.showAlert("สมัครบัญชีร้านสำเร็จ", "กรุณายืนยันอีเมลจากกล่องจดหมายก่อน จากนั้นกลับมาเข้าสู่ระบบด้วยอีเมลและรหัสผ่านเดิม ระบบจะใช้ข้อมูลเจ้าของร้านที่บันทึกไว้กับบัญชีเพื่อดำเนินการต่อโดยไม่เปิดหน้าตั้งค่าแยก", false);
          }
        } catch (err) {
          window.smartPOSActivityLog?.add('ERROR', 'สมัครบัญชีร้านไม่สำเร็จ', err?.message || String(err));
          window.showAlert("สมัครบัญชีไม่สำเร็จ", err.message || String(err), true);
        } finally { setStoreAuthBusy(false); }
      };

      window.storeSignIn = async function() {
        const client = window.getSupabaseClient();
        if (!client) return window.showAlert("ยังไม่ได้ตั้งค่า", "กรุณากรอก Project URL และ anon public key แล้วบันทึกก่อน", true);
        const email = document.getElementById('store-auth-email').value.trim();
        const password = document.getElementById('store-auth-password').value;
        if (!email || !password) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกอีเมลและรหัสผ่าน", true);
        setStoreAuthBusy(true);
        try {
          const { error } = await client.auth.signInWithPassword({ email, password });
          if (error) throw error;
          document.getElementById('store-auth-password').value = '';
          window.showToast("เข้าสู่ระบบร้านค้าสำเร็จ");
          await window.refreshAuthStatus();
          const ownerReady = await window.checkAndBootstrapOwner?.();
          if (ownerReady) await window.forceSyncNow?.();
        } catch (err) {
          window.smartPOSActivityLog?.add('ERROR', 'เข้าสู่ระบบร้านค้าไม่สำเร็จ', err?.message || String(err));
          window.showAlert("เข้าสู่ระบบไม่สำเร็จ", err.message || "อีเมลหรือรหัสผ่านไม่ถูกต้อง", true);
        } finally { setStoreAuthBusy(false); }
      };

      // Unified first-owner bootstrap: there is no separate setup modal or wizard.
      // New-account metadata stores only the PIN hash, never the raw PIN.
      window.checkAndBootstrapOwner = async function() {
        const client = window.getSupabaseClient();
        if (!client) return false;
        try {
          const { data: sessionData, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          const session = sessionData?.session;
          if (!session?.user) return false;
          const { data: existing, error: lookupError } = await client.from('app_users').select('id,name,role').eq('auth_user_id', session.user.id).maybeSingle();
          if (!lookupError && existing) {
            // hash ของ PIN ถูกเก็บในตารางความลับ อ่านได้เฉพาะแถวของตัวเองผ่าน RPC (ดู patch 003)
            const { data: myPinHash } = await client.rpc('get_my_pin_hash');
            const pinHash = typeof myPinHash === 'string' ? myPinHash : '';
            db.users = db.users || [];
            let localOwner = db.users.find(u => u.role === 'OWNER');
            if (!localOwner) { localOwner = { id: existing.id, name: existing.name, role: 'OWNER', permissions: ['ALL'], pinHash }; db.users.unshift(localOwner); }
            else { localOwner.id = existing.id; localOwner.name = existing.name || localOwner.name; if (pinHash) localOwner.pinHash = pinHash; }
            db.storeName = db.storeName || String(session.user.user_metadata?.store_name || '');
            window.persist?.();
            return true;
          }

          if (lookupError) window.smartPOSActivityLog?.add('WARN', 'ตรวจสอบ app_users ก่อนสร้างเจ้าของร้านไม่สำเร็จ', lookupError.message || String(lookupError));
          const meta = session.user.user_metadata || {};
          const fields = getOwnerBootstrapFields();
          const name = String(meta.owner_name || fields.name || '').trim();
          const storeName = String(meta.store_name || fields.storeName || db.storeName || '').trim();
          let pinHash = String(meta.owner_pin_hash || '').trim();
          if (!pinHash && /^\d{6}$/.test(fields.pin)) {
            if (fields.pin !== fields.pinConfirm) {
              window.showAlert('PIN ไม่ตรงกัน', 'กรุณากรอก PIN ทั้งสองช่องให้ตรงกัน แล้วกดเข้าสู่ระบบอีกครั้ง', true);
              return false;
            }
            pinHash = await window.makePinHash(fields.pin);
          }
          if (!name || !pinHash || !storeName) {
            window.showAlert('บัญชีนี้ยังไม่ได้ผูกเจ้าของร้าน', 'กรอกชื่อร้าน ชื่อเจ้าของร้าน และ PIN 6 หลักในส่วนบัญชีร้าน แล้วกดเข้าสู่ระบบอีกครั้ง หรือหากร้านนี้มีเจ้าของร้านอยู่แล้ว ให้ตรวจสอบสิทธิ์ SELECT ของ app_users และสถานะบัญชี', true);
            return false;
          }

          const { data: ownerResult, error: bootstrapError } = await client.rpc('bootstrap_first_owner', { p_name: name, p_pin: pinHash });
          if (bootstrapError) {
            const msg = String(bootstrapError.message || bootstrapError);
            window.smartPOSActivityLog?.add('ERROR', 'สร้างสิทธิ์เจ้าของร้านอัตโนมัติไม่สำเร็จ', msg);
            if (/มี OWNER อยู่แล้ว|owner already exists|already exists/i.test(msg)) {
              window.showAlert('ฐานข้อมูลมีเจ้าของร้านอยู่แล้ว', 'ไม่สามารถยึดสิทธิ์เจ้าของร้านเดิมได้ บัญชีนี้ต้องถูกเพิ่มโดยเจ้าของร้านเดิม หรือให้ผู้ดูแลตรวจสอบการผูก auth_user_id', true);
            } else {
              window.showAlert('ตั้งค่าสิทธิ์เจ้าของร้านอัตโนมัติไม่สำเร็จ', msg + ' — ตรวจสอบว่า SQL มีฟังก์ชัน bootstrap_first_owner และสิทธิ์ EXECUTE สำหรับ authenticated', true);
            }
            return false;
          }

          const ownerPin = fields.pin;
          if (ownerPin) {
            document.getElementById('store-owner-pin').value = '';
            document.getElementById('store-owner-pin-confirm').value = '';
          }
          db.users = db.users || [];
          const canonicalOwnerId = ownerResult && ownerResult.id ? ownerResult.id : null;
          const localOwner = db.users.find(u => u.role === 'OWNER');
          if (localOwner) { if (canonicalOwnerId) localOwner.id = canonicalOwnerId; localOwner.name = name; localOwner.pinHash = pinHash; delete localOwner.pin; if (/^\d{6}$/.test(fields.pin || '')) localOwner.pinLen = 6; }
          else db.users.unshift({ id: canonicalOwnerId || toUUID('owner-' + Date.now()), name, role: 'OWNER', permissions: ['ALL'], pinHash, pinLen: (/^\d{6}$/.test(fields.pin || '') ? 6 : undefined) });
          db.storeName = storeName || db.storeName || name;
          window.persist?.();
          window.renderEmployeeLoginScreen?.();
          window.showToast('สมัครและตั้งค่าสิทธิ์เจ้าของร้านสำเร็จ');
          window.smartPOSActivityLog?.add('INFO', 'ผูกบัญชี Supabase กับเจ้าของร้านสำเร็จ', name);
          return true;
        } catch (e) {
          window.smartPOSActivityLog?.add('ERROR', 'ตรวจสอบ/สร้างเจ้าของร้านไม่สำเร็จ', e?.message || String(e));
          window.showAlert('ตรวจสอบเจ้าของร้านไม่สำเร็จ', e?.message || String(e), true);
          return false;
        }
      };

      window.storeSignOut = async function() {
        const client = window.getSupabaseClient();
        if (!client) return;
        await client.auth.signOut();
        window.showToast("ออกจากระบบร้านค้าแล้ว");
        window.refreshAuthStatus();
      };

      window.refreshAuthStatus = async function() {
        const statusEl = document.getElementById('store-auth-status');
        const formEl = document.getElementById('store-auth-form');
        const signoutBtn = document.getElementById('store-auth-signout-btn');
        if (!statusEl) return;
        const client = window.getSupabaseClient();
        if (!client) {
          statusEl.className = 'p-3 rounded-xl border text-xs font-bold bg-slate-50 text-slate-500';
          statusEl.innerText = 'ยังไม่ได้เชื่อมต่อ Supabase (กรอก URL/Key ด้านบนก่อน)';
          formEl?.classList.remove('hidden');
          signoutBtn?.classList.add('hidden');
          window.updateSupabaseBadge(false);
          return;
        }
        try {
          const { data: { session } } = await client.auth.getSession();
          if (session?.user) {
            statusEl.className = 'p-3 rounded-xl border text-xs font-bold bg-emerald-50 border-emerald-200 text-emerald-700';
            statusEl.innerText = `✅ เข้าสู่ระบบแล้ว: ${session.user.email}`;
            formEl?.classList.add('hidden');
            signoutBtn?.classList.remove('hidden');
            window.updateSupabaseBadge(true);
          } else {
            statusEl.className = 'p-3 rounded-xl border text-xs font-bold bg-amber-50 border-amber-200 text-amber-700';
            statusEl.innerText = '⚠️ เชื่อมต่อฐานข้อมูลแล้ว แต่ยังไม่ได้เข้าสู่ระบบร้านค้า — การซิงค์จะไม่ทำงาน';
            formEl?.classList.remove('hidden');
            signoutBtn?.classList.add('hidden');
            window.updateSupabaseBadge(false);
          }
        } catch (err) {
          statusEl.className = 'p-3 rounded-xl border text-xs font-bold bg-rose-50 border-rose-200 text-rose-700';
          statusEl.innerText = '❌ ตรวจสอบสถานะไม่สำเร็จ: ' + (err.message || '');
        }
      };

      // ===== ซิงค์เฉพาะแถวที่เปลี่ยน =====
      // เดิมทุกครั้งที่ซิงค์ (17 จุดเรียกใช้) จะอัปโหลดสินค้า/ขนาด/ลูกค้าทั้งร้านใหม่หมด แม้แก้ราคาตัวเดียว และถ้าแถวเดียวผิดจะล้มทั้งชุด
      // ตอนนี้เก็บ "ลายนิ้วมือ" ของแถวที่ส่งสำเร็จล่าสุดไว้ในเครื่อง ส่งเฉพาะแถวที่ต่างไป ทีละ 300 แถว
      // ตัวป้องกัน: เปลี่ยนโปรเจกต์ Supabase → ส่งใหม่หมด / ครบ 24 ชม. → ส่งใหม่หมดหนึ่งรอบ / ซิงค์ล้มเหลว → ล้างลายนิ้วมือ (รอบหน้าส่งใหม่หมด)
      window.__syncHash = (function () {
        const KEY = 'pos_sync_hash_v1', MAX_AGE = 24 * 3600 * 1000;
        let state = null;
        const cyrb53 = (str, seed = 0) => {
          let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
          for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
          h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
          h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
          return 4294967296 * (2097151 & h2) + (h1 >>> 0);
        };
        const serverKey = () => { try { return String((window.getSupabaseClient && window.getSupabaseClient() || {}).supabaseUrl || ''); } catch (e) { return ''; } };
        const load = () => {
          const key = serverKey(), now = Date.now();
          // ตรวจทุกครั้ง: เปลี่ยนโปรเจกต์ Supabase / ครบ 24 ชม. / สั่งส่งใหม่หมด → เริ่มลายนิ้วมือใหม่
          if (state && state.server === key && now - state.at <= MAX_AGE && !window.__forceFullSync) return state;
          let s = null;
          if (!window.__forceFullSync) { try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; } }
          if (!s || s.server !== key || !s.at || now - s.at > MAX_AGE) s = { server: key, at: now, h: {} };
          window.__forceFullSync = false; state = s; return s;
        };
        const save = () => { if (state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* โควตาเต็ม: รอบหน้าส่งซ้ำได้ ไม่เสียหาย */ } } };
        return {
          diff(table, rows, idKey = 'id') {
            const st = load(), h = st.h[table] || (st.h[table] = {}), changed = [], marks = [];
            for (const r of rows) {
              const raw = String(Array.isArray(idKey) ? idKey.map(k => r[k]).join('|') : r[idKey]);
              const k = raw.replace(/-/g, '').slice(0, 10) + raw.length;   // คีย์สั้น ประหยัดพื้นที่ (ชนกันได้ แต่ผลคือส่งซ้ำ ไม่ใช่ข้าม)
              const sig = cyrb53(JSON.stringify(r)).toString(36);
              if (h[k] !== sig) { changed.push(r); marks.push([k, sig]); }
            }
            return { changed, commit() { marks.forEach(([k, sg]) => { h[k] = sg; }); save(); } };
          },
          async upsertChunks(client, table, rows, onConflict, size = 300, extra = {}) {
            for (let i = 0; i < rows.length; i += size) {
              const { error } = await client.from(table).upsert(rows.slice(i, i + size), { onConflict, ...extra });
              if (error) throw error;
            }
          },
          // แถวที่มีคอลัมน์ไม่เท่ากัน (เช่น บางแถวมี image_url บางแถวไม่มี) ต้องแยกกลุ่มก่อนส่ง
          // เพราะ upsert แบบก้อนจะเติม NULL ให้คอลัมน์ที่แถวนั้นไม่มี และทับค่าเดิมบนเซิร์ฟเวอร์
          async upsertGrouped(client, table, rows, onConflict, size = 300) {
            const groups = new Map();
            for (const r of rows) { const k = Object.keys(r).sort().join(','); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
            for (const g of groups.values()) await this.upsertChunks(client, table, g, onConflict, size);
          },
          reset() { state = null; try { localStorage.removeItem(KEY); } catch (e) { } }
        };
      })();

      window._syncProductsImpl = async function(isQuiet = false) {
        const client = window.getSupabaseClient();
        if (!client) return false;
        const _H = window.__syncHash;

        try {
          // 1. Categories
          const categoryRows = (db.categories || []).map((c, idx) => ({
            id: toUUID(c.id),
            name: c.name,
            icon: c.icon || '📁',
            color: c.color || '#4F46E5',
            display_order: idx + 1
          }));
          const _catD = _H.diff('categories', categoryRows);
          await _H.upsertChunks(client, 'categories', _catD.changed, 'id'); _catD.commit();

          // 2. Products — schema note: price/cost/stock no longer live on `products` at all
          // (moved entirely onto product_variants below). `products` only holds catalog-level
          // fields shared across every size/variant of the item.
          const productsList = Object.values(db.products || {});
          // ตาราง products ฝั่ง Supabase มี "sku unique" กันไว้ — ถ้าสินค้าในเครื่องนี้ดันมีรหัส
          // ซ้ำกันอยู่ (เช่น นำเข้าไฟล์เก่าตั้งแต่ก่อนมีการกันซ้ำตอนนำเข้า) การ upsert ทั้งก้อนจะโดน
          // ปฏิเสธทั้งหมดด้วย error 23505 ทันทีที่เจอแค่คู่เดียว (all-or-nothing) ทำให้สินค้าทั้งร้าน
          // ไม่ขึ้น Supabase เลยสักตัว จึงต้องเช็คและแก้ไขรหัสซ้ำในเครื่องให้เรียบร้อยก่อน "ทุกครั้ง"
          // ที่จะซิงค์ ไม่ใช่แค่ตอนนำเข้าไฟล์ใหม่เท่านั้น — แก้ตรงนี้แล้ว persist กลับลง db.products
          // ด้วยเลย เพื่อให้ทั้งเครื่องนี้และ Supabase เห็นรหัสเดียวกันตรงกันเสมอ
          const seenSku = new Map();
          const renamedSkus = [];
          productsList.forEach(p => {
            let sku = String(p.code || p.id).trim();
            if (seenSku.has(sku)) {
              const n = seenSku.get(sku) + 1;
              seenSku.set(sku, n);
              const newSku = sku + '-DUP' + n;
              renamedSkus.push(`${p.name}: ${sku} → ${newSku}`);
              p.code = newSku;
              if (p.variants && p.variants[0]) p.variants[0].barcode = newSku;
            } else {
              seenSku.set(sku, 1);
            }
          });
          if (renamedSkus.length > 0) {
            window.persist?.();
            console.warn('syncProductsToSupabase: renamed duplicate SKUs before sync', renamedSkus);
          }
          // รูปสินค้า: ส่ง image_url รวมไปกับ upsert ก้อนเดียว (เดิมวนยิง update ทีละสินค้า = N+1 requests)
          // ส่งเฉพาะ URL จริง (http/https) — data:image/... และค่าว่างจะไม่ถูกส่ง จึงไม่เขียนทับรูปบนเซิร์ฟเวอร์ด้วย NULL
          const _isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
          const productRows = productsList.map(p => {
            const row = {
              id: toUUID(p.id),
              sku: p.code || p.id,
              name: p.name,
              min_stock_alert: roundStock((p.variants && p.variants[0] && p.variants[0].minStock) || 5),
              is_active: !p.isDeleted && !p.isDisabled
            };
            if (_isHttpUrl(p.imageUrl)) row.image_url = p.imageUrl.trim();
            return row;
          });
          const _prodD = _H.diff('products', productRows);
          await _H.upsertGrouped(client, 'products', _prodD.changed, 'id'); _prodD.commit();

          // 3. Product Categories Junction — เฉพาะสินค้าที่เปลี่ยนหมวด
          const nameToId = {};
          (db.categories || []).forEach(c => { nameToId[c.name] = c.id; });
          const _linkSig = productsList.map(p => ({
            id: toUUID(p.id),
            cats: [...new Set((p.cat || []).filter(n => nameToId[n]).map(n => toUUID(nameToId[n])))].sort()
          }));
          const _linkD = _H.diff('links', _linkSig.map(x => ({ id: x.id, c: x.cats.join(',') })));
          if (_linkD.changed.length) {
            const _changedIds = new Set(_linkD.changed.map(x => x.id));
            const linkRows = [];
            _linkSig.forEach(x => { if (_changedIds.has(x.id)) x.cats.forEach(cid => linkRows.push({ product_id: x.id, category_id: cid })); });
            await _H.upsertChunks(client, 'product_categories', linkRows, 'product_id,category_id');
            // ลบความเชื่อมโยงที่ถูกเอาออก (เดิมมีแต่ upsert จึงกลับมาเองตอนโหลดใหม่) เฉพาะสินค้าที่เปลี่ยน
            const wanted = new Set(linkRows.map(r => r.product_id + '|' + r.category_id));
            const oldLinks = [];
            const readLinks = async (applyFilter) => {
              for (let from = 0; ; from += 1000) {   // อ่านทีละ 1000 แถว เรียงให้คงที่ ไม่ให้แถวตกหล่นข้ามหน้า
                let qy = client.from('product_categories').select('product_id,category_id');
                qy = applyFilter(qy).order('product_id', { ascending: true }).order('category_id', { ascending: true });
                const { data: page, error: oldErr } = await qy.range(from, from + 999);
                if (oldErr) throw oldErr;
                oldLinks.push(...(page || []));
                if (!page || page.length < 1000) break;
              }
            };
            const _ids = [..._changedIds];
            if (_ids.length > 200) await readLinks(q => q);
            else for (let i = 0; i < _ids.length; i += 100) { const part = _ids.slice(i, i + 100); await readLinks(q => q.in('product_id', part)); }
            const byProduct = new Map();
            oldLinks.forEach(r => {
              if (_changedIds.has(r.product_id) && !wanted.has(r.product_id + '|' + r.category_id)) {
                if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
                byProduct.get(r.product_id).push(r.category_id);
              }
            });
            for (const [pid, cids] of byProduct) {   // หนึ่งคำขอต่อสินค้า (เดิมลบทีละแถว)
              const { error: delErr } = await client.from('product_categories').delete().eq('product_id', pid).in('category_id', cids);
              if (delErr) throw delErr;
            }
          }
          _linkD.commit();

          // 4. Product Variants — price/cost_price are direct columns here (no more
          // override-with-fallback-to-parent semantics from the old schema).
          const variantRows = [], _variantOwner = [];   // _variantOwner[i] = [สินค้า, ขนาด] ของ variantRows[i]
          const _vSeen = new Set();   // SKU ของ variant ต้องไม่ซ้ำ
          const _barcodeSeen = new Map();
          const _barcodeRepairs = [];
          const _vsku = (v) => { const k = v.sku ? String(v.sku).trim() : ''; if (!k || _vSeen.has(k)) return null; _vSeen.add(k); return k; };
          // รอบที่ 1: ตรวจบาร์โค้ดซ้ำกันภายในเครื่อง (ทุกขนาด) แล้วสร้างแถวที่จะส่ง
          productsList.forEach(p => {
            (p.variants || []).forEach(v => {
              const originalBarcode = String(v.barcode || '').trim();
              const variantId = toUUID(v.id);
              let barcode = originalBarcode;
              if (barcode) {
                const localOwner = _barcodeSeen.get(barcode);
                if (localOwner && localOwner !== variantId) {
                  barcode = '';
                  _barcodeRepairs.push(`${p.name} (${v.sizeName || 'ปกติ'}): ${originalBarcode} ซ้ำกับสินค้า/ตัวเลือกอื่นในเครื่อง`);
                } else {
                  _barcodeSeen.set(barcode, variantId);
                }
                if (barcode !== originalBarcode) v.barcode = '';
              }
              const _vrow = {
                id: variantId,
                product_id: toUUID(p.id),
                variant_name: v.sizeName || 'ปกติ',
                unit: v.unit || p.unit || 'ชิ้น',
                barcode: barcode || null,
                sku: _vsku(v),
                price: roundAmt(v.price),
                cost_price: roundAmt(v.cost),
                min_stock: roundStock(v.minStock != null ? v.minStock : 5),   // ขั้นต่ำเป็นของแต่ละขนาด
                // ไม่ส่ง stock_quantity ในการ upsert — สต็อกเปลี่ยนผ่าน RPC เท่านั้น (create_sale / process_return / receive_goods / adjust_stock / seed)
                location_code: v.locationCode || null,   // ตำแหน่งชั้นวาง 
                is_active: !p.isDeleted && !p.isDisabled
              };
              if (_isHttpUrl(v.imageUrl)) _vrow.image_url = v.imageUrl.trim();   // รูปรายขนาด: ส่งรวมใน upsert เฉพาะ URL จริง
              if (+v.cutLength > 0) { _vrow.cut_length = +v.cutLength; _vrow.cut_price_per_m = roundAmt(v.cutPricePerM || 0); }   // ตั้งค่าตัดท่อ (PATCH 015)
              variantRows.push(_vrow);
              _variantOwner.push([p, v]);
            });
          });
          const _varD = _H.diff('variants', variantRows);
          // รอบที่ 2: เช็คบาร์โค้ดกับของเดิมบน Supabase เฉพาะแถวที่กำลังจะส่ง (เดิมอ่านบาร์โค้ดทั้งร้านทุกครั้ง)
          const _needCheck = _varD.changed.filter(r => r.barcode);
          if (_needCheck.length) {
            const _remoteBarcodeOwner = new Map();
            for (let i = 0; i < _needCheck.length; i += 100) {
              const part = _needCheck.slice(i, i + 100).map(r => r.barcode);
              const { data: _bd, error: _be } = await client.from('product_variants').select('id,barcode').in('barcode', part);
              if (_be) throw _be;
              (_bd || []).forEach(r => { const b = String(r.barcode || '').trim(); if (b) _remoteBarcodeOwner.set(b, String(r.id)); });
            }
            const _byId = new Map(variantRows.map((r, i) => [r.id, _variantOwner[i]]));
            _needCheck.forEach(row => {
              const remoteOwner = _remoteBarcodeOwner.get(row.barcode);
              if (remoteOwner && remoteOwner !== row.id) {
                const [p, v] = _byId.get(row.id);
                _barcodeRepairs.push(`${p.name} (${v.sizeName || 'ปกติ'}): ${row.barcode} ถูกใช้โดยรายการเดิมใน Supabase`);
                row.barcode = null; v.barcode = '';
              }
            });
          }
          await _H.upsertGrouped(client, 'product_variants', _varD.changed, 'id');
          _varD.commit();
          if (_barcodeRepairs.length) {
            window.persist?.();
            console.warn('Sync cleared duplicate/conflicting local barcodes', _barcodeRepairs);
            window.showAlert?.('แก้บาร์โค้ดซ้ำเพื่อให้ซิงค์ได้',
              `พบ ${_barcodeRepairs.length} บาร์โค้ดที่ซ้ำหรือชนกับรายการเดิม ระบบเก็บบาร์โค้ดไว้กับรายการแรก/รายการเดิม และล้างบาร์โค้ดของรายการที่ชนกันเพื่อป้องกันการขายผิดสินค้า กรุณาตรวจและกำหนดบาร์โค้ดที่ถูกต้องให้รายการเหล่านี้อีกครั้ง:\n\n` + _barcodeRepairs.slice(0, 20).join('\n') + (_barcodeRepairs.length > 20 ? `\n...และอีก ${_barcodeRepairs.length - 20} รายการ` : ''), false);
          }
          if (variantRows.length > 0) await window._seedStock(client, productsList);   // ส่งสต็อกตั้งต้นครั้งเดียวต่อสินค้า (ไม่ทับค่าที่เซิร์ฟเวอร์รู้อยู่แล้ว)

          // 5. Product Fractions — keyed off variant_id (not product_id).
          // นิยามตาม PATCH 010: quantity_ratio = "จำนวนหน่วยฐาน (หน่วยของสต็อก) ที่ใช้ต่อ 1 หน่วยขาย"
          // เช่น สต็อกนับเป็นชิ้น แพ็ก 12 ชิ้น → ratio = 12; create_sale ตัดสต็อก = จำนวนที่ขาย × ratio
          // ซึ่งตรงกับ fractionMultiplier ในเครื่อง (ตัดสต็อก = qty × multiplier) จึงส่งค่าตรงๆ ไม่ต้องแปลงกลับ/หาร
          const fractionRows = [];
          productsList.forEach(p => {
            (p.variants || []).forEach(v => {
              (v.fractions || []).forEach(f => {
                const ratio = f.fractionMultiplier > 0 ? +f.fractionMultiplier : 1;
                fractionRows.push({
                  id: toUUID(f.id),
                  variant_id: toUUID(v.id),
                  fraction_name: f.fractionName,
                  quantity_ratio: ratio,
                  price: roundAmt(f.fractionPrice),
                  barcode: f.barcode || null
                });
              });
            });
          });
          const _fracD = _H.diff('product_fractions', fractionRows);
          await _H.upsertChunks(client, 'product_fractions', _fracD.changed, 'id'); _fracD.commit();

          // 6. Customers — this schema has no debt/accounts-receivable column at all (only
          // credit_limit). Outstanding balance (db.customers[].debt) stays a LOCAL-only figure
          // this device tracks itself; there is nothing to push it into server-side, so it is
          // intentionally left out of this upsert rather than silently dropped into a
          // similarly-named column that doesn't exist.
          const customerRows = Object.values(db.customers || {}).map(c => ({
            id: toUUID(c.id),
            name: c.name,
            phone: c.phone || null,
            address: c.address || '',
            credit_limit: roundAmt(c.creditLimit ?? 50000)   // ค่าเริ่มต้นเท่ากับที่หน้าขายใช้ตรวจวงเงิน (เดิมส่ง 0 ทำให้เซิร์ฟเวอร์ปฏิเสธขายเชื่อ)
          }));
          if (customerRows.length > 0) {
            const _custD = _H.diff('customers', customerRows);
            await _H.upsertChunks(client, 'customers', _custD.changed, 'id'); _custD.commit();
            await window._seedDebts(client, Object.values(db.customers || {}));   // ยอดหนี้ตั้งต้นครั้งเดียว — หลังจากนั้นเปลี่ยนผ่าน RPC เท่านั้น
          }

          // 7. Suppliers
          const supplierRows = Object.entries(db.suppliers || {}).map(([key, s]) => ({
            id: toUUID(key),
            name: s.name,
            phone: s.phone || null,
            address: s.address || ''
          }));
          const _supD = _H.diff('suppliers', supplierRows);
          await _H.upsertChunks(client, 'suppliers', _supD.changed, 'id'); _supD.commit();

          // 8. app_users — replaces the old separate profiles/employees split. auth_user_id is
          // deliberately left NULL for PIN-only staff (nullable by design in this schema) —
          // only the store owner's row needs a real auth_user_id, set once via
          // window.bootstrapFirstOwner. Only the SHA-256 hash is ever written to `pin`, never
          // the raw digits.
          const userRows = (db.users || [])
            .filter(u => u.pinHash && u.role !== 'OWNER')
            .map(u => ({
              id: toUUID(u.id),
              name: u.name,
              pin: u.pinHash,
              role: u.role || 'CASHIER',
              permissions: u.permissions || [],
              is_active: u.active !== false
            }));
          const _userD = _H.diff('app_users', userRows);
          await _H.upsertChunks(client, 'app_users', _userD.changed, 'id'); _userD.commit();

          if (renamedSkus.length > 0 && !isQuiet) {
            window.showAlert?.('แก้รหัสสินค้าซ้ำอัตโนมัติก่อนซิงค์',
              `พบและแก้รหัส/บาร์โค้ดที่ซ้ำกัน ${renamedSkus.length} รายการก่อนส่งขึ้น Supabase (เติม "-DUP" ต่อท้าย) เพื่อไม่ให้ทั้งชุดซิงค์ไม่ผ่าน แนะนำให้ไปตรวจแก้รหัสที่ถูกต้องในเมนูสินค้าอีกครั้ง:\n\n` + renamedSkus.slice(0, 10).join('\n') + (renamedSkus.length > 10 ? `\n...และอีก ${renamedSkus.length - 10} รายการ` : ''),
              false);
          }
          return true;
        } catch (err) {
          console.error("Products SQL sync error:", err);
          try { _H.reset(); } catch (_) { }   // ล้มเหลว: ล้างลายนิ้วมือ รอบหน้าส่งใหม่หมดเพื่อให้แก้ตัวเองได้
          if (!isQuiet) window.showAlert("ข้อผิดพลาดในการซิงค์สินค้า", err.message, true);
          return false;
        }
      };

      let _prodSyncPromise = null;   // กันซิงค์สินค้าซ้อนกัน (บันทึกสินค้า + คิวซิงค์ + ปุ่มซิงค์)
      window.syncProductsToSupabase = function(isQuiet) {
        window.posHooks.emit('sync:products');
        if (_prodSyncPromise) return _prodSyncPromise;
        _prodSyncPromise = window._syncProductsImpl(isQuiet).finally(() => { _prodSyncPromise = null; });
        return _prodSyncPromise;
      };

      window.syncTransactionsToSupabase = async function(isQuiet = false) {
        const client = window.getSupabaseClient();
        if (!client) return false;

        try {
          // 1. Shifts — column names in this schema: opening_cash/closing_cash (not
          // starting_cash/ending_cash), opened_at/closed_at, status 'OPEN'/'CLOSED' (uppercase).
          const shiftRows = (db.shifts || []).map(s => ({
            id: toUUID(s.id),
            opened_at: new Date(s.startTime).toISOString(),
            closed_at: s.endTime ? new Date(s.endTime).toISOString() : null,
            opening_cash: roundAmt(s.openingCash),
            closing_cash: s.cashOnHand ? roundAmt(s.cashOnHand) : null,
            status: s.endTime ? 'CLOSED' : 'OPEN'
          }));
          const _H = window.__syncHash;
          const _shiftD = _H.diff('shifts', shiftRows);
          await _H.upsertChunks(client, 'shifts', _shiftD.changed, 'id'); _shiftD.commit();

          // 2. Bills — ไม่เขียนบิลตรงเข้าตารางอีกต่อไป: บิลทั้งหมดไปทาง create_sale (คิวซิงค์) เท่านั้น
          //    เพื่อให้เซิร์ฟเวอร์ตรวจสต็อก/วงเงิน/ส่วนลดเสมอ ไม่มี fallback ที่ข้ามกฎได้

          // 3. Cash Ledger — real cash-drawer movements only (AR payments received, cash
          // refunds, and manual cash-in/cash-out recorded during a shift). id is synthesized
          // per source since these were never given a stable id shaped for toUUID() the way
          // bills/products are.
          const cashLedgerRows = [];
          (db.cashLedger || []).forEach(cl => {
            if (!cl._viaRpc && (cl.type === 'cash-in-ar' || cl.type === 'expense-refund')) {   // รายการที่ไปทาง RPC แล้วห้ามส่งซ้ำ
              cashLedgerRows.push({
                id: toUUID(cl.id),
                shift_id: cl.shiftId ? toUUID(cl.shiftId) : null,
                type: cl.type,
                income: roundAmt(cl.income || 0),
                expense: roundAmt(cl.expense || 0),
                description: cl.description || null,
                ref_id: cl.refId || null,
                created_at: new Date(cl.time).toISOString()
              });
            }
            // 'ACCOUNTS_PAYABLE' entries are handled separately below (accounts_payable table) —
            // they represent a balance owed, not a cash-drawer movement, so they don't belong here.
          });
          (db.shifts || []).forEach(s => {
            (s.movements || []).forEach(m => {
              cashLedgerRows.push({
                id: toUUID(m.id),
                shift_id: toUUID(s.id),
                type: m.type === 'IN' ? 'SHIFT_CASH_IN' : 'SHIFT_CASH_OUT',
                income: m.type === 'IN' ? roundAmt(m.amount) : 0,
                expense: m.type === 'OUT' ? roundAmt(m.amount) : 0,
                description: m.note || null,
                ref_id: null,
                created_at: new Date(m.time).toISOString()
              });
            });
          });
          const _cashD = _H.diff('cash_ledger', cashLedgerRows);
          await _H.upsertChunks(client, 'cash_ledger', _cashD.changed, 'id'); _cashD.commit();

          // 4. Accounts Payable — outstanding supplier debt from goods receipts
          // (window.confirmReceivePO). purchase_order_id links to the purchase_orders row
          // created by that receipt's own background sync (window.syncGoodsReceiptToSupabase),
          // which stores its server-generated id back onto the AP entry as
          // _serverPurchaseOrderId — already a real Supabase uuid, so it's used as-is rather
          // than passed through toUUID(). Falls back to null if that sync hasn't completed yet
          // (offline, or still in flight) — the next sync pass will fill it in once it has.
          const apRows = (db.cashLedger || [])
            .filter(cl => cl.type === 'ACCOUNTS_PAYABLE')
            .map(ap => ({
              id: toUUID(ap.id),
              supplier_id: ap.supplierId ? toUUID(ap.supplierId) : null,
              purchase_order_id: ap._serverPurchaseOrderId || null,
              doc_ref: ap.docRef || null,
              amount: roundAmt(ap.amount || 0),
              credit_terms: ap.terms || 30,
              status: ap.status || 'OPEN',
              created_at: new Date(ap.createdAt).toISOString(),
              paid_at: ap.paidAt ? new Date(ap.paidAt).toISOString() : null
            }));
          // ไม่อัปเดตรายการเดิม: สถานะ/วันจ่ายเปลี่ยนได้ผ่าน RPC pay_supplier เท่านั้น (patch 004)
          const _apD = _H.diff('accounts_payable', apRows);
          await _H.upsertChunks(client, 'accounts_payable', _apD.changed, 'id', 300, { ignoreDuplicates: true }); _apD.commit();

          return true;
        } catch (err) {
          console.error("Transactions SQL sync error:", err);
          try { window.__syncHash.reset(); } catch (_) { }
          if (!isQuiet) window.showAlert("ข้อผิดพลาดในการซิงค์ธุรกรรม", err.message, true);
          return false;
        }
      };

      window.forceSyncNow = async function() {
        const client = window.getSupabaseClient();
        if (!client) {
          window.showAlert("ไม่ได้เชื่อมต่อ Supabase", "กรุณากรอก Project URL และ Key ในศูนย์การตั้งค่าก่อน", true);
          return;
        }

        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.remove('hidden');

        try {
          const _ver = await window.checkServerSchema();
          if (_ver !== null && _ver < 2) throw new Error('ฐานข้อมูลบนเซิร์ฟเวอร์ยังเป็นเวอร์ชันเก่า — ต้องรัน SMART-POS-FULL-v13.sql ก่อน');
          window.retryFailedSyncOps();   // กดซิงค์เองถือว่าสั่งลองส่งรายการที่เคยล้มเหลวใหม่
          const res1 = await window.syncProductsToSupabase(true);
          const res2 = await window.syncTransactionsToSupabase(true);
          const qres = await window.flushSyncQueue(true);

          if (!res1) { window.smartPOSActivityLog?.add('ERROR','ซิงก์สินค้า/หมวดหมู่/ลูกค้าไม่สำเร็จ','เซิร์ฟเวอร์ไม่รับข้อมูลชุดนี้'); await window.syncProductsToSupabase(false); throw new Error('ซิงค์สินค้า/หมวดหมู่/ลูกค้าไม่สำเร็จ'); }
          if (!res2) { await window.syncTransactionsToSupabase(false); throw new Error('ซิงค์บิล/กะ/รายรับ-จ่ายไม่สำเร็จ'); }

          if (qres && qres.failed > 0) {
            window.updateSupabaseBadge(false);
            return window.showAlert('ซิงค์เสร็จ แต่มีรายการที่เซิร์ฟเวอร์ปฏิเสธ', window.describeSyncFailures(), true);
          }
          if (qres && qres.pending > 0) { window.updateSupabaseBadge(false); return window.showAlert('ยังมีรายการรอส่ง', `เหลือ ${qres.pending} รายการ (อาจออฟไลน์) — จะลองส่งใหม่อัตโนมัติ`, true); }
          window.updateSupabaseBadge(true);
          window.smartPOSActivityLog?.add('OK','ซิงก์ข้อมูลกับ Supabase สำเร็จทั้งหมด','สินค้า ลูกค้า บิล กะ ส่งครบ');
          window.showToast("ซิงค์ข้อมูลกับ Supabase SQL สำเร็จแล้ว!");
        } catch (err) {
          console.error("Force sync failed:", err);
          window.updateSupabaseBadge(false);
          window.showAlert("เกิดข้อผิดพลาดในการซิงค์", err.message || String(err), true);
        } finally {
          if (overlay) overlay.classList.add('hidden');
        }
      };

      // ==========================================
      // CART & BILL DISCOUNTS
      // ==========================================
      window.addUnifiedToCart = function(productId, variantId, fractionId, evt) {
        const p = db.products[productId];
        if (!p) return;
        const v = p.variants.find(x => x.id === variantId);
        if (!v) return;

        let name = `${p.name} (${v.sizeName})`;
        let price = roundAmt(v.price);
        let multiplier = 1;

        if (fractionId) {
          const f = v.fractions.find(x => x.id === fractionId);
          if (f) {
            name = `${p.name} (${v.sizeName} - ${f.fractionName})`;
            price = roundAmt(f.fractionPrice);
            multiplier = roundStock(f.fractionMultiplier);
          }
        }

        const cartKey = `${productId}_${variantId}_${fractionId || 'main'}`;
        const existing = cart.find(x => x.cartKey === cartKey);

        if (existing) {
          existing.qty += 1;
        } else {
          cart.push({ cartKey, id: productId, variantId, fractionId, name, price, qty: 1, multiplier });
        }

        window.cart = cart;
        window.updateCartUI();
        window.showToast("เพิ่มลงตะกร้าเรียบร้อย");
        if (evt) window._flyNameToCart?.(evt, p.name);
        window.posHooks.emit('cart:add', { productId, variantId, fractionId });
      };

      // ชื่อสินค้าที่กดหยิบ "วิ่ง" ไปที่ไอคอนตะกร้าที่หัวจอ — ฟีดแบ็กภาพให้รู้ทันทีว่าหยิบสำเร็จ
      // และหยิบอะไรไป โดยไม่ต้องเหลือบมองข้อความ toast. ล้มเหลวแบบเงียบๆ ถ้าหา element ที่
      // เกี่ยวข้องไม่เจอ (ไม่ควรทำให้การหยิบสินค้าเข้าตะกร้าจริงพังเพราะเรื่องเอฟเฟกต์)
      window._flyNameToCart = function(evt, name) {
        try {
          const srcEl = evt.currentTarget || evt.target;
          const cartBtn = document.getElementById('header-cart-btn');
          if (!srcEl || !cartBtn) return;
          const srcRect = srcEl.getBoundingClientRect();
          const dstRect = cartBtn.getBoundingClientRect();
          const chip = document.createElement('div');
          chip.textContent = '🛒 ' + name;
          chip.className = 'fly-to-cart-chip';
          chip.style.left = (srcRect.left + srcRect.width / 2) + 'px';
          chip.style.top = (srcRect.top + srcRect.height / 2) + 'px';
          document.body.appendChild(chip);
          requestAnimationFrame(() => {
            chip.style.left = (dstRect.left + dstRect.width / 2) + 'px';
            chip.style.top = (dstRect.top + dstRect.height / 2) + 'px';
            chip.style.transform = 'translate(-50%,-50%) scale(.25)';
            chip.style.opacity = '0';
          });
          setTimeout(() => chip.remove(), 550);
          cartBtn.classList.add('cart-bump');
          setTimeout(() => cartBtn.classList.remove('cart-bump'), 280);
        } catch (e) { /* purely cosmetic — never block the actual add-to-cart */ }
      };

      // ==========================================
      // PRODUCT SELECTION (Category browse / Search)
      // Previously window.selectCategory / exitCategory / onSearchInput were referenced
      // by the UI but never defined anywhere, so every category and search click on the
      // sale page silently did nothing. Implemented below.
      // ==========================================
      // Group image helper — shared by the main card and the variant-picker modal so both show
      // the same "product photo" (a multi-size/multi-color item still only has one master photo).
      function productImgHtml(p, sizeClass, emojiClass) {
        const photoUrl = p.imageUrl || (p.image && /^(https?:|blob:|data:)/.test(p.image) ? p.image : '');
        const emojiCls = emojiClass || 'text-4xl text-center mb-1.5';
        return photoUrl
          ? `<img src="${escapeHTML(photoUrl)}" loading="lazy" decoding="async" class="${sizeClass} mx-auto object-cover rounded-2xl mb-1.5 border-2 border-slate-100 bg-slate-50" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${emojiCls}',textContent:'📦'}))">`
          : `<div class="${emojiCls}">${(p.image && p.image.length <= 4) ? escapeHTML(p.image) : '📦'}</div>`;
      }

      // UX: a product with only ONE size/color still shows and sells directly from its card
      // (tap → add to cart), with remaining stock quantity shown right on the button instead of
      // just a price. A product with MULTIPLE sizes/colors ("กลุ่มสินค้า") shows once as a single
      // group card with its main photo — tapping it opens a picker listing every size/color as
      // its own selectable line (see openVariantPicker), instead of cramming every size's chip
      // onto the browse-grid card. Split-sale ("แบ่งขาย") items keep the ✂️ shortcut wherever
      // their variant is shown, on the grid card or inside the picker. The photo itself always
      // comes from the PRODUCT record (p.imageUrl), so a group with several sizes/colors that
      // all share one photo — or a product with variants that never got individual photos —
      // naturally shows the same picture everywhere it appears without any extra setup.
      window.renderProductCard = function(p) {
        const isGroup = (p.variants || []).length > 1;
        // ภาพใหญ่เต็มความกว้างการ์ด (แทนกล่องเล็ก 80x80 เดิม) ให้ดูเหมือนการ์ดสินค้าในแอปช้อปปิ้งทั่วไป
        const imgHtml = productImgHtml(p, 'w-full aspect-square');

        if (!isGroup) {
          const v = p.variants?.[0];
          const out = !v || (+v.stock || 0) <= 0;
          const hasFractions = (v?.fractions || []).length > 0 || +(v?.cutLength) > 0;
          const qtyLabel = out ? 'หมด' : `คงเหลือ ${roundStock(v.stock)} ชิ้น`;
          return `
            <div class="bg-white rounded-2xl border shadow-sm p-2.5 flex flex-col">
              <div class="relative mb-1.5">
                ${imgHtml}
                ${hasFractions ? `<button onclick="window.openFractionPicker('${p.id}','${v.id}',event)" title="เลือกแบ่งขาย" class="absolute bottom-1 right-1 w-7 h-7 rounded-full bg-white/95 shadow border border-amber-200 text-amber-600 flex items-center justify-center text-[13px] btn-touch">✂️</button>` : ''}
              </div>
              <div class="font-bold text-[11px] text-center mb-1 text-slate-800 line-clamp-2">${escapeHTML(p.name)}</div>
              <button ${out ? 'disabled' : ''} onclick="window.addUnifiedToCart('${p.id}','${v?.id}',null,event)" class="${out ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'} rounded-lg py-1.5 px-2 text-[10px] font-bold flex flex-col items-center btn-touch w-full justify-center">
                <span>฿${v ? roundAmt(v.price).toFixed(2) : '-'}</span>
                <span class="text-[9px] ${out ? '' : 'text-indigo-400'}">${qtyLabel}</span>
              </button>
            </div>`;
        }

        // Group card: one photo/name, badge shows how many sizes/colors, tap opens the picker.
        // p.__virtual = จัดกลุ่มแค่ตอนแสดงผล (สินค้ายังแยกเรคคอร์ดกันจริงในฐานข้อมูล — ดู
        // clusterForDisplay) ต้องเปิด picker คนละฟังก์ชันกับกลุ่มที่รวมจริงแล้ว เพราะ p.id ของการ์ด
        // เสมือนนี้ไม่มีอยู่จริงใน db.products
        const openPicker = p.__virtual
          ? `window.openVirtualGroupPicker(${JSON.stringify(p._memberIds)})`
          : `window.openVariantPicker('${p.id}')`;
        const totalStock = p.variants.reduce((s, v) => s + (+v.stock || 0), 0);
        return `
          <div class="bg-white rounded-2xl border shadow-sm p-2.5 flex flex-col cursor-pointer btn-touch" onclick="${openPicker}">
            <div class="relative mb-1.5">
              ${imgHtml}
              <span class="absolute top-1 right-1 bg-indigo-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow">${p.variants.length} แบบ</span>
              ${p.__virtual ? `<span class="absolute top-1 left-1 bg-white/95 text-slate-500 text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow border" title="ยังไม่ได้รวมกลุ่มจริงในระบบ — จัดกลุ่มให้ดูตอนนี้เฉยๆ">🔎 คล้ายกัน</span>` : ''}
            </div>
            <div class="font-bold text-[11px] text-center mb-1 text-slate-800 line-clamp-2">${escapeHTML(p.name)}</div>
            <div class="text-[9px] text-center ${totalStock > 0 ? 'text-emerald-600' : 'text-slate-400'} font-bold mb-1.5">${totalStock > 0 ? `รวมคงเหลือ ${roundStock(totalStock)} ชิ้น` : 'หมดทุกแบบ'}</div>
            <button onclick="event.stopPropagation();${openPicker}" class="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg py-1.5 text-[10px] font-bold btn-touch">📏 เลือกขนาด/สี</button>
          </div>`;
      };

      // Carousel-style picker: shows ONE size/color at a time with a big card-sized photo,
      // price, and remaining quantity — navigated with the ‹ › arrows fixed to the left/right
      // screen edges (vertically centered) instead of scrolling a list. The ✂️ split-sale
      // shortcut appears next to "หยิบใส่ตะกร้า" only when the current size/color supports it.
      let vpItems = []; // [{ productId, product, variantId, variant }] — uniform whether this is one product's own variants, or members of a display-only cluster (see clusterForDisplay)
      let vpIndex = 0;

      window.openVariantPicker = function(productId) {
        const p = db.products[productId];
        if (!p || !(p.variants || []).length) return;
        vpItems = p.variants.map(v => ({ productId, product: p, variantId: v.id, variant: v }));
        vpIndex = 0;
        window.renderVariantPicker();
        const m = document.getElementById('modal-variant-picker');
        m.classList.remove('hidden'); m.classList.add('flex');
      };

      // เหมือน openVariantPicker เป๊ะ แต่แต่ละ "รายการ" มาจากสินค้าคนละตัวกัน — ใช้ตอนกดการ์ดกลุ่ม
      // เสมือนที่ clusterForDisplay จัดกลุ่มให้ตอนแสดงผลเท่านั้น (สินค้ายังแยกเรคคอร์ดกันจริงอยู่)
      window.openVirtualGroupPicker = function(productIds) {
        vpItems = (productIds || []).map(id => {
          const p = db.products[id];
          const v = p?.variants?.[0];
          return (p && v) ? { productId: id, product: p, variantId: v.id, variant: v } : null;
        }).filter(Boolean);
        if (!vpItems.length) return;
        vpIndex = 0;
        window.renderVariantPicker();
        const m = document.getElementById('modal-variant-picker');
        m.classList.remove('hidden'); m.classList.add('flex');
      };

      window.vpNav = function(delta) {
        const n = vpItems.length;
        if (!n) return;
        vpIndex = (vpIndex + delta + n) % n;
        window.renderVariantPicker();
      };

      window.renderVariantPicker = function() {
        const item = vpItems[vpIndex];
        if (!item) return;
        const p = item.product, v = item.variant;
        const out = (+v.stock || 0) <= 0;
        const hasFractions = (v.fractions || []).length > 0 || +(v.cutLength) > 0;

        document.getElementById('vp-title').textContent = `📏 ${p.name}`;
        document.getElementById('vp-image-wrap').innerHTML = productImgHtml(p, 'w-full h-full', 'text-8xl flex items-center justify-center w-full h-full');
        document.getElementById('vp-variant-name').textContent = v.sizeName;
        document.getElementById('vp-variant-stock').innerHTML = out
          ? `<span class="text-rose-500">หมด</span>`
          : `<span class="text-emerald-600">คงเหลือ ${roundStock(v.stock)} ชิ้น</span>`;
        document.getElementById('vp-variant-price').textContent = `฿${roundAmt(v.price).toFixed(2)}`;

        document.getElementById('vp-dots').innerHTML = vpItems.map((_, i) =>
          `<span class="w-2 h-2 rounded-full ${i === vpIndex ? 'bg-indigo-600' : 'bg-slate-200'}"></span>`
        ).join('');

        document.getElementById('vp-actions').innerHTML = `
          <button ${out ? 'disabled' : ''} onclick="window.addUnifiedToCart('${p.id}','${v.id}',null,event)" class="${out ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'} flex-1 rounded-xl py-3 text-sm font-bold btn-touch">🛒 หยิบใส่ตะกร้า</button>
          ${hasFractions ? `<button onclick="window.openFractionPicker('${p.id}','${v.id}',event)" title="เลือกแบ่งขาย" class="flex-shrink-0 w-12 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-600 flex items-center justify-center text-lg btn-touch">✂️</button>` : ''}
        `;
      };

      // Small popover for picking a "แบ่งขาย" (split/fraction) unit, opened from the ✂️ button
      // instead of permanently listing every fraction option inline on the card.
      window.openFractionPicker = function(productId, variantId, evt) {
        evt.stopPropagation();
        document.querySelectorAll('.fraction-popover').forEach(el => el.remove());
        const p = db.products[productId];
        const v = p?.variants?.find(x => x.id === variantId);
        if (!v || (!(v.fractions || []).length && !(+v.cutLength > 0))) return;

        const anchor = evt.currentTarget.parentElement;
        anchor.style.position = anchor.style.position || 'relative';
        const pop = document.createElement('div');
        pop.className = 'fraction-popover cart-item-pop absolute z-50 right-0 top-full mt-1 bg-white border rounded-xl shadow-2xl p-1.5 min-w-[160px]';
        pop.innerHTML = `<div class="text-[9px] font-bold text-slate-400 px-2 pb-1">✂️ เลือกแบ่งขาย</div>` + (+v.cutLength > 0 ? `<button onclick="window.openCutPipe('${productId}','${variantId}'); this.closest('.fraction-popover').remove();" class="w-full text-left px-2 py-1.5 hover:bg-amber-50 rounded-lg text-[10px] font-bold text-amber-700 btn-touch">✂️ ตัดท่อเป็นเมตร… (฿${roundAmt(v.cutPricePerM || 0).toFixed(2)}/ม.)</button>` : '') + (v.fractions || []).map(f => `
          <button onclick="window.addUnifiedToCart('${productId}','${variantId}','${f.id}',event); this.closest('.fraction-popover').remove();" class="w-full text-left px-2 py-1.5 hover:bg-amber-50 rounded-lg text-[10px] font-bold text-amber-700 flex justify-between gap-2 btn-touch">
            <span>${escapeHTML(f.fractionName)}</span><span class="flex-shrink-0">฿${roundAmt(f.fractionPrice).toFixed(2)}</span>
          </button>`).join('');
        anchor.appendChild(pop);

        setTimeout(() => document.addEventListener('click', function closeOnce(e) {
          if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', closeOnce); }
        }), 0);
      };

      // ---- Category bar (sticky, horizontally scrollable) + paginated product grid ----
      let productsPerPage = 24;
      let productGridPage = 0;

      // ต่อหน้า / คอลัมน์ ปรับได้จาก selector บนแถบแบ่งหน้า — ตั้งค่าถูกจดจำไว้ใน localStorage
      // เพื่อไม่ต้องตั้งใหม่ทุกครั้งที่เปิดแอป
      window.changeProductsPerPage = function(val) {
        productsPerPage = Math.max(1, parseInt(val) || 24);
        productGridPage = 0;
        try { localStorage.setItem('pos_products_per_page', productsPerPage); } catch (e) {}
        window.renderProductGridPage();
      };

      window.changeProductGridCols = function(val) {
        const cols = Math.max(1, parseInt(val) || 4);
        const grid = document.getElementById('product-grid');
        if (grid) grid.className = `grid gap-3 grid-cols-${cols}`;
        try { localStorage.setItem('pos_products_grid_cols', cols); } catch (e) {}
      };

      // คืนค่าที่เคยตั้งไว้ตอนโหลดแอป
      (function restoreGridPrefs() {
        try {
          const savedPerPage = localStorage.getItem('pos_products_per_page');
          const savedCols = localStorage.getItem('pos_products_grid_cols');
          if (savedPerPage) productsPerPage = parseInt(savedPerPage) || 24;
          document.addEventListener('DOMContentLoaded', () => {
            const sel1 = document.getElementById('product-page-size-select');
            const sel2 = document.getElementById('product-grid-cols-select');
            if (sel1) sel1.value = String(productsPerPage);
            if (sel2) { sel2.value = savedCols || '4'; window.changeProductGridCols(savedCols || '4'); }
          });
        } catch (e) {}
      })();
      let currentCategoryFilter = null; // null = "ทั้งหมด"
      let currentMainCategoryId = null; // which main category's subcategory row is expanded
      let _lastProductList = [];
      let _lastProductTitle = 'สินค้าทั้งหมด';

      window.renderCategoryBar = function() {
        const bar = document.getElementById('category-bar');
        if (!bar) return;
        const cats = Array.isArray(db.categories) ? db.categories : [];
        const topLevel = cats.filter(c => !c.parentId);
        const pill = (label, icon, isActive, onclick, extraCls) => `
          <button onclick="${onclick}" class="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold btn-touch transition-colors ${isActive ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border text-slate-600 hover:border-indigo-300'} ${extraCls || ''}">
            <span>${icon}</span><span>${label}</span>
          </button>`;
        bar.innerHTML = pill('ทั้งหมด', '🏷️', currentCategoryFilter === null, `window.selectCategory(null)`) +
          topLevel.map(c => pill(escapeHTML(c.name), c.icon || '📦', currentCategoryFilter === c.name || currentMainCategoryId === c.id, `window.selectCategory(${escapeHTML(JSON.stringify(c.name))})`)).join('');

        // Subcategory row — only shown while a main category that actually has children is expanded.
        const subWrap = document.getElementById('subcategory-bar-wrap');
        const subBar = document.getElementById('subcategory-bar');
        const children = currentMainCategoryId ? cats.filter(c => c.parentId === currentMainCategoryId) : [];
        if (subWrap && subBar) {
          if (children.length) {
            const mainCat = cats.find(c => c.id === currentMainCategoryId);
            subWrap.classList.remove('hidden');
            subBar.innerHTML =
              pill(`ทั้งหมดใน${escapeHTML(mainCat?.name || '')}`, mainCat?.icon || '🏷️', currentCategoryFilter === mainCat?.name, `window.selectCategory(${escapeHTML(JSON.stringify(mainCat?.name))})`, 'bg-indigo-50') +
              children.map(c => pill(escapeHTML(c.name), c.icon || '📦', currentCategoryFilter === c.name, `window.selectCategory(${escapeHTML(JSON.stringify(c.name))})`)).join('');
          } else {
            subWrap.classList.add('hidden');
            subBar.innerHTML = '';
          }
        }
      };

      window.scrollCategoryBar = function(dir) {
        const bar = document.getElementById('category-bar');
        if (bar) bar.scrollBy({ left: dir * 160, behavior: 'smooth' });
      };

      // Keeps the category bar pinned directly beneath the app header, and the pagination bar
      // pinned directly beneath the category bar — both computed from actual rendered heights
      // rather than a hardcoded offset that could drift out of sync.
      window.syncCategoryBarOffset = function() {
        const header = document.querySelector('header');
        const catWrap = document.getElementById('category-bar-wrap');
        const subWrap = document.getElementById('subcategory-bar-wrap');
        const pageWrap = document.getElementById('product-page-bar-wrap');
        if (header && catWrap) {
          const afterHeader = header.offsetHeight + (parseFloat(getComputedStyle(header).top) || 0);
          catWrap.style.top = afterHeader + 'px';
          const subVisible = subWrap && !subWrap.classList.contains('hidden');
          const afterCat = afterHeader + catWrap.offsetHeight;
          if (subWrap) subWrap.style.top = afterCat + 'px';
          if (pageWrap) pageWrap.style.top = (afterCat + (subVisible ? subWrap.offsetHeight : 0)) + 'px';
        }
      };
      window.addEventListener('resize', () => window.syncCategoryBarOffset());

      // จัดกลุ่มสินค้าที่ "ยังไม่ได้รวมกลุ่มจริงในฐานข้อมูล" ให้แสดงรวมเป็นการ์ดเดียวตอนค้นหา/เลือก
      // หมวดหมู่ — แค่ตอนแสดงผลเท่านั้น ไม่แก้ไขข้อมูลจริงเลย (ยังกด "🩺 จับกลุ่มสินค้าอัตโนมัติ" ในหน้า
      // ตั้งค่าเพื่อรวมจริงถาวรได้เหมือนเดิม) ใช้ตรรกะตรวจจับชุดเดียวกับเครื่องมือนั้น
      // (getProductBaseName) แต่เอาเฉพาะ 2 วิธีที่มั่นใจสูง — ชื่อคล้ายกันตามรูปแบบไซส์/สี/หน่วยที่รู้จัก
      // และรูปภาพเดียวกันเป๊ะ — ไม่เอา fallback แบบคำนำหน้าคล้ายกัน (fuzzy) ที่หน้าตั้งค่าติดป้าย
      // "ตรวจสอบก่อนรวม" ไว้ เพราะพลาดแล้วกระทบการขายจริงตรงๆ ต่างจากหน้าตั้งค่าที่แค่เป็นคำแนะนำ
      function clusterForDisplay(products) {
        const standalone = products.filter(p => (p.variants || []).length === 1);
        const clustered = new Set();
        const virtualGroups = [];

        const byName = {};
        standalone.forEach(p => {
          const base = getProductBaseName(p.name);
          if (base.length > 1) (byName[base] = byName[base] || []).push(p);
        });
        Object.entries(byName).forEach(([base, items]) => {
          if (items.length < 2) return;
          items.forEach(p => clustered.add(p.id));
          virtualGroups.push({ label: base, items });
        });

        const byImage = {};
        standalone.filter(p => !clustered.has(p.id)).forEach(p => {
          const url = p.imageUrl;
          if (url && /^(https?:|data:)/.test(url)) (byImage[url] = byImage[url] || []).push(p);
        });
        Object.values(byImage).forEach(items => {
          if (items.length < 2) return;
          items.forEach(p => clustered.add(p.id));
          virtualGroups.push({ label: getProductBaseName(items[0].name) || items[0].name, items });
        });

        if (!virtualGroups.length) return products; // ทางลัด — ไม่มีอะไรให้จัดกลุ่มเพิ่ม

        const idToVirtualCard = new Map();
        virtualGroups.forEach(g => {
          const card = {
            __virtual: true,
            id: 'vg-' + g.items.map(p => p.id).join('-'),
            name: g.label,
            imageUrl: g.items.find(p => p.imageUrl)?.imageUrl || null,
            image: g.items.find(p => p.image)?.image || null,
            variants: g.items.flatMap(p => p.variants || []),
            _memberIds: g.items.map(p => p.id)
          };
          g.items.forEach(p => idToVirtualCard.set(p.id, card));
        });

        // คงลำดับเดิมของผลลัพธ์ไว้ (สำคัญตอนค้นหา — รายการที่ตรงสุดต้องขึ้นก่อนเหมือนเดิม ไม่ใช่ถูก
        // ดันไปท้ายแถวเพราะถูกจัดกลุ่ม) โดยแทรกการ์ดกลุ่มเสมือน ณ ตำแหน่งของสมาชิกตัวแรกที่เจอ
        const out = [];
        const emitted = new Set();
        products.forEach(p => {
          const vcard = idToVirtualCard.get(p.id);
          if (vcard) {
            if (!emitted.has(vcard.id)) { out.push(vcard); emitted.add(vcard.id); }
            return;
          }
          out.push(p);
        });
        return out;
      }

      window.renderProductGridResults = function(products, title) {
        _lastProductList = clusterForDisplay(products);
        _lastProductTitle = title;
        productGridPage = 0;
        window.renderProductGridPage();
      };

      // A product counts as "out of stock" for this filter when every one of its variants is
      // at 0 (or less) — a product with at least one variant still available stays visible.
      function isProductFullyOutOfStock(p) {
        return (p.variants || []).every(v => (+v.stock || 0) <= 0);
      }

      window.renderProductGridPage = function() {
        const hideOut = document.getElementById('hide-out-of-stock')?.checked;
        const visibleList = hideOut ? _lastProductList.filter(p => !isProductFullyOutOfStock(p)) : _lastProductList;

        const totalPages = Math.max(1, Math.ceil(visibleList.length / productsPerPage));
        productGridPage = Math.max(0, Math.min(productGridPage, totalPages - 1));
        const pageItems = visibleList.slice(productGridPage * productsPerPage, (productGridPage + 1) * productsPerPage);

        const _productCount = visibleList.reduce((n, c) => n + (c.__virtual ? (c._memberIds || []).length : 1), 0);
        document.getElementById('current-cat-title').textContent = `${_lastProductTitle} (${visibleList.length} การ์ด • ${_productCount} สินค้า)`;
        document.getElementById('product-page-indicator').textContent = `หน้า ${productGridPage + 1}/${totalPages}`;
        document.getElementById('product-grid').innerHTML = pageItems.length
          ? pageItems.map(window.renderProductCard).join('')
          : `<p class="col-span-full text-center text-slate-400 font-bold py-10">ไม่พบสินค้า</p>`;
        // Re-measure after render: adding the page-size/column selectors can wrap the bar onto
        // a second line on narrow screens, changing its height.
        window.syncCategoryBarOffset?.();
      };

      window.gotoProductPage = function(delta) {
        const hideOut = document.getElementById('hide-out-of-stock')?.checked;
        const visibleList = hideOut ? _lastProductList.filter(p => !isProductFullyOutOfStock(p)) : _lastProductList;
        const totalPages = Math.max(1, Math.ceil(visibleList.length / productsPerPage));
        productGridPage = Math.max(0, Math.min(totalPages - 1, productGridPage + delta));
        window.renderProductGridPage();
        document.getElementById('product-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      window.selectCategory = function(catName) {
        currentCategoryFilter = catName;
        const cats = Array.isArray(db.categories) ? db.categories : [];
        const cat = catName === null ? null : cats.find(c => c.name === catName);
        // ตัดสินว่าแถวหมวดหมู่ย่อยควรกางออกให้ "หมวดหมู่หลัก" ไหน: ถ้าเลือกหมวดหมู่หลักเอง
        // ก็กางของตัวเอง, ถ้าเลือกหมวดหมู่ย่อยก็กางของแม่มันไว้ (ให้เห็นว่าอยู่ในกลุ่มไหน)
        currentMainCategoryId = cat ? (cat.parentId || cat.id) : null;
        const s = document.getElementById('search-product');
        if (s) s.value = '';
        window.renderCategoryBar();
        window.syncCategoryBarOffset?.(); // re-measure — bar heights can change per filter

        // เลือกหมวดหมู่หลักที่มีหมวดหมู่ย่อย = รวมสินค้าทุกหมวดหมู่ย่อยในนั้นมาแสดงด้วย
        // ไม่ใช่แค่สินค้าที่ติดป้ายชื่อหมวดหมู่หลักตรงตัวเท่านั้น
        const namesToMatch = cat && !cat.parentId
          ? [cat.name, ...cats.filter(c => c.parentId === cat.id).map(c => c.name)]
          : (catName === null ? null : [catName]);

        const products = namesToMatch === null
          ? Object.values(db.products).filter(p => !p.isDisabled).sort((a, b) => naturalCompare(a.name, b.name))
          : Object.values(db.products).filter(p => !p.isDisabled && (p.cat || []).some(pc => namesToMatch.includes(pc))).sort((a, b) => naturalCompare(a.name, b.name));
        window.renderProductGridResults(products, catName === null ? '🏷️ สินค้าทั้งหมด' : catName);
      };

      window.exitCategory = function() {
        const s = document.getElementById('search-product');
        if (s) s.value = '';
        window.selectCategory(currentCategoryFilter);
      };

      window.onSearchInput = function(e) {
        const q = (e.target.value || '').trim().toLowerCase();
        if (!q) { window.selectCategory(currentCategoryFilter); return; }
        let results = Object.values(db.products).filter(p => {
          if (p.isDisabled) return false;
          if ((p.name || '').toLowerCase().includes(q)) return true;
          if ((p.code || '').toLowerCase().includes(q)) return true;
          return (p.variants || []).some(v => (v.barcode || '').toLowerCase().includes(q));
        });
        // Relevance ordering: exact barcode/SKU hits and name-starts-with matches surface
        // first, so the item being searched for shows up without scanning the whole grid.
        results.sort((a, b) => {
          const score = p => {
            if ((p.variants || []).some(v => (v.barcode || '').toLowerCase() === q)) return 0;
            if ((p.code || '').toLowerCase() === q) return 0;
            if ((p.name || '').toLowerCase().startsWith(q)) return 1;
            return 2;
          };
          return score(a) - score(b) || naturalCompare(a.name, b.name);
        });
        window.renderProductGridResults(results, `🔍 ผลการค้นหา: "${e.target.value}"`);
      };

      window.updateCartQty = function(key, change) {
        const item = cart.find(x => x.cartKey === key);
        if (!item) return;
        item.qty += change;
        if (item.qty <= 0) {
          cart = cart.filter(x => x.cartKey !== key);
        }
        window.cart = cart;
        window.updateCartUI();
      };

      window.updateCartUI = function() {
        const count = cart.reduce((sum, item) => sum + item.qty, 0);
        const badge = document.getElementById('header-cart-count');
        if (badge) {
          badge.innerText = count;
          badge.style.display = count ? '' : 'none';
          badge.classList.remove('cart-badge-bump');
          void badge.offsetWidth; // restart animation
          badge.classList.add('cart-badge-bump');
        }

        const list = document.getElementById('cart-items-list');
        if (list) {
          list.innerHTML = cart.length ? cart.map(item => `
            <div class="cart-item-pop flex justify-between items-center bg-slate-50 hover:bg-slate-100 p-2.5 rounded-2xl border border-slate-100 text-xs text-slate-800 transition-colors">
              <div class="flex-1 min-w-0 pr-2">
                <span class="font-bold block truncate">${escapeHTML(item.name)}</span>
                <span class="text-[10px] text-slate-400">@${formatMoney(item.price)}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <button onclick="window.updateCartQty('${item.cartKey}', -1)" class="cart-stepper-btn w-7 h-7 rounded-full bg-white border border-slate-200 text-rose-500 font-bold shadow-sm btn-touch">−</button>
                <span class="font-black text-xs w-5 text-center">${item.qty}</span>
                <button onclick="window.updateCartQty('${item.cartKey}', 1)" class="cart-stepper-btn w-7 h-7 rounded-full bg-white border border-slate-200 text-indigo-600 font-bold shadow-sm btn-touch">+</button>
                <span class="w-14 text-right font-bold text-indigo-600">${formatMoney(item.qty * item.price)}</span>
              </div>
            </div>
          `).join('') : `
            <div class="flex flex-col items-center justify-center py-8 text-slate-300">
              <span class="text-4xl cart-empty-float">🛒</span>
              <span class="text-xs font-bold mt-2 text-slate-400">ตะกร้าว่างเปล่า เลือกสินค้าเพื่อเริ่มขาย</span>
            </div>`;
        }

        window.updateCartTotals();
      };

      window.updateCartTotals = function() {
        const _tot = window.calcCartTotals(cart, document.getElementById('cart-discount-input')?.value, document.getElementById('cart-discount-type')?.value);
        const subtotal = _tot.subtotal, discountAmt = _tot.discountAmt, grandTotal = _tot.grandTotal;

        if (document.getElementById('cart-subtotal')) document.getElementById('cart-subtotal').innerText = formatMoney(subtotal);
        if (document.getElementById('cart-discount-disp')) document.getElementById('cart-discount-disp').innerText = `-฿${discountAmt.toFixed(2)}`;
        const grandEl = document.getElementById('cart-grand-total');
        if (grandEl) {
          grandEl.innerText = formatMoney(grandTotal);
          grandEl.classList.remove('cart-total-glow');
          void grandEl.offsetWidth;
          grandEl.classList.add('cart-total-glow');
        }

        window.calcChange();
      };

      // Clears everything tied to the current sale (cart, discount, cash-received, payment
      // method, chosen customer) so nothing "leftover" carries into the next transaction.
      // Previously only `cart` itself was reset after checkout — the discount amount and the
      // cash-received figure stayed in their input fields, so the next sale could silently
      // start with a stale discount applied or show an incorrect change amount.
      window.resetCartState = function() {
        cart = [];
        window.cart = cart;

        const discountInput = document.getElementById('cart-discount-input');
        if (discountInput) discountInput.value = '';
        const discountType = document.getElementById('cart-discount-type');
        if (discountType) discountType.value = 'BAHT';
        const cashReceived = document.getElementById('pay-cash-received');
        if (cashReceived) cashReceived.value = '';
        const custSelect = document.getElementById('pay-customer-select');
        if (custSelect) custSelect.value = 'GENERAL';

        window.switchPayTab('CASH');
        window.updateCartUI();
      };

      window.populateCustomerSelect = function() {
        const custSelect = document.getElementById('pay-customer-select');
        if (custSelect) {
          const cur = custSelect.value;
          custSelect.innerHTML = `<option value="GENERAL">ลูกค้าทั่วไป (ไม่ระบุ)</option>` +
            Object.values(db.customers || {}).map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
          if (cur && db.customers[cur]) custSelect.value = cur;
        }
      };

      window.openCartModal = function() {
        window.populateCustomerSelect();
        window.updateCartUI();
        document.getElementById('modal-cart').classList.remove('hidden');
        document.getElementById('modal-cart').classList.add('flex');
        window.posHooks.emit('cart:open');
      };

      // ==========================================
      // PAYMENT PROCESSING
      // ==========================================
      window.switchPayTab = function(tab) {
        activePayMethod = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');

        document.querySelectorAll('.pay-view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`pay-view-${tab}`).classList.remove('hidden');

        if (tab === 'TRANSFER') {
          const grandTotalStr = String(window.currentCartTotal());
          const grandTotal = parseFloat(grandTotalStr) || 0;
          document.getElementById('pay-pp-id-disp').innerText = db.promptPayId;
          document.getElementById('pay-promptpay-qr-img').src = `https://promptpay.io/${db.promptPayId}/${grandTotal}.png`;
        }
      };

      window.selectQuickBanknote = function(val) {
        const grandTotalStr = String(window.currentCartTotal());
        const total = parseFloat(grandTotalStr) || 0;
        const input = document.getElementById('pay-cash-received');
        if (val === 'MATCH') {
          input.value = total;
        } else {
          let cur = parseFloat(input.value) || 0;
          input.value = roundAmt(cur + val);
        }
        window.calcChange();
      };

      window.calcChange = function() {
        const grandTotalStr = String(window.currentCartTotal());
        const total = parseFloat(grandTotalStr) || 0;
        const received = parseFloat(document.getElementById('pay-cash-received')?.value) || 0;
        const change = roundAmt(received - total);
        if (document.getElementById('pay-cash-change')) {
          document.getElementById('pay-cash-change').innerText = formatMoney(change > 0 ? change : 0);
        }
        window.posHooks.emit('pay:calc');
      };

      // Shared running-number generator for any document type (bills, goods-receipt notes,
      // credit notes, purchase orders, ...). Format: PREFIX-YYYYMMDD-NNN, resetting to 001 each
      // new day. Counter state lives in db.counters so it persists locally and across reloads.
      function getRunningDocNumber(prefix, dateKey, numKey, withDevice) {
        const today = window.todayKey();   // วันที่เวลาไทย ไม่ใช่ UTC
        db.counters = db.counters || {};
        if (db.counters[dateKey] !== today) {
          db.counters[dateKey] = today;
          db.counters[numKey] = 1;
        } else {
          db.counters[numKey]++;
        }
        const dev = withDevice ? window.getDeviceId() + '-' : '';   // กันเลขบิลซ้ำข้ามเครื่อง
        return `${prefix}-${today}-${dev}${db.counters[numKey].toString().padStart(3, '0')}`;
      }

      function getDailyBillId() {
        return getRunningDocNumber('POS', 'lastBillDate', 'dailyBillNum', true);
      }

      // Auto-numbering for documents the user CAN type their own reference for (e.g. the
      // supplier's own delivery-note number) — these are only used as a fallback when the
      // field is left blank, never overriding something the user actually typed in.
      window.getGoodsReceiptNumber = function() { return getRunningDocNumber('GR', 'lastGRDate', 'dailyGRNum', true); };
      window.getCreditNoteNumber = function() { return getRunningDocNumber('CN', 'lastCNDate', 'dailyCNNum', true); };
      window.currentCartTotal = function() { return window.calcCartTotals(cart, document.getElementById('cart-discount-input')?.value, document.getElementById('cart-discount-type')?.value).grandTotal; };
      window.getAutoSku = function() { return getRunningDocNumber('SKU', 'lastSKUDate', 'dailySKUNum'); };

      async function processPaymentCore() {
        if (cart.length === 0) return alert("ตะกร้าสินค้าว่างเปล่า");

        const grandTotalStr = String(window.currentCartTotal());
        const total = parseFloat(grandTotalStr) || 0;
        const cid = document.getElementById('pay-customer-select').value;

        if (activePayMethod === 'CREDIT' && cid === 'GENERAL') {
          return alert("กรณีค้างชำระ จำเป็นต้องเลือกชื่อลูกค้าก่อนบันทึก");
        }

        // ตรวจวงเงินฝั่งหน้าเว็บเพื่อแจ้งผู้ใช้ทันที; ฐานข้อมูลตรวจซ้ำใน create_sale และเป็นตัวตัดสินสุดท้าย
        if (activePayMethod === 'CREDIT' && db.customers[cid]) {
          const limit = db.customers[cid].creditLimit ?? 50000;
          if (roundAmt(db.customers[cid].debt + total) > limit) {
            return window.showAlert
              ? window.showAlert("วงเงินเครดิตไม่พอ", `ยอดหนี้รวมจะเกินวงเงินเครดิตที่กำหนดไว้ (${formatMoney(limit)})`, true)
              : alert(`ยอดหนี้รวมจะเกินวงเงินเครดิตที่กำหนดไว้ (${formatMoney(limit)})`);
          }
        }

        // ป้องกันสต็อกติดลบ (เปิด/ปิดที่ ตั้งค่า > ร้านค้า) — เดิมไม่มีการเช็คสต็อกก่อนขายเลย
        if (window.isPreventNegativeStock()) {
          const need = {};
          cart.forEach(i => { const k = i.id + '|' + i.variantId; need[k] = (need[k] || 0) + i.qty * (i.multiplier || 1); });
          for (const k of Object.keys(need)) {
            const [pid, vid] = k.split('|');
            const pv = db.products[pid]?.variants?.find(x => x.id === vid);
            if (pv && roundStock((+pv.stock || 0) - need[k]) < 0) {
              return window.showAlert("สินค้าคงเหลือไม่พอ", `"${db.products[pid].name}" คงเหลือ ${roundStock(+pv.stock || 0)} แต่ต้องการ ${roundStock(need[k])} (ปิดการป้องกันได้ที่ ตั้งค่า > ร้านค้า)`, true);
            }
          }
        }

        const _tot = window.calcCartTotals(cart, document.getElementById('cart-discount-input')?.value, document.getElementById('cart-discount-type')?.value);
        const billId = getDailyBillId();
        const bill = {
          id: billId,
          time: Date.now(),
          items: cart.map(i => ({ ...i })),
          total: total,
          subtotal: _tot.subtotal,        // ยอดก่อนลด
          discount: _tot.discountAmt,     // ส่วนลด (เดิมไม่เคยถูกบันทึก/ส่งขึ้นเซิร์ฟเวอร์)
          deviceId: window.getDeviceId(),
          _rpcPending: true,              // รอส่งผ่าน create_sale (ดูคิวซิงค์)
          method: activePayMethod,
          customerId: cid,
          cashierId: db.activeUser?.id || null,
          cashierName: db.activeUser?.name || null,
          shiftId: db.currentShift?.id || null
        };
        if (db.settings && db.settings.vatRegistered && +db.settings.vatRate > 0) {
          const _vr = +db.settings.vatRate;
          bill.taxMode = 'INCLUDED'; bill.vatRate = _vr;
          bill.vatAmount = roundAmt(total * _vr / (100 + _vr));      // ภาษีที่รวมอยู่ในยอด
          bill.vatBase = roundAmt(total - bill.vatAmount);            // มูลค่าก่อนภาษี
        } else { bill.taxMode = 'NONE'; bill.vatAmount = 0; }

        db.bills.push(bill);

        // Deduct Stock
        cart.forEach(item => {
          const p = db.products[item.id];
          if (p) {
            const v = p.variants.find(x => x.id === item.variantId);
            if (v) v.stock = roundStock(v.stock - (item.qty * item.multiplier));
          }
        });

        // Handle Credit Debt
        if (activePayMethod === 'CREDIT' && db.customers[cid]) {
          db.customers[cid].debt = roundAmt(db.customers[cid].debt + total);
        }

        // Reset — clears cart, discount, cash-received, payment tab, and customer selection
        // so nothing carries over ("ค้าง") into the next sale.
        window.resetCartState();
        window.closeModal('modal-cart');
        // Put the operation into the durable queue before displaying a success message or
        // allowing the queue runner to send it. The stable bill ID is the idempotency reference.
        window.enqueueSync({ type: 'sale', payload: { billId: bill.id } }, true);
        let durableResult = null;
        try {
          durableResult = await window.persistDurably();
        } catch (e) {
          console.error('Durable sale save failed', e);
        }
        window.renderReceipt(bill);
        if (!durableResult || !durableResult.ok) {
          window.showAlert?.('⚠️ ต้องตรวจสอบการบันทึก', 'บิลนี้อยู่ในหน่วยความจำของแอป แต่การบันทึกลงเครื่องไม่สำเร็จ อย่าปิดหรือรีโหลดหน้านี้จนกว่าจะเชื่อมต่อและซิงก์ขึ้น Supabase สำเร็จ', true);
          return;
        }
        if (durableResult.warning) {
          window.showAlert?.('บันทึกในเครื่องได้ แต่สำรองไม่ครบ', 'รายการขายถูกเก็บใน localStorage แล้ว แต่ IndexedDB สำรองไม่สำเร็จ ควรเชื่อมต่ออินเทอร์เน็ตและตรวจว่าซิงก์ขึ้น Supabase สำเร็จก่อนปิดแอป', true);
        } else {
          window.showToast('บันทึกบิลในเครื่องแล้ว — กำลังรอซิงก์ขึ้นคลาวด์');
        }
        window.flushSyncQueue?.().catch(e => console.warn('Sale sync deferred:', errMsg(e)));
      }

      // จุดเข้าเดียวของการชำระเงิน: ตรวจสิทธิ์ -> ทำรายการ -> แจ้งเหตุการณ์ (เสียง/อีเวนต์ขายสำเร็จ)
      window.processPaymentRequest = async function() {
        if (!window.canDo('SALE')) return window.posDenied('SALE');
        if (activePayMethod === 'CREDIT' && !window.canDo('CREDIT_SALE')) return window.posDenied('CREDIT_SALE');
        const disc = parseFloat(document.getElementById('cart-discount-input')?.value) || 0;
        if (disc > 0 && !window.canDo('DISCOUNT')) return window.posDenied('DISCOUNT');

        const billsBefore = (db.bills || []).length;
        const total = Number(window.currentCartTotal()) || 0;
        const received = parseFloat(document.getElementById('pay-cash-received')?.value) || 0;
        const isCash = activePayMethod === 'CASH';
        let res;
        try { res = await processPaymentCore.apply(this, arguments); }
        catch (e) { window.posHooks.emit('pay:error', e); throw e; }
        const sold = (db.bills || []).length > billsBefore;
        window.posHooks.emit('pay:end', { sold, total, received, isCash });
        if (sold) {
          try { document.dispatchEvent(new CustomEvent('pos:sale-complete', { detail: {
            total, received,
            change: (isCash && total > 0 && received >= total) ? Math.round((received - total) * 100) / 100 : 0
          } })); } catch (e) {}
        }
        return res;
      };

      // การส่งบิลขึ้นเซิร์ฟเวอร์ย้ายไปที่คิวซิงค์ — ดู window.enqueueSync / runSale ในโมดูลคิวซิงค์ท้ายไฟล์
      window.syncBillToSupabaseRPC = function(bill) { window.enqueueSync({ type: 'sale', payload: { billId: bill.id } }); };

      // ============================================================
      // พักบิล (HOLD / PARK SALE) — เก็บตะกร้าปัจจุบันไว้ชั่วคราว แล้วเริ่มขายลูกค้ารายใหม่ได้
      // ทันทีโดยไม่ต้องยกเลิกบิลที่กำลังทำอยู่ (เช่น ลูกค้าลืมกระเป๋าเงินไว้ในรถ, รอเช็คของเพิ่ม)
      // เก็บเป็น local-only ในเครื่อง ไม่ sync ขึ้น Supabase เพราะยังไม่ใช่ธุรกรรมขายจริง
      // ============================================================
      window.holdCurrentBill = function() {
        if (!cart.length) return window.showAlert?.('ตะกร้าว่าง', 'ไม่มีสินค้าในตะกร้าให้พัก', true);
        db.heldBills = db.heldBills || [];
        db.heldBills.push({
          id: 'HOLD-' + Date.now(),
          time: Date.now(),
          cart: cart.map(i => ({ ...i })),
          customerId: document.getElementById('pay-customer-select')?.value || 'GENERAL',
          discountInput: document.getElementById('cart-discount-input')?.value || '',
          discountType: document.getElementById('cart-discount-type')?.value || 'BAHT',
          payMethod: activePayMethod,
          label: (document.getElementById('pay-customer-select')?.selectedOptions?.[0]?.textContent || 'ลูกค้าทั่วไป').trim()
        });
        cart = [];
        window.cart = cart;
        window.persist?.();
        window.updateCartUI?.();
        window.closeModal('modal-cart');
        window.renderHeldBillsCount();
        window.showToast?.('พักบิลไว้แล้ว — เริ่มขายบิลใหม่ได้เลย');
      };

      window.renderHeldBillsCount = function() {
        const n = (db.heldBills || []).length;
        const el = document.getElementById('held-bills-count');
        if (!el) return;
        el.textContent = n;
        el.classList.toggle('hidden', n === 0);
      };

      window.openHeldBillsModal = function() {
        window.renderHeldBillsList();
        const m = document.getElementById('modal-held-bills');
        m.classList.remove('hidden'); m.classList.add('flex');
      };

      window.renderHeldBillsList = function() {
        const list = document.getElementById('held-bills-list');
        if (!list) return;
        const held = (db.heldBills || []).slice().reverse();
        list.innerHTML = held.length ? held.map(h => {
          const total = h.cart.reduce((s, i) => s + (i.qty * i.price), 0);
          const itemsLabel = h.cart.map(i => `${escapeHTML(i.name)} ×${i.qty}`).join(', ');
          return `
          <div class="bg-slate-50 border rounded-xl p-3 text-xs">
            <div class="flex justify-between font-bold text-slate-800">
              <span>${escapeHTML(h.label)}</span><span class="text-indigo-600">${formatMoney(total)}</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-0.5">${new Date(h.time).toLocaleString('th-TH')} • ${h.cart.length} รายการ</div>
            <div class="text-[10px] text-slate-500 mt-1 line-clamp-2">${itemsLabel}</div>
            <div class="flex gap-2 mt-2">
              <button onclick="window.resumeHeldBill('${h.id}')" class="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold btn-touch">↩️ เรียกคืน</button>
              <button onclick="window.deleteHeldBill('${h.id}')" class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg font-bold btn-touch">🗑️</button>
            </div>
          </div>`;
        }).join('') : `<p class="text-center text-slate-400 font-bold py-8">ยังไม่มีบิลที่พักไว้</p>`;
      };

      window.resumeHeldBill = function(id) {
        const held = db.heldBills || [];
        const idx = held.findIndex(h => h.id === id);
        if (idx === -1) return;
        const h = held[idx];
        // ถ้าตะกร้าปัจจุบันมีของค้างอยู่ พักของเดิมไว้ก่อนสลับ กันข้อมูลหาย
        if (cart.length) window.holdCurrentBill();
        cart = h.cart.map(i => ({ ...i }));
        window.cart = cart;
        held.splice(idx, 1);
        window.persist?.();
        window.renderHeldBillsCount();
        window.closeModal('modal-held-bills');
        window.openCartModal();
        setTimeout(() => {
          const sel = document.getElementById('pay-customer-select');
          if (sel) sel.value = h.customerId;
          const di = document.getElementById('cart-discount-input');
          if (di) di.value = h.discountInput;
          const dt = document.getElementById('cart-discount-type');
          if (dt) dt.value = h.discountType;
          window.switchPayTab?.(h.payMethod || 'CASH');
          window.updateCartTotals?.();
        }, 0);
        window.showToast?.('เรียกบิลที่พักไว้กลับมาแล้ว');
      };

      window.deleteHeldBill = function(id) {
        if (!confirm('ลบบิลที่พักไว้? สินค้าในบิลนี้จะหายไป ต้องเริ่มเพิ่มใหม่ถ้าต้องการ')) return;
        db.heldBills = (db.heldBills || []).filter(h => h.id !== id);
        window.persist?.();
        window.renderHeldBillsCount();
        window.renderHeldBillsList();
      };

      document.addEventListener('DOMContentLoaded', () => { db.heldBills = db.heldBills || []; window.renderHeldBillsCount(); });

      window.renderReceipt = function(bill) {
        const cName = bill.customerId !== 'GENERAL' && db.customers[bill.customerId] ? db.customers[bill.customerId].name : 'ลูกค้าทั่วไป';
        let itemsHtml = bill.items.map(i => `
          <div class="flex justify-between border-b border-dashed border-slate-200 py-1 text-xs">
            <span class="flex-1">${escapeHTML(i.name)}</span>
            <span class="w-8 text-center">${i.qty}</span>
            <span class="w-16 text-right">${formatMoney(i.qty * i.price)}</span>
          </div>
        `).join('');

        // Return / credit-note history for this bill — shows up right on the receipt itself so
        // there's a clear paper trail of every deduction applied against it, not just the
        // original sale total.
        const returns = (db.returns || []).filter(r => r.billId === bill.id);
        const returnsHtml = returns.length ? `
          <div class="mt-2 pt-2 border-t border-dashed border-rose-200 text-[10px] text-rose-600 space-y-0.5">
            <p class="font-bold">↩️ ประวัติใบลดหนี้ / คืนสินค้า:</p>
            ${returns.map(r => `<p>${escapeHTML(r.id)} — ${new Date(r.time).toLocaleDateString('th-TH')} — ${r.isDebtReduction ? 'หักยอดหนี้' : 'คืนเงินสด'} ${formatMoney(r.amount)}</p>`).join('')}
          </div>` : '';

        const html = `
          <div class="space-y-3 p-4 border rounded-xl bg-white max-w-sm mx-auto text-slate-800">
            <div class="text-center">
              ${bill.taxMode === 'INCLUDED' ? '<p class="text-xs font-black">ใบกำกับภาษีอย่างย่อ</p>' : ''}
              <h2 class="text-base font-bold">${escapeHTML(db.storeName)}</h2>
              <p class="text-[10px] text-slate-500">${escapeHTML(db.storeAddress)}</p>
              ${bill.taxMode === 'INCLUDED' ? `<p class="text-[10px] text-slate-500">เลขประจำตัวผู้เสียภาษี ${escapeHTML(db.taxId || '-')} • ${escapeHTML((db.settings && db.settings.vatBranch) || 'สำนักงานใหญ่')}</p>` : ''}
              <div class="border-b my-2"></div>
            </div>
            <div class="text-[10px] space-y-0.5">
              <p><b>เลขที่บิล:</b> ${escapeHTML(bill.id)}</p>
              <p><b>วันที่เวลา:</b> ${new Date(bill.time).toLocaleString('th-TH')}</p>
              <p><b>ลูกค้า:</b> ${escapeHTML(cName)}</p>
              <p><b>ช่องทางชำระ:</b> ${escapeHTML(bill.method)}</p>
            </div>
            <div class="font-bold border-b pb-1 mb-1 flex text-[10px]">
              <span class="flex-1">รายการ</span><span class="w-8 text-center">จำนวน</span><span class="w-16 text-right">รวม</span>
            </div>
            ${itemsHtml}
            <div class="mt-3 text-right text-xs border-t pt-2 font-bold text-indigo-600">
              ${bill.taxMode === 'INCLUDED' ? `<div class="flex justify-between text-[11px] text-slate-600 font-normal"><span>มูลค่าก่อนภาษี:</span><span>${formatMoney(bill.vatBase)}</span></div><div class="flex justify-between text-[11px] text-slate-600 font-normal"><span>ภาษีมูลค่าเพิ่ม ${bill.vatRate}%:</span><span>${formatMoney(bill.vatAmount)}</span></div>` : ''}
              <div class="flex justify-between text-sm"><span>ยอดรวมสุทธิ${bill.taxMode === 'INCLUDED' ? ' (รวม VAT)' : ''}:</span><span>${formatMoney(bill.total)}</span></div>
            </div>
            ${returnsHtml}
          </div>
        `;
        document.getElementById('print-document-area').innerHTML = html;
        document.getElementById('modal-document-viewer').classList.remove('hidden');
        document.getElementById('modal-document-viewer').classList.add('flex');
      };

      // ==========================================
      // COMPREHENSIVE PRODUCT TABLE RENDER
      // ==========================================
      window.resetStockFilters = function() {
        document.getElementById('stock-search-input').value = '';
        document.getElementById('stock-category-filter').value = 'ALL';
        document.getElementById('stock-status-filter').value = 'ALL';
        stockSortBy = 'name';
        stockSortDir = 'asc';
        window.renderStockTable();
      };

      // Toggles sort direction when clicking the same column again, matching the familiar
      // spreadsheet convention (click once = ascending, click again = descending).
      window.setStockSort = function(field) {
        if (stockSortBy === field) {
          stockSortDir = stockSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          stockSortBy = field;
          stockSortDir = 'asc';
        }
        window.renderStockTable();
      };

      const STOCK_PAGE_SIZE = 100;
      let stockRenderLimit = STOCK_PAGE_SIZE, stockRenderSig = '';
      window.stockShowMore = function() { stockRenderLimit += 200; window.renderStockTable(); };

      const renderStockTableCore = function() {
        // Clear any selection on every re-render (search/filter/sort change the row set, so a
        // stale selection referencing rows no longer shown would be confusing) — also hides
        // the bulk toolbar until the user checks something again.
        selectedProductIds.clear();
        window.updateBulkToolbar();

        const search = document.getElementById('stock-search-input').value.toLowerCase();
        const catFilter = document.getElementById('stock-category-filter').value;
        const statusFilter = document.getElementById('stock-status-filter').value;
        const tbody = document.getElementById('stock-table-body');

        const catSel = document.getElementById('stock-category-filter');
        if (catSel.options.length <= 1) {
          catSel.innerHTML = `<option value="ALL">📁 หมวดหมู่ทั้งหมด</option>` +
            db.categories.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
        }

        // Reflect the active sort column/direction on the column headers.
        document.querySelectorAll('[id^="sort-arrow-"]').forEach(el => el.innerHTML = '');
        const activeArrow = document.getElementById('sort-arrow-' + stockSortBy);
        if (activeArrow) activeArrow.innerHTML = stockSortDir === 'asc' ? '▲' : '▼';

        // ตัวกรอง/การเรียงเปลี่ยน -> กลับไปแสดงหน้าแรก (วาดใหม่เฉยๆ เช่น หลังแก้ไขสินค้า คงจำนวนที่เปิดไว้)
        const sig = [search, catFilter, statusFilter, stockSortBy, stockSortDir].join('|');
        if (sig !== stockRenderSig) { stockRenderSig = sig; stockRenderLimit = STOCK_PAGE_SIZE; }

        let flt = [];
        Object.values(db.products).forEach(p => {
          // สินค้าที่ยังไม่มีขนาด/หน่วย ก็ต้องแสดงในตาราง (เดิมถูกข้ามไป ทำให้จำนวนไม่ตรงกับหน้าขาย)
          const variantsForRows = (p.variants && p.variants.length) ? p.variants : [{ sizeName: '(ยังไม่มีขนาด)', barcode: '', cost: 0, price: 0, stock: 0, minStock: 0 }];
          variantsForRows.forEach((v) => {
            const isMatchSearch = p.name.toLowerCase().includes(search) ||
                                 (p.code || '').toLowerCase().includes(search) ||
                                 (v.barcode || '').toLowerCase().includes(search) ||
                                 (v.locationCode || '').toLowerCase().includes(search);
            const isMatchCat = catFilter === 'ALL' || (p.cat && p.cat.includes(catFilter));
            const stock = roundStock(v.stock);
            const isOut = stock <= 0;
            const isBelowMin = !isOut && stock <= roundStock(v.minStock || 10);
            let isMatchStatus = true;
            if (statusFilter === 'LOW') isMatchStatus = isBelowMin;
            else if (statusFilter === 'OUT') isMatchStatus = isOut;
            else if (statusFilter === 'NORMAL') isMatchStatus = !isOut && !isBelowMin;

            if (isMatchSearch && isMatchCat && isMatchStatus) {
              flt.push({ p, v, isBelowMin, isOut });
            }
          });
        });

        document.getElementById('stock-total-count').innerText = flt.length;
        document.getElementById('stock-product-count').innerText = new Set(flt.map(x => x.p.id)).size;
        const totalStockValue = flt.reduce((s, item) => s + ((+item.v.cost || 0) * (+item.v.stock || 0)), 0);
        document.getElementById('stock-total-value').innerText = '฿' + roundAmt(totalStockValue).toLocaleString('th-TH');

        // Sorting — every data column is sortable, toggling asc/desc on repeated clicks.
        const dir = stockSortDir === 'desc' ? -1 : 1;
        const sorters = {
          name: (a, b) => naturalCompare(a.p.name, b.p.name) * dir,
          code: (a, b) => naturalCompare(a.p.code || '', b.p.code || '') * dir,
          barcode: (a, b) => naturalCompare(a.v.barcode || '', b.v.barcode || '') * dir,
          cost: (a, b) => ((a.v.cost || 0) - (b.v.cost || 0)) * dir,
          price: (a, b) => ((a.v.price || 0) - (b.v.price || 0)) * dir,
          stock: (a, b) => ((a.v.stock || 0) - (b.v.stock || 0)) * dir,
          margin: (a, b) => (((a.v.price || 0) - (a.v.cost || 0)) - ((b.v.price || 0) - (b.v.cost || 0))) * dir,
          stockvalue: (a, b) => (((a.v.cost || 0) * (a.v.stock || 0)) - ((b.v.cost || 0) * (b.v.stock || 0))) * dir,
          cat: (a, b) => (((a.p.cat && a.p.cat[0]) || '').localeCompare(((b.p.cat && b.p.cat[0]) || ''), 'th')) * dir
        };
        if (sorters[stockSortBy]) flt.sort(sorters[stockSortBy]);

        if (flt.length === 0) {
          tbody.innerHTML = `<tr><td colspan="15" class="p-8 text-center text-slate-400 font-bold">ไม่พบรายการสินค้าที่ตรงเงื่อนไข</td></tr>`;
          return;
        }

        const shown = flt.slice(0, stockRenderLimit);
        tbody.innerHTML = shown.map((item, idx) => {
          const p = item.p, v = item.v, isBelowMin = item.isBelowMin, isOut = item.isOut;
          const fractionsHtml = (v.fractions || []).map(f => `
            <span class="inline-block bg-slate-100 border rounded px-1.5 py-0.5 mr-1 mb-1 text-[10px] font-bold text-slate-600">
              ${escapeHTML(f.fractionName)} (x${f.fractionMultiplier}) = ฿${f.fractionPrice}
            </span>
          `).join('') + (v.parentVariantId ? '' : `<button onclick="window.openCutPipeSetup('${p.id}','${v.id}')" class="inline-block bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mr-1 mb-1 text-[10px] font-bold text-amber-700">✂️ ${+v.cutLength > 0 ? 'ตัดท่อ ' + v.cutLength + ' ม./เส้น' : 'ตั้งค่าตัดท่อ'}</button>`);

          const imgThumb = p.imageUrl
            ? `<img src="${escapeHTML(p.imageUrl)}" class="w-8 h-8 object-cover rounded-lg border mx-auto">`
            : `<span class="text-2xl">${escapeHTML(p.image || '📦')}</span>`;

          const _u = escapeHTML(v.unit || 'ชิ้น'), _mixT = window.formatStockMixed ? window.formatStockMixed(v) : null;
          const _mix = _mixT ? `<span class="block text-[9px] text-slate-500">= ${escapeHTML(_mixT)}</span>` : '';
          const stockBadge = isOut
            ? `<span class="text-rose-600 bg-rose-50">${v.stock} ${_u}<span class="block text-[8px]">❌ หมดสต็อก</span></span>`
            : isBelowMin
              ? `<span class="text-amber-600 bg-amber-50">${v.stock} ${_u}${_mix}<span class="block text-[8px]">⚠️ ต่ำกว่าเกณฑ์</span></span>`
              : `<span class="text-emerald-600">${v.stock} ${_u}${_mix}</span>`;

          // Group badge — a product with more than one variant is effectively a "group" (see
          // the merge/split tools); this makes that visible at a glance in the table too.
          const groupBadge = (p.variants || []).length > 1
            ? `<span class="block text-[9px] text-indigo-500 font-bold mt-0.5">🔗 กลุ่ม ${p.variants.length} ขนาด</span>` : '';

          // เพิ่มขึ้นมา: ตารางเดิมไม่มีคอลัมน์กำไร/มูลค่าสต็อกเลย ทำให้ต้องเปิดดูทีละตัวเอง
          const cost = +v.cost || 0, price = +v.price || 0, stockQty = +v.stock || 0;
          const profit = roundAmt(price - cost);
          const marginPct = cost > 0 ? Math.round((profit / cost) * 100) : (price > 0 ? 100 : 0);
          const stockValue = roundAmt(cost * stockQty);
          const minStock = roundStock(v.minStock || 10);

          return `
            <tr class="hover:bg-indigo-50/40 border-b even:bg-slate-50/60 transition-colors">
              <td class="p-3 text-center"><input type="checkbox" class="stock-row-checkbox w-4 h-4 rounded accent-indigo-600" data-pid="${p.id}" ${selectedProductIds.has(p.id) ? 'checked' : ''} onchange="window.toggleProductSelection('${p.id}', this.checked)"></td>
              <td class="p-3 text-center font-bold text-slate-400">${idx + 1}</td>
              <td class="p-3 text-center">${imgThumb}</td>
              <td class="p-3 whitespace-nowrap">
                <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                  ${escapeHTML((p.cat && p.cat[0]) || 'งานทั่วไป')}
                </span>
              </td>
              <td class="p-3 font-bold text-slate-800 text-xs max-w-[220px] break-words">${escapeHTML(p.name)} <span class="text-slate-400 text-[10px]">(${escapeHTML(v.sizeName)})</span>${groupBadge}</td>
              <td class="p-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">${escapeHTML(p.code || p.id)}</td>
              <td class="p-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">${escapeHTML(v.barcode || '-')}</td>
              <td class="p-3 text-right tabular-nums whitespace-nowrap">฿${v.cost || 0}</td>
              <td class="p-3 text-right tabular-nums font-bold text-indigo-600 whitespace-nowrap">฿${v.price || 0}</td>
              <td class="p-3 text-right tabular-nums whitespace-nowrap"><span class="${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'} font-bold">฿${profit}</span><span class="block text-[9px] text-slate-400">${marginPct}%</span></td>
              <td class="p-3 text-center font-black text-xs rounded-lg whitespace-nowrap">${stockBadge}</td>
              <td class="p-3 text-center text-[11px] text-slate-500 whitespace-nowrap">${minStock}</td>
              <td class="p-3 text-right tabular-nums text-[11px] text-slate-600 whitespace-nowrap">฿${stockValue.toLocaleString('th-TH')}</td>
              <td class="p-3 max-w-[200px]">${fractionsHtml || '<span class="text-slate-300">-</span>'}</td>
              ${window.posLocCell(p.id, v.id)}
              <td class="p-3 text-center whitespace-nowrap">
                <button onclick="window.openProductModal('${p.id}')" class="text-indigo-600 font-bold mr-2 hover:underline btn-touch">แก้ไข</button>
                <button onclick="window.deleteProduct('${p.id}')" class="text-rose-500 font-bold hover:underline btn-touch">ลบ</button>
              </td>
            </tr>
          `;
        }).join('') + (flt.length > shown.length
          ? `<tr><td colspan="15" class="p-4 text-center"><button onclick="window.stockShowMore()" class="bg-indigo-50 text-indigo-700 font-black text-xs px-5 py-2.5 rounded-xl btn-touch">แสดงเพิ่ม (เหลืออีก ${flt.length - shown.length} จาก ${flt.length} รายการ)</button></td></tr>`
          : '');
      };

      window.renderStockTable = function() {
        const r = renderStockTableCore.apply(this, arguments);
        window.posHooks.emit('stock:render');
        return r;
      };

      // ==========================================
      // BULK SELECTION & ACTIONS (stock table)
      // ==========================================
      let selectedProductIds = new Set();

      window.toggleProductSelection = function(pid, checked) {
        if (checked) selectedProductIds.add(pid); else selectedProductIds.delete(pid);
        // A product can span multiple rows (one per variant) — keep every checkbox for the
        // same product in sync with a single click.
        document.querySelectorAll(`.stock-row-checkbox[data-pid="${pid}"]`).forEach(cb => cb.checked = checked);
        window.updateBulkToolbar();
      };

      window.toggleSelectAllStock = function(checked) {
        const seen = new Set();
        document.querySelectorAll('.stock-row-checkbox').forEach(cb => {
          cb.checked = checked;
          const pid = cb.dataset.pid;
          if (!seen.has(pid)) { seen.add(pid); if (checked) selectedProductIds.add(pid); else selectedProductIds.delete(pid); }
        });
        window.updateBulkToolbar();
      };

      window.clearStockSelection = function() {
        selectedProductIds.clear();
        document.querySelectorAll('.stock-row-checkbox, #stock-select-all').forEach(cb => cb.checked = false);
        window.updateBulkToolbar();
      };

      window.updateBulkToolbar = function() {
        const bar = document.getElementById('stock-bulk-toolbar');
        if (!bar) return;
        const count = selectedProductIds.size;
        bar.classList.toggle('hidden', count === 0);
        const countEl = document.getElementById('stock-bulk-count');
        if (countEl) countEl.textContent = count;
      };

      // รอให้ข้อมูลสินค้าส่งขึ้นเซิร์ฟเวอร์ก่อน แล้วส่งคิวปรับสต็อก และแจ้งว่ามีรายการที่ยังไม่ผ่านหรือไม่
      window.finishBulkSync = async function(label) {
        try { await window.syncProductsToSupabase?.(true); } catch (e) { console.warn('catalog sync after ' + label + ' failed', e); }
        try { await window.flushSyncQueue?.(); } catch (e) { console.warn('queue flush after ' + label + ' failed', e); }
        const failed = (db.syncQueue || []).filter(o => o.status === 'failed').length;
        const pending = (db.syncQueue || []).filter(o => o.status !== 'failed').length;
        if (failed) window.showAlert?.('ยังส่งไม่ครบ', `${label}: ${failed} รายการส่งไม่สำเร็จ (กดปุ่มซิงค์เพื่อลองใหม่ หรือดูสาเหตุในประวัติกิจกรรม)`, true);
        else if (pending) window.showToast?.(`${label}: รอส่งอีก ${pending} รายการ`);
        else window.showToast?.(`${label}: ส่งขึ้นเซิร์ฟเวอร์ครบแล้ว`);
      };

      window.openBulkCategoryModal = function() {
        if (!selectedProductIds.size) return;
        document.getElementById('bulk-cat-count').textContent = selectedProductIds.size;
        const topLevel = (db.categories || []).filter(c => !c.parentId);
        const childrenOf = pid => (db.categories || []).filter(c => c.parentId === pid);
        const rowHtml = (c, indent) => `
          <label class="flex items-center gap-2 py-1.5 text-xs font-bold text-slate-600 cursor-pointer" style="padding-left:${indent * 14}px">
            <input type="checkbox" value="${escapeHTML(c.name)}" class="bulk-cat-check w-4 h-4 rounded accent-indigo-600">
            ${indent ? '↳ ' : ''}${escapeHTML(c.icon || '📁')} ${escapeHTML(c.name)}
          </label>`;
        let html = '';
        topLevel.forEach(c => { html += rowHtml(c, 0); childrenOf(c.id).forEach(ch => html += rowHtml(ch, 1)); });
        document.getElementById('bulk-cat-checks').innerHTML = html || `<p class="text-slate-400 text-[11px] py-2">ยังไม่มีหมวดหมู่</p>`;
        document.getElementById('modal-bulk-category').classList.remove('hidden');
        document.getElementById('modal-bulk-category').classList.add('flex');
      };

      // "เพิ่มเข้าไป" = เติมหมวดที่ติ๊กเข้าไปเพิ่มจากของเดิม (ไม่ลบหมวดเดิมทิ้ง) เหมาะกับสินค้า
      // ที่อยู่ได้หลายหมวดพร้อมกัน — "แทนที่หมวดเดิมทั้งหมด" = ล้างหมวดเดิมแล้วตั้งใหม่ตามที่ติ๊ก
      window.confirmBulkCategory = function() {
        const chosen = Array.from(document.querySelectorAll('.bulk-cat-check:checked')).map(el => el.value);
        if (!chosen.length) return window.showAlert?.('ยังไม่ได้เลือก', 'กรุณาติ๊กอย่างน้อย 1 หมวดหมู่', true);
        const mode = document.querySelector('input[name="bulk-cat-mode"]:checked').value;
        selectedProductIds.forEach(pid => {
          const p = db.products[pid];
          if (!p) return;
          if (mode === 'REPLACE') { p.cat = chosen.slice(); }
          else { p.cat = p.cat || []; chosen.forEach(name => { if (!p.cat.includes(name)) p.cat.push(name); }); }
        });
        window.persist?.();
        window.closeModal('modal-bulk-category');
        window.clearStockSelection();
        window.renderStockTable();
        window.renderSaleHome?.();
        window.showToast?.(`แก้ไขหมวดหมู่สำเร็จ`);
        finishBulkSync('แก้ไขหมวดหมู่');
      };

      window.openBulkMinStockModal = function() {
        if (!selectedProductIds.size) return;
        document.getElementById('bulk-minstock-count').textContent = selectedProductIds.size;
        document.getElementById('bulk-minstock-value').value = '';
        document.getElementById('modal-bulk-minstock').classList.remove('hidden');
        document.getElementById('modal-bulk-minstock').classList.add('flex');
      };

      window.confirmBulkMinStock = function() {
        const val = parseFloat(document.getElementById('bulk-minstock-value').value);
        if (isNaN(val) || val < 0) return window.showAlert?.('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกจำนวนขั้นต่ำให้ถูกต้อง', true);
        selectedProductIds.forEach(pid => {
          const p = db.products[pid];
          if (!p) return;
          p.minStock = val;
          (p.variants || []).forEach(v => v.minStock = val);
        });
        window.persist?.();
        window.closeModal('modal-bulk-minstock');
        window.clearStockSelection();
        window.renderStockTable();
        window.showToast?.('เปลี่ยนจำนวนขั้นต่ำแจ้งเตือนสำเร็จ');
        window.syncProductsToSupabase?.(true);
      };

      // ปรับ "จำนวนที่มี" (สต็อกจริง) แบบเลือกได้หลายรายการพร้อมกัน — ใช้ได้เฉพาะสินค้าที่มี
      // ขนาด/สีเดียว เพราะสินค้ากลุ่มมีหลาย variant พร้อมกัน ไม่รู้ว่าผู้ใช้ตั้งใจปรับตัวไหน
      // (ข้ามให้อัตโนมัติพร้อมแจ้งเตือนจำนวนที่ข้าม แทนที่จะเดาเอาเองแล้วพลาด)
      window.openBulkStockModal = function() {
        if (!selectedProductIds.size) return;
        const prods = Array.from(selectedProductIds).map(pid => db.products[pid]).filter(p => p && (p.variants || []).length > 0);
        const variantCount = prods.reduce((n, p) => n + p.variants.length, 0);
        const groupCount = prods.filter(p => p.variants.length > 1).length;
        document.getElementById('bulk-stock-count').textContent = prods.length;
        const note = document.getElementById('bulk-stock-skip-note');
        if (groupCount > 0) {
          note.textContent = `ℹ️ มีสินค้ากลุ่ม ${groupCount} รายการ (หลายขนาด/สี) — ค่าที่กรอกจะใช้กับ "ทุกขนาด" ในกลุ่ม รวมทั้งหมด ${variantCount} ตัวเลือก`;
          note.classList.remove('hidden');
        } else note.classList.add('hidden');
        document.getElementById('bulk-stock-value').value = '';
        document.getElementById('modal-bulk-stock').classList.remove('hidden');
        document.getElementById('modal-bulk-stock').classList.add('flex');
      };

      window.confirmBulkStock = function() {
        const val = parseFloat(document.getElementById('bulk-stock-value').value);
        if (isNaN(val)) return window.showAlert?.('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกจำนวน', true);
        const mode = document.querySelector('input[name="bulk-stock-mode"]:checked').value;
        let changedVariants = 0, changedProducts = 0, seq = 0;
        const stamp = Date.now();
        selectedProductIds.forEach(pid => {
          const p = db.products[pid];
          if (!p || !(p.variants || []).length) return;
          // สินค้ากลุ่ม (หลายขนาด/สี) ปรับทุกตัวเลือกด้วยค่าเดียวกัน — เดิมถูกข้ามทำให้ยอดไม่เปลี่ยน
          p.variants.forEach(v => {
            const old = +v.stock || 0;
            v.stock = mode === 'SET' ? Math.max(0, roundStock(val)) : Math.max(0, roundStock(old + val));
            changedVariants++;
            seq++;
            if (v.id) window.enqueueSync({ type: 'adjust', payload: { variantId: v.id, value: v.stock,
              reason: 'ปรับจำนวนหลายรายการ', opRef: 'ADJ-' + stamp + '-' + window.getDeviceId() + '-' + seq } }, true);
          });
          changedProducts++;
        });
        if (!changedVariants) return window.showAlert?.('ไม่มีรายการที่ปรับได้', 'สินค้าที่เลือกไม่มีตัวเลือก (ขนาด/สี) ให้ปรับจำนวน', true);
        window.persist?.();
        window.closeModal('modal-bulk-stock');
        window.clearStockSelection();
        window.renderStockTable();
        window.renderSaleHome?.();
        window.showToast?.(`ปรับจำนวนคงเหลือ ${changedProducts} สินค้า (${changedVariants} ตัวเลือก)`);
        finishBulkSync('ปรับจำนวนคงเหลือ');
      };

      // ---- Merge selected products into one grouped product (shared with auto-suggestions) ----
      window.mergeProductsIntoGroup = function(ids, groupName) {
        if (ids.length < 2) return false;
        const target = db.products[ids[0]];
        if (!target) return false;
        const mergedAwayIds = [];
        ids.slice(1).forEach(srcId => {
          const src = db.products[srcId];
          if (!src) return;
          (src.variants || []).forEach(v => {
            target.variants.push({ ...v, id: 'v-' + Date.now() + Math.random().toString(36).slice(2, 6), sizeName: `${src.name} - ${v.sizeName}` });
          });
          // รวมหมวดหมู่ของทุกสินค้าที่ถูกยุบเข้าด้วยกันด้วย ไม่ใช่แค่ของสินค้าตัวหลัก
          (src.cat || []).forEach(cName => { if (!target.cat) target.cat = []; if (!target.cat.includes(cName)) target.cat.push(cName); });
          mergedAwayIds.push(srcId);
          delete db.products[srcId];
        });
        target.name = groupName;
        window.persist?.();
        (async () => {
          const c = sb();
          if (!c) return;
          for (const id of mergedAwayIds) {
            try { await c.from('products').delete().eq('id', toUUID ? toUUID(id) : id); } catch (e) { console.warn('cleanup delete failed for merged product', id, e); }
          }
        })();
        window.syncProductsToSupabase?.(true);
        return true;
      };

      window.openMergeGroupModal = function() {
        if (selectedProductIds.size < 2) return window.showAlert?.('เลือกไม่พอ', 'กรุณาเลือกสินค้าอย่างน้อย 2 รายการเพื่อรวมกลุ่ม', true);
        const ids = Array.from(selectedProductIds);
        document.getElementById('merge-group-preview').innerHTML = ids.map(id => {
          const p = db.products[id];
          return p ? `<div class="bg-slate-50 p-2 rounded-lg border">${escapeHTML(p.name)} <span class="text-slate-400">(${p.variants.length} ขนาด)</span></div>` : '';
        }).join('');
        document.getElementById('merge-group-name').value = db.products[ids[0]]?.name || '';
        document.getElementById('modal-merge-group').classList.remove('hidden');
        document.getElementById('modal-merge-group').classList.add('flex');
      };

      window.confirmMergeGroup = function() {
        const groupName = document.getElementById('merge-group-name').value.trim();
        if (!groupName) return window.showAlert?.('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อกลุ่ม', true);
        const ids = Array.from(selectedProductIds);
        const count = ids.length;
        if (!window.mergeProductsIntoGroup(ids, groupName)) return;
        window.closeModal('modal-merge-group');
        window.clearStockSelection();
        window.renderStockTable();
        window.renderSaleHome?.();
        window.populatePOPickers?.();
        window.showToast?.(`รวม ${count} รายการเป็นกลุ่ม "${groupName}" สำเร็จ`);
      };

      // ---- Auto-detect likely groups by name (same base name, differing size/color/letter
      // suffix) — always shown for review; nothing is merged automatically. ----
      // ปรับเพิ่มรอบนี้ (เพื่อให้ "จับกลุ่มได้จริง" ตามที่แจ้งว่ายังจับไม่ค่อยเจอ):
      //  - เดิมต้องมีช่องว่างคั่นก่อนตัวอักษรไซส์เท่านั้น ("เสื้อยืด XL" เจอ แต่ "เสื้อยืดXL" ไม่เจอ)
      //    ตอนนี้คั่นด้วยช่องว่าง/ขีด/วงเล็บ/ไม่มีอะไรคั่นเลยก็เจอหมด
      //  - เพิ่มการตัดวงเล็บท้ายชื่อทั้งก้อนออก เช่น "เสื้อยืด (สีแดง)" -> "เสื้อยืด"
      //  - เพิ่ม fallback แบบ "คำนำหน้าเหมือนกันยาวพอสมควร" (longest common prefix) สำหรับชื่อที่
      //    ไม่ตรง pattern สี/ไซส์/หน่วยเป๊ะเลย แต่ขึ้นต้นเหมือนกันมากจนน่าจะเป็นสินค้าเดียวกัน — วิธีนี้
      //    มั่นใจน้อยกว่า จึงติดป้ายเตือนให้ตรวจสอบก่อนกดรวมเป็นพิเศษ (ระบบไม่รวมให้อัตโนมัติอยู่แล้ว)
      function getProductBaseName(name) {
        let base = (name || '').trim();
        const colors = ['สีแดง', 'สีน้ำเงิน', 'สีเขียว', 'สีเหลือง', 'สีดำ', 'สีขาว', 'สีส้ม', 'สีชมพู', 'สีม่วง', 'สีเทา', 'สีน้ำตาล', 'สีทอง', 'สีเงิน', 'สีฟ้า', 'สีครีม'];
        const thaiSizes = ['เล็กพิเศษ', 'ใหญ่พิเศษ', 'เล็ก', 'กลาง', 'ใหญ่'];
        const unitNumberRe = /[\s\-\/]*\(?\d+(\.\d+)?\s*(\/\s*\d+(\.\d+)?)?\s*(x\s*\d+(\.\d+)?)?\s*(นิ้ว|หุน|มม\.?|ซม\.?|มล\.?|ลิตร|กก\.?|kg|g|mm|cm|ml|l)\)?\s*$/i;
        // [\s\-\/,]* แทน \s+ เดิม: คั่นด้วยช่องว่าง/ขีด/สแลช/จุลภาค หรือ "ไม่คั่นเลย" ก็จับได้
        const letterSizeRe = /[\s\-\/,]*\(?(XXXL|XXL|XL|L|M|S|XS)\)?\s*$/i;
        const trailingParenRe = /\s*\([^()]{1,20}\)\s*$/; // วงเล็บท้ายชื่อ เช่น "(สีแดง)" "(เบอร์ 8)"

        let changed = true, guard = 0;
        while (changed && guard < 6) {
          changed = false; guard++;
          const colorHit = colors.find(c => base.endsWith(c) || base.endsWith(`(${c})`));
          if (colorHit) { base = base.replace(new RegExp(`\\(?${colorHit}\\)?\\s*$`), '').trim(); changed = true; continue; }
          const thaiSizeHit = thaiSizes.find(c => base.endsWith(c) || base.endsWith(`(${c})`));
          if (thaiSizeHit) { base = base.replace(new RegExp(`\\(?${thaiSizeHit}\\)?\\s*$`), '').trim(); changed = true; continue; }
          let stripped = base.replace(unitNumberRe, '').trim();
          if (stripped && stripped !== base) { base = stripped; changed = true; continue; }
          stripped = base.replace(letterSizeRe, '').trim();
          if (stripped && stripped !== base) { base = stripped; changed = true; continue; }
          stripped = base.replace(trailingParenRe, '').trim();
          if (stripped && stripped !== base) { base = stripped; changed = true; continue; }
        }
        return base;
      }

      // Fallback แบบ "คำนำหน้าเหมือนกัน" สำหรับชื่อที่ไม่ตรง pattern สี/ไซส์ที่รู้จักเลย —
      // ต้องยาวอย่างน้อย 4 ตัวอักษร และอย่างน้อย 60% ของชื่อที่สั้นกว่า ถึงจะถือว่าน่าจะเป็นกลุ่มเดียวกัน


      // ==========================================
      // GOODS RECEIPT & MASTER SETTINGS
      // ==========================================
      window.onPOProductChange = function() {
        const pid = document.getElementById('po-product-picker-value').value;
        const p = db.products[pid];
        const _pv = p && ((p.variants || []).find(x => x.id === window._poPickedVariantId) || (p.variants || [])[0]);
        if (_pv) {
          document.getElementById('po-item-cost').value = _pv.cost;
          document.getElementById('po-item-qty').value = 1;
        }
      };

      window.filterPOProductPicker = function() {
        const qEl = document.getElementById('po-product-search');
        const resultsEl = document.getElementById('po-product-picker-results');
        const q = (qEl.value || '').trim().toLowerCase();
        const all = Object.values(db.products || {});
        let matches = q
          ? all.filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q) || (p.variants || []).some(v => (v.barcode || '').toLowerCase().includes(q)))
          : all;
        // Relevance: exact/starts-with name matches surface above mid-string matches.
        if (q) {
          matches.sort((a, b) => {
            const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
            const score = s => s.startsWith(q) ? 0 : 1;
            return score(an) - score(bn) || naturalCompare(a.name, b.name);
          });
        }
        // หนึ่งแถวต่อหนึ่งขนาด/ตัวเลือก — เดิมรับเข้าได้เฉพาะขนาดแรก ทำให้สินค้ากลุ่มรับของไม่ครบ
        const rows = [];
        matches.forEach(p => (p.variants || []).forEach(v => rows.push({ p, v })));
        const shown = rows.slice(0, 60);
        resultsEl.innerHTML = shown.length ? shown.map(({ p, v }) => {
          const img = p.imageUrl
            ? `<img src="${escapeHTML(p.imageUrl)}" class="w-9 h-9 object-cover rounded-lg border flex-shrink-0">`
            : `<span class="w-9 h-9 flex items-center justify-center text-xl flex-shrink-0">${escapeHTML(p.image || '📦')}</span>`;
          const stockLabel = (+v.stock || 0) <= 0 ? '<span class="text-rose-500">หมด</span>' : `คงเหลือ ${v.stock}`;
          return `
            <button type="button" onclick="window.selectPOProduct('${p.id}','${v.id}')" class="w-full flex items-center gap-2 p-2 hover:bg-indigo-50 text-left border-b last:border-0 btn-touch">
              ${img}
              <div class="flex-1 min-w-0">
                <div class="font-bold text-xs text-slate-800 truncate">${escapeHTML(p.name)} <span class="text-slate-400 font-normal">(${escapeHTML(v.sizeName)})</span></div>
                <div class="text-[10px] text-slate-400">SKU: ${escapeHTML(p.code || '-')} • ${stockLabel}</div>
              </div>
            </button>`;
        }).join('') : `<div class="p-4 text-center text-slate-400 text-xs font-bold">ไม่พบสินค้าที่ค้นหา</div>`;
        resultsEl.classList.remove('hidden');
      };

      window.selectPOProduct = function(pid, vid) {
        const p = db.products[pid];
        if (!p) return;
        const _v = (p.variants || []).find(x => x.id === vid) || (p.variants || [])[0];
        window._poPickedVariantId = _v ? _v.id : null;
        document.getElementById('po-product-picker-value').value = pid;
        document.getElementById('po-product-search').value = p.name + (_v ? ` (${_v.sizeName})` : '');
        document.getElementById('po-product-picker-results').classList.add('hidden');
        window.onPOProductChange();
        window._poRefreshUnits?.();
      };

      document.addEventListener('click', (e) => {
        const input = document.getElementById('po-product-search');
        const results = document.getElementById('po-product-picker-results');
        if (input && results && !input.contains(e.target) && !results.contains(e.target)) {
          results.classList.add('hidden');
        }
      });

      window.renderPOCartList = function() {
        const container = document.getElementById('po-cart-list');
        // Editable worksheet: qty/cost are live inputs, not static text — adjusting either
        // recalculates that row's total and the grand total in place (window.updatePOItemField)
        // without re-rendering the whole list, so the input being typed into never loses focus.
        container.innerHTML = poTempItems.length ? poTempItems.map((item, idx) => `
          <div class="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border text-xs">
            <div class="flex-1 min-w-0">
              <b class="text-slate-800 block truncate">${escapeHTML(item.productName)}</b>
              <div class="flex items-center gap-1.5 mt-1">
                <input type="number" min="0" step="any" value="${item.qty}" oninput="window.updatePOItemField(${idx},'qty',this.value)" class="w-16 border rounded-lg text-center py-1 font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                <span class="text-slate-400">ชิ้น ×</span>
                <input type="number" min="0" step="any" value="${item.cost}" oninput="window.updatePOItemField(${idx},'cost',this.value)" class="w-20 border rounded-lg text-center py-1 font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                <span class="text-slate-400">บาท</span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <b id="po-item-total-${idx}" class="text-indigo-600">฿${roundAmt(item.total).toFixed(2)}</b>
              <button onclick="poTempItems.splice(${idx},1); window.renderPOCartList();" title="ลบรายการนี้" class="text-rose-500 font-bold hover:bg-rose-50 rounded-lg w-6 h-6 flex items-center justify-center btn-touch">✕</button>
            </div>
          </div>
        `).join('') : `<p class="text-center text-slate-400 font-bold py-6 text-xs">ยังไม่มีรายการ — ค้นหาสินค้าด้านบนเพื่อเพิ่ม</p>`;
        window.updatePOGrandTotal();
      };

      window.updatePOItemField = function(idx, field, value) {
        const item = poTempItems[idx];
        if (!item) return;
        item[field] = Math.max(0, parseFloat(value) || 0);
        item.total = roundAmt(item.qty * item.cost);
        const totalEl = document.getElementById(`po-item-total-${idx}`);
        if (totalEl) totalEl.innerText = `฿${item.total.toFixed(2)}`;
        window.updatePOGrandTotal();
      };

      window.updatePOGrandTotal = function() {
        const grandTotal = poTempItems.reduce((a, x) => roundAmt(a + x.total), 0);
        document.getElementById('po-grand-total').innerText = formatMoney(grandTotal);
      };

      window.clearPOList = function() {
        if (poTempItems.length && !confirm('ล้างรายการที่เพิ่มไว้ทั้งหมด?')) return;
        poTempItems.length = 0;
        window.renderPOCartList();
      };

      // ---- Delivery note attachments (ใบส่งของ) — kept as accounting evidence ----
      // Supports multiple files per receipt (a delivery note is often more than one page/photo)
      // and both images (compressed client-side) and PDFs (kept as-is, shown with a document
      // icon since a thumbnail can't be rendered without an extra PDF-rendering library).
      let poDeliveryNoteFiles = []; // [{ dataUrl, mime, name }]

      window.handleDeliveryNoteSelect = function(e) {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
          const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
          const reader = new FileReader();
          reader.onload = function(evt) {
            if (isPdf) {
              poDeliveryNoteFiles.push({ dataUrl: evt.target.result, mime: 'application/pdf', name: file.name });
              window.renderDeliveryNotePreview();
              return;
            }
            const img = new Image();
            img.onload = function() {
              // Downscale/compress client-side — a phone camera photo can be several MB, which
              // would be slow to upload and wasteful to keep as an offline localStorage fallback.
              const maxDim = 1280;
              let { width, height } = img;
              if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
              }
              const canvas = document.createElement('canvas');
              canvas.width = width; canvas.height = height;
              canvas.getContext('2d').drawImage(img, 0, 0, width, height);
              poDeliveryNoteFiles.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.72), mime: 'image/jpeg', name: file.name });
              window.renderDeliveryNotePreview();
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        });
        e.target.value = ''; // allow re-selecting the same file again if removed and re-added
      };

      window.renderDeliveryNotePreview = function() {
        const wrap = document.getElementById('po-delivery-note-preview');
        if (!wrap) return;
        if (!poDeliveryNoteFiles.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
        wrap.classList.remove('hidden');
        wrap.innerHTML = poDeliveryNoteFiles.map((f, idx) => `
          <div class="relative">
            ${f.mime === 'application/pdf'
              ? `<div class="w-24 h-24 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-indigo-200 bg-indigo-50 shadow-sm p-1">
                   <span class="text-3xl">📄</span>
                   <span class="text-[9px] font-bold text-indigo-700 text-center line-clamp-2 px-1">${escapeHTML(f.name)}</span>
                 </div>`
              : `<img src="${f.dataUrl}" class="w-24 h-24 object-cover rounded-xl border-2 border-indigo-200 shadow-sm">`
            }
            <button onclick="window.removeDeliveryNote(${idx})" class="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 hover:bg-rose-600 text-white rounded-full text-xs font-bold flex items-center justify-center shadow btn-touch">✕</button>
          </div>
        `).join('');
      };

      window.removeDeliveryNote = function(idx) {
        poDeliveryNoteFiles.splice(idx, 1);
        window.renderDeliveryNotePreview();
      };

      window.clearDeliveryNote = function() {
        poDeliveryNoteFiles = [];
        const inputEl = document.getElementById('po-delivery-note-input');
        if (inputEl) inputEl.value = '';
        window.renderDeliveryNotePreview();
      };

      // ---------- รับเข้าเป็นหน่วยใหญ่ (ม้วน/เส้น/แพ็ก) แล้วแปลงเป็นหน่วยฐานให้อัตโนมัติ ----------
      // หน่วยหลักของสินค้า = หน่วยเล็กที่สุดที่ตัดสต็อก (PATCH 010) เช่น เมตร
      // รับ "3 ม้วน ม้วนละ 1,000" (ม้วน = 100 เมตร) → สต็อก +300 เมตร ทุนเมตรละ 10
      window.stockUnitsFor = function(v) {
        const base = (v && v.unit) || 'ชิ้น';
        const packs = ((v && v.fractions) || []).filter(f => +f.fractionMultiplier > 1)
          .map(f => ({ name: f.fractionName, ratio: +f.fractionMultiplier }));
        return [{ name: base, ratio: 1 }].concat(packs);
      };
      window._poRefreshUnits = function() {
        const qtyEl = document.getElementById('po-item-qty'); if (!qtyEl) return;
        let sel = document.getElementById('po-item-unit');
        if (!sel) {
          sel = document.createElement('select'); sel.id = 'po-item-unit';
          sel.className = 'col-span-full bg-slate-50 border p-2.5 rounded-xl font-bold text-xs outline-none';
          qtyEl.parentNode.insertBefore(sel, qtyEl);
        }
        const p = db.products[document.getElementById('po-product-picker-value').value];
        const v = p && ((p.variants || []).find(x => x.id === window._poPickedVariantId) || (p.variants || [])[0]);
        const units = window.stockUnitsFor(v);
        sel.innerHTML = units.map(u => `<option value="${u.ratio}">${escapeHTML(u.name)}${u.ratio > 1 ? ` (= ${u.ratio} ${escapeHTML(units[0].name)})` : ' (หน่วยหลัก)'}</option>`).join('');
        sel.style.display = units.length > 1 ? '' : 'none';
      };
      // สต็อกแบบอ่านง่าย: 270 เมตร → "2 ม้วน 70 เมตร" (แสดงเมื่อมีหน่วยใหญ่และสต็อกถึงหนึ่งหน่วยใหญ่)
      window.formatStockMixed = function(v) {
        const units = window.stockUnitsFor(v); if (units.length < 2) return null;
        const big = units.slice(1).sort((a, b) => b.ratio - a.ratio)[0];
        const stock = +v.stock || 0; if (stock < big.ratio) return null;
        const n = Math.floor(stock / big.ratio + 1e-9), rem = roundStock(stock - n * big.ratio);
        return `${n} ${big.name}` + (rem > 0 ? ` ${rem} ${units[0].name}` : '');
      };

      window.addItemToPOList = function() {
        const pid = document.getElementById('po-product-picker-value').value;
        const qty = parseFloat(document.getElementById('po-item-qty').value) || 0;
        const cost = parseFloat(document.getElementById('po-item-cost').value) || 0;
        if (!pid || qty <= 0) return window.showAlert ? window.showAlert("ข้อมูลไม่ครบ", "กรุณาค้นหาและเลือกสินค้า พร้อมระบุจำนวนให้ถูกต้อง", true) : alert("กรุณาเลือกสินค้าและระบุจำนวนให้ถูกต้อง");

        const p = db.products[pid];
        const _pv = p && ((p.variants || []).find(x => x.id === window._poPickedVariantId) || (p.variants || [])[0]);
        if (!p || !_pv) return window.showAlert?.('สินค้าไม่มีขนาด/ตัวเลือก', 'สินค้านี้ยังไม่มีขนาดหรือตัวเลือกให้รับเข้าสต็อก กรุณาเพิ่มในหน้าแก้ไขสินค้าก่อน', true);
        const _selU = document.getElementById('po-item-unit');
        const _factor = (_selU && _selU.style.display !== 'none' && +_selU.value > 0) ? +_selU.value : 1;
        const _uName = _factor > 1 ? ((_selU.options[_selU.selectedIndex].text || '').replace(/\s*\(.*\)$/, '')) : '';
        // แปลงเป็นหน่วยฐาน: จำนวน × ratio, ทุนต่อหน่วยฐาน = ทุนต่อหน่วยใหญ่ ÷ ratio (ยอดรวมบิลยังเท่าเดิม)
        poTempItems.push({ productId: pid, variantId: _pv.id, productName: p.name + ((p.variants || []).length > 1 ? ` (${_pv.sizeName})` : '') + (_factor > 1 ? ` [รับ ${qty} ${_uName}]` : ''), qty: roundStock(qty * _factor), cost: _factor > 1 ? Number((cost / _factor).toFixed(4)) : cost, total: roundAmt(qty * cost) });
        window._poPickedVariantId = null;
        window.renderPOCartList();

        // Reset the picker so the next item can be searched for immediately.
        document.getElementById('po-product-search').value = '';
        document.getElementById('po-product-picker-value').value = '';
        document.getElementById('po-item-qty').value = '';
        document.getElementById('po-item-cost').value = '';
      };

      // Populates the supplier dropdown and clears/resets the product search picker so it's
      // ready to search fresh (e.g. after the product catalog changes elsewhere).
      window.populatePOPickers = function() {
        const supSel = document.getElementById('po-supplier-select');
        if (supSel) {
          const cur = supSel.value;
          // Use the dictionary key (not s.id) as the option value — keeps the AP/PO record's
          // supplierId consistent with how db.suppliers is actually keyed and looked up elsewhere,
          // even for the seed supplier whose internal .id field doesn't match its key.
          supSel.innerHTML = `<option value="">-- เลือกซัพพลายเออร์ --</option>` +
            Object.entries(db.suppliers || {}).map(([key, s]) =>
              `<option value="${key}">${escapeHTML(s.name)} (เครดิต ${s.terms} วัน)</option>`
            ).join('');
          if (cur && db.suppliers[cur]) supSel.value = cur;
        }

        const resultsEl = document.getElementById('po-product-picker-results');
        if (resultsEl) resultsEl.classList.add('hidden');
      };
      // Alias: showView() calls this name specifically when opening the po-receive view.
      window.renderPOPicker = window.populatePOPickers;

      // confirmReceivePO is defined once in the later atomic goods-receipt module.

      window.openMasterSettingsModal = function(tabKey) {
        document.getElementById('set-store-name').value = db.storeName;
        document.getElementById('set-store-address').value = db.storeAddress;
        document.getElementById('set-promptpay').value = db.promptPayId;
        document.getElementById('set-tax-id').value = db.taxId || '';
        { const _st = db.settings || {};
          const _vr = document.getElementById('set-vat-registered'); if (_vr) _vr.checked = !!_st.vatRegistered;
          const _vt = document.getElementById('set-vat-rate'); if (_vt) _vt.value = (_st.vatRate != null ? _st.vatRate : 7);
          const _vb = document.getElementById('set-vat-branch'); if (_vb) _vb.value = _st.vatBranch || 'สำนักงานใหญ่'; }
        const _pn = document.getElementById('set-prevent-negative'); if (_pn) _pn.checked = !!(db.settings && db.settings.preventNegativeStock);
        document.getElementById('set-supabase-url').value = window.getConfiguredSupabaseUrl();
        document.getElementById('set-supabase-key').value = window.getConfiguredSupabaseAnonKey();

        window.renderSettingsSuppliers();
        window.renderSettingsCustomers();
        window.renderUserManagerList?.();
        window.refreshAuthStatus?.();
        window.switchSettingsTab(tabKey || 'STORE');
        document.getElementById('modal-master-settings').classList.remove('hidden');
        document.getElementById('modal-master-settings').classList.add('flex');
      };

      // เดิม "จัดการซัพพลายเออร์" เปิดเป็นหน้าต่างลอยแยกต่างหาก (modal-supplier-manager)
      // ทำให้ไม่เหมือนเมนูอื่น (ลูกค้า/พนักงาน) ที่จัดการอยู่ในหน้าต่างตั้งค่าเดิมทั้งหมด —
      // ตอนนี้เปิดหน้าต่างตั้งค่าเดิมแล้วสลับไปแท็บซัพพลายเออร์แทน ให้พฤติกรรมตรงกันทุกเมนู
      window.openSupplierManagerModal = function() { window.openMasterSettingsModal('SUPPLIERS'); };

      window.switchSettingsTab = function(tabKey) {
        document.querySelectorAll('.settings-tab-btn').forEach(btn => btn.classList.remove('active'));
        const tabBtn = document.getElementById(`set-tab-${tabKey}`);
        if (tabBtn) tabBtn.classList.add('active');

        document.querySelectorAll('#modal-master-settings [id^="set-panel-"]').forEach(panel => panel.classList.add('hidden'));
        const panelEl = document.getElementById(`set-panel-${tabKey}`);
        if (panelEl) panelEl.classList.remove('hidden');
      };

      window.saveStoreSettings = function() {
        db.storeName = document.getElementById('set-store-name').value.trim();
        db.storeAddress = document.getElementById('set-store-address').value.trim();
        db.promptPayId = document.getElementById('set-promptpay').value.trim();
        db.taxId = document.getElementById('set-tax-id').value.trim();
        db.settings = db.settings || {};
        db.settings.preventNegativeStock = !!document.getElementById('set-prevent-negative')?.checked;
        { const reg = !!document.getElementById('set-vat-registered')?.checked;
          const rate = parseFloat(document.getElementById('set-vat-rate')?.value);
          if (reg && !/^\d{13}$/.test(db.taxId || '')) return window.showAlert?.('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง', 'ถ้าจดทะเบียน VAT ต้องกรอกเลขประจำตัวผู้เสียภาษี 13 หลัก', true);
          if (reg && (isNaN(rate) || rate <= 0 || rate > 30)) return window.showAlert?.('อัตรา VAT ไม่ถูกต้อง', 'กรุณากรอกอัตรา VAT เช่น 7', true);
          db.settings.vatRegistered = reg; db.settings.vatRate = isNaN(rate) ? 7 : rate;
          db.settings.vatBranch = (document.getElementById('set-vat-branch')?.value || '').trim() || 'สำนักงานใหญ่'; }
        document.getElementById('store-name-title').innerText = db.storeName;
        window.persist?.();
        window.showToast?.("บันทึกข้อมูลร้านค้าเรียบร้อยแล้ว");
      };

      // ==========================================
      // หมวดหมู่สินค้าอ้างอิงจากเว็บ YOJIONLINE.com (โครงสร้าง "หมวดหมู่สินค้า" จริงบนเว็บ
      // ณ วันที่บันทึกหน้าเว็บไว้ — 13 หมวดหลัก พร้อมหมวดย่อย) ใช้เป็นชุดหมวดหมู่ตั้งต้นของระบบ
      // แทนที่จะให้ db.categories ว่างเปล่าแล้วต้องมาสร้างเองทีละหมวด — ให้ผังหมวดหมู่ในโปรแกรม
      // "หน้าตา" ตรงกับผังหมวดหมู่บนเว็บตั้งแต่แรก (ชุดเดียวกับที่ 418.sql seed ไว้ฝั่ง Supabase)
      // ==========================================
      const YOJI_CATEGORY_TREE = [
        { name: 'ท่อพีวีซี', icon: '🔵', color: '#0ea5e9', children: [
          { name: 'ท่อพีวีซีสีฟ้า' }, { name: 'ท่อพีวีซีสีเหลือง' }, { name: 'ท่อพีวีซีสีขาว' }
        ]},
        { name: 'อุปกรณ์ท่อพีวีซี', icon: '🔧', color: '#0ea5e9', children: [
          { name: 'อุปกรณ์ท่อสีฟ้า' }, { name: 'อุปกรณ์ท่อสีเหลือง' }, { name: 'อุปกรณ์ท่อสีขาว' }
        ]},
        { name: 'อุปกรณ์ประปา ห้องน้ำ', icon: '🚿', color: '#06b6d4', children: [
          { name: 'ก๊อกน้ำ' }, { name: 'กาวทาท่อ เทป' }, { name: 'บอลวาวล์ ประตูน้ำ' },
          { name: 'ฝักบัว สายฉีดชำระ' }, { name: 'อุปกรณ์ประปาอื่นๆ' }
        ]},
        { name: 'อุปกรณ์ก่อสร้าง', icon: '🧱', color: '#a16207', children: [
          { name: 'อุปกรณ์ทำความสะอาด' }, { name: 'วัสดุก่อสร้าง' }
        ]},
        { name: 'น๊อต สกรู แหวน', icon: '🔩', color: '#64748b', children: [] },
        { name: 'สี อุปกรณ์ทาสี', icon: '🎨', color: '#ec4899', children: [
          { name: 'สีน้ำ สีทาบ้าน สีทาอาคาร' }, { name: 'สีสเปรย์ สีพ่นพิเศษ' }, { name: 'สีน้ำมัน สีทาเหล็ก' },
          { name: 'สีทาไม้ น้ำมันทาไม้' }, { name: 'เคมีภัณฑ์ ซ่อมแซม' }, { name: 'อุปกรณ์ทาสี' }, { name: 'ทินเนอร์ น้ำมันสน' }
        ]},
        { name: 'เครื่องมือช่าง ฮาร์ดแวร์', icon: '🛠️', color: '#4f46e5', children: [
          { name: 'เทปกาว กาว ซิลิโคน' }, { name: 'เครื่องมือช่าง' }, { name: 'ใบตัด ใบเจียร์ กระดาษทราย' },
          { name: 'เครื่องมือเชื่อม' }, { name: 'กุญแจ ลูกบิด' }, { name: 'เครื่องเขียน' }, { name: 'เครื่องมือเจาะ ดอกสว่าน' }
        ]},
        { name: 'เครื่องมือเกษตรและสวน', icon: '🌱', color: '#16a34a', children: [] },
        { name: 'เครื่องมือไฟฟ้า', icon: '⚡', color: '#eab308', children: [] },
        { name: 'สายไฟ', icon: '🔌', color: '#f59e0b', children: [] },
        { name: 'อุปกรณ์ไฟฟ้า', icon: '💡', color: '#f59e0b', children: [
          { name: 'หลอดไฟ' }, { name: 'อุปกรณ์ไฟฟ้าอื่นๆ' }
        ]},
        { name: 'ท่ออุปกรณ์เหล็กร้อยสายไฟ', icon: '🪛', color: '#78716c', children: [
          { name: 'ท่อเหล็กร้อยสายไฟ' }, { name: 'อุปกรณ์ท่อเหล็กร้อยสายไฟ' }
        ]},
        { name: 'ชั้นวางสินค้า', icon: '🗄️', color: '#78716c', children: [] },
        // ไม่มีอยู่ในผังหมวดหมู่จริงของเว็บ — เก็บสินค้าที่จับคู่หมวดหมู่จากเว็บไม่ได้ไว้ที่นี่ก่อน
        // (มาจากคอลัมน์ "อื่นๆ" ของไฟล์นำเข้า) ต้องเข้าไปแยกหมวดที่ถูกต้องเองทีหลัง
        { name: 'อื่นๆ', icon: '📦', color: '#94a3b8', children: [] }
      ];

      // แม็ปชื่อหมวดหมู่แบบย่อในไฟล์ Excel (คอลัมน์ "หมวดหมู่") ไปยังชื่อหมวดหมู่จริงบนเว็บ
      // YOJIONLINE.com ด้านบน — บางหมวดแม็ปตรงเข้าหมวดหลัก บางหมวดแม็ปลงหมวดย่อยที่ใกล้เคียงที่สุด
      const EXCEL_TO_YOJI_CATEGORY = {
        'อื่นๆ': 'อื่นๆ',
        'อุปกรณ์ไฟฟ้า': 'อุปกรณ์ไฟฟ้าอื่นๆ',
        'เครื่องมือช่าง': 'เครื่องมือช่าง',
        'อุปกรณ์ประปา': 'อุปกรณ์ประปาอื่นๆ',
        'สีและอุปกรณ์ทาสี': 'สี อุปกรณ์ทาสี',
        'อุปกรณ์ท่อพีวีซี ข้อต่อข้องอ PVC': 'อุปกรณ์ท่อพีวีซี',
        'หลอดไฟ': 'หลอดไฟ',
        'ท่อพีวีซี': 'ท่อพีวีซี',
        'ใบตัด ใบเจียร์ กระดาษทราย': 'ใบตัด ใบเจียร์ กระดาษทราย',
        'เทปและกาว': 'เทปกาว กาว ซิลิโคน',
        'อุปกรณ์ก่อสร้าง': 'อุปกรณ์ก่อสร้าง',
        'กุญแจและอุปกรณ์ล็อค': 'กุญแจ ลูกบิด',
        'เครื่องเขียน': 'เครื่องเขียน',
        'อุปกรณ์ยึดจับ/สกรู-น็อต': 'น๊อต สกรู แหวน',
        'สายไฟ': 'สายไฟ',
        'เครื่องมือเกษตรและสวน': 'เครื่องมือเกษตรและสวน',
        'สารเคมีและน้ำยา': 'เคมีภัณฑ์ ซ่อมแซม',
        'อุปกรณ์ทำความสะอาด': 'อุปกรณ์ทำความสะอาด',
        'อุปกรณ์นิรภัย': 'อื่นๆ'
      };

      // สร้างหมวดหมู่ตามผัง YOJI_CATEGORY_TREE ลงใน db.categories — ทำงานแบบ idempotent
      // (เช็กชื่อซ้ำก่อนเสมอ ไม่สร้างหมวดซ้ำถ้ามีอยู่แล้ว เช่น ผู้ใช้เคยสร้าง/แก้เองมาก่อน)
      window.seedYojiCategories = function() {
        db.categories = db.categories || [];
        const byName = name => db.categories.find(c => c.name === name);
        YOJI_CATEGORY_TREE.forEach(top => {
          let parent = byName(top.name);
          if (!parent) {
            parent = { id: 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: top.name, icon: top.icon, color: top.color, parentId: null };
            db.categories.push(parent);
          }
          (top.children || []).forEach(child => {
            if (!byName(child.name)) {
              db.categories.push({ id: 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: child.name, icon: top.icon, color: top.color, parentId: parent.id });
            }
          });
        });
        return new Set(db.categories.map(c => c.name));
      };

      // ---------- นำเข้ารายการสินค้า: ใช้โครงสร้างเดียวกับไฟล์ส่งออก นำเข้าเฉพาะแถวที่ผ่านการตรวจ ----------
      function buildImportPlan(rows){
        const num = v => { const s = String(v == null ? '' : v).replace(/,/g, '').trim(); if (s === '') return NaN; const n = parseFloat(s); return isFinite(n) ? n : NaN; };
        const txt = v => String(v == null ? '' : v).normalize('NFC').trim();
        const pick = (r, ...ks) => { for (const k of ks) { if (r[k] !== undefined && r[k] !== '') return r[k]; } return ''; };
        const existingSku = new Map(), existingBar = new Map();
        Object.values(db.products || {}).forEach(p => { if (p.isDeleted) return; (p.variants || []).forEach(v => {
          if (v.sku) existingSku.set(String(v.sku).toLowerCase(), p.name);
          if (v.barcode) existingBar.set(String(v.barcode), p.name); }); });
        const fileSku = new Map(), fileBar = new Map(), rejected = [], mains = [], subs = [];
        const reject = (line, reason, name) => rejected.push({ line, reason, name: name || '' });
        rows.forEach((r, idx) => {
          const line = idx + 2;
          const row = {
            line, type: txt(pick(r, 'ประเภทแถว')) || 'หลัก', name: txt(pick(r, 'ชื่อสินค้า', 'ชื่อ', 'Name')),
            sku: txt(pick(r, 'รหัสสินค้า (SKU)', 'รหัสสินค้า', 'SKU', 'รหัส', 'Code')), bar: txt(pick(r, 'รหัสบาร์โค้ด', 'บาร์โค้ด', 'Barcode')),
            size: txt(pick(r, 'ขนาด/รุ่น', 'ขนาด', 'ไซส์', 'Size')) || 'ปกติ', unit: txt(pick(r, 'หน่วย')),
            cost: num(pick(r, 'ราคาทุน', 'ทุน', 'Cost')), price: num(pick(r, 'ราคาขาย', 'ราคา', 'Price')),
            group: txt(pick(r, 'กลุ่มสินค้า', 'กลุ่ม')), main: txt(pick(r, 'หมวดหมู่หลัก', 'หมวดหมู่', 'Category')), sub: txt(pick(r, 'หมวดหมู่ย่อย')),
            parent: txt(pick(r, 'รหัสสินค้าหลัก')), ratio: num(pick(r, 'จำนวนหน่วยฐานต่อ 1 หน่วยนี้', 'จำนวนหน่วยย่อยต่อ 1 หน่วยหลัก', 'ตัวคูณ')),
            stock: num(pick(r, 'จำนวนคงเหลือ', 'จำนวน', 'ยอดยกมา', 'Stock')), min: num(pick(r, 'ขั้นต่ำ', 'MinStock')),
            status: txt(pick(r, 'สถานะ')) || 'ใช้', image: txt(pick(r, 'รูปสินค้า', 'ไฟล์รูปภาพ')), img: r.__img || null
          };
          if (!row.name && !row.sku && !row.price && !row.unit) return;          // แถวว่าง
          if (row.type !== 'หลัก' && row.type !== 'หน่วยย่อย') return reject(line, 'ประเภทแถวต้องเป็น "หลัก" หรือ "หน่วยย่อย"', row.name);
          if (!row.sku) return reject(line, 'ไม่มีรหัสสินค้า (SKU)', row.name);
          if (!['ใช้', 'ไม่ใช้'].includes(row.status)) return reject(line, 'สถานะต้องเป็น "ใช้" หรือ "ไม่ใช้"', row.name);
          const skuKey = row.sku.toLowerCase();
          if (fileSku.has(skuKey)) return reject(line, `SKU ซ้ำกับแถว ${fileSku.get(skuKey)}`, row.name);
          fileSku.set(skuKey, line);
          if (row.type === 'หลัก') {
            if (!row.name) return reject(line, 'ไม่มีชื่อสินค้า', row.name);
            if (!row.main) return reject(line, 'ไม่มีหมวดหมู่หลัก', row.name);
            if (!(row.price > 0)) return reject(line, 'ราคาขายต้องมากกว่า 0', row.name);
            if (row.cost < 0) return reject(line, 'ราคาทุนติดลบ', row.name);
            if (row.stock < 0) return reject(line, 'จำนวนคงเหลือติดลบ', row.name);
            if (existingSku.has(skuKey) && existingSku.get(skuKey) !== (row.group || row.name)) return reject(line, `SKU นี้ถูกใช้กับสินค้า "${existingSku.get(skuKey)}" อยู่แล้ว`, row.name);
          } else {
            if (!row.parent) return reject(line, 'หน่วยย่อยต้องระบุรหัสสินค้าหลัก', row.name);
            if (!row.unit) return reject(line, 'หน่วยย่อยไม่มีชื่อหน่วย', row.name);
            if (!(row.price > 0)) return reject(line, 'ราคาหน่วยย่อยต้องมากกว่า 0', row.name);
            if (!(row.ratio > 0)) return reject(line, 'จำนวนหน่วยฐานต่อ 1 หน่วยนี้ต้องมากกว่า 0', row.name);
          }
          if (row.bar) {
            if (!/^\d{8,14}$/.test(row.bar)) return reject(line, 'รหัสบาร์โค้ดต้องเป็นตัวเลข 8–14 หลัก', row.name);
            const bk = row.bar;
            if (fileBar.has(bk)) return reject(line, `บาร์โค้ดซ้ำกับแถว ${fileBar.get(bk)}`, row.name);
            if (existingBar.has(bk) && existingBar.get(bk) !== (row.group || row.name)) return reject(line, `บาร์โค้ดนี้ถูกใช้กับสินค้า "${existingBar.get(bk)}" อยู่แล้ว`, row.name);
            fileBar.set(bk, line);
          }
          if (row.type === 'หลัก') mains.push(row); else subs.push(row);
        });
        // กลุ่มเดียวกันต้องมีหมวด/สถานะเดียวกัน
        const gKey = r => r.group || r.name;
        const gInfo = new Map();
        mains.forEach(r => { const k = gKey(r); if (!gInfo.has(k)) gInfo.set(k, { main: r.main, sub: r.sub, status: r.status, image: r.image, min: r.min, img: null }); if (r.img && !gInfo.get(k).img) gInfo.get(k).img = r.img; });
        const okMains = mains.filter(r => {
          const g = gInfo.get(gKey(r));
          if (g.main !== r.main || g.sub !== r.sub) { reject(r.line, 'หมวดหมู่ไม่ตรงกับแถวอื่นในกลุ่มเดียวกัน', r.name); return false; }
          if (g.status !== r.status) { reject(r.line, 'สถานะไม่ตรงกับแถวอื่นในกลุ่มเดียวกัน', r.name); return false; }
          return true;
        });
        const okSkus = new Map(okMains.map(r => [r.sku.toLowerCase(), r]));
        const okSubs = subs.filter(r => {
          const parent = okSkus.get(r.parent.toLowerCase());
          if (!parent) { reject(r.line, `รหัสสินค้าหลัก "${r.parent}" ไม่ผ่านการตรวจหรือไม่มีในไฟล์`, r.name); return false; }
          r.parentRow = parent; return true;
        });
        // จัดกลุ่มเป็นสินค้า
        const groups = new Map();
        okMains.forEach(r => {
          const k = gKey(r);
          if (!groups.has(k)) { const g = gInfo.get(k); groups.set(k, { name: k, code: r.sku, main: g.main, sub: g.sub, status: g.status, image: g.image, img: g.img, minStock: isFinite(g.min) && g.min >= 0 ? g.min : 5, variants: [] }); }
          const g = groups.get(k);
          g.variants.push({ sku: r.sku, barcode: r.bar, sizeName: r.size, unit: r.unit || 'ชิ้น', cost: isFinite(r.cost) ? r.cost : 0, price: r.price, stock: isFinite(r.stock) ? r.stock : 0, minStock: isFinite(r.min) ? r.min : g.minStock, fractions: [], line: r.line });
        });
        okSubs.forEach(r => {
          const g = groups.get(gKey(r.parentRow)); const v = g.variants.find(x => x.sku.toLowerCase() === r.parent.toLowerCase());
          v.fractions.push({ id: 'f-' + r.sku.replace(/\s+/g, '_'), sku: r.sku, barcode: r.bar, fractionName: r.unit, fractionMultiplier: r.ratio, fractionPrice: r.price });
        });
        const list = [...groups.values()];
        const nVar = list.reduce((a, g) => a + g.variants.length, 0), nFrac = okSubs.length, nPhoto = list.filter(g => g.img).length;
        return { groups: list, rejected: rejected.sort((a, b) => a.line - b.line), stats: { groups: list.length, variants: nVar, fractions: nFrac, photos: nPhoto, rejected: rejected.length, total: rows.length, noCost: list.reduce((a, g) => a + g.variants.filter(v => !(v.cost > 0)).length, 0) } };
      }

      function renderImportPreview(plan){
        const box = document.getElementById('import-preview-box'), el = document.getElementById('import-preview-table');
        box.classList.remove('hidden');
        const s = plan.stats;
        const rej = plan.rejected.slice(0, 200).map(x => `<tr class="border-t"><td class="p-2">${x.line}</td><td class="p-2">${escapeHTML(x.name)}</td><td class="p-2 text-rose-700">${escapeHTML(x.reason)}</td></tr>`).join('');
        el.innerHTML = `
          <div class="p-3 text-xs bg-indigo-50 border-b leading-relaxed">
            ผ่านการตรวจ <b class="text-emerald-700">${s.variants + s.fractions}</b> แถว (สินค้า <b>${s.groups}</b> กลุ่ม • ขนาด <b>${s.variants}</b> • หน่วยย่อย <b>${s.fractions}</b> • มีรูป <b>${s.photos}</b> กลุ่ม)<br>
            ไม่ผ่าน <b class="text-rose-700">${s.rejected}</b> แถว จากทั้งหมด ${s.total} แถว — แถวที่ไม่ผ่านจะถูกข้าม ไม่นำเข้า
            ${s.noCost ? `<br><span class="text-amber-700 font-bold">⚠️ ราคาทุนว่าง ${s.noCost} รายการ — ระบบจะบันทึกทุน 0 ทำให้กำไรสูงเกินจริง ควรกรอกทุนก่อนใช้จริง</span>` : ''}
          </div>
          ${plan.rejected.length ? `<div class="max-h-48 overflow-y-auto"><table class="w-full text-left text-xs"><thead class="bg-rose-50 font-bold"><tr><th class="p-2">แถว</th><th class="p-2">ชื่อ</th><th class="p-2">เหตุผล</th></tr></thead><tbody>${rej}</tbody></table></div>` : '<div class="p-3 text-xs text-emerald-700">✅ ทุกแถวผ่านการตรวจ</div>'}`;
        const confirmBtn = document.querySelector('[onclick*="confirmOpeningStockImport"]');
        if (confirmBtn) confirmBtn.disabled = !plan.groups.length;
      }

      // อ่านไฟล์นำเข้า: ข้อมูลแถวด้วย SheetJS (อ่านค่าเซลล์ได้เสถียร) และรูปที่ฝังด้วย JSZip อ่านโดยตรงจาก drawing ของไฟล์
      // (ไม่ใช้ ExcelJS ตอนนำเข้า เพราะไฟล์ที่สร้างจากเครื่องมืออื่นทำให้ ExcelJS ล้มด้วย r.anchors)
      const normZipPath = p => { const out = []; p.split('/').forEach(seg => { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }); return out.join('/'); };
      async function readEmbeddedPhotos(buf){
        const map = new Map();
        try { await window.posLoadLib('jszip'); } catch (e) { return map; }
        const zip = await JSZip.loadAsync(buf);
        const readText = async p => { const f = zip.file(p); return f ? await f.async('string') : null; };
        const relTargets = async (relPath, baseDir) => {
          const s = await readText(relPath); const out = [];
          if (!s) return out;
          const doc = new DOMParser().parseFromString(s, 'application/xml');
          const rels = doc.getElementsByTagName('Relationship');
          for (let i = 0; i < rels.length; i++) {
            const tgt = rels[i].getAttribute('Target') || '';
            const full = tgt.startsWith('/') ? tgt.slice(1) : normZipPath(baseDir + '/' + tgt);
            out.push({ id: rels[i].getAttribute('Id'), type: rels[i].getAttribute('Type') || '', target: full });
          }
          return out;
        };
        const wbXml = await readText('xl/workbook.xml'); if (!wbXml) return map;
        const wbDoc = new DOMParser().parseFromString(wbXml, 'application/xml');
        const sheets = wbDoc.getElementsByTagName('sheet');
        const sheetRid = (sheets[0] && (sheets[0].getAttribute('r:id') || sheets[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))) || null;
        if (!sheetRid) return map;
        const wbRels = await relTargets('xl/_rels/workbook.xml.rels', 'xl');
        const sheetPath = (wbRels.find(r => r.id === sheetRid) || {}).target; if (!sheetPath) return map;
        const sheetDir = sheetPath.split('/').slice(0, -1).join('/'), sheetFile = sheetPath.split('/').pop();
        const sheetRels = await relTargets(sheetDir + '/_rels/' + sheetFile + '.rels', sheetDir);
        for (const dr of sheetRels.filter(r => /\/drawing$/.test(r.type) || /drawings\/drawing\d+\.xml$/.test(r.target))) {
          const dXml = await readText(dr.target); if (!dXml) continue;
          const dDir = dr.target.split('/').slice(0, -1).join('/'), dFile = dr.target.split('/').pop();
          const dRels = await relTargets(dDir + '/_rels/' + dFile + '.rels', dDir);
          const dDoc = new DOMParser().parseFromString(dXml, 'application/xml');
          const anchors = Array.from(dDoc.documentElement.children).filter(n => /Anchor$/.test(n.localName));
          for (const a of anchors) {
            const from = a.getElementsByTagNameNS('*', 'from')[0]; if (!from) continue;
            const rowEl = from.getElementsByTagNameNS('*', 'row')[0]; if (!rowEl) continue;
            const rowNum = parseInt(rowEl.textContent, 10) + 1;
            const blip = a.getElementsByTagNameNS('*', 'blip')[0]; if (!blip) continue;
            const embed = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip.getAttribute('r:embed');
            const media = (dRels.find(r => r.id === embed) || {}).target; if (!media || !zip.file(media)) continue;
            const ext = (media.split('.').pop() || 'jpeg').toLowerCase();
            if (!map.has(rowNum)) map.set(rowNum, { buffer: await zip.file(media).async('arraybuffer'), ext: ext === 'jpg' ? 'jpeg' : ext });
          }
        }
        return map;
      }

      window.handleOpeningStockFile = async function(e){
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          await window.posLoadLib('xlsx');
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          const sheetName = wb.SheetNames.includes('รายการสินค้า') ? 'รายการสินค้า' : wb.SheetNames[0];
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false, blankrows: true });
          let imgByRow = new Map();
          try { imgByRow = await readEmbeddedPhotos(buf); } catch (err) { console.warn('อ่านรูปในไฟล์ไม่ได้ จะนำเข้าข้อมูลโดยไม่มีรูป', err); }
          rows.forEach((r, i) => { r.__img = imgByRow.get(i + 2) || null; });
          const plan = buildImportPlan(rows);
          if (!plan.groups.length && !plan.rejected.length) return window.showAlert?.('ไม่พบข้อมูล', 'ไม่พบแถวสินค้าในไฟล์', true);
          pendingImportList = plan.groups;
          renderImportPreview(plan);
          if (imgByRow.size && !plan.stats.photos) console.warn('พบรูปในไฟล์แต่ไม่ผูกกับแถวหลัก ตรวจคอลัมน์รูปสินค้า');
        } catch (err) {
          console.error(err);
          window.showAlert?.('อ่านไฟล์ไม่สำเร็จ', err.message || String(err), true);
        }
      };

      // อัปโหลดรูปที่ฝังในไฟล์ขึ้น Storage (bucket product-images) แล้วผูกกับสินค้า — ล้มเหลวได้โดยไม่กระทบข้อมูลสินค้า
      async function uploadImportPhotos(groups){
        const client = window.getSupabaseClient?.();
        const out = { ok: 0, fail: 0, skipped: 0, noClient: !client };
        for (const g of groups) {
          if (!g.img) continue;
          if (!client) { out.skipped++; continue; }
          try {
            const ext = g.img.ext === 'png' ? 'png' : 'jpg';
            const path = `${g.pid}_${Date.now()}.${ext}`;
            const blob = new Blob([g.img.buffer], { type: ext === 'png' ? 'image/png' : 'image/jpeg' });
            const { error } = await client.storage.from('product-images').upload(path, blob, { contentType: blob.type, upsert: true });
            if (error) throw error;
            const { data } = client.storage.from('product-images').getPublicUrl(path);
            const p = db.products[g.pid]; if (!p) throw new Error('ไม่พบสินค้าในเครื่องหลังอัปโหลดรูป'); p.imageUrl = data.publicUrl;
            out.ok++;
          } catch (err) { console.warn('photo upload failed', g.name, err); out.fail++; }
        }
        if (out.ok) window.persist?.();
        return out;
      }

      window.confirmOpeningStockImport = async function(){
        if (!pendingImportList.length) return;
        window.seedYojiCategories?.();   // หมวดหลัก/ย่อยตามผังเว็บ ไฟล์นำเข้าจะจับคู่เข้าหมวดเดิม ไม่สร้างหมวดซ้ำ

        db.categories = db.categories || [];
        const ensureCat = (name, parentId) => {
          let c = db.categories.find(x => x.name === name && (x.parentId || null) === (parentId || null));
          if (!c) { c = { id: 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, icon: '📦', color: '#64748b', parentId: parentId || null }; db.categories.push(c); }
          return c;
        };
        let added = 0, updated = 0, fracs = 0;
        pendingImportList.forEach(g => {
          const top = ensureCat(g.main);
          const cat = g.sub ? ensureCat(g.sub, top.id) : top;
          const catName = cat.name;
          const existing = Object.values(db.products).find(p => !p.isDeleted && p.name === g.name);
          g.pid = existing ? existing.id : null;
          const mk = nv => ({ id: 'v-' + nv.sku.replace(/\s+/g, '_'), sizeName: nv.sizeName, sku: nv.sku, barcode: nv.barcode, cost: nv.cost, price: nv.price, stock: nv.stock, minStock: nv.minStock, fractions: nv.fractions.map(f => ({ id: f.id, fractionName: f.fractionName, fractionMultiplier: f.fractionMultiplier, fractionPrice: f.fractionPrice, sku: f.sku, barcode: f.barcode })) });
          if (existing) {
            existing.cat = [catName]; existing.isDisabled = g.status === 'ไม่ใช้';
            existing.variants = existing.variants || [];
            g.variants.forEach(nv => {
              const lv = existing.variants.find(v => (nv.sku && v.sku === nv.sku) || (nv.barcode && v.barcode === nv.barcode));
              if (lv) {       // อัปเดตราคา ทุน หน่วยย่อย แต่ไม่แตะยอดคงเหลือเดิม
                if (nv.price > 0) lv.price = nv.price;
                if (nv.cost > 0) lv.cost = nv.cost;
                if (!lv.sku) lv.sku = nv.sku;
                if (nv.barcode && !lv.barcode) lv.barcode = nv.barcode;
                if (nv.fractions.length) lv.fractions = mk(nv).fractions;
              } else existing.variants.push(mk(nv));
            });
            updated++;
          } else {
            let pid = 'imp-' + g.code.replace(/\s+/g, '_'), n = 2;
            while (db.products[pid]) pid = 'imp-' + g.code.replace(/\s+/g, '_') + '-' + (n++);
            db.products[pid] = { id: pid, name: g.name, code: g.code, cat: [catName], image: '📦', imageUrl: null, imageFile: g.image || '', minStock: g.minStock, isDisabled: g.status === 'ไม่ใช้', variants: g.variants.map(mk) };
            g.pid = pid;
            added++;
          }
          fracs += g.variants.reduce((a, v) => a + v.fractions.length, 0);
        });
        window.persist?.();
        window.showToast?.('กำลังอัปโหลดรูปจากไฟล์…');
        const ph = await uploadImportPhotos(pendingImportList);
        window.persist?.();
        window.renderCategoryManagerList?.(); window.renderCategoryParentOptions?.();
        window.renderStockTable?.(); window.renderSaleHome?.(); window.populatePOPickers?.();
        const photoMsg = ph.noClient ? 'ยังไม่ได้เชื่อม Supabase — ไม่ได้อัปโหลดรูป' : `รูป ${ph.ok} สำเร็จ${ph.fail ? ` • ล้มเหลว ${ph.fail}` : ''}`;
        window.showToast?.(`นำเข้าสินค้าใหม่ ${added} • อัปเดต ${updated} กลุ่ม • หน่วยย่อย ${fracs} • ${photoMsg}`);
        window.smartPOSActivityLog?.add('OK', 'นำเข้ารายการสินค้าจากไฟล์', `ใหม่ ${added} • อัปเดต ${updated} • หน่วยย่อย ${fracs}`);
        window.syncProductsToSupabase?.(true);
        pendingImportList = [];
        document.getElementById('import-preview-box').classList.add('hidden');
      };

      window.renderSettingsSuppliers = function() {
        document.getElementById('settings-suppliers-list').innerHTML = Object.values(db.suppliers).map(s => {
          const owed = (db.cashLedger || [])
            .filter(x => x.type === 'ACCOUNTS_PAYABLE' && x.supplierId === s.id && x.status === 'OPEN')
            .reduce((sum, x) => sum + (+x.amount || 0), 0);
          return `
          <div class="bg-slate-50 p-2.5 rounded-xl border flex justify-between items-center">
            <div>
              <b>${escapeHTML(s.name)}</b> <span class="text-slate-400">(เครดิต ${s.terms} วัน)</span>
              <span class="block text-[10px] ${owed > 0 ? 'text-rose-500 font-bold' : 'text-slate-400'}">เจ้าหนี้คงค้าง ${formatMoney(owed)}</span>
            </div>
            <button onclick="window.deleteSupplier('${s.id}')" class="text-rose-500 font-bold hover:underline">ลบ</button>
          </div>`;
        }).join('') || `<p class="text-center text-slate-400 font-bold py-3 text-xs">ยังไม่มีซัพพลายเออร์</p>`;
      };

      window.renderSettingsCustomers = function() {
        document.getElementById('settings-customers-list').innerHTML = Object.values(db.customers).map(c => `
          <div class="bg-slate-50 p-2.5 rounded-xl border flex justify-between items-center">
            <div><b>${escapeHTML(c.name)}</b> <span class="text-slate-400">📞 ${escapeHTML(c.phone)}</span>
              <span class="block text-[10px] text-slate-400">หนี้คงค้าง ${formatMoney(c.debt || 0)} / วงเงิน ${formatMoney(c.creditLimit ?? 50000)}</span>
            </div>
            <button onclick="window.deleteCustomer('${c.id}')" class="text-rose-500 font-bold hover:underline">ลบ</button>
          </div>
        `).join('');
      };

      window.saveCustomer = function() {
        const name = document.getElementById('customer-name-input').value.trim();
        const phone = document.getElementById('customer-phone-input').value.trim();
        const creditLimit = parseFloat(document.getElementById('customer-credit-limit-input').value) || 50000;
        if (!name) return window.showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อลูกค้า", true);

        const id = 'CUST-' + Date.now().toString(36).toUpperCase();
        db.customers[id] = { id, name, phone, debt: 0, creditLimit };
        document.getElementById('customer-name-input').value = '';
        document.getElementById('customer-phone-input').value = '';
        document.getElementById('customer-credit-limit-input').value = '';
        window.persist?.();
        window.renderSettingsCustomers();
        window.showToast("บันทึกลูกค้าสำเร็จ");
      };

      window.deleteCustomer = function(id) {
        if (db.customers[id]?.debt > 0) {
          return window.showAlert("ไม่สามารถลบได้", "ลูกค้ารายนี้ยังมียอดหนี้ค้างชำระอยู่", true);
        }
        delete db.customers[id];
        window.persist?.();
        window.renderSettingsCustomers();
        window.showToast("ลบลูกค้าสำเร็จ");
      };

      // ==========================================
      // SALES / RECEIVABLES / RETURNS (รวมขาย, ลูกหนี้, ยอดค้าง, ใบเสร็จ, คืนสินค้า)
      // ==========================================
      window.renderSalesAR = function() {
        // 1. Accounts receivable / outstanding balances
        const arEl = document.getElementById('ar-balance-list');
        if (arEl) {
          const debtors = Object.values(db.customers || {}).filter(c => (c.debt || 0) > 0);
          arEl.innerHTML = debtors.length ? debtors.map(c => `
            <div class="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs flex justify-between items-center">
              <div><b class="text-slate-800">${escapeHTML(c.name)}</b><span class="block text-[10px] text-slate-500">📞 ${escapeHTML(c.phone || '-')}</span></div>
              <div class="text-right">
                <span class="block font-black text-rose-600">${formatMoney(c.debt)}</span>
                <button onclick="window.openReceivePaymentModal('${c.id}')" class="text-[10px] text-indigo-600 font-bold underline">รับชำระหนี้</button>
              </div>
            </div>`).join('') : `<p class="text-center text-slate-400 font-bold py-6">ไม่มีลูกหนี้ค้างชำระ 🎉</p>`;
        }

        // 2. Bill / receipt history with return action
        const billsEl = document.getElementById('ar-bills-list');
        if (billsEl) {
          const q = (document.getElementById('ar-bills-search')?.value || '').trim().toLowerCase();
          let bills = (db.bills || []).slice().reverse();
          if (q) {
            bills = bills.filter(b => {
              const cName = (b.customerId && b.customerId !== 'GENERAL' && db.customers[b.customerId]) ? db.customers[b.customerId].name : 'ลูกค้าทั่วไป';
              return b.id.toLowerCase().includes(q) || cName.toLowerCase().includes(q);
            });
          }
          billsEl.innerHTML = bills.length ? bills.map(b => {
            const cName = (b.customerId && b.customerId !== 'GENERAL' && db.customers[b.customerId]) ? db.customers[b.customerId].name : 'ลูกค้าทั่วไป';
            const canReturn = !b.isRefunded;
            // Show how much (if anything) has been returned against this bill so far — the old
            // version only showed a boolean "fully returned" badge and said nothing about a
            // partial return, which looked identical to a bill nobody had touched.
            const returnedSoFar = (db.returns || []).filter(r => r.billId === b.id).reduce((s, r) => s + r.amount, 0);
            let statusBadge = '';
            if (b.isRefunded) statusBadge = '<span class="text-rose-500 font-bold">คืนสินค้าครบแล้ว</span>';
            else if (returnedSoFar > 0) statusBadge = `<span class="text-amber-600 font-bold">คืนแล้ว ${formatMoney(returnedSoFar)}</span>`;
            return `<div class="bg-slate-50 p-3 rounded-xl border text-xs space-y-1.5">
              <div class="flex justify-between items-center">
                <b class="text-indigo-600">${escapeHTML(b.id)}</b>
                <span class="font-black text-slate-800">${formatMoney(b.total)}</span>
              </div>
              <div class="text-[10px] text-slate-400 flex justify-between items-center">
                <span>${new Date(b.time).toLocaleString('th-TH')} | ${escapeHTML(cName)} | ${escapeHTML(b.method)}</span>
                ${statusBadge}
              </div>
              <div class="flex gap-2 pt-1">
                <button onclick='window.renderReceipt(db.bills.find(x=>x.id===${JSON.stringify(b.id)}))' class="flex-1 py-1.5 bg-white border rounded-lg font-bold btn-touch">🧾 ดูใบเสร็จ</button>
                ${canReturn ? `<button onclick="window.openReturnModal(${JSON.stringify(b.id)})" class="flex-1 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-bold btn-touch">↩️ คืนสินค้า</button>` : ''}
              </div>
            </div>`;
          }).join('') : `<p class="text-center text-slate-400 font-bold py-6">ไม่พบประวัติการขาย</p>`;
        }
      };
      // Backward-compatible alias: some code paths (bridge script / loadDatabaseState) still call renderHistory().
      window.renderHistory = window.renderSalesAR;

      // --- Receive customer payment against outstanding debt ---
      window.openReceivePaymentModal = function(customerId) {
        const c = db.customers[customerId];
        if (!c) return;
        document.getElementById('rp-customer-id').value = customerId;
        document.getElementById('rp-customer-name').textContent = c.name;
        document.getElementById('rp-customer-debt').textContent = formatMoney(c.debt || 0);
        document.getElementById('rp-amount').value = '';
        document.getElementById('modal-receive-payment').classList.remove('hidden');
        document.getElementById('modal-receive-payment').classList.add('flex');
      };

      window.confirmReceivePayment = function() {
        const cid = document.getElementById('rp-customer-id').value;
        const c = db.customers[cid];
        if (!c) return;
        const amount = roundAmt(parseFloat(document.getElementById('rp-amount').value) || 0);
        if (amount <= 0) return window.showAlert("จำนวนเงินไม่ถูกต้อง", "กรุณาระบุจำนวนเงินที่รับชำระ", true);
        if (amount > c.debt) return window.showAlert("จำนวนเงินเกินยอดหนี้", `ยอดหนี้คงเหลือมีเพียง ${formatMoney(c.debt)}`, true);

        c.debt = roundAmt(c.debt - amount);
        db.cashLedger = db.cashLedger || [];
        const _payId = 'CL-' + Date.now() + '-' + window.getDeviceId();
        db.cashLedger.push({ id: _payId, _viaRpc: true, type: 'cash-in-ar', income: amount, description: `รับชำระหนี้จาก ${c.name}`, refId: cid, shiftId: db.currentShift?.id || null, time: Date.now() });

        window.enqueueSync({ type: 'payment', payload: { customerId: cid, amount, shiftId: db.currentShift?.id || null, opRef: _payId } });
        window.persist?.();
        window.closeModal('modal-receive-payment');
        window.renderSalesAR();
        window.showToast(`บันทึกรับชำระหนี้ ${formatMoney(amount)} เรียบร้อย`);
      };

      // --- Return / refund workflow ---
      // Two-step flow: (1) pick items/quantities to return, (2) review — shows the exact
      // cash-refund or debt-reduction amount and a clear explanation of which one applies —
      // and nothing is actually executed (stock restored, cash logged, debt reduced) until the
      // user explicitly confirms on the review step.
      let returnTempBillId = null;

      window.openReturnModal = function(billId) {
        const bill = db.bills.find(b => b.id === billId);
        if (!bill) return;
        if (bill.isRefunded) return window.showAlert("คืนสินค้าแล้ว", "บิลนี้ถูกคืนสินค้าครบทุกรายการแล้ว", true);

        returnTempBillId = billId;
        document.getElementById('return-bill-id').textContent = bill.id;
        document.getElementById('return-items-list').innerHTML = bill.items.map((item, idx) => {
          const already = item.returnedQty || 0;
          const maxQty = roundStock(item.qty - already);
          if (maxQty <= 0) return '';
          return `<div class="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border text-xs">
            <div class="flex-1 pr-2"><b class="text-slate-800">${escapeHTML(item.name)}</b><span class="block text-[10px] text-slate-400">@${formatMoney(item.price)} (คืนได้สูงสุด ${maxQty})</span></div>
            <input type="number" min="0" max="${maxQty}" step="any" value="0" id="return-qty-${idx}" oninput="window.updateReturnTotal()" class="w-16 border rounded-lg text-center py-1.5 font-bold outline-none">
          </div>`;
        }).join('');
        window.updateReturnTotal();

        // Always reopen on step 1, even if a previous session was left mid-review.
        document.getElementById('return-step-select').classList.remove('hidden');
        document.getElementById('return-step-review').classList.add('hidden');

        document.getElementById('modal-return').classList.remove('hidden');
        document.getElementById('modal-return').classList.add('flex');
      };

      window.updateReturnTotal = function() {
        const bill = db.bills.find(b => b.id === returnTempBillId);
        if (!bill) return;
        let total = 0;
        bill.items.forEach((item, idx) => {
          const el = document.getElementById(`return-qty-${idx}`);
          const already = item.returnedQty || 0;
          const maxQty = roundStock(item.qty - already);
          let q = el ? (parseFloat(el.value) || 0) : 0;
          if (q < 0) q = 0;
          if (q > maxQty) q = maxQty;
          if (el) el.value = q;
          total += q * item.price * window.billRefundRatio(bill);   // หักสัดส่วนส่วนลดของบิลเดิม
        });
        document.getElementById('return-total-display').textContent = formatMoney(total);
      };

      window.backToReturnSelect = function() {
        document.getElementById('return-step-review').classList.add('hidden');
        document.getElementById('return-step-select').classList.remove('hidden');
      };

      // STEP 2: compute exactly what will happen and show it for explicit confirmation —
      // does not touch stock, cash, or debt yet.
      window.reviewReturn = function() {
        const bill = db.bills.find(b => b.id === returnTempBillId);
        if (!bill) return;

        const lines = [];
        let total = 0, _g = 0;
        bill.items.forEach((item, idx) => {
          const el = document.getElementById(`return-qty-${idx}`);
          const q = el ? (parseFloat(el.value) || 0) : 0;
          if (q <= 0) return;
          const lineTotal = roundAmt(q * item.price * window.billRefundRatio(bill));
          _g += q * item.price;
          total = roundAmt(_g * window.billRefundRatio(bill));
          lines.push({ name: item.name, qty: q, price: item.price, lineTotal });
        });

        if (!lines.length) return window.showAlert("ไม่มีรายการคืน", "กรุณาระบุจำนวนที่ต้องการคืนอย่างน้อย 1 รายการ", true);

        document.getElementById('return-review-items').innerHTML = lines.map(l => `
          <div class="flex justify-between bg-slate-50 p-2 rounded-lg border">
            <span>${escapeHTML(l.name)} × ${l.qty}</span>
            <b class="text-slate-700">${formatMoney(l.lineTotal)}</b>
          </div>
        `).join('');

        const isCredit = bill.method === 'CREDIT';
        const msgEl = document.getElementById('return-review-message');
        const labelEl = document.getElementById('return-review-total-label');
        if (isCredit) {
          msgEl.className = 'p-3 rounded-xl border text-xs leading-relaxed mb-3 bg-indigo-50 border-indigo-200 text-indigo-800';
          msgEl.innerHTML = `📋 บิลนี้เป็น <b>เงินเชื่อ (ค้างชำระ)</b> — <b>ไม่ต้องคืนเงินสด</b> ระบบจะ<b>หักยอดหนี้ค้างชำระของลูกค้าลง ${formatMoney(total)}</b> แทนเมื่อกดยืนยัน`;
          labelEl.textContent = 'ยอดหักหนี้:';
        } else {
          msgEl.className = 'p-3 rounded-xl border text-xs leading-relaxed mb-3 bg-rose-50 border-rose-200 text-rose-800';
          msgEl.innerHTML = `💵 บิลนี้ชำระด้วย <b>${escapeHTML(bill.method)}</b> — กรุณา<b>คืนเงินสด ${formatMoney(total)} ให้ลูกค้าจริงก่อน</b> แล้วจึงกดยืนยัน (การกดยืนยันจะบันทึกว่าได้คืนเงินแล้ว)`;
          labelEl.textContent = 'ยอดคืนเงินสด:';
        }
        document.getElementById('return-review-total-display').textContent = formatMoney(total);

        document.getElementById('return-step-select').classList.add('hidden');
        document.getElementById('return-step-review').classList.remove('hidden');
      };

      // Only actually runs after explicit confirmation on the review step.
      window.executeReturn = function() {
        const bill = db.bills.find(b => b.id === returnTempBillId);
        if (!bill) return;

        let refundTotal = 0;
        let anyReturned = false;
        const rpcItems = []; // BUG FIX (#1): เก็บไว้ส่งขึ้น process_return RPC ด้วย
        const _restock = [];
        let _gross = 0;
        const _ratio = window.billRefundRatio(bill);

        bill.items.forEach((item, idx) => {
          const el = document.getElementById(`return-qty-${idx}`);
          const already = item.returnedQty || 0;
          const maxQty = roundStock(item.qty - already);
          let returnQty = el ? (parseFloat(el.value) || 0) : 0;
          if (returnQty <= 0 || maxQty <= 0) return;
          returnQty = Math.min(returnQty, maxQty);

          anyReturned = true;
          item.returnedQty = roundStock(already + returnQty);
          _gross += returnQty * item.price;

          // Restock: reverse of the deduction done at checkout time (item.multiplier converts
          // the sold fraction/unit back into base stock units, matching processPaymentRequest).
          const p = db.products[item.id];
          const v = p?.variants?.find(x => x.id === item.variantId);
          if (v) v.stock = roundStock((+v.stock || 0) + returnQty * (item.multiplier || 1));
          _restock.push({ variantId: item.variantId, qty: returnQty * (item.multiplier || 1) });

          rpcItems.push({
            variant_id: item.variantId || null,
            fraction_id: item.fractionId || null,
            quantity: returnQty,
            // Send the actual refunded unit price after the original bill discount ratio,
            // so the server-side refund total matches the amount shown to the cashier.
            unit_price: roundAmt(item.price * _ratio)
          });
        });

        if (!anyReturned) return window.showAlert("ไม่มีรายการคืน", "กรุณาระบุจำนวนที่ต้องการคืนอย่างน้อย 1 รายการ", true);
        refundTotal = roundAmt(_gross * _ratio);   // คืนตามที่ลูกค้าจ่ายจริง (หักส่วนลดแล้ว) — ตรงกับ process_return บนเซิร์ฟเวอร์

        const fullyReturned = bill.items.every(item => roundStock(item.returnedQty || 0) >= roundStock(item.qty));
        bill.isRefunded = fullyReturned;

        db.returns = db.returns || [];
        const creditNoteNo = window.getCreditNoteNumber();
        const isCredit = bill.method === 'CREDIT';
        db.returns.push({ id: creditNoteNo, billId: bill.id, amount: refundTotal, method: bill.method, isDebtReduction: isCredit, time: Date.now() });

        // Credit sale: reduce the customer's outstanding debt instead of handing back cash.
        // Otherwise: log a cash refund out of the drawer/ledger.
        if (isCredit && bill.customerId && db.customers[bill.customerId]) {
          db.customers[bill.customerId].debt = roundAmt(Math.max(0, db.customers[bill.customerId].debt - refundTotal));
        } else {
          db.cashLedger = db.cashLedger || [];
          db.cashLedger.push({ id: 'CL-' + Date.now() + '-' + window.getDeviceId(), _viaRpc: true, type: 'expense-refund', expense: refundTotal, description: 'คืนสินค้าบิล ' + bill.id, refId: bill.id, shiftId: db.currentShift?.id || null, time: Date.now() });
        }

        window.closeModal('modal-return');
        window.persist?.();
        window.renderSalesAR();
        window.renderStockTable?.();
        window.showToast(isCredit
          ? `บันทึกใบลดหนี้ ${creditNoteNo} เรียบร้อย: หักยอดหนี้ ${formatMoney(refundTotal)}`
          : `บันทึกใบลดหนี้ ${creditNoteNo} เรียบร้อย: คืนเงิน ${formatMoney(refundTotal)}`);

        window.enqueueSync({ type: 'return', payload: { billId: bill.id, items: rpcItems.map(i => ({ variant_id: i.variant_id, fraction_id: i.fraction_id, quantity: i.quantity, unit_price: i.unit_price })), restock: _restock, returnRef: creditNoteNo, shiftId: db.currentShift?.id || null, isCredit, customerId: bill.customerId, refund: refundTotal, fully: fullyReturned } });
      };

      // CAMERA SCANNER
      // Generalized to scan into any target input (defaults to the sale-page search box) —
      // reused by the product form's barcode field for fast entry instead of typing by hand.
      window.startCameraScan = async function(targetInputId) {
        window._scanTargetId = targetInputId || 'search-product';
        document.getElementById('modal-camera').classList.remove('hidden');
        document.getElementById('modal-camera').classList.add('flex');
        try { await window.posLoadLib('qrcode'); }
        catch (e) { window.stopCameraScan(); return window.showAlert?.('เปิดกล้องไม่ได้', e.message, true); }
        if (!scanner) scanner = new Html5Qrcode("reader");
        scanner.start({ facingMode: "environment" }, { fps: 15, qrbox: 250 }, (text) => {
          window.stopCameraScan();
          const targetId = window._scanTargetId || 'search-product';
          const target = document.getElementById(targetId);
          if (target) target.value = text;
          if (targetId === 'search-product') {
            window.onSearchInput({ target: { value: text } });
          }
        }).catch(() => window.stopCameraScan());
      };

      window.stopCameraScan = function() {
        if (scanner) scanner.stop().catch(() => {});
        document.getElementById('modal-camera').classList.add('hidden');
      };

      window.closeModal = function(id) { 
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('hidden'); 
      };

      window.closeCustomAlert = function() { 
        document.getElementById('custom-alert-modal').classList.add('hidden'); 
      };

      window.showAlert = function(title, desc, isError = false) {
        window.posHooks.emit('ui:notice', { type: 'แจ้งเตือน', args: [title, desc, isError] });
        document.getElementById('custom-alert-title').innerText = title;
        document.getElementById('custom-alert-desc').innerText = desc;
        document.getElementById('custom-alert-modal').classList.remove('hidden');
        document.getElementById('custom-alert-modal').classList.add('flex');
      };

      window.showToast = function(msg) {
        window.posHooks.emit('ui:notice', { type: 'กิจกรรม', args: [msg] });
        const toast = document.getElementById('toast');
        document.getElementById('toast-message').innerText = msg;
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.transform = 'translateY(-100px)'; toast.style.opacity = '0'; }, 2500);
      };

      setInterval(() => {
        const clock = document.getElementById('clock');
        if (clock) clock.innerText = new Date().toLocaleTimeString('th-TH');
      }, 1000);

      window.addEventListener('DOMContentLoaded', () => {
        window.renderSaleHome?.();
        window.refreshAuthStatus?.();
        setTimeout(() => window.syncCategoryBarOffset?.(), 0);
      });
    