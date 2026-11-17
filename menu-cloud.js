
let menuDb = null, menuRequest = 0;
let activeRestaurantId = null;

function menuMessage(text) {
  document.getElementById('menu-connection').textContent = text;
}

function paintMenu() {
  if (!categories().includes(currentCategory)) {
    currentCategory = 'All Items';
  }

  cart = cart.flatMap(c => {
    const latest = resolveSize(
      menuItems.find(i => i.id === c.id),
      c.size
    );
    return latest ? [{ ...latest, quantity: c.quantity }] : [];
  });

  renderCategories();
  renderMenu();
  updateCartUI();

  if (!menuItems.some(i => i.available)) {
    document.getElementById('menu-container').textContent =
      menuReady ? 'No dishes available right now.' : 'Loading menu…';
  }
}

async function loadMenu() {
  if (!menuDb || !activeRestaurantId) return;

  const ticket = ++menuRequest;

  const { data, error } = await menuDb
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', activeRestaurantId)
    .order('sort_order')
    .order('id');

  if (ticket !== menuRequest) return;

  if (error) {
    menuMessage('Menu unavailable: ' + error.message);
    return;
  }

  menuItems = data.map(i => ({
    ...i,
    price: Number(i.price)
  }));

  menuReady = true;
  paintMenu();
}

async function startCloud() {
  try {
    menuDb = window.createNoshClient();

    const slug = window.NOSH_RESTAURANT?.slug;

    if (!slug) {
      throw new Error('Restaurant identification missing');
    }

    const { data: restaurant, error } = await menuDb
      .from('restaurants')
      .select('id, name, slug')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;

    if (!restaurant) {
      throw new Error('Restaurant not found or inactive');
    }

    activeRestaurantId = restaurant.id;

    window.NOSH_ACTIVE_RESTAURANT = restaurant;

    menuDb.channel('public-menu-' + activeRestaurantId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'menu_items',
        filter: 'restaurant_id=eq.' + activeRestaurantId
      }, () => loadMenu().catch(e => menuMessage(e.message)))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          menuMessage('Menu connected');
          loadMenu().catch(e => menuMessage(e.message));
        } else if (
          ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)
        ) {
          menuMessage('Live menu reconnecting');
        }
      });

    await loadMenu();

    setInterval(
      () => loadMenu().catch(e => menuMessage(e.message)),
      15000
    );

    window.addEventListener('online',
      () => loadMenu().catch(e => menuMessage(e.message))
    );

    window.addEventListener('offline',
      () => menuMessage('Offline · reconnect before ordering')
    );

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        loadMenu().catch(e => menuMessage(e.message));
      }
    });

  } catch (error) {
    menuMessage(error.message);
  }
}
