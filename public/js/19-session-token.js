
(function () {
  'use strict';
  const KEY = 'pos_session';
  window.posSessionToken = function () {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s || !s.token || !(s.exp > Date.now())) return null;
      return s.token;
    } catch (e) { return null; }
  };
  function saveSession(token, userId, ttlSec) {
    localStorage.setItem(KEY, JSON.stringify({ token, userId, exp: Date.now() + ttlSec * 1000 }));
  }
  // ขอ token หลังล็อกอินสำเร็จ (ถ้าออฟไลน์หรือเซิร์ฟเวอร์ไม่รู้จักผู้ใช้ จะใช้กติกาเดิมแทน)
  async function obtainSession(u) {
    const c = window.getSupabaseClient?.();
    if (!c || !u || !u.pinHash || u.role === 'OWNER') return;   // เจ้าของร้านไม่ได้ซิงก์ไปยัง app_users
    try {
      const { data, error } = await c.rpc('employee_login', { p_app_user_id: toUUID(u.id), p_pin_hash: u.pinHash });
      if (!error && data && data.ok) saveSession(data.session, u.id, data.expires_in_sec || 43200);
      else localStorage.removeItem(KEY);
    } catch (e) { /* ออฟไลน์: ไม่มี token ใช้กติกาเดิม */ }
  }
  posHooks.on('auth:login', u => obtainSession(u));   // ล็อกอินสำเร็จ -> ขอ token
  posHooks.on('auth:lock', () => endSession());
  async function endSession() {
    const t = window.posSessionToken();
    localStorage.removeItem(KEY);
    if (!t) return;
    try { await window.getSupabaseClient?.()?.rpc('employee_logout', { p_session: t }); } catch (e) {}
  }

})();
