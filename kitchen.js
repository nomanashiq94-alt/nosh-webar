const STATUSES = ['Received','Preparing','Ready','Served','Cancelled'];
let db, channel, orders=[], generation=0, request=0, signedIn=false;
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('en-PK');
function message(text){el('connection').textContent=text;}
function renderKitchen(){
  const active=orders.filter(o=>!['Served','Cancelled'].includes(o.status));
  const total=orders.filter(o=>o.status!=='Cancelled').reduce((n,o)=>n+Number(o.total),0);
  el('kitchen-stats').textContent='Unarchived orders: '+orders.length+' | Active: '+active.length+' | Order value: Rs. '+money(total)+' (not verified payments)';
  el('kitchen-list').innerHTML=orders.length?orders.map(o=>`
    <div class="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
      <div class="flex justify-between gap-3"><div><span class="text-xs text-amber-400">${esc(o.id)}</span><h3 class="text-lg font-bold">Table ${esc(String(o.table).padStart(2,'0'))}</h3></div><b>${esc(o.status)}</b></div>
      <div class="text-xs text-slate-400"><p>Customer: ${esc(o.name)} (${esc(o.phone||'N/A')})</p><p>Payment: ${esc(o.payment)} at Counter</p><p>${esc(new Date(o.createdAt).toLocaleString())}</p></div>
      <div class="bg-slate-950 p-3 rounded-xl space-y-1">${o.items.filter(i=>i && typeof i === "object").map(i=>`<div class="flex justify-between gap-2 text-sm"><span>${esc(i.quantity)} × ${esc(i.title)}</span><span>Rs. ${money(Number(i.price)*Number(i.quantity))}</span></div>`).join('')}</div>
      <div class="flex justify-between items-center"><b class="text-amber-400">Rs. ${money(o.total)}</b>
      <select aria-label="Order status" data-order="${esc(o.id)}" class="admin-input text-xs !w-auto">${STATUSES.map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>`).join(''):'<p class="col-span-full text-slate-400 py-12 text-center">No unarchived orders. Waiting for customers…</p>';
}
async function refreshOrders(){
  if(!signedIn)return;
  const epoch=generation, ticket=++request;
  const {data,error}=await db.from('orders').select('*').eq('archived',false).order('createdAt',{ascending:false});
  if(epoch!==generation || ticket!==request)return;
  if(error){message('Could not load orders: '+error.message);return;}
  orders=data;renderKitchen();
}
async function changeOrderStatus(id,status){
  if(!STATUSES.includes(status)||!signedIn)return;
  const {data,error}=await db.from('orders').update({status}).eq('id',id).select('id');
  if(error||!data?.length){message('Status was not saved: '+(error?.message||'No permission or order missing'));await refreshOrders();return;}
  await refreshOrders();
}
async function clearOrders(){
  if(!signedIn)return;
  if(!confirm('Archive all Served and Cancelled orders? They stay in the database.'))return;
  const {error}=await db.from('orders').update({archived:true}).in('status',['Served','Cancelled']).eq('archived',false);
  if(error)message('Archive failed: '+error.message);
  await refreshOrders();
}
el('kitchen-list').addEventListener('change',async event=>{
  if(!event.target.matches('select[data-order]'))return;
  event.target.disabled=true;
  try{await changeOrderStatus(event.target.dataset.order,event.target.value);}
  catch(error){message(error.message);await refreshOrders();}
  finally{event.target.disabled=false;}
});
async function sessionChanged(session){
  const epoch=++generation;
  signedIn=false;
  if(channel){db.removeChannel(channel);channel=null;}
  orders=[];el('kitchen-list').replaceChildren();el('kitchen-stats').textContent='';
  el('login').classList.toggle('hidden',!!session);
  el('logout').classList.toggle('hidden',!session);
  if(!session){message('Sign in with an authorized kitchen account.');return;}
  const {data,error}=await db.from('kitchen_staff').select('user_id').eq('user_id',session.user.id).maybeSingle();
  if(epoch!==generation)return;
  if(error||!data){message('This account has no kitchen access. Add its Auth UID to kitchen_staff.');return;}
  signedIn=true;message('Connecting live orders…');
  channel=db.channel('kitchen-orders').on('postgres_changes',
    {event:'*',schema:'public',table:'orders'},()=>{refreshOrders().catch(e=>message(e.message));})
    .subscribe(status=>{
      if(epoch!==generation)return;
      if(status==='SUBSCRIBED'){message('Live connected · auto refresh backup every 15 seconds');refreshOrders().catch(e=>message(e.message));}
      else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))
        message('Live connection interrupted · retrying with 15-second refresh backup');
    });
  await refreshOrders();
}
el('login').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.target.querySelector('button');button.disabled=true;
  try{
    const {error}=await db.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});
    if(error)throw error;
    el('password').value='';
  }catch(error){message('Sign in failed: '+error.message);}
  finally{button.disabled=false;}
});
el('logout').onclick=async()=>{
  const {error}=await db.auth.signOut();
  if(error)message('Sign out failed: '+error.message);
};
try{
  db=window.createNoshClient(true);
  db.auth.onAuthStateChange((event,session)=>{
    if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','TOKEN_REFRESHED'].includes(event))
      setTimeout(()=>sessionChanged(session).catch(e=>message(e.message)),0);
  });
  setInterval(()=>refreshOrders().catch(e=>message(e.message)),15000);
  window.addEventListener('online',()=>refreshOrders().catch(e=>message(e.message)));
  window.addEventListener('offline',()=>message('Offline · displayed orders may be out of date'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOrders().catch(e=>message(e.message));});
}catch(error){message(error.message);}
