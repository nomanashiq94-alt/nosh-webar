let adminDb = null;
let adminAuthorized = false;
let adminEpoch = 0;
let menuItems = [];

function adminMessage(text) {
  document.getElementById('admin-message').textContent = text;
}

async function loadMenu() {
  if (!adminAuthorized) return;
  const epoch = adminEpoch;
  const { data, error } = await adminDb.from('menu_items').select('*').order('sort_order').order('id');
  if (epoch !== adminEpoch) return;
  if (error) throw error;
  menuItems = data.map(item => ({ ...item, price: Number(item.price) }));
  renderAdminList();
}

    const money = n => 'Rs. ' + Number(n || 0).toLocaleString('en-PK', {maximumFractionDigits:0});
    const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
    // Model Viewer dimensions are in metres. Apply uniform scaling to target physical size.
    async function calibrateViewer(viewer,item,output) {
      const width=Number(item.widthCm);
      if(!Number.isFinite(width)||width<=0){viewer.scale='1 1 1';if(output)output.textContent='No size calibration set';return;}
      try {
        await viewer.updateComplete;
        const d=viewer.getDimensions();
        const axis=item.widthAxis||'maxXZ';
        const dimension=axis==='x'?d.x:axis==='y'?d.y:axis==='z'?d.z:Math.max(d.x,d.z);
        if(!Number.isFinite(dimension)||dimension<=0)throw Error('Model has invalid dimensions');
        const factor=(width/100)/dimension;
        viewer.scale=`${factor} ${factor} ${factor}`;
        if(output)output.textContent=`GLB measured ${(dimension*100).toFixed(1)} cm → target ${width} cm (scale ×${factor.toFixed(3)}). Check AR on device.`;
      } catch(e){viewer.scale='1 1 1';if(output)output.textContent='Could not measure GLB: '+e.message;}
    }
    async function previewUploads(){
      const area=document.getElementById('upload-preview');area.replaceChildren();
      const img=document.getElementById('upload-image').files[0];
      if(img){const el=document.createElement('img');el.src=URL.createObjectURL(img);el.className='w-32 h-24 object-cover rounded-xl';el.onload=()=>URL.revokeObjectURL(el.src);area.append(el);}
      const glb=document.getElementById('upload-model').files[0];
      if(glb){const viewer=document.createElement('model-viewer');viewer.src=URL.createObjectURL(glb);viewer.setAttribute('camera-controls','');viewer.style.height='220px';viewer.className='rounded-xl bg-slate-900';area.append(viewer);
        const status=document.createElement('p');status.className='text-xs text-amber-300';area.append(status);
        viewer.addEventListener('load',()=>calibrateViewer(viewer,{widthCm:document.getElementById('edit-width').value,widthAxis:document.getElementById('edit-axis').value},status));
      }
      const usdz=document.getElementById('upload-usdz').files[0];
      if(usdz){const label=document.createElement('p');label.textContent='Selected USDZ: '+usdz.name;area.append(label);}
    }
    for(const type of ['image','model','usdz'])document.getElementById('upload-'+type).addEventListener('change',previewUploads);
    function showToast(msg) {
      const toast = document.getElementById('toast-notification');
      document.getElementById('toast-message').textContent = msg;

      toast.classList.remove('-translate-y-20', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');

      setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-20', 'opacity-0');
      }, 3000);
    }

    function newItem() { fillEditor(null); }
    function editItem(id) { fillEditor(menuItems.find(i => i.id === id)); }
    function fillEditor(i) {
      if(!adminAuthorized)return adminMessage('Admin login required.');
      document.getElementById('admin-form').classList.remove('hidden');
      document.getElementById('editor-title').textContent = i ? 'Edit dish' : 'Add dish';
      for (const [field, val] of Object.entries({id:i?.id||'',title:i?.title||'',category:i?.category||'',price:i?.price??'',description:i?.description||'',image:i?.image||'',model:i?.modelUrl||'',usdz:i?.usdzUrl||'',width:i?.widthCm||''})) document.getElementById('edit-'+field).value=val;
      document.getElementById('edit-axis').value=i?.widthAxis||'maxXZ';
      document.getElementById('edit-available').checked=i?.available??true;
      for(const type of ['image','model','usdz'])document.getElementById('upload-'+type).value='';
      document.getElementById('upload-preview').replaceChildren();
      document.getElementById('admin-form').scrollIntoView({behavior:'smooth',block:'start'});
    }
    function exportMenu() {
      const blob = new Blob([JSON.stringify(menuItems,null,2)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nosh-menu.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
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
  adminMessage('Admin connected · Save publishes changes to all customers.');
  await loadMenu();
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

try {
  adminDb = window.createNoshAdminClient();
  adminDb.auth.onAuthStateChange((event, session) => {
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
      setTimeout(() => adminSession(session).catch(error => adminMessage(error.message)), 0);
    }
  });
} catch (error) {
  adminMessage(error.message);
}
