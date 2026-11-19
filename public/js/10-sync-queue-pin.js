
// ============================================================================
// คิวซิงค์ (sync queue), ค่าตั้งต้นสต็อก/หนี้ (seeding), PIN แบบใหม่
// แก้ตามรายงานตรวจสอบ: ไม่มี "fallback เขียนบิลตรง" อีกต่อไป ทุกธุรกรรมไปทาง RPC บนเซิร์ฟเวอร์
// เท่านั้น (create_sale / process_return / receive_customer_payment / adjust_stock / receive_goods)
// ส่งไม่สำเร็จจะค้างในคิว (db.syncQueue) แล้วลองใหม่เอง — เซิร์ฟเวอร์ปฏิเสธจริง (เช่นเกินวงเงิน)
// จะติดสถานะ failed และแจ้งเตือน ไม่ถูกข้ามเงียบๆ
// ============================================================================
(function () {
  'use strict';

  const client = () => (window.getSupabaseClient ? window.getSupabaseClient() : null);
  const errMsg = (e) => String((e && (e.message || e.details)) || e || 'ไม่ทราบสาเหตุ');
  const isNetworkError = (e) =>
    /Failed to fetch|NetworkError|Network request failed|fetch failed|Load failed|timeout|ERR_INTERNET/i.test(errMsg(e)) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);
  const isMissingRpc = (e) => (e && e.code === 'PGRST202') || /Could not find the function/i.test(errMsg(e));

  // ---------- helpers: เลขเอกสาร / ยอดรวม / สัดส่วนคืนเงิน ----------
  window.getDeviceId = function () {
    let d = null;
    try { d = localStorage.getItem('pos_device_id'); } catch (e) { /* storage blocked */ }
    if (!d) {
      try {
        d = Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      } catch (e) { d = Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, '0'); }
      try { localStorage.setItem('pos_device_id', d); } catch (e) { /* ignore */ }
    }
    return d;
  };

  // วันที่ตามเวลาไทย (Asia/Bangkok) ไม่ว่าอุปกรณ์จะตั้งโซนเวลาไว้เป็นอะไร — YYYYMMDD
  window.todayKey = function (date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(date || new Date());
    return parts.replace(/-/g, '');
  };

  // คำนวณยอดจาก state ตรงๆ (ไม่อ่านข้อความบนหน้าจอ) — pure function ทดสอบได้
  window.calcCartTotals = function (items, discountInput, discountType) {
    const r2 = (n) => Number(Math.round(Number(parseFloat(n) + 'e2')) + 'e-2') || 0;
    const subtotal = (items || []).reduce((s, i) => r2(s + i.qty * i.price), 0);
    const di = parseFloat(discountInput) || 0;
    let d = discountType === 'PERCENT' ? r2((subtotal * di) / 100) : r2(di);
    if (d < 0) d = 0;
    if (d > subtotal) d = subtotal;
    return { subtotal, discountAmt: d, grandTotal: r2(subtotal - d) };
  };

  // สัดส่วนที่ลูกค้าจ่ายจริงเทียบกับราคารายการ (ใช้หักส่วนลดตอนคืนเงิน) — เท่ากับสูตรที่ process_return ใช้ฝั่งเซิร์ฟเวอร์
  window.billRefundRatio = function (bill) {
    const sum = (bill.items || []).reduce((s, i) => s + i.qty * i.price, 0);
    const paid = +bill.total;
    if (!(sum > 0) || !isFinite(paid) || paid >= sum) return 1;
    return Math.max(0, paid / sum);
  };

  window.isPreventNegativeStock = function () { return !!(window.db && db.settings && db.settings.preventNegativeStock); };

  // ---------- คิวซิงค์ ----------
  window.enqueueSync = function (op, noFlush) {
    db.syncQueue = db.syncQueue || [];
    op.id = op.id || ('Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    // แนบ token ของผู้ทำรายการ เพื่อให้เซิร์ฟเวอร์ตรวจสิทธิ์ได้
    if (['adjust', 'sale', 'delete', 'return'].includes(op.type) && op.payload && !op.payload.sessionToken) {
      const tk = window.posSessionToken?.();
      if (tk) op.payload.sessionToken = tk;
    }
    // Preserve the local actor at creation time. The server-side session must map to this
    // exact app_users.id before an operation is sent; never sync another cashier's queue
    // merely because an OWNER session remains active on the same device.
    if (!op.actorAppUserId) op.actorAppUserId = db.activeUser?.id || null;
    op.status = 'pending'; op.tries = 0; op.createdAt = Date.now();
    db.syncQueue.push(op);
    if (window.persist) window.persist();
    window.refreshSyncBadge();
    if (!noFlush) setTimeout(() => window.flushSyncQueue(), 0);
  };

  window.syncQueueStats = function () {
    const q = (window.db && db.syncQueue) || [];
    return { pending: q.filter(o => !['failed','needs_review'].includes(o.status)).length, failed: q.filter(o => o.status === 'failed').length, needsReview: q.filter(o => o.status === 'needs_review').length };
  };

  window.describeSyncFailures = function () {
    const labels = { sale: 'บิลขาย', return: 'คืนสินค้า', payment: 'รับชำระหนี้', adjust: 'ปรับสต็อก', receive: 'รับสินค้าเข้า', delete: 'ลบสินค้า' };
    return ((db.syncQueue || []).filter(o => o.status === 'failed'))
      .map(o => `• ${labels[o.type] || o.type} ${o.payload?.billId || o.payload?.returnRef || o.payload?.receiptId || ''}: ${o.lastError || ''}`)
      .join('\n');
  };

  window.refreshSyncBadge = function () {
    const s = window.syncQueueStats();
    const el = document.getElementById('sync-queue-badge');
    if (!el) return;
    if (!s.pending && !s.failed && !s.needsReview) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const parts = []; if (s.needsReview) parts.push(`ต้องตรวจสอบ ${s.needsReview}`); if (s.failed) parts.push(`ส่งไม่ผ่าน ${s.failed}`); if (s.pending) parts.push(`รอส่ง ${s.pending}`);
    el.textContent = parts.join(' • ');
    el.className = 'text-[10px] font-bold px-2 py-1 rounded-lg ' + ((s.failed || s.needsReview) ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700');
    el.onclick = () => { if (s.failed || s.needsReview) { const review = (db.syncQueue || []).filter(o => o.status === 'needs_review').map(o => `• ${o.type || 'รายการ'} ${o.id}: ${o.lastError || 'ต้องตรวจสอบผู้ทำรายการ'}`).join('\n'); window.showAlert && window.showAlert('รายการซิงก์ที่ต้องตรวจสอบ', (review ? 'รายการเก่าที่ไม่มีผู้ทำรายการยืนยัน (ยังไม่ส่ง):\n' + review + '\n\n' : '') + (window.describeSyncFailures() || 'ไม่มีรายการที่ส่งไม่ผ่าน'), true); } };
  };

  // ---------- ตัวช่วยบนเซิร์ฟเวอร์ ----------
  async function ensureUser(c, uid) {
    if (!uid) return;
    const u = (db.users || []).find(x => x.id === uid);
    if (u && u.role === 'OWNER') return; // Owner row is created only by bootstrap_first_owner.
    if (u && u.pinHash) {
      const { error } = await c.from('app_users').upsert(
        [{ id: toUUID(u.id), name: u.name, pin: u.pinHash, role: u.role || 'CASHIER', permissions: u.permissions || [], is_active: true }],
        { onConflict: 'id' });
      if (error) throw error;
    }
  }
  window._shiftRow = function (s) {
    return {
      id: toUUID(s.id), opened_by: (s.userId || db.activeUser?.id) ? toUUID(s.userId || db.activeUser.id) : null,
      opened_at: new Date(s.startTime).toISOString(),
      closed_at: s.endTime ? new Date(s.endTime).toISOString() : null,
      opening_cash: roundAmt(s.openingCash), closing_cash: s.cashOnHand != null ? roundAmt(s.cashOnHand) : null,
      status: s.endTime ? 'CLOSED' : 'OPEN'
    };
  };
  async function ensureShift(c, shiftId) {
    if (!shiftId) return;
    const s = (db.shifts || []).find(x => x.id === shiftId) || (db.currentShift && db.currentShift.id === shiftId ? db.currentShift : null);
    if (!s) return;
    const { error } = await c.from('shifts').upsert([window._shiftRow(s)], { onConflict: 'id' });
    if (error) throw error;
  }
  // ใช้จาก flow ปิดกะเท่านั้น: คืน UUID เดียวกับที่ upsert ไป Supabase
  window.ensureShiftForClose = async function(shiftId) {
    const c = client();
    if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase client');
    if (!shiftId) throw new Error('ไม่พบรหัสกะ');
    const uuid = toUUID(shiftId);
    await ensureShift(c, shiftId);
    return uuid;
  };
  async function ensureCustomer(c, cid) {
    if (!cid || cid === 'GENERAL') return;
    const cu = db.customers && db.customers[cid];
    if (!cu) return;
    const { error } = await c.from('customers').upsert([{
      id: toUUID(cu.id), name: cu.name, phone: cu.phone || null, address: cu.address || '',
      credit_limit: roundAmt(cu.creditLimit ?? 50000)
    }], { onConflict: 'id' });
    if (error) throw error;
    await window._seedDebts(c, [cu]);
  }

  // ---------- ค่าตั้งต้น (seed) ของสต็อก/หนี้ ----------
  // ส่งค่าจากเครื่องขึ้นไป "ครั้งเดียว" ต่อสินค้า/ลูกค้า (เซิร์ฟเวอร์ไม่ทับถ้า seeded แล้ว)
  // หักรายการที่ค้างอยู่ในคิวออกก่อน เพราะรายการเหล่านั้นจะถูกส่งผ่าน RPC แล้วเซิร์ฟเวอร์ปรับเอง (กันนับซ้ำ)
  function pendingDeltas() {
    const stock = {}, debt = {};
    (db.syncQueue || []).forEach(op => {
      const p = op.payload || {};
      if (op.type === 'sale') {
        const b = (db.bills || []).find(x => x.id === p.billId); if (!b) return;
        (b.items || []).forEach(i => { if (i.variantId) { const k = toUUID(i.variantId); stock[k] = (stock[k] || 0) - i.qty * (i.multiplier || 1); } });
        if (b.method === 'CREDIT' && b.customerId && b.customerId !== 'GENERAL') debt[b.customerId] = (debt[b.customerId] || 0) + (+b.total || 0);
      } else if (op.type === 'return') {
        (p.restock || []).forEach(r => { if (r.variantId) { const k = toUUID(r.variantId); stock[k] = (stock[k] || 0) + r.qty; } });
        if (p.isCredit && p.customerId) debt[p.customerId] = (debt[p.customerId] || 0) - (+p.refund || 0);
      } else if (op.type === 'payment') {
        debt[p.customerId] = (debt[p.customerId] || 0) - (+p.amount || 0);
      } else if (op.type === 'receive') {
        const r = (db.purchaseOrders || []).find(x => x.id === p.receiptId); if (!r) return;
        (r.items || []).forEach(x => { const v = ((db.products[x.productId]?.variants || []).find(y => y.id === x.variantId) || db.products[x.productId]?.variants?.[0]); if (v && v.id) { const k = toUUID(v.id); stock[k] = (stock[k] || 0) + (+x.qty || 0); } });
      }
    });
    return { stock, debt };
  }
  window._pendingDeltas = pendingDeltas;

  window._seedStock = async function (c, productsList) {
    const delta = pendingDeltas().stock, items = [], refs = [];
    productsList.forEach(p => (p.variants || []).forEach(v => {
      if (v.id && !v._seeded) {
        const id = toUUID(v.id);
        items.push({ variant_id: id, stock: roundStock((+v.stock || 0) - (delta[id] || 0)) }); refs.push(v);
      }
    }));
    for (let i = 0; i < items.length; i += 400) {
      const { error } = await c.rpc('seed_variant_stock', { p_items: items.slice(i, i + 400) });
      if (error) {
        if (isMissingRpc(error)) { window._schemaOutdated = true; console.warn('seed_variant_stock ไม่พบบนเซิร์ฟเวอร์ — ยังไม่ได้รัน migration 0002'); return; }
        throw error;
      }
      refs.slice(i, i + 400).forEach(v => { v._seeded = true; });
    }
    if (items.length && window.persist) window.persist();
  };

  window._seedDebts = async function (c, customers) {
    const delta = pendingDeltas().debt, items = [], refs = [];
    customers.forEach(cu => {
      if (cu && cu.id && !cu._debtSeeded) {
        items.push({ customer_id: toUUID(cu.id), debt: roundAmt((+cu.debt || 0) - (delta[cu.id] || 0)) }); refs.push(cu);
      }
    });
    for (let i = 0; i < items.length; i += 400) {
      const { error } = await c.rpc('seed_customer_debt', { p_items: items.slice(i, i + 400) });
      if (error) {
        if (isMissingRpc(error)) { window._schemaOutdated = true; return; }
        throw error;
      }
      refs.slice(i, i + 400).forEach(cu => { cu._debtSeeded = true; });
    }
    if (items.length && window.persist) window.persist();
  };

  // ---------- ตัวรันแต่ละชนิดของรายการในคิว ----------
  async function runSale(c, p) {
    const bill = (db.bills || []).find(b => b.id === p.billId);
    if (!bill) return;                                  // บิลถูกลบไปแล้ว — ทิ้งรายการนี้
    await ensureUser(c, bill.cashierId);
    await ensureShift(c, bill.shiftId);
    if (bill.customerId && bill.customerId !== 'GENERAL') await ensureCustomer(c, bill.customerId);
    const items = (bill.items || []).map(i => ({
      product_id: i.id ? toUUID(i.id) : null,
      variant_id: i.variantId ? toUUID(i.variantId) : null,
      fraction_id: i.fractionId ? toUUID(i.fractionId) : null,
      item_name: i.name, quantity: +i.qty || 1, unit_price: +i.price || 0
    }));
    const { data, error } = await c.rpc('create_sale', {
      p_bill_number: bill.id,
      p_customer_id: (bill.customerId && bill.customerId !== 'GENERAL') ? toUUID(bill.customerId) : null,
      p_user_id: bill.cashierId ? toUUID(bill.cashierId) : null,
      p_shift_id: bill.shiftId ? toUUID(bill.shiftId) : null,
      p_discount_amount: +bill.discount || 0,
      p_tax_amount: +bill.vatAmount || 0,
      p_payment_method: bill.method || 'CASH',
      p_items: items,
      p_allow_negative: !window.isPreventNegativeStock(),
      p_tax_mode: bill.taxMode || 'NONE',
      p_expected_total: +bill.total,
      p_created_at: (bill.time ? new Date(bill.time).toISOString() : null),
      p_session: p.sessionToken || null
    });
    if (error) throw error;
    bill._syncedViaRPC = true; delete bill._rpcPending;
    bill._serverBillId = (data && data.bill_id) || null;
  }

  async function runReturn(c, p) {
    const bill = (db.bills || []).find(b => b.id === p.billId);
    if (!bill) return;
    if (!bill._serverBillId && !bill._legacy) throw new Error('บิลต้นทาง ' + p.billId + ' ยังไม่ถูกส่งขึ้นเซิร์ฟเวอร์');
    await ensureShift(c, p.shiftId);
    const { error } = await c.rpc('process_return', {
      p_bill_id: bill._serverBillId || toUUID(bill.id),
      p_items: (p.items || []).map(i => ({
        variant_id: i.variant_id ? toUUID(i.variant_id) : null,
        fraction_id: i.fraction_id ? toUUID(i.fraction_id) : null,
        quantity: +i.quantity || 0,
        unit_price: +i.unit_price || 0
      })),
      p_full_return: !!p.fully, p_return_ref: p.returnRef,
      p_shift_id: p.shiftId ? toUUID(p.shiftId) : null,
      p_session: p.sessionToken || null   // ให้เซิร์ฟเวอร์ตรวจสิทธิ์ RETURN รายบุคคล (PATCH 014)
    });
    if (error) throw error;
  }

  async function runPayment(c, p) {
    await ensureCustomer(c, p.customerId);
    await ensureShift(c, p.shiftId);
    const { error } = await c.rpc('receive_customer_payment', {
      p_customer_id: toUUID(p.customerId), p_amount: +p.amount,
      p_shift_id: p.shiftId ? toUUID(p.shiftId) : null, p_op_ref: p.opRef,
      p_payment_method: String(p.paymentMethod || p.method || 'CASH').toUpperCase(),
      p_reference: p.reference || p.transferReference || null
    });
    if (error) throw error;
  }

  async function runAdjust(c, p) {
    const { error } = await c.rpc('adjust_stock', {
      p_variant_id: toUUID(p.variantId), p_mode: 'SET', p_value: +p.value, p_reason: p.reason || null, p_op_ref: p.opRef,
      p_session: p.sessionToken || null
    });
    if (error) throw error;
    // ตั้ง flag seeded ฝั่งเครื่อง
    Object.values(db.products || {}).forEach(pr => (pr.variants || []).forEach(v => { if (v.id === p.variantId) v._seeded = true; }));
  }

  async function runReceive(c, p) {
    const r = (db.purchaseOrders || []).find(x => x.id === p.receiptId);
    if (!r) return;
    const sup = db.suppliers && db.suppliers[r.supplierId];
    if (sup) {
      const { error: se } = await c.from('suppliers').upsert([{ id: toUUID(r.supplierId), name: sup.name, phone: sup.phone || null, address: sup.address || '' }], { onConflict: 'id' });
      if (se) throw se;
    }
    const items = (r.items || []).map(x => {
      const v = ((db.products[x.productId]?.variants || []).find(y => y.id === x.variantId) || db.products[x.productId]?.variants?.[0]);
      return { product_id: toUUID(x.productId), variant_id: v && v.id ? toUUID(v.id) : null, quantity: +x.qty, unit_cost: +x.cost || 0 };
    });
    const { data, error } = await c.rpc('receive_goods', {
      p_client_ref: r.id, p_supplier_id: toUUID(r.supplierId), p_doc_ref: r.docRef || null,
      p_terms: r.terms || 30, p_received_at: r.receivedAt || null, p_items: items,
      p_ap_id: p.apId ? toUUID(p.apId) : null, p_pay_now: !!p.payNow
    });
    if (error) throw error;
    const ap = (db.cashLedger || []).find(x => x.id === p.apId);
    if (ap && data && data.po_id) ap._serverPurchaseOrderId = data.po_id;
  }

  async function runDelete(c, p) {
    const { error } = await c.rpc('delete_entity', { p_kind: p.kind, p_id: toUUID(p.id), p_note: p.note || null, p_session: p.sessionToken || null });
    if (error && !/ไม่พบ|not found/i.test(errMsg(error))) throw error;   // ไม่พบ = ถูกลบ/ไม่เคยขึ้นเซิร์ฟเวอร์ ถือว่าเสร็จ
  }

  const RUNNERS = { sale: runSale, return: runReturn, payment: runPayment, adjust: runAdjust, receive: runReceive, delete: runDelete };

  let flushing = null;
  window.flushSyncQueue = function (quiet) {
    if (flushing) return flushing;
    flushing = (async () => {
      // Avoid auth/network calls while the browser reports offline. Keep every op queued.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return window.syncQueueStats();
      const c = client();
      if (!c) return window.syncQueueStats();
      let sess;
      try { sess = await c.auth.getSession(); }
      catch (e) { if (isNetworkError(e)) return window.syncQueueStats(); throw e; }
      if (!(sess && sess.data && sess.data.session)) return window.syncQueueStats();
      db.syncQueue = db.syncQueue || [];
      const _actorOk = new Set(); let _catalogPushed = false, _sinceSave = 0;   // ตรวจผู้ทำรายการครั้งเดียวต่อรอบ ไม่ใช่ทุกรายการ (เดิม 2-3 คำขอต่อบิล)
      for (const op of db.syncQueue.slice()) {
        if (op.status === 'failed') continue;
        // Fail closed: old queue entries without actor provenance cannot safely be attributed.
        // A browser PIN selection is not a Supabase identity; require the current Auth session
        // to map to the same active app_users row as the actor captured when the operation began.
        try {
          if (!op.actorAppUserId) { op.lastError = 'คิวเดิมไม่มีข้อมูลผู้ทำรายการ จึงพักไว้เพื่อป้องกันการบันทึกผิดบัญชี'; op.status = 'needs_review'; if (window.persist) window.persist(); continue; }
          if (!_actorOk.has(op.actorAppUserId)) {
          const { data: authUserData, error: authUserError } = await c.auth.getUser();
          if (authUserError || !authUserData?.user) throw new Error('ตรวจสอบตัวตน Supabase ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่');
          const { data: actor, error: actorError } = await c.from('app_users')
            .select('id,auth_user_id,is_active').eq('auth_user_id', authUserData.user.id).maybeSingle();
          if (actorError) throw new Error('ตรวจสอบบัญชีผู้ทำรายการไม่สำเร็จ: ' + actorError.message);
          if (!actor || actor.is_active !== true) {
            throw new Error('บัญชีที่เข้าสู่ระบบยังไม่ได้รับสิทธิ์ใช้งาน (ไม่พบใน app_users)');
          }
          if (actor.id !== op.actorAppUserId) {
            // เครื่องหน้าร้านล็อกอินด้วยบัญชีเจ้าของ/ผู้จัดการ แล้วพนักงานใช้ PIN: ผู้ทำรายการต้องเป็นพนักงาน active ในฐานข้อมูล
            const { data: opActor, error: opErr } = await c.from('app_users').select('id,is_active').eq('id', op.actorAppUserId).maybeSingle();
            if (opErr || !opActor || opActor.is_active !== true) {
              throw new Error('ไม่พบพนักงานผู้ทำรายการบนเซิร์ฟเวอร์ (ต้องใช้บัญชีเจ้าของ/ผู้จัดการล็อกอินที่เครื่องนี้ และซิงค์รายชื่อพนักงานก่อน)');
            }
          }
          _actorOk.add(op.actorAppUserId);
          }
        } catch (actorCheckError) {
          op.lastError = errMsg(actorCheckError);
          op.status = 'failed';
          console.warn('sync actor verification failed', op.type, op.lastError);
          if (window.persist) window.persist();
          continue;
        }
        let retriedAfterCatalog = false;
        for (;;) {
          try {
            await RUNNERS[op.type](c, op.payload || {});
            db.syncQueue = db.syncQueue.filter(x => x.id !== op.id);
            break;
          } catch (err) {
            op.lastError = errMsg(err);
            if (isNetworkError(err)) { if (window.persist) window.persist(); return window.syncQueueStats(); }   // ออฟไลน์: หยุดแล้วลองรอบหน้า
            op.tries = (op.tries || 0) + 1;
            if (!retriedAfterCatalog && !_catalogPushed && op.type !== 'delete') {   // อาจเพราะสินค้า/ลูกค้ายังไม่ขึ้นเซิร์ฟเวอร์ — ซิงค์แคตตาล็อกก่อนลองอีกครั้ง
              retriedAfterCatalog = true; _catalogPushed = true;   // ดันแคตตาล็อกทั้งร้านอย่างมากรอบละครั้ง (เดิมทุกรายการที่ล้มเหลว)
              try { await window.syncProductsToSupabase(true); } catch (e) { /* ตกไปที่ failed ด้านล่างถ้ายังไม่ผ่าน */ }
              continue;
            }
            op.status = 'failed';
            console.warn('sync op failed', op.type, op.lastError);
            break;
          }
        }
        if (++_sinceSave >= 10) { _sinceSave = 0; if (window.persist) window.persist(); }   // บันทึกทั้งฐานทุก 10 รายการ ไม่ใช่ทุกรายการ
      }
      if (window.persist) window.persist();
      return window.syncQueueStats();
    })().finally(() => { flushing = null; window.refreshSyncBadge(); });
    return flushing;
  };

  window.retryFailedSyncOps = function () {
    (db.syncQueue || []).forEach(o => { if (o.status === 'failed') { o.status = 'pending'; o.tries = 0; } });
    if (window.persist) window.persist();
  };

  window.checkServerSchema = async function () {
    const c = client(); if (!c) return null;
    try {
      const { data, error } = await c.rpc('pos_schema_version');
      if (error) throw error;
      return data;
    } catch (e) { return isMissingRpc(e) ? 0 : null; }
  };

  // ลองส่งเมื่อกลับมาออนไลน์ และทุก 60 วินาที
  window.addEventListener('online', () => window.flushSyncQueue());
  setInterval(() => { if (navigator.onLine !== false && (db.syncQueue || []).some(o => !['failed','needs_review'].includes(o.status))) window.flushSyncQueue().catch(e => console.warn('Background sync deferred:', errMsg(e))); }, 60000);

  // ---------- PIN: PBKDF2 + salt, จำกัดจำนวนครั้งที่ลองผิด ----------
  const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));
  const PBKDF2_ITER = 150000;
  async function pbkdf2(pin, saltBytes, iter) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' }, key, 256);
    return new Uint8Array(bits);
  }
  window.makePinHash = async function (pin) {
    if (window.crypto && crypto.subtle) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      return 'pbkdf2$' + PBKDF2_ITER + '$' + hex(salt) + '$' + hex(await pbkdf2(pin, salt, PBKDF2_ITER));
    }
    return window.hashPin(pin);   // เบราว์เซอร์ไม่มี crypto.subtle (เช่นเปิดผ่าน http) — ถอยกลับเป็นแบบเดิม
  };
  window.verifyPinHash = async function (pin, stored) {
    if (!stored) return false;
    if (stored.startsWith('pbkdf2$')) {
      if (!(window.crypto && crypto.subtle)) return false;
      const [, iter, salt, h] = stored.split('$');
      return hex(await pbkdf2(pin, unhex(salt), parseInt(iter, 10))) === h;
    }
    return (await window.hashPin(pin)) === stored;   // รูปแบบเดิม (SHA-256) — จะถูกอัปเกรดเมื่อล็อกอินสำเร็จ
  };
  window.WEAK_PINS = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '1212', '2580', '0123',
    '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '123456', '654321', '121212', '123123', '112233', '123321', '102030', '147258', '159357', '012345', '456789'];
})();

// ---- boot: เตรียมคิว, ย้ายบิลเก่า, ลงทะเบียน service worker ----
(function () {
  db.syncQueue = db.syncQueue || [];
  // บิลที่สร้างก่อนอัปเกรด (ไม่มีธง) ถือว่าซิงค์แล้ว — ก่อนอัปเกรดให้กดซิงค์ด้วยเวอร์ชันเดิมให้เรียบร้อยก่อน
  (db.bills || []).forEach(b => { if (!b._syncedViaRPC && !b._rpcPending) { b._syncedViaRPC = true; b._legacy = true; } });
  window.refreshSyncBadge();
  setTimeout(() => window.flushSyncQueue(), 3000);
  // Service Worker registration is centralized in offline-readiness-runtime below.
})();
