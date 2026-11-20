
(function(){
 'use strict';
 const KEY='smartpos_activity_log_v1', MAX=500;
 const $=id=>document.getElementById(id);
 function read(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(_){return []}}
 // ---------- บันทึกกิจกรรม: ส่งขึ้น audit_logs ตาม schema จริง และไม่ทำให้รายการหายเมื่อส่งไม่สำเร็จ ----------
 var OUT_KEY='smartpos_audit_outbox_v2', MAX_OUT=1000, MAX_ATTEMPTS=5;
 function readOut(){try{return JSON.parse(localStorage.getItem(OUT_KEY)||'[]')}catch(_){return []}}
 function writeOut(a){try{localStorage.setItem(OUT_KEY,JSON.stringify(a.slice(-MAX_OUT)))}catch(_){}}
 function removeOut(id){writeOut(readOut().filter(x=>x.id!==id));}
 function patchLocal(id,patch){const arr=read();const e=arr.find(x=>x.id===id);if(e){Object.assign(e,patch);try{localStorage.setItem(KEY,JSON.stringify(arr))}catch(_){}}}
 function localOnly(type,message,detail){const arr=read();arr.unshift({id:'L'+Date.now()+Math.random().toString(36).slice(2,6),time:new Date().toISOString(),type,message,detail:String(detail||''),cloud:'none'});try{localStorage.setItem(KEY,JSON.stringify(arr.slice(0,MAX)))}catch(_){}}
 function newId(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():('e'+Date.now()+Math.random().toString(36).slice(2,10));}
 function add(type,message,detail){
  const event={id:newId(),time:new Date().toISOString(),type:String(type||'INFO'),message:String(message||''),detail:String(detail||''),cloud:'pending'};
  const arr=read();arr.unshift(event);
  try{localStorage.setItem(KEY,JSON.stringify(arr.slice(0,MAX)))}catch(_){}
  const ob=readOut();ob.push({...event,attempts:0});writeOut(ob);
  if($('sp-observe-panel')?.classList.contains('open'))renderLog();
  pumpCloud();
 }
 var lastWarnKey='',lastWarnAt=0;
 function warnCloud(msg){const k=String(msg).slice(0,120);if(k===lastWarnKey&&Date.now()-lastWarnAt<300000)return;lastWarnKey=k;lastWarnAt=Date.now();localOnly('WARN','ส่ง Audit Log ขึ้น Supabase ไม่สำเร็จ (จะลองส่งใหม่อัตโนมัติ)',msg);}
 async function pumpCloud(){
  if(window.__spAuditPump)return;
  window.__spAuditPump=true;
  let retryIn=0;
  try{
   const client=window.getSupabaseClient?.();
   if(!client){return;}                                   // ยังไม่ได้เชื่อม Supabase: เก็บในคิว ไม่ทิ้ง
   while(true){
    const ob=readOut();
    if(!ob.length)break;
    const ev=ob[0];
    const sess=await client.auth.getSession();
    const session=sess?.data?.session;
    if(sess?.error||!session?.user){patchLocal(ev.id,{cloud:'pending',cloudError:'ยังไม่ได้เข้าสู่ระบบ Supabase'});retryIn=60000;break;}
    const u=window.db?.activeUser||{};
    // คอลัมน์ตรงกับ public.audit_logs ใน SMART-POS-FULL-v13.sql
    const row={
     id:ev.id,
     created_at:ev.time,
     actor_user_id:null,                                  // ไม่ใส่ id ของแอป เพราะอาจไม่ตรงกับ app_users แล้วทำให้ FK ล้ม ชื่อและบทบาทเก็บใน details แทน
     actor_name:String(u.name||session.user.email||'ไม่ระบุ').slice(0,160),
     action:(String(ev.type||'INFO')+': '+String(ev.message||'')).slice(0,300),
     entity_type:'application',
     entity_id:null,
     details:{level:ev.type,message:ev.message,detail:ev.detail,app_user:u.name||null,app_role:u.role||null,device:window.getDeviceId?.()||null,auth_email:session.user.email||null,source:'Smart POS Activity Log'}
    };
    const {error}=await client.from('audit_logs').insert(row);
    // อ่านคิวใหม่ทุกครั้งหลัง await: กันการเขียนทับรายการที่เพิ่มระหว่างรอ
    if(!error){removeOut(ev.id);patchLocal(ev.id,{cloud:'sent',cloudError:''});continue;}
    const msg=error.message||String(error);
    ev.attempts=(ev.attempts||0)+1;
    if(ev.attempts>=MAX_ATTEMPTS){                        // ส่งไม่ผ่านหลายครั้ง: ย้ายออกจากคิวเพื่อไม่ให้รายการอื่นค้าง แต่ยังเก็บในเครื่องพร้อมสาเหตุ
     removeOut(ev.id);patchLocal(ev.id,{cloud:'rejected',cloudError:msg});warnCloud(msg);continue;
    }
    const cur=readOut();const k=cur.findIndex(x=>x.id===ev.id);if(k>=0){cur[k]=ev;writeOut(cur);}patchLocal(ev.id,{cloud:'failed',cloudError:msg});warnCloud(msg);
    retryIn=30000;break;
   }
  }catch(err){warnCloud(err?.message||String(err));retryIn=30000;}
  finally{
   window.__spAuditPump=false;
   if(retryIn&&!window.__spAuditRetry){window.__spAuditRetry=setTimeout(()=>{window.__spAuditRetry=null;pumpCloud();},retryIn);}
  }
 }
 window.addEventListener('online',()=>pumpCloud());
 setInterval(()=>{if(readOut().length)pumpCloud();},60000);
 var CLOUD_TXT={sent:'✅ ส่งขึ้นเซิร์ฟเวอร์แล้ว',pending:'⏳ รอส่ง',failed:'⚠️ ส่งไม่สำเร็จ (จะลองใหม่)',rejected:'❌ ส่งไม่ได้ (ถูกปฏิเสธ)',none:'เก็บในเครื่องเท่านั้น'};
 window.smartPOSActivityLog={add,read};
 window.posHooks.on('ui:notice',function(e){try{add(e.type,e.args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' — '),'');}catch(_){}});
 window.addEventListener('error',e=>add('ERROR',e.message||'JavaScript error',(e.filename||'')+':'+(e.lineno||'')));
 window.addEventListener('unhandledrejection',e=>{const r=e.reason;add('ERROR','Promise ปฏิเสธ/งาน async ล้มเหลว',r?.message||String(r||''))});
 window.addEventListener('online',()=>add('INFO','เครือข่ายกลับมาออนไลน์',''));
 window.addEventListener('offline',()=>add('WARN','เครือข่ายออฟไลน์','ตรวจคิวซิงก์ก่อนปิดหน้า'));
 // Warn when the app's processing overlay stays visible; do not forcibly dismiss it or risk interrupting a save.
 let loadingSince=0, loadingWarned=false;setInterval(()=>{if(document.hidden)return;const ov=document.getElementById('loading-overlay');const loading=!!ov&&!ov.classList.contains('hidden');if(loading){if(!loadingSince)loadingSince=Date.now();if(!loadingWarned&&Date.now()-loadingSince>30000){loadingWarned=true;add('WARN','ตรวจพบหน้าประมวลผลนานเกิน 30 วินาที','อาจมีคำขอเครือข่ายหรือขั้นตอน async ค้างอยู่ ตรวจ Console/Network และ Supabase Logs');}}else{loadingSince=0;loadingWarned=false;}},15000);
 function products(){const d=window.db||{};const raw=d.products||{};return (Array.isArray(raw)?raw:Object.values(raw)).filter(p=>p&&!p.isDeleted&&p.deleted!==true)}
 function imgOf(p){
  const raw=String(p.imageUrl||p.image_url||p.photoUrl||p.photo_url||p.image||'').trim();
  // Emoji/placeholders such as 📦 are not product photos. Count only image URLs/data URLs;
  // this avoids reporting every default placeholder as an image that was actually uploaded.
  return /^(https?:\/\/|data:image\/|blob:)/i.test(raw)?raw:'';
 }
 function calc(){const ps=products();const withImg=ps.filter(p=>imgOf(p));const noImg=ps.filter(p=>!imgOf(p));const variants=ps.reduce((n,p)=>n+(Array.isArray(p.variants)?p.variants.filter(v=>!v.isDeleted&&v.deleted!==true).length:0),0);return {ps,withImg,noImg,variants}}
 function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function renderLog(){const logs=read();$('sp-observe-log').innerHTML=logs.length?logs.slice(0,150).map(x=>`<div class="sp-log"><div><b>${escape(x.type)}</b> · ${escape(new Date(x.time).toLocaleString('th-TH'))}</div><div>${escape(x.message)}</div>${x.detail?`<div class="text-slate-500 text-xs">${escape(x.detail)}</div>`:''}<div class="text-[11px] ${x.cloud==='sent'?'text-emerald-700':(x.cloud==='failed'||x.cloud==='rejected')?'text-rose-700':'text-slate-400'}">${escape(CLOUD_TXT[x.cloud]||CLOUD_TXT.none)}${x.cloudError?' — '+escape(x.cloudError):''}</div></div>`).join(''):'ยังไม่มี Log ที่บันทึกไว้'}
 function render(){const a=calc();$('sp-observe-stats').innerHTML=[['สินค้าทั้งหมด',a.ps.length],['สินค้าที่มีรูป',a.withImg.length],['สินค้าที่ไม่มีรูป',a.noImg.length],['จำนวนตัวเลือก/Variant',a.variants]].map(x=>`<div class="sp-stat"><div class="text-slate-500 text-xs">${x[0]}</div><div class="sp-num">${x[1].toLocaleString('th-TH')}</div></div>`).join('');
 const online=navigator.onLine;const hasDb=!!window.db;const client=window.getSupabaseClient?.();$('sp-observe-status').innerHTML=`<b>สถานะเบราว์เซอร์:</b> ${online?'🟢 ออนไลน์':'🟠 ออฟไลน์'}<br><b>ข้อมูลในแอป:</b> ${hasDb?'พบ db ในหน่วยความจำ':'ไม่พบ db'}<br><b>Supabase Client:</b> ${client?'พบ client (ยังไม่ยืนยันสิทธิ์/การเชื่อมต่อจริง)':'ยังไม่พบ client'}<br><b>เวลาตรวจล่าสุด:</b> ${new Date().toLocaleString('th-TH')}<br><b>หมายเหตุ:</b> จำนวนสินค้าอ้างอิงข้อมูลที่โหลดอยู่ในแอป ณ เวลานี้ อาจยังไม่ใช่ยอดทั้งหมดใน Cloud หากยังไม่ได้ซิงก์`;
 const adv=[];if(a.noImg.length)adv.push(`• มีสินค้า ${a.noImg.length} รายการที่ยังไม่มี URL/ข้อมูลรูปจริง (ไม่นับ emoji หรือรูปแทนชั่วคราว) ควรตรวจชื่อ/SKU และจับคู่รูปให้ถูกต้อง`);if(!online)adv.push('• ออฟไลน์: ตรวจคิวซิงก์ก่อนปิดหน้า');if(!client)adv.push('• ยังไม่พบ Supabase Client: ตรวจ Project URL และ anon key');adv.push('• รูปที่ไม่ได้ใช้จะนับได้เมื่อกดตรวจ Storage และบัญชีมีสิทธิ์ list bucket; ถ้า RLS/Storage policy ปฏิเสธ ระบบจะแสดงข้อผิดพลาดแทนการเดาจำนวน');adv.push('• Log ในเครื่องเก็บไว้ในเบราว์เซอร์ ส่วนกิจกรรมจะพยายามส่งไปตาราง audit_logs เมื่อมี session และสิทธิ์ RLS อนุญาต; หากส่งไม่สำเร็จให้ดูคำเตือนใน Log และตรวจตาราง/สิทธิ์');$('sp-observe-advice').innerHTML='<b>คำแนะนำ</b><br>'+adv.map(escape).join('<br>');renderLog();}
 async function scanStorage(){
  const client=window.getSupabaseClient?.();
  if(!client){add('ERROR','ตรวจ Storage ไม่ได้','ยังไม่มี Supabase client');render();return}
  const a=calc(), usedPaths=new Set(), usedNames=new Set();
  for(const p of a.ps){const u=imgOf(p);if(!u)continue;try{let path='';const url=new URL(u,location.href);const m=url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/product-images\/(.+)$/);if(m)path=decodeURIComponent(m[1]).split('?')[0];else path=decodeURIComponent(url.pathname.split('/').pop()||'');if(path){usedPaths.add(path.replace(/^\/+/,''));usedNames.add(path.split('/').pop());}}catch(_){const path=u.split('?')[0].split('/').pop();if(path)usedNames.add(decodeURIComponent(path));}}
  $('sp-observe-status').textContent='กำลังตรวจรายการไฟล์ใน bucket product-images รวมถึงโฟลเดอร์ย่อย…';
  try{
   const bucket=client.storage.from('product-images'), files=[], seen=new Set(), limit=100, maxFiles=5000;
   async function walk(prefix){let offset=0;while(true){const {data,error}=await bucket.list(prefix,{limit,offset,sortBy:{column:'name',order:'asc'}});if(error)throw error;const rows=data||[];for(const f of rows){if(!f?.name)continue;const full=prefix?prefix+'/'+f.name:f.name;const isFolder=!f.id&&!f.metadata;if(isFolder){await walk(full);}else if(!seen.has(full)){seen.add(full);files.push({name:f.name,path:full});if(files.length>=maxFiles)throw new Error('พบไฟล์ถึงขีดจำกัด '+maxFiles+' รายการ จึงหยุดเพื่อป้องกันการอ่านเกินขอบเขต');}}if(rows.length<limit)break;offset+=rows.length;}}
   await walk('');
   const unused=files.filter(f=>!usedPaths.has(f.path)&&!usedNames.has(f.name));
   add('INFO','ตรวจ Storage สำเร็จ',`พบไฟล์ ${files.length} รายการรวมโฟลเดอร์ย่อย; ไม่พบการอ้างอิง ${unused.length} รายการ`);
   $('sp-observe-status').innerHTML=`<b>ตรวจ Storage สำเร็จ</b><br>ไฟล์ทั้งหมด (รวมโฟลเดอร์ย่อย): ${files.length}<br>ไฟล์ที่ไม่พบการอ้างอิงจากสินค้า: ${unused.length}<br><span class="text-amber-700">รายการนี้เป็นเพียงไฟล์ที่ไม่พบการอ้างอิงจาก URL ที่ตรวจได้ อาจมีรูปแบบ URL หรือการอ้างอิงอื่น จึงห้ามลบอัตโนมัติ</span>`;
   $('sp-observe-advice').innerHTML='<b>คำแนะนำ</b><br>'+[a.noImg.length?`• มีสินค้า ${a.noImg.length} รายการไม่มี URL รูป`: '• สินค้าทั้งหมดที่โหลดอยู่มี URL รูปแล้ว',unused.length?`• ตรวจสอบไฟล์ที่อาจไม่ได้ใช้ ${unused.length} รายการก่อนลบ`: '• ไม่พบไฟล์ที่น่าสงสัยจากการเทียบครั้งนี้','• จำนวนสินค้าที่แสดงเป็นข้อมูลที่โหลดในแอป ไม่ใช่การนับตรงจากฐานข้อมูล Cloud'].map(escape).join('<br>')+(unused.length?'<br><br><b>ไฟล์ที่อาจไม่ได้ใช้ — ตรวจสอบก่อนดำเนินการ</b><br>'+unused.slice(0,100).map(f=>'• '+escape(f.path)).join('<br>')+(unused.length>100?'<br>… แสดง 100 รายการแรก':''):'');
  }catch(e){add('ERROR','ตรวจ Storage ไม่สำเร็จ',e?.message||String(e));$('sp-observe-status').textContent='ตรวจ Storage ไม่สำเร็จ: '+(e?.message||String(e))+' — ตรวจชื่อ bucket, session และ Storage RLS policy';}
  renderLog();
 }
 window.posHub.register({id:'observe',group:'system',icon:'🛠️',label:'ตรวจระบบ / Log',hint:'ประวัติและข้อผิดพลาด',run:()=>{$('sp-observe-panel').classList.add('open');render()}});$('sp-observe-close').addEventListener('click',()=>$('sp-observe-panel').classList.remove('open'));$('sp-observe-refresh').addEventListener('click',render);$('sp-observe-storage').addEventListener('click',scanStorage);$('sp-observe-export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(read(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='smartpos-activity-log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});$('sp-observe-clear').addEventListener('click',()=>{if(confirm('ล้างประวัติ Log เฉพาะในเบราว์เซอร์เครื่องนี้?')){localStorage.removeItem(KEY);renderLog()}});
 document.addEventListener('DOMContentLoaded',()=>{add('INFO','เปิดแอป Smart POS','ระบบบันทึกกิจกรรมในเบราว์เซอร์เริ่มทำงาน');render()});
})();
