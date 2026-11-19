
(function () {
  'use strict';
  const K = { sound: 'pos_sound_on', voice: 'pos_voice_on', rate: 'pos_voice_rate', bg: 'pos_bg', font: 'pos_font', touch: 'pos_touch_big' };
  const get = (k, d) => { const v = localStorage.getItem(k); return v == null ? d : v; };
  const set = (k, v) => localStorage.setItem(k, String(v));
  const root = document.documentElement;

  function applyTheme() {
    root.classList.toggle('pos-touch-big', get(K.touch, '0') === '1');
    ['pos-bg-cream','pos-bg-sky','pos-bg-mint','pos-bg-slate'].forEach(c => root.classList.remove(c));
    const bg = get(K.bg, 'white'); if (bg !== 'white') root.classList.add('pos-bg-' + bg);
    ['pos-font-lg','pos-font-xl'].forEach(c => root.classList.remove(c));
    const f = get(K.font, 'normal'); if (f === 'lg') root.classList.add('pos-font-lg'); if (f === 'xl') root.classList.add('pos-font-xl');
  }

  // เสียงพูด: เปิด/ปิดได้ และปรับความเร็วได้
  const synth = window.speechSynthesis;
  if (synth && !synth.__v19) {
    const origSpeak = synth.speak.bind(synth);
    synth.speak = function (u) {
      if (get(K.voice, '1') !== '1') return;
      try { u.rate = parseFloat(get(K.rate, '1')) || 1; } catch (e) {}
      return origSpeak(u);
    };
    synth.__v19 = true;
  }

  function ensureModal() {
    let m = document.getElementById('pos-settings-modal'); if (m) return m;
    m = document.createElement('div'); m.id = 'pos-settings-modal';
    m.innerHTML = '<div class="pos-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:18px">🎨 ปรับแต่งเสียงและหน้าจอ</b><button id="pvs-close" style="border:0;background:#e2e8f0;border-radius:10px;padding:8px 14px;font-weight:700">ปิด</button></div>' +
      '<div class="row"><div><b>🔔 เสียงแจ้งเตือน</b><div style="font-size:12px;color:#64748b">เสียงตอนเพิ่มสินค้าและขายสำเร็จ</div></div><input id="pvs-sound" type="checkbox" style="width:24px;height:24px"></div>' +
      '<div class="row"><div><b>🗣️ เสียงพูดยอดเงิน</b><div style="font-size:12px;color:#64748b">พูดยอดรวมและเงินทอน</div></div><input id="pvs-voice" type="checkbox" style="width:24px;height:24px"></div>' +
      '<div class="row"><div><b>⏩ ความเร็วเสียงพูด</b></div><div><input id="pvs-rate" type="range" min="0.7" max="1.5" step="0.1" style="width:160px"> <span id="pvs-rate-v"></span></div></div>' +
      '<div class="row"><div><b>🖼️ พื้นหลัง</b></div><div class="seg" id="pvs-bg"></div></div>' +
      '<div class="row"><div><b>🔤 ขนาดตัวอักษร</b></div><div class="seg" id="pvs-font"></div></div>' +
      '<div class="row"><div><b>👆 ปุ่มใหญ่สำหรับสัมผัส</b><div style="font-size:12px;color:#64748b">เหมาะกับมือถือ/แท็บเล็ต</div></div><input id="pvs-touch" type="checkbox" style="width:24px;height:24px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button id="pvs-reset" style="flex:1;padding:12px;border-radius:12px;border:0;background:#fee2e2;color:#991b1b;font-weight:700">คืนค่าเริ่มต้น</button>' +
      '<button id="pvs-done" style="flex:1;padding:12px;border-radius:12px;border:0;background:#4f46e5;color:#fff;font-weight:800">เสร็จ</button></div></div>';
    document.body.appendChild(m);
    const seg = (id, key, opts) => {
      const box = document.getElementById(id);
      opts.forEach(([v, label]) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.v = v;
        b.onclick = () => { set(key, v); applyTheme(); refresh(); }; box.appendChild(b);
      });
    };
    seg('pvs-bg', K.bg, [['white','ขาว'],['cream','ครีม'],['sky','ฟ้า'],['mint','เขียว'],['slate','เข้ม']]);
    seg('pvs-font', K.font, [['normal','ปกติ'],['lg','ใหญ่'],['xl','ใหญ่มาก']]);
    document.getElementById('pvs-sound').onchange = e => { set(K.sound, e.target.checked ? '1' : '0'); refresh(); };
    document.getElementById('pvs-voice').onchange = e => { set(K.voice, e.target.checked ? '1' : '0'); refresh(); };
    document.getElementById('pvs-rate').oninput = e => { set(K.rate, e.target.value); refresh(); };
    document.getElementById('pvs-touch').onchange = e => { set(K.touch, e.target.checked ? '1' : '0'); applyTheme(); refresh(); };
    document.getElementById('pvs-reset').onclick = () => { Object.values(K).forEach(k => localStorage.removeItem(k)); localStorage.setItem(K.sound,'1'); applyTheme(); refresh(); };
    document.getElementById('pvs-done').onclick = () => { m.style.display = 'none'; };
    document.getElementById('pvs-close').onclick = () => { m.style.display = 'none'; };
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    return m;
  }
  function refresh() {
    const m = document.getElementById('pos-settings-modal'); if (!m) return;
    document.getElementById('pvs-sound').checked = get(K.sound, '1') !== '0';
    document.getElementById('pvs-voice').checked = get(K.voice, '1') === '1';
    document.getElementById('pvs-rate').value = get(K.rate, '1');
    document.getElementById('pvs-rate-v').textContent = Number(get(K.rate, '1')).toFixed(1) + '×';
    document.getElementById('pvs-touch').checked = get(K.touch, '0') === '1';
    ['pvs-bg','pvs-font'].forEach(id => {
      const key = id === 'pvs-bg' ? K.bg : K.font; const def = id === 'pvs-bg' ? 'white' : 'normal';
      document.querySelectorAll('#' + id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === get(key, def)));
    });
  }
  function openSettings() { ensureModal(); refresh(); document.getElementById('pos-settings-modal').style.display = 'block'; }
  window.posOpenSettings = openSettings;
  window.posHub.register({ id: 'screen', group: 'look', icon: '🎨', label: 'ปรับแต่งหน้าจอ', hint: 'สี • ขนาดตัวอักษร', run: openSettings });

  applyTheme();
})();
