
    (function () {
      'use strict';
      var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
      var num = function (v) { return Number(v) || 0; };
      var money = function (v) { return '฿' + num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
      var todayTH = function () { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); };
      var addDays = function (iso, n) { var d = new Date(iso + 'T00:00:00+07:00'); d.setUTCDate(d.getUTCDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); };
      var lastDaily = [];

      window.setReportRange = function (kind) {
        var t = todayTH(), from = t;
        if (kind === '7d') from = addDays(t, -6);
        if (kind === 'month') from = t.slice(0, 8) + '01';
        document.getElementById('report-from').value = from;
        document.getElementById('report-to').value = t;
        window.renderReport();
      };

      async function fetchAll(makeQuery, maxPages) {
        var out = [], page = 1000, max = Math.max(1, Number(maxPages) || 250);
        for (var i = 0; i < max; i++) {
          var r = await makeQuery().range(i * page, i * page + page - 1);
          if (r.error) throw r.error;
          var rows = r.data || []; out = out.concat(rows);
          if (rows.length < page) return out;
        }
        throw new Error('รายงานมีข้อมูลเกินขีดจำกัด ' + (max * page).toLocaleString('th-TH') + ' แถว กรุณาจำกัดช่วงวันที่');
      }

      function row(label, value, cls) {
        return '<div class="flex justify-between text-xs py-1 border-b"><span class="text-slate-500">' + label + '</span><b class="tabular-nums ' + (cls || 'text-slate-800') + '">' + value + '</b></div>';
      }
      function card(title, inner) {
        return '<div class="bg-white p-4 rounded-3xl border shadow-sm"><h4 class="text-sm font-extrabold text-slate-800 border-b pb-2 mb-2">' + title + '</h4>' + inner + '</div>';
      }

      window.renderReport = async function () {
        var body = document.getElementById('report-body');
        if (!body) return;
        var c = window.getSupabaseClient && window.getSupabaseClient();
        if (!c) { body.innerHTML = card('ยังไม่ได้เชื่อมต่อ', '<p class="text-xs text-slate-500">ตั้งค่า Supabase และเข้าสู่ระบบก่อน รายงานดึงจากฐานข้อมูลกลางเพื่อให้ตัวเลขตรงกับบัญชี</p>'); return; }
        if (navigator.onLine === false) { body.innerHTML = card('ออฟไลน์', '<p class="text-xs text-slate-500">รายงานต้องใช้อินเทอร์เน็ต</p>'); return; }
        var fromEl = document.getElementById('report-from'), toEl = document.getElementById('report-to');
        if (!fromEl.value || !toEl.value) { fromEl.value = fromEl.value || todayTH(); toEl.value = toEl.value || todayTH(); }
        var from = fromEl.value, to = toEl.value;
        if (from > to) { body.innerHTML = card('ช่วงวันที่ไม่ถูกต้อง', '<p class="text-xs text-rose-600">วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด</p>'); return; }
        var startISO = new Date(from + 'T00:00:00+07:00').toISOString();
        var endISO = new Date(addDays(to, 1) + 'T00:00:00+07:00').toISOString();
        body.innerHTML = '<p class="text-center text-xs font-bold text-slate-400 py-6">กำลังโหลดรายงาน…</p>';
        try {
          var pending = ((window.db && window.db.syncQueue) || []).filter(function (o) { return o.status !== 'done'; }).length;
          var res = await Promise.all([
            fetchAll(function () { return c.from('v_daily_sales').select('*').gte('day', from).lte('day', to).order('day', { ascending: false }); }, 5),
            fetchAll(function () { return c.from('bills').select('id,payment_method,total,tax_amount,tax_mode,created_at').gte('created_at', startISO).lt('created_at', endISO).order('created_at'); }, 30),
            fetchAll(function () { return c.from('v_shift_summary').select('*').gte('opened_at', startISO).lt('opened_at', endISO).order('opened_at', { ascending: false }); }, 5),
            fetchAll(function () { return c.from('v_customer_ar').select('name,debt').order('debt', { ascending: false }); }, 5),
            fetchAll(function () { return c.from('v_ap_open').select('supplier,amount,due_date').order('due_date'); }, 5),
            fetchAll(function () { return c.from('v_stock_valuation').select('stock_value').order('variant_id'); }, 30)
          ]);
          var daily = res[0], bills = res[1], shifts = res[2], ar = res[3], ap = res[4], stock = res[5];
          var zc = await c.from('product_variants').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('cost_price', 0);
          var zeroCost = (zc && !zc.error && typeof zc.count === 'number') ? zc.count : 0;
          lastDaily = daily;
          var t = { bills: 0, gross: 0, disc: 0, net: 0, refunds: 0, cogs: 0, profit: 0 };
          daily.forEach(function (d) { t.bills += num(d.bills); t.gross += num(d.gross_sales); t.disc += num(d.discounts); t.net += num(d.net_sales); t.refunds += num(d.refunds); t.cogs += num(d.cogs); t.profit += num(d.gross_profit); });
          var netAfter = t.net - t.refunds;
          var margin = netAfter > 0 ? (t.profit / netAfter * 100) : 0;
          var byMethod = {}, vat = 0;
          bills.forEach(function (b) { var m = b.payment_method || 'CASH'; byMethod[m] = (byMethod[m] || 0) + num(b.total); if (b.tax_mode && b.tax_mode !== 'NONE') vat += num(b.tax_amount); });
          var methodName = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', QR: 'QR/พร้อมเพย์', CARD: 'บัตร', CREDIT: 'ขายเชื่อ (ตั้งลูกหนี้)' };
          var arTotal = ar.reduce(function (a, x) { return a + num(x.debt); }, 0);
          var apTotal = ap.reduce(function (a, x) { return a + num(x.amount); }, 0);
          var today = todayTH();
          var apOver = ap.filter(function (x) { return x.due_date && x.due_date < today; });
          var stockValue = stock.reduce(function (a, x) { return a + num(x.stock_value); }, 0);

          var html = '';
          if (pending) html += '<div class="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs font-bold text-amber-700">⚠️ มี ' + pending + ' รายการรอซิงค์ ยังไม่รวมในรายงานนี้ — ซิงค์ให้เสร็จก่อนแล้วกด “แสดงรายงาน” อีกครั้ง</div>';
          if (zeroCost > 0) html += '<div class="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs font-bold text-amber-700">⚠️ มีสินค้า ' + zeroCost.toLocaleString('th-TH') + ' รายการที่ยังไม่มีราคาทุน (ทุน = 0) — ต้นทุนขายและกำไรขั้นต้นในรายงานนี้จะสูงเกินจริง กรอกทุนในหน้าแก้ไขสินค้าหรือรับสินค้าเข้าด้วยราคาซื้อจริง</div>';
          html += card('สรุปยอดขาย ' + esc(from) + ' ถึง ' + esc(to),
            row('จำนวนบิล', t.bills.toLocaleString('th-TH')) +
            row('ยอดขายก่อนลด', money(t.gross)) +
            row('ส่วนลด', '-' + money(t.disc), 'text-rose-600') +
            row('ยอดขายสุทธิ', money(t.net)) +
            row('คืนสินค้า/ยกเลิกบิล', '-' + money(t.refunds), 'text-rose-600') +
            row('ยอดขายหลังหักคืน', money(netAfter), 'text-indigo-600') +
            row('ต้นทุนขาย (ตามวันที่ขายจริง)', '-' + money(t.cogs), 'text-rose-600') +
            row('กำไรขั้นต้น', money(t.profit), t.profit >= 0 ? 'text-emerald-600' : 'text-rose-600') +
            row('อัตรากำไรขั้นต้น', margin.toFixed(1) + '%') +
            (vat > 0 ? row('ภาษีขายที่รวมในยอด (VAT)', money(vat)) : ''));
          html += card('แยกตามวิธีชำระ (ยอดบิล)',
            Object.keys(byMethod).length ? Object.keys(byMethod).sort().map(function (m) { return row(esc(methodName[m] || m), money(byMethod[m])); }).join('') : '<p class="text-xs text-slate-400">ไม่มีบิลในช่วงนี้</p>');
          html += card('ภาพรวม ณ ปัจจุบัน',
            row('ลูกหนี้ค้างชำระรวม (' + ar.length + ' ราย)', money(arTotal), arTotal > 0 ? 'text-rose-600' : undefined) +
            row('เจ้าหนี้ค้างจ่ายรวม (' + ap.length + ' ใบ)', money(apTotal), apTotal > 0 ? 'text-amber-600' : undefined) +
            row('เจ้าหนี้เกินกำหนดจ่าย', apOver.length + ' ใบ / ' + money(apOver.reduce(function (a, x) { return a + num(x.amount); }, 0)), apOver.length ? 'text-rose-600' : undefined) +
            row('มูลค่าสต็อกคงเหลือ (ตามต้นทุน)', money(stockValue)));
          if (ar.length) html += card('ลูกหนี้ค้างชำระ', ar.slice(0, 15).map(function (x) { return row(esc(x.name), money(x.debt), 'text-rose-600'); }).join('') + (ar.length > 15 ? '<p class="text-[10px] text-slate-400 pt-1">แสดง 15 รายแรกจาก ' + ar.length + '</p>' : ''));
          html += card('รายวัน <button onclick="window.exportReportCsv()" class="float-right text-[10px] text-indigo-600 font-bold underline">ดาวน์โหลด CSV</button>',
            daily.length ? daily.map(function (d) {
              return '<div class="flex justify-between text-[11px] py-1 border-b"><span class="font-bold text-slate-600">' + esc(d.day) + ' <span class="text-slate-400 font-normal">(' + num(d.bills) + ' บิล)</span></span><span class="tabular-nums"><b>' + money(d.net_after_returns) + '</b> <span class="' + (num(d.gross_profit) >= 0 ? 'text-emerald-600' : 'text-rose-600') + '">กำไร ' + money(d.gross_profit) + '</span></span></div>';
            }).join('') : '<p class="text-xs text-slate-400">ไม่มีข้อมูลในช่วงนี้</p>');
          html += card('ผลปิดกะ (เงินสดในลิ้นชัก)',
            shifts.length ? shifts.map(function (sh) {
              var closed = sh.status === 'CLOSED', v = num(sh.cash_variance);
              return '<div class="text-[11px] py-1.5 border-b"><div class="flex justify-between"><b class="text-slate-700">' + esc(new Date(sh.opened_at).toLocaleString('th-TH')) + '</b><span class="' + (closed ? 'text-slate-500' : 'text-amber-600') + ' font-bold">' + (closed ? 'ปิดแล้ว' : 'ยังเปิดอยู่') + '</span></div>' +
                '<div class="flex justify-between text-slate-500"><span>ควรมี ' + money(closed ? sh.expected_cash : sh.expected_now) + (closed ? ' • นับได้ ' + money(sh.closing_cash) : '') + '</span>' +
                (closed ? '<b class="' + (v === 0 ? 'text-emerald-600' : 'text-rose-600') + '">' + (v === 0 ? 'ตรง' : (v > 0 ? 'เกิน ' : 'ขาด ') + money(Math.abs(v))) + '</b>' : '') + '</div>' +
                (sh.close_note ? '<div class="text-slate-400">หมายเหตุ: ' + esc(sh.close_note) + '</div>' : '') + '</div>';
            }).join('') : '<p class="text-xs text-slate-400">ไม่มีกะในช่วงนี้</p>');
          body.innerHTML = html;
        } catch (e) {
          console.error('report failed', e);
          body.innerHTML = card('โหลดรายงานไม่สำเร็จ', '<p class="text-xs text-rose-600 break-words">' + esc(e && e.message ? e.message : e) + '</p><p class="text-[10px] text-slate-400 mt-2">ตรวจว่ารัน SMART-POS-FULL-v13.sql แล้ว และล็อกอินด้วยบัญชีที่ได้รับสิทธิ์</p>');
        }
      };

      window.exportReportCsv = function () {
        if (!lastDaily.length) return;
        var head = ['วันที่', 'จำนวนบิล', 'ยอดขายก่อนลด', 'ส่วนลด', 'ยอดขายสุทธิ', 'คืนสินค้า', 'ยอดขายหลังหักคืน', 'ต้นทุนขาย', 'กำไรขั้นต้น'];
        var lines = [head.join(',')].concat(lastDaily.slice().reverse().map(function (d) {
          return [d.day, d.bills, d.gross_sales, d.discounts, d.net_sales, d.refunds, d.net_after_returns, d.cogs, d.gross_profit].join(',');
        }));
        var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'report-' + document.getElementById('report-from').value + '_' + document.getElementById('report-to').value + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      };
    })();
    