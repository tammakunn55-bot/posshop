
(function(){
  'use strict';
  var banner, label, detail, icon;
  function getQueueStats(){
    try {
      var raw=localStorage.getItem('pos_full_db_state');
      var state=raw?JSON.parse(raw):{};
      var q=Array.isArray(state.syncQueue)?state.syncQueue:[];
      var pending=q.filter(function(x){return x.status!=='failed';}).length;
      var failed=q.filter(function(x){return x.status==='failed';}).length;
      var bills=Array.isArray(state.bills)?state.bills:[];
      var localPending=bills.filter(function(b){return b._rpcPending===true;}).length;
      return {pending:Math.max(pending,localPending),failed:failed,localPending:localPending};
    } catch(e){return {pending:0,failed:0,localPending:0};}
  }
  function render(){
    banner=document.getElementById('offline-readiness-banner');
    label=document.getElementById('offline-status-label');
    detail=document.getElementById('offline-status-detail');
    icon=document.getElementById('offline-status-icon');
    if(!banner||!label||!detail)return;
    var online=navigator.onLine!==false, q=getQueueStats();
    if(!online){
      banner.dataset.state='offline'; icon.textContent='●'; label.textContent='ออฟไลน์ — บันทึกในเครื่อง รอซิงก์';
      detail.textContent='บิลที่ยังไม่ซิงก์: '+q.pending+' | IndexedDB สำรองสถานะล่าสุดแบบเบื้องหลัง | ห้ามล้างข้อมูลก่อนซิงก์สำเร็จ';
    }else if(q.failed){
      banner.dataset.state='error'; icon.textContent='●'; label.textContent='มีรายการซิงก์ไม่ผ่าน '+q.failed+' รายการ';
      detail.textContent='บิลรอส่ง '+q.pending+' รายการ — ตรวจข้อผิดพลาดแล้วกดซิงก์ใหม่';
    }else if(q.pending){
      banner.dataset.state='offline'; icon.textContent='●'; label.textContent='ออนไลน์ — มีบิลรอซิงก์ '+q.pending+' รายการ';
      detail.textContent='อย่าล้างข้อมูลในเครื่อง จนกว่าระบบจะแจ้งว่าซิงก์สำเร็จ';
    }else{
      var cloudDown = window.posCloudOk === false;
      banner.dataset.state = cloudDown ? 'offline' : 'online'; icon.textContent='●';
      label.textContent = cloudDown ? 'ออฟไลน์ (ใช้ในเครื่อง)' : 'พร้อมใช้งาน';
      detail.textContent=online?'ออนไลน์ — บิลใหม่จะเข้าคิวซิงก์กับ Supabase':'ออฟไลน์ — ใช้ข้อมูลที่มีในเครื่อง; ตรวจคิวซิงก์ก่อนปิดแอป';
    }
  }
  window.addEventListener('online',function(){render(); if(window.flushSyncQueue) setTimeout(function(){try{window.flushSyncQueue();}catch(e){}},1200);});
  window.addEventListener('offline',render);
  window.addEventListener('storage',render);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)render();});
  posHooks.on('persist',function(){setTimeout(render,0);});
  window.addEventListener('load',function(){
    render();
    // GitHub Pages project sites need a relative SW path so scope stays inside this repository.
    if('serviceWorker' in navigator && location.protocol==='https:'){
      navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(function(){
        if(navigator.serviceWorker.controller) render();
      }).catch(function(e){console.warn('Offline app-shell registration failed:',e);});
    }
  });
  window.smartPOSOfflineStatus={refresh:render,queueStats:getQueueStats};
})();
