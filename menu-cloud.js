let menuDb = null, menuRequest = 0;
function menuMessage(text){document.getElementById('menu-connection').textContent=text;}
function paintMenu(){
  if(!categories().includes(currentCategory))currentCategory='All Items';
  cart=cart.flatMap(c=>{const latest=menuItems.find(i=>i.id===c.id&&i.available);return latest?[{...latest,quantity:c.quantity}]:[];});
  renderCategories();renderMenu();updateCartUI();
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
    menuDb = window.createNoshClient();
    menuDb.channel('public-menu').on('postgres_changes',
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
