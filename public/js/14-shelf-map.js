
(function () {
  'use strict';
  // ---------- ตัวช่วยทั่วไป ----------
  const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const safeCartCount = () => { try { return cart.reduce((a, i) => a + (i.qty || 0), 0); } catch (e) { return 0; } };
  const soundOn = () => localStorage.getItem('pos_sound_on') !== '0';

  // ---------- เสียง (Web Audio ไม่ต้องใช้ไฟล์) ----------
  let actx = null;
  function audio() {
    try {
      if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(freq, dur, type, vol, delay) {
    if (!soundOn()) return;
    const c = audio(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const SFX = {
    add:   () => tone(880, 0.08),
    total: () => { tone(660, 0.12); tone(990, 0.18, 'sine', 0.18, 0.13); },
    paid:  () => { tone(784, 0.12); tone(988, 0.12, 'sine', 0.18, 0.12); tone(1319, 0.25, 'sine', 0.18, 0.24); },
    error: () => tone(220, 0.3, 'square', 0.12),
    ok:    () => tone(1046, 0.15, 'sine', 0.15)
  };
  // พูดภาษาไทย (ถ้าเครื่องมีเสียงภาษาไทย) — iOS ต้องเริ่มจากการแตะก่อนจึงจะพูดได้
  function speak(text) {
    if (!soundOn() || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'th-TH'; u.rate = 1;
      const v = speechSynthesis.getVoices().find(x => /^th/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* เสียงพูดไม่ใช่สิ่งจำเป็นต่อการขาย */ }
  }
  // ปลดล็อกเสียงในการแตะครั้งแรก (ข้อจำกัดของ iOS)
  ['pointerdown', 'touchend'].forEach(ev =>
    document.addEventListener(ev, () => audio(), { once: true, passive: true }));

  // ---------- เครื่องมือ: เปิด/ปิดเสียง (อยู่ในศูนย์เครื่องมือ ไม่มีปุ่มลอย) ----------
  window.posHub.register({
    id: 'sound', group: 'look', keepOpen: true,
    icon: () => (soundOn() ? '🔊' : '🔇'),
    label: 'เสียงแจ้งเตือน',
    hint: () => (soundOn() ? 'เปิดอยู่' : 'ปิดอยู่'),
    run: () => { localStorage.setItem('pos_sound_on', soundOn() ? '0' : '1'); if (soundOn()) SFX.add(); }
  });

  // ---------- เสียงในขั้นตอนขาย (รับเหตุการณ์จากฟังก์ชันขายหลัก) ----------
  posHooks.on('cart:add', () => SFX.add());

  posHooks.on('cart:open', () => {
    if (safeCartCount() > 0) {
      const total = Number(window.currentCartTotal()) || 0;
      SFX.total();
      speak('ยอดรวม ' + money(total) + ' บาท');
    }
  });

  let changeTimer = null, lastSpokenChange = null;
  posHooks.on('pay:calc', () => {
    const total = Number(window.currentCartTotal()) || 0;
    const received = parseFloat(document.getElementById('pay-cash-received')?.value) || 0;
    const change = Math.round((received - total) * 100) / 100;
    // พูดเงินทอนหลังผู้ใช้หยุดพิมพ์ 0.9 วินาที และพูดเฉพาะเมื่อค่าเปลี่ยน
    clearTimeout(changeTimer);
    if (received > 0 && total > 0 && change >= 0 && change !== lastSpokenChange) {
      changeTimer = setTimeout(() => {
        lastSpokenChange = change;
        speak('เงินทอน ' + money(change) + ' บาท');
      }, 900);
    }
  });

  posHooks.on('pay:error', () => SFX.error());
  posHooks.on('pay:end', e => {
    // นับเป็นขายสำเร็จเฉพาะเมื่อมีบิลเพิ่มขึ้นจริง (ไม่นับการพิมพ์ใบเสร็จซ้ำ)
    if (!e.sold) { SFX.error(); return; }
    SFX.paid();
    setTimeout(() => {
      if (e.isCash && e.total > 0 && e.received >= e.total) {
        const change = Math.round((e.received - e.total) * 100) / 100;
        speak('รับเงิน ' + money(e.received) + ' บาท ' +
              (change > 0 ? 'เงินทอน ' + money(change) + ' บาท ' : '') + 'ขอบคุณค่ะ');
      } else {
        speak('ขอบคุณค่ะ');
      }
      lastSpokenChange = null;
    }, 500);
  });

  // =====================================================================
  // แผนผังชั้นวางสินค้า: จุดเก็บรหัส "โซน-ชั้น-ช่อง" เช่น A-2-3
  // ค่าเก็บในแต่ละขนาดสินค้า (variant.locationCode) และซิงก์ผ่าน location_code
  // =====================================================================
  const CODE_RE = /^([A-Z])-(\d{1,2})-(\d{1,2})$/;
  const MIN_SHELVES = 5, MIN_SLOTS = 6;

  function allVariants() {
    const out = [];
    Object.values(db.products || {}).forEach(p => {
      if (p.isDeleted) return;
      (p.variants || []).forEach(v => out.push({ p, v }));
    });
    return out;
  }
  // จัดกลุ่มตามโซน และหาขนาดตารางจากค่าที่ใช้อยู่ (อย่างน้อย 5 ชั้น x 6 ช่อง)
  function layoutInfo() {
    const zones = {};
    allVariants().forEach(({ v }) => {
      const m = CODE_RE.exec(v.locationCode || '');
      if (!m) return;
      const z = m[1], sh = +m[2], sl = +m[3];
      zones[z] = zones[z] || { shelves: MIN_SHELVES, slots: MIN_SLOTS };
      zones[z].shelves = Math.max(zones[z].shelves, sh);
      zones[z].slots = Math.max(zones[z].slots, sl);
    });
    if (!Object.keys(zones).length) zones['A'] = { shelves: MIN_SHELVES, slots: MIN_SLOTS };
    return zones;
  }
  function itemsAt(code) {
    return allVariants().filter(({ v }) => (v.locationCode || '') === code);
  }

  let mapZone = null, mapCell = null;

  function ensureMapModal() {
    let m = document.getElementById('pos-shelf-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'pos-shelf-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9995;background:rgba(15,23,42,.55);padding:12px;overflow:auto';
    m.innerHTML = '<div id="pos-shelf-box" style="max-width:720px;margin:0 auto;background:#fff;border-radius:16px;padding:16px;font-family:Sarabun,sans-serif;color:#0f172a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:18px">🗺️ แผนผังชั้นวางสินค้า</b>' +
      '<button id="pos-shelf-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:6px 12px;font-weight:700">ปิด</button></div>' +
      '<div id="pos-shelf-zones" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>' +
      '<div id="pos-shelf-grid"></div>' +
      '<div id="pos-shelf-detail" style="margin-top:12px"></div></div>';
    document.body.appendChild(m);
    document.getElementById('pos-shelf-close').onclick = () => { m.style.display = 'none'; };
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    return m;
  }

  function renderZones() {
    const zones = layoutInfo();
    const names = Object.keys(zones).sort();
    if (!mapZone || !zones[mapZone]) mapZone = names[0];
    document.getElementById('pos-shelf-zones').innerHTML = names.map(z =>
      `<button data-zone="${z}" style="padding:8px 14px;border-radius:10px;border:1px solid #c7d2fe;font-weight:700;background:${z === mapZone ? '#4f46e5' : '#eef2ff'};color:${z === mapZone ? '#fff' : '#3730a3'}">โซน ${z}</button>`
    ).join('') + `<button data-zone="+" style="padding:8px 14px;border-radius:10px;border:1px dashed #94a3b8;background:#fff;font-weight:700">+ โซนใหม่</button>`;
    document.querySelectorAll('#pos-shelf-zones button').forEach(b => b.onclick = () => {
      if (b.dataset.zone === '+') {
        const next = String.fromCharCode(Math.max(...names.map(n => n.charCodeAt(0))) + 1);
        if (next > 'Z') return;
        mapZone = next; mapCell = null;
      } else { mapZone = b.dataset.zone; mapCell = null; }
      renderMap();
    });
    return zones;
  }

  function renderGrid(zones) {
    const z = zones[mapZone];
    let html = `<div style="display:grid;grid-template-columns:44px repeat(${z.slots},minmax(0,1fr));gap:4px;font-size:12px">`;
    html += '<div></div>' + Array.from({ length: z.slots }, (_, i) => `<div style="text-align:center;color:#64748b;font-weight:700">ช่อง ${i + 1}</div>`).join('');
    for (let sh = 1; sh <= z.shelves; sh++) {
      html += `<div style="display:flex;align-items:center;justify-content:center;color:#64748b;font-weight:700">ชั้น ${sh}</div>`;
      for (let sl = 1; sl <= z.slots; sl++) {
        const code = `${mapZone}-${sh}-${sl}`;
        const n = itemsAt(code).length;
        const sel = mapCell === code;
        html += `<button data-code="${code}" style="min-height:52px;border-radius:10px;border:${sel ? '3px solid #4f46e5' : (n ? '1px solid #818cf8' : '1px dashed #cbd5e1')};background:${n ? '#eef2ff' : '#f8fafc'};padding:4px;text-align:center;font-size:11px;line-height:1.2">` +
                 `<div style="font-weight:800;color:#312e81">${code}</div>` +
                 `<div style="color:${n ? '#4338ca' : '#94a3b8'}">${n ? n + ' รายการ' : 'ว่าง'}</div></button>`;
      }
    }
    html += '</div>';
    document.getElementById('pos-shelf-grid').innerHTML = html;
    document.querySelectorAll('#pos-shelf-grid button').forEach(b => b.onclick = () => {
      mapCell = b.dataset.code; SFX.total !== undefined && SFX.add(); renderMap();
    });
  }

  function renderDetail() {
    const el = document.getElementById('pos-shelf-detail');
    if (!mapCell) { el.innerHTML = '<div style="color:#64748b">แตะช่องในตารางเพื่อดูสินค้าในช่องนั้น หรือจัดสินค้าลงช่องว่าง</div>'; return; }
    const items = itemsAt(mapCell);
    let html = `<div style="font-weight:800;margin-bottom:6px">ตำแหน่ง ${mapCell}</div>`;
    if (items.length) {
      html += items.map(({ p, v }) => {
        const pid = p.id, vid = v.id;
        const oos = (v.stock || 0) <= 0;
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e2e8f0;border-radius:10px;padding:8px;margin-bottom:6px">` +
          `<div><div style="font-weight:700">${p.name} (${v.sizeName || 'ปกติ'})</div>` +
          `<div style="font-size:12px;color:${oos ? '#dc2626' : '#64748b'}">฿${money(v.price)} • คงเหลือ ${v.stock ?? 0}${oos ? ' (หมด)' : ''}</div></div>` +
          `<div style="display:flex;gap:6px"><button data-add="${pid}|${vid}" ${oos ? 'disabled' : ''} style="padding:8px 10px;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;border:0">+ ตะกร้า</button>` +
          `<button data-remove="${pid}|${vid}" style="padding:8px 10px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:700;border:0">นำออก</button></div></div>`;
      }).join('');
    } else {
      html += '<div style="color:#64748b;margin-bottom:6px">ช่องนี้ว่าง</div>';
    }
    html += `<div style="margin-top:10px;font-weight:700">จัดสินค้าลงช่องนี้</div>` +
      `<input id="pos-shelf-search" placeholder="พิมพ์ชื่อสินค้าเพื่อค้นหา" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px;margin-top:4px">` +
      `<div id="pos-shelf-results" style="max-height:180px;overflow:auto;margin-top:6px"></div>`;
    el.innerHTML = html;

    el.querySelectorAll('button[data-add]').forEach(b => b.onclick = () => {
      const [pid, vid] = b.dataset.add.split('|');
      window.addUnifiedToCart(pid, vid, null);
      renderDetail();
    });
    el.querySelectorAll('button[data-remove]').forEach(b => b.onclick = () => {
      const [pid, vid] = b.dataset.remove.split('|');
      const v = (db.products[pid]?.variants || []).find(x => x.id === vid);
      if (v) { v.locationCode = null; window.persist?.(); window.showToast?.('นำออกจากช่องแล้ว'); }
      renderMap();
    });
    const input = document.getElementById('pos-shelf-search');
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      const box = document.getElementById('pos-shelf-results');
      if (!q) { box.innerHTML = ''; return; }
      const hits = allVariants().filter(({ p, v }) =>
        ((p.name || '') + ' ' + (v.sizeName || '')).toLowerCase().includes(q)).slice(0, 20);
      box.innerHTML = hits.map(({ p, v }) => {
        const where = v.locationCode ? ` <span style="color:#64748b">(อยู่ที่ ${v.locationCode})</span>` : '';
        return `<button data-assign="${p.id}|${v.id}" style="display:block;width:100%;text-align:left;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:4px;background:#fff">` +
               `${p.name} (${v.sizeName || 'ปกติ'})${where}</button>`;
      }).join('') || '<div style="color:#64748b">ไม่พบสินค้า</div>';
      box.querySelectorAll('button[data-assign]').forEach(b => b.onclick = () => {
        const [pid, vid] = b.dataset.assign.split('|');
        const v = (db.products[pid]?.variants || []).find(x => x.id === vid);
        if (!v) return;
        v.locationCode = mapCell;
        window.persist?.();
        window.showToast?.('จัดวางที่ ' + mapCell + ' แล้ว');
        SFX.add();
        renderMap();
      });
    };
  }

  function renderMap() {
    const m = ensureMapModal();
    const zones = renderZones();
    renderGrid(zones);
    renderDetail();
  }

  window.openShelfMap = function () {
    mapCell = null;
    const m = ensureMapModal();
    m.style.display = 'block';
    renderMap();
    posHooks.emit('shelf:open');
  };

  window.posHub.register({
    id: 'map', group: 'ops', icon: '🗺️', label: 'แผนผังร้าน', hint: 'ตำแหน่งชั้นวาง',
    run: () => window.openShelfMap()
  });

  // ตัวช่วยกลางสำหรับโมดูลถัดไป (ประกาศครั้งเดียวที่นี่)
  const esc = s => (window.escapeHTML ? window.escapeHTML(s) : String(s == null ? '' : s));
  window.POS = { CODE_RE, esc, money, soundOn, speak, audio, SFX, allVariants, layoutInfo, itemsAt, zoneOf: code => { const m = CODE_RE.exec(code || ''); return m ? m[1] : null; }, findVariant: (pid, vid) => { const p = db.products[pid]; if (!p) return null; const v = (p.variants || []).find(x => x.id === vid); return v ? { p, v } : null; } };

})();
