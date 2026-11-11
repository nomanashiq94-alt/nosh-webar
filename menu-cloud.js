let menuDb=null,adminDb=null,menuChannel=null,menuRequest=0,adminAuthorized=false,adminEpoch=0;
function menuMessage(text){document.getElementById('menu-connection').textContent=text;}
function adminMessage(text){document.getElementById('admin-message').textContent=text;}
function paintMenu(){
  if(!categories().includes(currentCategory))currentCategory='All Items';
  cart=cart.flatMap(c=>{const latest=menuItems.find(i=>i.id===c.id&&i.available);return latest?[{...latest,quantity:c.quantity}]:[];});
  renderCategories();renderMenu();updateCartUI();renderAdminList();
  if(!menuItems.some(i=>i.available))document.getElementById('menu-container').textContent=menuReady?'No dishes available right now.':'Loading menu…';
}
async function loadMenu(){
  if(!menuDb)return;
  const ticket=++menuRequest;
  const {data,error}=await menuDb.from('menu_items').select('*').order('sort_order').order('id');
  if(ticket!==menuRequest)return;
  if(error){menuMessage('Menu unavailable: '+error.message+' · Please ask staff for help.');return;}
  menuItems=data.map(i=>({...i,price:Number(i.price)}));menuReady=true;paintMenu();
}
async function startCloud(){
  try{
    menuDb=window.createNoshClient();adminDb=window.createNoshAdminClient();
    adminDb.auth.onAuthStateChange((event,session)=>{
      if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','TOKEN_REFRESHED'].includes(event))
        setTimeout(()=>adminSession(session).catch(e=>adminMessage(e.message)),0);
    });
    menuChannel=menuDb.channel('public-menu').on('postgres_changes',
      {event:'*',schema:'public',table:'menu_items'},()=>loadMenu().catch(e=>menuMessage(e.message)))
      .subscribe(status=>{
        if(status==='SUBSCRIBED'){menuMessage('Menu connected');loadMenu().catch(e=>menuMessage(e.message));}
        else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))menuMessage('Live menu reconnecting · automatic refresh continues');
      });
    await loadMenu();
    setInterval(()=>loadMenu().catch(e=>menuMessage(e.message)),15000);
    window.addEventListener('online',()=>loadMenu().catch(e=>menuMessage(e.message)));
    window.addEventListener('offline',()=>menuMessage('Offline · reconnect before ordering'));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadMenu().catch(e=>menuMessage(e.message));});
  }catch(error){menuMessage(error.message);}
}
async function adminSession(session){
  const epoch=++adminEpoch;adminAuthorized=false;
  document.getElementById('admin-form').classList.add('hidden');
  document.getElementById('admin-login').classList.toggle('hidden',!!session);
  document.getElementById('admin-logout').classList.toggle('hidden',!session);
  document.getElementById('admin-tools').classList.add('hidden');renderAdminList();
  if(!session){adminMessage('Sign in to edit the shared menu.');return;}
  const {data,error}=await adminDb.from('menu_admins').select('user_id').eq('user_id',session.user.id).maybeSingle();
  if(epoch!==adminEpoch)return;
  if(error||!data){adminMessage('This account has no menu admin access. Add its UID to menu_admins.');return;}
  adminAuthorized=true;document.getElementById('admin-tools').classList.remove('hidden');
  adminMessage('Admin connected · Save publishes changes to all customers.');renderAdminList();
}
async function signInAdmin(event){
  event.preventDefault();if(!adminDb)return adminMessage('Database unavailable. Check setup.');
  const button=event.target.querySelector('button');button.disabled=true;
  try{
    const {error}=await adminDb.auth.signInWithPassword({email:document.getElementById('admin-email').value.trim(),password:document.getElementById('admin-password').value});
    if(error)throw error;document.getElementById('admin-password').value='';
  }catch(error){adminMessage('Sign in failed: '+error.message);}
  finally{button.disabled=false;}
}
async function signOutAdmin(){
  if(!adminDb)return;
  const {error}=await adminDb.auth.signOut();if(error)adminMessage(error.message);
}
function openAdmin(){document.getElementById('admin-modal').classList.remove('hidden');renderAdminList();}
function closeAdmin(){document.getElementById('admin-modal').classList.add('hidden');}
function renderAdminList(){
  const list=document.getElementById('admin-list');list.replaceChildren();if(!adminAuthorized)return;
  if(!menuItems.length){list.textContent='No dishes yet. Add a dish.';return;}
  menuItems.forEach(item=>{
    const row=document.createElement('div');row.className='flex items-center justify-between gap-2 bg-slate-800 p-3 rounded-xl';
    const info=document.createElement('div');info.className='min-w-0';
    const title=document.createElement('div');title.className='font-semibold text-sm truncate';title.textContent=item.title;
    const summary=document.createElement('div');summary.className='text-xs text-amber-400';summary.textContent=money(item.price)+' · '+item.category+' · '+(item.available?'Available':'Unavailable');
    info.append(title,summary);
    const actions=document.createElement('div');actions.className='flex gap-2';
    const edit=document.createElement('button');edit.className='bg-slate-700 rounded-lg p-2 text-xs';edit.textContent='Edit';edit.onclick=()=>editItem(item.id);
    const remove=document.createElement('button');remove.className='bg-red-900/60 text-red-200 rounded-lg p-2 text-xs';remove.textContent='Delete';remove.onclick=()=>deleteItem(item.id);
    actions.append(edit,remove);row.append(info,actions);list.append(row);
  });
}
async function saveItem(e){
  e.preventDefault();if(!adminAuthorized)return adminMessage('Admin login required.');
  const get=k=>document.getElementById('edit-'+k).value.trim();
  const id=get('id')||'dish-'+crypto.randomUUID(),price=Number(get('price')),width=Number(get('width'))||null;
  if(!get('title')||!get('category')||!Number.isFinite(price)||price<0||price>999999)
    return alert('Enter a dish name, category and valid price (0–999999).');
  const item={id,title:get('title'),category:get('category'),price,description:get('description'),
    image:safeUrl(get('image')),modelUrl:safeUrl(get('model')),usdzUrl:safeUrl(get('usdz')),
    widthCm:width,widthAxis:document.getElementById('edit-axis').value,
    available:document.getElementById('edit-available').checked,
    sort_order:menuItems.find(i=>i.id===id)?.sort_order??menuItems.length};
  const button=e.target.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Uploading / saving…';
  try{
    for(const type of ['image','model','usdz']){
      const file=document.getElementById('upload-'+type).files[0];if(!file)continue;
      const valid=type==='image'?['image/jpeg','image/png','image/webp'].includes(file.type):file.name.toLowerCase().endsWith('.'+(type==='model'?'glb':'usdz'));
      if(!valid||file.size>(type==='image'?15:50)*1024*1024)throw Error('Invalid or oversized '+type+' file.');
      const ext=type==='image'?({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type]):type==='model'?'glb':'usdz';
      const path=id+'/'+crypto.randomUUID()+'.'+ext;
      document.getElementById('upload-status').textContent='Uploading '+type+'…';
      const {error}=await adminDb.storage.from('menu-media').upload(path,file,{
        cacheControl:'31536000',upsert:false,contentType:type==='model'?'model/gltf-binary':type==='usdz'?'model/vnd.usdz+zip':file.type
      });
      if(error)throw error;
      const {data}=adminDb.storage.from('menu-media').getPublicUrl(path);
      item[type==='image'?'image':type==='model'?'modelUrl':'usdzUrl']=data.publicUrl;
    }
    const {error}=await adminDb.from('menu_items').upsert(item,{onConflict:'id'});if(error)throw error;
    document.getElementById('admin-form').classList.add('hidden');
    document.getElementById('upload-status').textContent='Saved to cloud storage.';
    await loadMenu();showToast('Dish published to all customers');
  }catch(error){alert('Could not publish dish: '+error.message);}
  finally{button.disabled=false;button.textContent='Save dish';}
}
async function deleteItem(id){
  if(!adminAuthorized)return adminMessage('Admin login required.');
  if(!confirm('Delete this dish from the shared menu on ALL devices? Existing orders are kept.'))return;
  try{
    const {error}=await adminDb.from('menu_items').delete().eq('id',id);if(error)throw error;
    await loadMenu();showToast('Dish deleted from shared menu');
  }catch(error){alert('Delete failed: '+error.message);}
}
