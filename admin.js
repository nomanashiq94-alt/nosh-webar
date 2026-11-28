const sizeLabels = {small: 'Small', medium: 'Medium', large: 'Large'};

document.getElementById('size-fields').innerHTML = Object.entries(sizeLabels).map(([key, label]) => `
  <div class="space-y-2">
    <p class="text-sm font-semibold">${label}</p>
    <label class="block text-xs">Price (PKR)<input id="size-${key}-price" class="admin-input" type="number" min="0" max="999999" step="0.01"></label>
    <label class="block text-xs">Diameter (cm)<input id="size-${key}-width" class="admin-input" type="number" min="1" max="200" step="0.1"></label>
    <label class="block text-xs">iPhone AR URL (optional)<input id="size-${key}-usdz" class="admin-input" type="url" placeholder="https://…"></label>
  </div>
`).join('');

function readSizeOptions() {
  const sizes = {};
  for (const key of Object.keys(sizeLabels)) {
    const price = document.getElementById('size-' + key + '-price').value;
    if (price === '') continue;
    const width = document.getElementById('size-' + key + '-width').value;
    const usdz = document.getElementById('size-' + key + '-usdz').value.trim();
    if (usdz && !safeUrl(usdz)) throw Error('Use an HTTPS iPhone AR URL for ' + sizeLabels[key] + '.');
    sizes[key] = {price: Number(price)};
    if (width) sizes[key].widthCm = Number(width);
    if (usdz) sizes[key].usdzUrl = safeUrl(usdz);
  }
  return sizes;
}

let adminDb = null;
let adminAuthorized = false;
let adminEpoch = 0;
let adminUserId = null;
let adminCheckingAccess = false;
let menuItems = [];
let adminRestaurantId = null;
let adminIsSuper = false;

async function chooseAdminRestaurant(id) {
  if (!adminAuthorized) return;
  const select = document.getElementById('admin-restaurant');
  if (!Array.from(select.options).some(option => option.value === id)) return;
  const requestEpoch=adminEpoch;
  adminRestaurantId = id;
  document.getElementById('admin-form').classList.add('hidden');
  menuItems = [];
  renderAdminList();
  await loadMenu();
  if(requestEpoch===adminEpoch&&adminRestaurantId===id)adminMessage('Managing: ' + select.selectedOptions[0].textContent);
}


function adminMessage(text) {
  document.getElementById('admin-message').textContent = text;
}

async function loadMenu() {
  if (!adminAuthorized || !adminRestaurantId) return;
  const epoch = adminEpoch;
  const restaurantId = adminRestaurantId;
  const { data, error } = await adminDb.from('menu_items').select('*').eq('restaurant_id',restaurantId).order('sort_order').order('id');
  if (epoch !== adminEpoch || restaurantId !== adminRestaurantId) return;
  if (error) throw error;
  menuItems = data.map(item => ({ ...item, price: Number(item.price) }));
  renderAdminList();
}

    const money = n => 'Rs. ' + Number(n || 0).toLocaleString('en-PK', {maximumFractionDigits:2});
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
      if(!adminAuthorized||!adminRestaurantId)return adminMessage('Select a restaurant first.');
      document.getElementById('admin-form').classList.remove('hidden');
      document.getElementById('editor-title').textContent = i ? 'Edit dish' : 'Add dish';
      for (const [field, val] of Object.entries({id:i?.id||'',title:i?.title||'',category:i?.category||'',price:i?.price??'',description:i?.description||'',image:i?.image||'',model:i?.modelUrl||'',usdz:i?.usdzUrl||'',width:i?.widthCm||''})) document.getElementById('edit-'+field).value=val;
      document.getElementById('edit-axis').value=i?.widthAxis||'maxXZ';
      for (const key of Object.keys(sizeLabels)) {
        const option = i?.sizes?.[key];
        document.getElementById('size-' + key + '-price').value = option?.price ?? '';
        document.getElementById('size-' + key + '-width').value = option?.widthCm ?? '';
        document.getElementById('size-' + key + '-usdz').value = option?.usdzUrl ?? '';
      }
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
  const userId = session?.user.id ?? null;
  if (userId && userId === adminUserId && (adminAuthorized || adminCheckingAccess)) return;

  const epoch = ++adminEpoch;
  adminUserId = userId;
  adminAuthorized = false;
  adminRestaurantId = null;
  adminIsSuper = false;
  document.getElementById('admin-restaurant-wrap').classList.add('hidden');
  adminCheckingAccess = !!userId;
  document.getElementById('admin-form').classList.add('hidden');
  document.getElementById('admin-login').classList.toggle('hidden',!!session);
  document.getElementById('admin-logout').classList.toggle('hidden',!session);
  document.getElementById('admin-tools').classList.add('hidden');renderAdminList();
  if(!session){adminMessage('Sign in to edit the shared menu.');return;}
  try {
    const [{data:superAdmin,error:superError},membershipResult]=await Promise.all([adminDb.from('super_admins').select('user_id').eq('user_id',userId).maybeSingle(),adminDb.from('menu_admins').select('restaurant_id').eq('user_id',userId).maybeSingle()]);
    if(epoch!==adminEpoch)return;
    if(superError)throw superError;
    adminIsSuper=!!superAdmin;
    let restaurants=[];
    if(adminIsSuper){
      const {data,error}=await adminDb.from('restaurants').select('id,name,slug').order('name');
      if(error)throw error;
      restaurants=data||[];
    }else{
      const {data:membership,error}=membershipResult;
      if(error)throw error;
      if(membership?.restaurant_id){
        const {data,error:restaurantError}=await adminDb.from('restaurants').select('id,name,slug').eq('id',membership.restaurant_id).maybeSingle();
        if(restaurantError)throw restaurantError;
        if(data)restaurants=[data];
      }
    }
    if(epoch!==adminEpoch)return;
    if(!restaurants.length){adminMessage('No restaurant assigned or available.');return;}
    const select=document.getElementById('admin-restaurant');
    select.replaceChildren();
    for(const restaurant of restaurants){
      const option=document.createElement('option');
      option.value=restaurant.id;
      option.textContent=restaurant.name+' ('+restaurant.slug+')';
      select.append(option);
    }
    adminAuthorized=true;
    document.getElementById('admin-restaurant-wrap').classList.remove('hidden');
    document.getElementById('admin-tools').classList.remove('hidden');
    const requestedId = new URLSearchParams(
  window.location.search
).get('restaurant_id');

const selected = restaurants.find(
  restaurant => restaurant.id === requestedId
);

if (requestedId && !selected) {
  adminMessage('You do not have access to the requested restaurant.');
  return;
}

const targetId = selected ? selected.id : restaurants[0].id;

select.value = targetId;
await chooseAdminRestaurant(targetId);
  } catch (error) {
    if (epoch === adminEpoch) adminMessage(error.message);
  } finally {
    if (epoch === adminEpoch) adminCheckingAccess = false;
  }
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
    const summary=document.createElement('div');summary.className='text-xs text-amber-400';summary.textContent=(Object.keys(item.sizes || {}).length ? 'From ' + money(Math.min(...Object.values(item.sizes).map(size => size.price))) : money(item.price))+' · '+item.category+' · '+(item.available?'Available':'Unavailable');
    info.append(title,summary);
    const actions=document.createElement('div');actions.className='flex gap-2';
    const edit=document.createElement('button');edit.className='bg-slate-700 rounded-lg p-2 text-xs';edit.textContent='Edit';edit.onclick=()=>editItem(item.id);
    const remove=document.createElement('button');remove.className='bg-red-900/60 text-red-200 rounded-lg p-2 text-xs';remove.textContent='Delete';remove.onclick=()=>deleteItem(item.id);
    actions.append(edit,remove);row.append(info,actions);list.append(row);
  });
}
async function saveItem(e){
  e.preventDefault();if(!adminAuthorized||!adminRestaurantId)return adminMessage('Select a restaurant first.');
  const get=k=>document.getElementById('edit-'+k).value.trim();
  let sizes;
  try { sizes = readSizeOptions(); }
  catch (error) { return alert(error.message); }
  const firstSize = Object.values(sizes)[0];
  if (!firstSize && get('price') === '') return alert('Enter a single-size price or at least one size price.');
  const id=get('id')||'dish-'+crypto.randomUUID(),price=firstSize?.price ?? Number(get('price')),width=Number(get('width'))||null;
  if(!get('title')||!get('category')||!Number.isFinite(price)||price<0||price>999999)
    return alert('Enter a dish name, category and valid price (0–999999).');
  const restaurantId=adminRestaurantId;
  const item={id,restaurant_id:restaurantId,title:get('title'),category:get('category'),price,sizes,description:get('description'),
    image:safeUrl(get('image')),modelUrl:safeUrl(get('model')),usdzUrl:safeUrl(get('usdz')),
    widthCm:width,widthAxis:document.getElementById('edit-axis').value,
    available:document.getElementById('edit-available').checked,
    sort_order:menuItems.find(i=>i.id===id)?.sort_order??menuItems.length};
  const button=e.target.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Uploading / saving…';
  try{
    for(const type of ['image','model','usdz']){
      const file=document.getElementById('upload-'+type).files[0];if(!file)continue;
      const valid=type==='image'?['image/jpeg','image/png','image/webp'].includes(file.type):file.name.toLowerCase().endsWith('.'+(type==='model'?'glb':'usdz'));
      if(!valid||file.size===0||file.size>(type==='image'?5:50)*1024*1024)throw Error('Invalid or oversized '+type+' file.');
      const ext=type==='image'?({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type]):type==='model'?'glb':'usdz';
      const path=restaurantId+'/'+id+'/'+crypto.randomUUID()+'.'+ext;
      document.getElementById('upload-status').textContent='Uploading '+type+'…';
      const {error}=await adminDb.storage.from('menu-media').upload(path,file,{
        cacheControl:'31536000',upsert:false,contentType:type==='model'?'model/gltf-binary':type==='usdz'?'model/vnd.usdz+zip':file.type
      });
      if(error)throw error;
      const {data}=adminDb.storage.from('menu-media').getPublicUrl(path);
      item[type==='image'?'image':type==='model'?'modelUrl':'usdzUrl']=data.publicUrl;
    }
    if(restaurantId!==adminRestaurantId)throw Error('Restaurant changed; please save again.');
    const {error}=await adminDb.from('menu_items').upsert(item,{onConflict:'id'});if(error)throw error;
    document.getElementById('admin-form').classList.add('hidden');
    document.getElementById('upload-status').textContent='Saved to cloud storage.';
    await loadMenu();showToast('Dish published to all customers');
  }catch(error){alert('Could not publish dish: '+error.message);}
  finally{button.disabled=false;button.textContent='Save dish';}
}
async function deleteItem(id){
  if(!adminAuthorized||!adminRestaurantId)return adminMessage('Select a restaurant first.');
  if(!confirm('Delete this dish from the shared menu on ALL devices? Existing orders are kept.'))return;
  try{
    const {error}=await adminDb.from('menu_items').delete().eq('id',id).eq('restaurant_id',adminRestaurantId);if(error)throw error;
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
