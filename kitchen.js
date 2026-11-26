const STATUSES = ['Received','Preparing','Ready','Served','Cancelled'];
let db, channel, orders=[], generation=0, request=0, signedIn=false;
let kitchenRestaurantId = null;
let kitchenView = 'active';
let historyOrders = [];
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
function renderBill(o){
  const fields=['subtotal','tax_percent','tax_amount','service_charge_percent','service_charge_amount'];
  const complete=fields.every(k=>o[k]!=null && Number.isFinite(Number(o[k])));
  const row=(label,value)=>`<div class="flex justify-between gap-2 text-sm"><span>${esc(label)}</span><span>Rs. ${money(value)}</span></div>`;
  return `<div class="border-t border-slate-700 pt-3 space-y-1">${complete ? row('Subtotal',o.subtotal)+(Number(o.tax_percent)||Number(o.tax_amount)?row('Tax ('+Number(o.tax_percent)+'%)',o.tax_amount):'')+(Number(o.service_charge_percent)||Number(o.service_charge_amount)?row('Service charge ('+Number(o.service_charge_percent)+'%)',o.service_charge_amount):'') : '<p class="text-xs text-slate-400">Original billing breakdown unavailable</p>'}<div class="flex justify-between gap-2 font-bold text-amber-400"><span>Grand total</span><span>Rs. ${money(o.total)}</span></div></div>`;
}
function message(text){el('connection').textContent=text;}
let audioContext, soundEnabled=false, beepTimer=null, pendingKnown=false;
let tones=new Set();
function stopTones(){for(const tone of tones){try{tone.stop();}catch{}} tones.clear();}
function stopAlarm(){clearInterval(beepTimer);beepTimer=null;stopTones();}
function beep(){
  if(paused || !signedIn || !soundEnabled || audioContext?.state!=='running')return;
  const now=audioContext.currentTime;
  for(const offset of [0,0.25]){
    const tone=audioContext.createOscillator(), gain=audioContext.createGain();
    tone.type='sine';tone.frequency.value=880;
    gain.gain.setValueAtTime(0.001,now+offset);
    gain.gain.exponentialRampToValueAtTime(0.18,now+offset+0.025);
    gain.gain.exponentialRampToValueAtTime(0.001,now+offset+0.19);
    tone.connect(gain);gain.connect(audioContext.destination);tones.add(tone);
    tone.onended=()=>{tones.delete(tone);tone.disconnect();gain.disconnect();};
    tone.start(now+offset);tone.stop(now+offset+0.2);
  }
}
function syncAlarm(){
  const count=orders.filter(o=>o.status==='Received').length;
  el('sound-panel').hidden=!signedIn;
  el('pending-count').textContent='Pending orders: '+(pendingKnown?count:'checking…');
  el('sound-toggle').textContent=soundEnabled?'Mute Sound':'Enable Sound';
  el('sound-status').textContent=!soundEnabled?'Sound off · enable after opening this page.':audioContext?.state!=='running'?'Audio paused by browser · mute and enable again.':!pendingKnown?'Sound enabled · checking orders…':count?'Sound enabled · awaiting acceptance':'Sound enabled · waiting for new orders';
  if(paused || !signedIn || !soundEnabled || !count || audioContext?.state!=='running'){stopAlarm();return;}
  if(beepTimer===null){beep();beepTimer=setInterval(beep,2500);}
}
async function enableSound(){
  if(paused||!signedIn)return false;
  const epoch=generation;
  try{
    if(!audioContext){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Audio not supported');audioContext=new Audio();audioContext.onstatechange=syncAlarm;}
    await audioContext.resume();
    if(epoch!==generation||!signedIn)return false;
    if(audioContext.state!=='running')throw Error('Browser blocked audio');
    soundEnabled=true;syncAlarm();return true;
  }catch(error){soundEnabled=false;syncAlarm();el('sound-status').textContent=error.message;return false;}
}
el('sound-toggle').onclick=async()=>{if(soundEnabled){soundEnabled=false;syncAlarm();}else await enableSound();};
el('sound-test').onclick=async()=>{if(await enableSound()){if(beepTimer===null)beep();}};
function switchKitchenView(view){
  if(!['active','history'].includes(view))return;
  kitchenView=view;
  el('tab-active').setAttribute('aria-selected',String(view==='active'));
  el('tab-history').setAttribute('aria-selected',String(view==='history'));
  el('tab-active').classList.toggle('bg-amber-500',view==='active');
  el('tab-active').classList.toggle('text-black',view==='active');
  el('tab-history').classList.toggle('bg-amber-500',view==='history');
  el('tab-history').classList.toggle('text-black',view==='history');
  el('archive-finished').classList.toggle('hidden',view==='history');
  renderKitchen();updateControls();
  refreshOrders().catch(e=>message(e.message));
}
function renderKitchen(){
  if(kitchenView==='history'){
    el('kitchen-stats').textContent='Archived order history: '+historyOrders.length+' orders · read-only';
    el('kitchen-list').innerHTML=historyOrders.length?historyOrders.map(o=>`
      <div class="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <div class="flex justify-between gap-3"><div><span class="text-xs text-amber-400">${esc(o.id)}</span><h3 class="text-lg font-bold">Table ${esc(String(o.table).padStart(2,'0'))}</h3></div><b>${esc(o.status)}</b></div>
        <div class="text-xs text-slate-400"><p>Customer: ${esc(String(o.name??'').trim()||'Guest')} (${esc(o.phone||'N/A')})</p><p>Payment: ${esc(o.payment)} at Counter</p><p>${esc(new Date(o.createdAt).toLocaleString())}</p></div>
        <div class="bg-slate-950 p-3 rounded-xl space-y-1">${(Array.isArray(o.items)?o.items:[]).filter(i=>i && typeof i==='object').map(i=>`<div class="flex justify-between gap-2 text-sm"><span>${esc(i.quantity)} × ${esc(i.title)}</span><span>Rs. ${money(Number(i.price)*Number(i.quantity))}</span></div>`).join('')}</div>
        ${renderBill(o)}<div class="text-xs text-slate-400">Archived · read-only</div>
      </div>`).join(''):'<p class="col-span-full text-slate-400 py-12 text-center">No archived orders found.</p>';
    return;
  }
  const active=orders.filter(o=>!['Served','Cancelled'].includes(o.status));
  const total=orders.filter(o=>o.status!=='Cancelled').reduce((n,o)=>n+Number(o.total),0);
  el('kitchen-stats').textContent='Unarchived orders: '+orders.length+' | Active: '+active.length+' | Order value: Rs. '+money(total)+' (not verified payments)';
  el('kitchen-list').innerHTML=orders.length?orders.map(o=>`
    <div class="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
      <div class="flex justify-between gap-3"><div><span class="text-xs text-amber-400">${esc(o.id)}</span><h3 class="text-lg font-bold">Table ${esc(String(o.table).padStart(2,'0'))}</h3></div><b>${esc(o.status)}</b></div>
      <div class="text-xs text-slate-400"><p>Customer: ${esc(String(o.name??'').trim()||'Guest')} (${esc(o.phone||'N/A')})</p><p>Payment: ${esc(o.payment)} at Counter</p><p>${esc(new Date(o.createdAt).toLocaleString())}</p></div>
      <div class="bg-slate-950 p-3 rounded-xl space-y-1">${(Array.isArray(o.items)?o.items:[]).filter(i=>i && typeof i === "object").map(i=>`<div class="flex justify-between gap-2 text-sm"><span>${esc(i.quantity)} × ${esc(i.title)}</span><span>Rs. ${money(Number(i.price)*Number(i.quantity))}</span></div>`).join('')}</div>
      ${renderBill(o)}<div class="flex justify-end items-center">
      <select aria-label="Order status" data-order="${esc(o.id)}" class="admin-input text-xs !w-auto">${STATUSES.map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>`).join(''):'<p class="col-span-full text-slate-400 py-12 text-center">No unarchived orders. Waiting for customers…</p>';
}
async function refreshOrders(recovery=false){
  if(!signedIn || !kitchenRestaurantId || (paused && recovery!==true))return false;
  if(!navigator.onLine){pauseKitchen();return false;}
  const epoch=generation, ticket=++request;
  const view=kitchenView, restaurantId=kitchenRestaurantId;
  const query=archived=>db.from('orders').select('*').eq('restaurant_id',restaurantId).eq('archived',archived).order('createdAt',{ascending:false}).abortSignal(AbortSignal.timeout(8000));
  const active=await query(false);
  if(epoch!==generation || ticket!==request || view!==kitchenView)return;
  if(active.error){pauseKitchen();return false;}
  orders=active.data||[];pendingKnown=true;syncAlarm();
  if(view==='history'){
    const history=await query(true);
    if(epoch!==generation || ticket!==request || view!==kitchenView)return;
    if(history.error){pauseKitchen();return false;}
    historyOrders=history.data||[];
  }
  renderKitchen();updateControls();return true;
}
async function changeOrderStatus(id,status){
  if(paused||!navigator.onLine||!STATUSES.includes(status)||!signedIn||!kitchenRestaurantId||kitchenView!=='active')return;
  const {data,error}=await db.from('orders').update({status}).eq('id',id).eq('restaurant_id',kitchenRestaurantId).select('id');
  if(error||!data?.length){message('Status was not saved: '+(error?.message||'No permission or order missing'));await refreshOrders();return;}
  await refreshOrders();
}
async function clearOrders(){
  if(paused||!navigator.onLine||!signedIn || !kitchenRestaurantId || kitchenView!=='active')return;
  if(!confirm('Archive all Served and Cancelled orders? They stay in the database.'))return;
  const {error}=await db.from('orders').update({archived:true}).eq('restaurant_id',kitchenRestaurantId).in('status',['Served','Cancelled']).eq('archived',false);
  if(error)message('Archive failed: '+error.message);
  await refreshOrders();
}
el('tab-active').addEventListener('click',()=>switchKitchenView('active'));
el('tab-history').addEventListener('click',()=>switchKitchenView('history'));
el('kitchen-list').addEventListener('change',async event=>{
  if(!event.target.matches('select[data-order]'))return;
  event.target.disabled=true;
  try{await changeOrderStatus(event.target.dataset.order,event.target.value);}
  catch(error){message(error.message);await refreshOrders();}
  finally{event.target.disabled=paused||!signedIn;}
});
let currentKitchenUser=null;
let paused=false, recovering=false, networkEpoch=0;
function updateControls(){
  el('archive-finished').disabled=paused||!signedIn;
  el('kitchen-list').querySelectorAll('select').forEach(x=>x.disabled=paused||!signedIn);
  el('sound-test').disabled=paused||!signedIn;
  el('sound-toggle').disabled=paused||!signedIn;
}
function pauseKitchen(){
  if(!signedIn)return;
  if(!paused){paused=true;networkEpoch++;request++;}
  stopAlarm();updateControls();
  message('Offline or connection interrupted · last loaded orders are read-only · reconnecting automatically…');
}
async function recoverKitchen(){
  if(!signedIn||recovering||!navigator.onLine)return;
  recovering=true;
  const epoch=generation, net=networkEpoch;
  try{
    if(!await checkKitchenAccess()||epoch!==generation||net!==networkEpoch||!navigator.onLine)return;
    if(paused){
      const ok=await refreshOrders(true);
      if(!ok||epoch!==generation||net!==networkEpoch||!navigator.onLine)return;
      if(!await checkKitchenAccess()||epoch!==generation||net!==networkEpoch||!navigator.onLine)return;
      paused=false;updateControls();syncAlarm();message('Connection restored · orders synchronized');
    }
  }finally{recovering=false;}
}
let accessCheck=null, forcedReason='', revoking=false;
async function revokeKitchen(reason){
  if(revoking)return;
  revoking=true;forcedReason=reason;
  await sessionChanged(null);
  const button=el('login').querySelector('button[type=submit]');button.disabled=true;
  try{
    const {error}=await db.auth.signOut({scope:'local'});
    if(error)throw error;
  }catch(e){message(reason+' Sign out could not finish; reconnect and reload.');return;}
  finally{revoking=false;button.disabled=false;}
  message(reason);
}
async function checkKitchenAccess(){
  if(!signedIn||revoking)return false;
  if(!navigator.onLine){pauseKitchen();return false;}
  const epoch=generation, user=currentKitchenUser, restaurant=kitchenRestaurantId;
  if(accessCheck?.epoch===epoch)return accessCheck.promise;
  const promise=(async()=>{
    try{
      const {data,error}=await db.from('kitchen_staff').select('restaurant_id,is_active').eq('user_id',user).maybeSingle().abortSignal(AbortSignal.timeout(8000));
      if(epoch!==generation)return false;
      if(error)throw error;
      if(!data||data.is_active!==true||data.restaurant_id!==restaurant){await revokeKitchen('Kitchen access disabled or changed. Contact your administrator.');return false;}
      return true;
    }catch(e){if(epoch===generation)pauseKitchen();return false;}
  })();
  accessCheck={epoch,promise};
  try{return await promise;}finally{if(accessCheck?.promise===promise)accessCheck=null;}
}
async function sessionChanged(session){
  if(session && revoking)return;
  if(session && signedIn && currentKitchenUser===session.user.id)return;
  currentKitchenUser=session?.user.id||null;
  const epoch=++generation;
  signedIn=false;paused=false;networkEpoch++;updateControls();
  soundEnabled=false;pendingKnown=false;stopAlarm();syncAlarm();
  kitchenRestaurantId = null;
  if(channel){db.removeChannel(channel);channel=null;}
  orders=[];historyOrders=[];el('kitchen-list').replaceChildren();el('kitchen-stats').textContent='';
  el('login').classList.toggle('hidden',!!session);
  el('logout').classList.toggle('hidden',!session);
  if(!session){message(forcedReason||'Sign in with an authorized kitchen account.');return;}
  const {data,error}=await db.from('kitchen_staff').select('user_id, restaurant_id, is_active').eq('user_id',session.user.id).maybeSingle();
  if(epoch!==generation)return;
  if(error){message('Connection unavailable · retrying account verification…');setTimeout(()=>{if(epoch===generation)sessionChanged(session).catch(e=>message(e.message));},5000);return;}
  if(!data){await revokeKitchen('Kitchen access could not be verified. Contact your administrator.');return;}
  if(data.is_active!==true){await revokeKitchen('Kitchen account disabled. Contact your administrator.');return;}
  if(!data.restaurant_id){await revokeKitchen('No restaurant assigned to this kitchen account.');return;}
  kitchenRestaurantId=data.restaurant_id;
  signedIn=true;updateControls();syncAlarm();message('Connecting live orders…');
  channel=db.channel('kitchen-orders').on('postgres_changes',
    {event:'*',schema:'public',table:'orders',filter:'restaurant_id=eq.'+kitchenRestaurantId},()=>{refreshOrders().catch(e=>message(e.message));})
    .subscribe(status=>{
      if(epoch!==generation)return;
      if(status==='SUBSCRIBED'){if(paused){recoverKitchen().catch(()=>pauseKitchen());return;}message('Live connected · auto refresh backup every 15 seconds');refreshOrders().catch(()=>pauseKitchen());}
      else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))
        message('Live connection interrupted · retrying with 15-second refresh backup');
    });
  await refreshOrders();
}
el('login').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.target.querySelector('button[type=submit]');button.disabled=true;
  try{
    forcedReason='';
    const identifier=el('email').value.trim();
    const username=identifier.toLowerCase();
    if(!identifier.includes('@')&&!/^[a-z0-9_]{3,30}$/.test(username))throw Error('Enter a valid username or email.');
    const email=identifier.includes('@')?identifier:username+'@kitchen.nosh-webar.invalid';
    const {error}=await db.auth.signInWithPassword({email,password:el('password').value});
    if(error)throw error;
    el('password').value='';el('password').type='password';el('toggle-password').textContent='Show';el('toggle-password').setAttribute('aria-pressed','false');
  }catch(error){message('Sign in failed: '+error.message);}
  finally{button.disabled=false;}
});
el('toggle-password').onclick=()=>{const field=el('password');const show=field.type==='password';field.type=show?'text':'password';el('toggle-password').textContent=show?'Hide':'Show';el('toggle-password').setAttribute('aria-pressed',String(show));};
el('logout').onclick=async()=>{
  const {error}=await db.auth.signOut();
  if(error)message('Sign out failed: '+error.message);
};
try{
  db=window.createNoshClient(true);
  db.auth.onAuthStateChange((event,session)=>{
    if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT'].includes(event))
      setTimeout(()=>sessionChanged(session).catch(e=>message(e.message)),0);
  });
  setInterval(()=>recoverKitchen().catch(()=>pauseKitchen()),5000);
  setInterval(()=>refreshOrders().catch(e=>message(e.message)),15000);
  window.addEventListener('online',()=>recoverKitchen().catch(()=>pauseKitchen()));
  window.addEventListener('offline',()=>{networkEpoch++;pauseKitchen();});
  document.addEventListener('visibilitychange',async()=>{if(!document.hidden){await recoverKitchen();if(!paused)await refreshOrders();}});
}catch(error){message(error.message);}