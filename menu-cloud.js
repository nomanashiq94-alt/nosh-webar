let menuDb = null, menuRequest = 0;
let activeRestaurantId = null;
let lastMenuSignature = null;
let reloadTimer;
let statusRequest = 0;
function menuMessage(text) { document.getElementById('menu-connection').textContent = text; }
async function refreshOrderingStatus() {
  if (!menuDb || !activeRestaurantId) return;
  const ticket = ++statusRequest;
  try {
    const [{data,error}, config] = await Promise.all([
      menuDb.rpc('get_restaurant_ordering_status', {p_restaurant_id:activeRestaurantId}),
      menuDb.from('restaurants').select('table_count,tax_percent,service_charge_percent,cash_enabled,card_enabled,customer_name_required,customer_phone_required').eq('id',activeRestaurantId).eq('status','active').single()
    ]);
    if (ticket !== statusRequest) return;
    if (error || typeof data !== 'boolean') throw error || Error('Invalid ordering status');
    if(config.error || !config.data) throw config.error || Error('Settings unavailable');
    applySettings(config.data);
    setOrderingState(data ? 'allowed' : 'blocked');
  } catch (error) {
    if (ticket === statusRequest) { restaurantSettings=null; setOrderingState('checking'); }
  }
}
function paintMenu() {
  if (!categories().includes(currentCategory)) currentCategory = 'All Items';
  cart = cart.flatMap(c => {
    const latest = resolveSize(menuItems.find(i => i.id === c.id), c.size);
    return latest ? [{ ...latest, quantity: c.quantity }] : [];
  });
  renderCategories(); renderMenu(); updateCartUI();
  if (!menuItems.some(i => i.available)) document.getElementById('menu-container').textContent = menuReady ? 'No dishes available right now.' : 'Loading menu…';
}
async function loadMenu() {
  if (!menuDb || !activeRestaurantId) return;
  const ticket = ++menuRequest;
  const status = refreshOrderingStatus();
  const {data,error} = await menuDb.from('menu_items').select('*').eq('restaurant_id',activeRestaurantId).order('sort_order').order('id');
  await status;
  if (ticket !== menuRequest) return;
  if (error || !Array.isArray(data)) { menuMessage('Menu unavailable · retrying'); return; }
  if (!navigator.onLine) return;
  menuMessage('Menu connected');
  const signature = JSON.stringify(data);
  if (menuReady && signature === lastMenuSignature) return;
  menuItems = data.map(i => ({...i,price:Number(i.price)}));
  lastMenuSignature = signature;
  menuReady = true; paintMenu();
}
async function startCloud() {
  try {
    menuDb = window.createNoshClient();
    const slug = window.NOSH_RESTAURANT?.slug;
    if (!slug) throw Error('Restaurant identification missing');
    const {data:restaurant,error} = await menuDb.from('restaurants').select('id,name,slug,logo_url,primary_color,secondary_color,background_color,card_color,text_color,price_color,button_text_color,border_color,muted_text_color').eq('slug',slug).eq('status','active').maybeSingle();
    if (error) throw error;
    if (!restaurant) throw Error('Restaurant not found or inactive');
    activeRestaurantId = restaurant.id;
    window.NOSH_ACTIVE_RESTAURANT = restaurant;
    window.dispatchEvent(new Event('nosh-restaurant-resolved'));
    const reload = () => { clearTimeout(reloadTimer); reloadTimer=setTimeout(() => { if(navigator.onLine) loadMenu().catch(e => menuMessage(e.message)); },150); };
    menuDb.channel('public-menu-'+activeRestaurantId).on('postgres_changes',{event:'*',schema:'public',table:'menu_items',filter:'restaurant_id=eq.'+activeRestaurantId},reload).subscribe(status => {
      if (status === 'SUBSCRIBED') { menuMessage('Menu connected'); if(menuReady) reload(); }
      else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) menuMessage('Live menu reconnecting');
    });
    await loadMenu();
    setInterval(()=>{if(!document.hidden) reload();},15000);
    window.addEventListener('online',reload);
    window.addEventListener('offline',()=>{ ++statusRequest; ++menuRequest; restaurantSettings=null; setOrderingState('checking'); menuMessage('Offline · reconnect before ordering'); });
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) reload();});
  } catch(error) { menuMessage(error.message); setOrderingState('checking'); }
}
