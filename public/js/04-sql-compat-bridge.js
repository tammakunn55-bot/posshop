
/* Smart POS Pro V1.0 SQL Schema Compatibility Bridge */
(function(){
  window.SQL_SCHEMA_VERSION='Smart_POS_Pro_Enterprise_Full_Database_Schema';

  // Compatibility fallbacks for missing functions in the original page.
  window.showView = window.showView || function(viewId){
    document.querySelectorAll('.view-content').forEach(function(v){ v.classList.add('hidden'); });
    const view=document.getElementById('view-'+viewId);
    if(view) view.classList.remove('hidden');
    document.querySelectorAll('.nav-btn-el').forEach(function(btn){
      const active=btn.dataset.view===viewId;
      btn.classList.toggle('opacity-100',active);
      btn.classList.toggle('opacity-40',!active);
    });
    if(viewId==='stock') window.renderStockTable?.();
    if(viewId==='history') window.renderSalesAR?.();
    if(viewId==='report'){
      if(window.canDo && !window.canDo('ALL')){ window.showAlert?.('ไม่มีสิทธิ์','รายงานดูได้เฉพาะเจ้าของร้านหรือผู้ที่ได้รับสิทธิ์ทั้งหมด',true); return window.showView('sale'); }
      var _rf=document.getElementById('report-from'); if(_rf && !_rf.value){ window.setReportRange('today'); } else { window.renderReport?.(); }
    }
    if(viewId==='po-receive') {
      window.renderPOPicker?.();
      window.populatePOPickers?.();
      window.renderPurchaseHistory?.();
    }
  };

  // UX: added a fixed "ทั้งหมด" tile ahead of the category buttons so staff can browse or
  // search the whole catalog in one tap without first having to guess which category an item
  // was filed under — this is what actually makes "find it fast" possible when unsure.
  // UX rework: category "cards" replaced by a sticky, always-reachable category bar (see
  // window.renderCategoryBar in the main script) — this now just kicks off that bar plus the
  // default "all products" grid, and keeps the bar's sticky offset in sync with the header.
  window.renderSaleHome = window.renderSaleHome || function(){
    if(!window.db) return;
    window.renderCategoryBar?.();
    window.syncCategoryBarOffset?.();
    window.selectCategory?.(null);
  };

  function sb(){ return window.getSupabase ? window.getSupabase() : null; }
  // อ่านข้อมูล Cloud แบบแบ่งหน้าเสมอ เพราะ PostgREST จำกัดจำนวนแถวต่อคำขอ
  // ค่าเริ่มต้นมักอยู่ที่ 1,000 แถว การ select ครั้งเดียวจึงทำให้สินค้า/บิลหลังแถวที่ 1,000 หาย
  // fn ต้องสร้าง query ใหม่ทุกครั้ง และ query ที่ส่งเข้ามาต้องมี order ที่คงที่
  async function q(table, fn){
    const c=sb(); if(!c) return null;
    const PAGE_SIZE=1000, MAX_ROWS=250000;
    const first=fn(c.from(table));
    if(!first || typeof first.then!=='function') return first;
    const all=[]; let offset=0;
    while(offset<MAX_ROWS){
      const query = offset===0 ? first : fn(c.from(table));
      const {data,error}=await query.range(offset, offset+PAGE_SIZE-1);
      if(error) throw error;
      const rows=data||[]; all.push(...rows);
      if(rows.length<PAGE_SIZE) return all;
      offset+=rows.length;
    }
    throw new Error(`ตาราง ${table} มีข้อมูลเกิน ${MAX_ROWS.toLocaleString()} แถว ระบบหยุดเพื่อป้องกันการโหลดไม่ครบโดยไม่แจ้งเตือน`);
  }
  window.loadDatabaseState=async function(silent){
    const c=sb(); if(!c) return false;
    // Run each table fetch independently (allSettled, not all) so a problem with one table
    // — e.g. a bad embedded-relationship query — doesn't block every other table from loading,
    // and so the failure message can name exactly which table/column broke instead of a
    // generic "pull failed" with no way to diagnose it.
    // ตัวช่วย: มีคำสั่งปรับสต็อกของขนาดนี้ที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์หรือไม่
    const hasPendingAdj = id => (db.syncQueue || []).some(o => o.type === 'adjust' && o.status !== 'failed' && o.payload && o.payload.variantId === id);
    const queries={
      categories:q('categories',x=>x.select('*').order('display_order').order('id')),
      products:q('products',x=>x.select('*').eq('is_active',true).order('name').order('id')),
      product_categories:q('product_categories',x=>x.select('*').order('product_id').order('category_id')),
      product_variants:q('product_variants_view',x=>x.select('*').eq('is_active',true).order('id')),
      product_fractions:q('product_fractions',x=>x.select('*').order('variant_id').order('id')),
      customers:q('customers',x=>x.select('*').eq('is_active',true).order('name').order('id')),
      bills:q('bills',x=>x.select('*, bill_items(*)').order('created_at',{ascending:false}).order('id',{ascending:false}))
    };
    const keys=Object.keys(queries);
    const settled=await Promise.allSettled(Object.values(queries));
    const results={}, failures=[];
    keys.forEach((k,i)=>{
      if(settled[i].status==='fulfilled'){ results[k]=settled[i].value; }
      else { results[k]=[]; failures.push(`${k}: ${settled[i].reason?.message||settled[i].reason}`); }
    });
    if(keys.every((k,i)=>settled[i].status==='rejected')){
      // Every single table failed — almost certainly not signed in, or URL/key wrong, rather
      // than a per-table schema issue. Report that plainly instead of dumping 7 identical errors.
      console.error('loadDatabaseState: all queries failed', failures);
      window.showAlert?.('ดึงข้อมูลไม่สำเร็จ','เชื่อมต่อฐานข้อมูลไม่ได้ทั้งหมด — ตรวจสอบว่าได้ "เข้าสู่ระบบร้านค้า" แล้วหรือยัง (ต้องล็อกอินก่อนจึงจะอ่าน/เขียนข้อมูลได้) และ Project URL/anon key ถูกต้อง',true);
      return false;
    }
    try{
      const {categories:cats,products:prods,product_categories:links,product_variants:vars,product_fractions:fracs,customers:custs,bills}=results;
      window.db=window.db||{};
      // ส่งคิวที่ค้างให้เสร็จก่อน — ถ้ายังมีรายการค้าง จะไม่เอาสต็อก/ยอดหนี้จากเซิร์ฟเวอร์มาทับ (เพราะยังไม่รวมรายการเหล่านั้น)
      await window.flushSyncQueue?.(true);
      const _hasPending=(db.syncQueue||[]).length>0;

      // Categories — add any remote category not already present locally by name; never
      // touch/remove existing local categories.
      db.categories=db.categories||[];
      let newCats=0;
      (cats||[]).forEach(x=>{
        if(!db.categories.some(lc=>lc.name===x.name)){
          db.categories.push({id:'cat-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:x.name,icon:x.icon||'📁',color:x.color||'#4f46e5'});
          newCats++;
        }
      });

      const catById=Object.fromEntries((cats||[]).map(x=>[x.id,x.name]));
      const catsByProduct={}; (links||[]).forEach(l=>(catsByProduct[l.product_id]=catsByProduct[l.product_id]||[]).push(catById[l.category_id]||l.category_id));

      // product_fractions are keyed by variant_id in this schema (not product_id).
      // PATCH 010: quantity_ratio = จำนวนหน่วยฐานต่อ 1 หน่วยขาย — ค่าเดียวกับ fractionMultiplier
      // ในเครื่องทุกประการ (ตัดสต็อก = qty × ratio) จึงรับค่ามาใช้ตรงๆ ไม่ต้องกลับค่า
      const fracsByVariant={}; (fracs||[]).forEach(f=>(fracsByVariant[f.variant_id]=fracsByVariant[f.variant_id]||[]).push(f));

      // product_variants columns here are variant_name / price / cost_price — direct values,
      // no override-with-parent-fallback (this schema's `products` table has no price/cost
      // columns of its own at all, unlike the previous schema this app used to target).
      const rawVarsByProduct={}; (vars||[]).forEach(v=>(rawVarsByProduct[v.product_id]=rawVarsByProduct[v.product_id]||[]).push(v));

      // Products — match an existing local product by SKU (the one field that's stable across
      // both the local record and its Supabase row) so its ORIGINAL local id, and therefore its
      // current local stock/price (which may have moved since the last push), is preserved.
      // Only products genuinely new to this device (no local SKU match) get created, using the
      // Supabase row id as their new local id.
      db.products=db.products||{};
      const localIdBySku={};
      Object.values(db.products).forEach(p=>{ if(p.code) localIdBySku[p.code]=p.id; });

      let addedProd=0, matchedProd=0, addedVar=0, stockUpd=0, debtUpd=0;
      (prods||[]).forEach(p=>{
        const sku=p.sku||'';
        const existingId=sku?localIdBySku[sku]:null;
        if(existingId && db.products[existingId]){
          const existing=db.products[existingId];
          existing.name=p.name;
          existing.cat=catsByProduct[p.id]||existing.cat;
          existing.image=p.image_url||existing.image; if(p.image_url) existing.imageUrl=p.image_url;
          if(p.min_stock_alert!=null)existing.minStock=+p.min_stock_alert;
          matchedProd++;
          if(!_hasPending){   // ให้สต็อกตรงกับเซิร์ฟเวอร์ + เพิ่มตัวเลือก (variant) ที่เครื่องอื่นเพิ่มไว้
            existing.variants=existing.variants||[];
            (rawVarsByProduct[p.id]||[]).forEach(rv=>{
              const lv=existing.variants.find(x=>toUUID(x.id)===rv.id);
              if(!lv){
                existing.variants.push({id:rv.id,minStock:(rv.min_stock!=null?+rv.min_stock:(+p.min_stock_alert||5)),sizeName:rv.variant_name||'ปกติ',barcode:rv.barcode||'',sku:rv.sku||'',cost:+(rv.cost_price||0),price:+(rv.price||0),stock:+(rv.stock_quantity||0),_seeded:!!rv.stock_seeded,unit:rv.unit||'ชิ้น',cutLength:rv.cut_length!=null?+rv.cut_length:undefined,cutPricePerM:rv.cut_price_per_m!=null?+rv.cut_price_per_m:undefined,parentVariantId:rv.parent_variant_id||undefined,pieceLength:rv.piece_length!=null?+rv.piece_length:undefined,fractions:[]});
                addedVar++;
              }else{
                if(rv.min_stock!=null) lv.minStock=+rv.min_stock;
                if(rv.image_url) lv.imageUrl=rv.image_url;
                if(rv.cut_length!=null){lv.cutLength=+rv.cut_length;lv.cutPricePerM=+(rv.cut_price_per_m||0);}
                if(rv.parent_variant_id){lv.parentVariantId=rv.parent_variant_id;lv.pieceLength=+rv.piece_length;}
                // อย่าเขียนทับสต็อกที่ยังมีคำสั่งปรับค้างอยู่ในคิว ไม่งั้นการโหลดใหม่จะย้อนค่าที่เพิ่งตั้ง
                if(rv.stock_seeded && !hasPendingAdj(lv.id)){ lv.stock=+(rv.stock_quantity||0); lv._seeded=true; stockUpd++; }
              }
            });
          }
        }else if(!existingId){
          const remoteVariants=(rawVarsByProduct[p.id]||[]).map(v=>({
            id:v.id,minStock:(v.min_stock!=null?+v.min_stock:(+p.min_stock_alert||5)),sizeName:v.variant_name||'ปกติ',unit:v.unit||'ชิ้น',imageUrl:v.image_url||null,barcode:v.barcode||'',sku:v.sku||'',_seeded:!!v.stock_seeded,cutLength:v.cut_length!=null?+v.cut_length:undefined,cutPricePerM:v.cut_price_per_m!=null?+v.cut_price_per_m:undefined,parentVariantId:v.parent_variant_id||undefined,pieceLength:v.piece_length!=null?+v.piece_length:undefined,
            cost:+(v.cost_price||0),price:+(v.price||0),stock:(hasPendingAdj(v.id)?0:+(v.stock_quantity||0)),
            fractions:(fracsByVariant[v.id]||[]).map(f=>({
              id:f.id,fractionName:f.fraction_name,
              fractionMultiplier:f.quantity_ratio>0?+f.quantity_ratio:1,
              fractionPrice:+(f.price||0),barcode:f.barcode||''
            }))
          }));
          db.products[p.id]={
            id:p.id,name:p.name,code:sku,cat:catsByProduct[p.id]||[],image:p.image_url||'📦',imageUrl:p.image_url||null,
            minStock:+(p.min_stock_alert||0),
            variants:remoteVariants.length?remoteVariants:[{id:null,sizeName:'ปกติ',barcode:'',cost:0,price:0,stock:0,fractions:[]}]
          };
          addedProd++;
        }
      });

      // Customers — match by phone (or name if no phone on either side). This schema has no
      // debt/accounts-receivable column, so a pulled-in new customer starts at debt:0 — an
      // existing local record's tracked debt is never touched (there's nothing server-side to
      // reconcile it against anyway).
      db.customers=db.customers||{};
      const localIdByPhone={}, localIdByName={};
      Object.values(db.customers).forEach(cu=>{ if(cu.phone)localIdByPhone[cu.phone]=cu.id; localIdByName[cu.name]=cu.id; });
      let addedCust=0;
      (custs||[]).forEach(cu=>{
        const existingId=(cu.phone&&localIdByPhone[cu.phone])||localIdByName[cu.name];
        if(!existingId){
          db.customers[cu.id]={id:cu.id,name:cu.name,phone:cu.phone||'',address:cu.address||'',debt:+(cu.debt||0),_debtSeeded:!!cu.debt_seeded,creditLimit:+(cu.credit_limit||0)};
          addedCust++;
        }else if(!_hasPending && cu.debt_seeded && db.customers[existingId]){
          db.customers[existingId].debt=roundAmt(+(cu.debt||0)); db.customers[existingId]._debtSeeded=true; debtUpd++;   // ยอดหนี้ตามเซิร์ฟเวอร์
        }
      });

      // Bills — additive only. Never overwrite or remove a local bill; only pull in remote
      // bills this device doesn't have yet (e.g. rung up on a different terminal), matched by
      // bill_number which is exactly the local bill's id.
      db.bills=db.bills||[];
      const _localCidByUuid={}; Object.values(db.customers||{}).forEach(cu=>{_localCidByUuid[toUUID(cu.id)]=cu.id;});
      const localBillIds=new Set(db.bills.map(b=>b.id));
      let addedBills=0;
      (bills||[]).forEach(b=>{
        if(!localBillIds.has(b.bill_number)){
          db.bills.push({
            id:b.bill_number,time:new Date(b.created_at).getTime(),total:+b.total,subtotal:+(b.subtotal||b.total),discount:+(b.discount_amount||0),
            _syncedViaRPC:true,_serverBillId:b.id,
            method:(b.payment_method||'CASH').toUpperCase(),customerId:(b.customer_id&&(_localCidByUuid[b.customer_id]||b.customer_id))||'GENERAL',
            isRefunded:b.status==='CANCELLED',
            items:(b.bill_items||[]).map(bi=>({id:bi.product_id,variantId:bi.variant_id,fractionId:bi.fraction_id,name:bi.item_name,price:+bi.unit_price,qty:+bi.quantity,returnedQty:+(bi.returned_qty||0)}))
          });
          addedBills++;
        }
      });

      persist();
      window.renderSaleHome?.(); window.renderStockTable?.(); window.renderSalesAR?.();
      window.populateCustomerSelect?.(); window.populatePOPickers?.();
      const summary=`หมวดหมู่ใหม่ ${newCats} • สินค้าใหม่ ${addedProd} (จับคู่ของเดิม ${matchedProd}) • ลูกค้าใหม่ ${addedCust} • บิลที่ดึงเพิ่ม ${addedBills} • ปรับสต็อก ${stockUpd} • ปรับยอดหนี้ ${debtUpd}${_hasPending?' (ข้ามการปรับสต็อก/หนี้ เพราะยังมีรายการค้างส่ง)':''}`;
      if(failures.length){
        console.warn('loadDatabaseState: partial failure on', failures);
        window.showAlert?.('ดึงข้อมูลสำเร็จบางส่วน',`${summary}\n\n⚠️ ตารางต่อไปนี้ดึงไม่สำเร็จ: ${failures.join(' | ')}`,true);
      } else if(!silent){
        window.showAlert?.('ดึงข้อมูลจากคลาวด์สำเร็จ',summary,false);
      }
      return true;
    }catch(e){ console.error('loadDatabaseState',e); window.showAlert?.('ดึงข้อมูลไม่สำเร็จ','เกิดข้อผิดพลาดระหว่างประมวลผลข้อมูลที่ดึงมา: '+(e.message||e),true); return false; }
  };

  // Explicit, confirmed pull — replaces the old silent auto-pull on every page load.
  window.confirmPullFromCloud=function(){
    if(!confirm('ดึงข้อมูลล่าสุดจากฐานข้อมูลคลาวด์มาเพิ่มในเครื่องนี้?\n\n(เพิ่มรายการที่ยังไม่มีในเครื่องนี้ และปรับจำนวนสต็อก/ยอดหนี้ให้ตรงกับเซิร์ฟเวอร์ เมื่อไม่มีรายการค้างส่ง)'))return;
    window.loadDatabaseState(false);
  };

  window.getSupabase = window.getSupabaseClient;


  // Cloud pull is now explicit only (see window.confirmPullFromCloud, wired to the Settings
  // button) — no longer runs automatically on page load. See the note above loadDatabaseState.
})();
