'use strict';
const db = window.createNoshAdminClient();
const $ = id => document.getElementById(id);
const message = s => { $('message').textContent = s; };
let epoch = 0;
let selectedRestaurant = null;
const fallbackPrimary = '#f59e0b';
const fallbackSecondary = '#fbbf24';
const validColor = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;

async function refreshRestaurants() {
  const { data, error } = await db.from('restaurants')
    .select('id,name,slug,status,created_at,logo_url,primary_color,secondary_color')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const list = $('restaurants'); list.replaceChildren();
  for (const r of data) {
    const li = document.createElement('li');
    const strong = document.createElement('strong'); strong.textContent = r.name;
    const small = document.createElement('small'); small.textContent = ' · ' + r.slug + ' · ' + r.status;
    const edit = document.createElement('button'); edit.type = 'button';
    edit.className = 'restaurant-edit'; edit.textContent = 'Edit branding';
    edit.addEventListener('click', () => openBranding(r.id));
    const manage = document.createElement('button');
    manage.type = 'button'; manage.className = 'restaurant-edit';
    manage.textContent = 'Manage Menu';
    manage.addEventListener('click', () => {
      window.location.href = 'admin.html?restaurant_id=' + encodeURIComponent(r.id);
    });
    const subscription = document.createElement('button');
    subscription.type = 'button'; subscription.className = 'restaurant-edit';
    subscription.textContent = 'Manage Subscription';
    subscription.addEventListener('click', () => openSubscription(r));
    li.append(strong, small, edit, manage, subscription); list.append(li);
  }
  if (!data.length) { const li = document.createElement('li'); li.textContent = 'No restaurants yet.'; list.append(li); }
}

async function openBranding(id) {
  $('branding-section').hidden = true;
  message('Loading branding settings…');
  const { data: r, error } = await db.from('restaurants')
    .select('id,name,slug,logo_url,primary_color,secondary_color').eq('id', id).single();
  if (error || !r) { message('Cannot load restaurant: ' + (error?.message || 'Not found')); return; }
  selectedRestaurant = r;
  $('selected-restaurant').textContent = 'Editing: ' + r.name + ' (' + r.slug + ')';
  $('brand-name').value = r.name;
  $('brand-primary').value = validColor(r.primary_color, fallbackPrimary);
  $('brand-secondary').value = validColor(r.secondary_color, fallbackSecondary);
  $('brand-logo').value = r.logo_url || '';
  $('branding-status').textContent = '';
  $('logo-upload-status').textContent = '';
  $('brand-logo-file').value = '';
  updateLogoPreview();
  $('branding-section').hidden = false;
  $('branding-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  message('Branding settings loaded.');
}

function updateLogoPreview() {
  const value = $('brand-logo').value.trim();
  const img = $('logo-preview');
  if (!value || !/^https:\/\//i.test(value)) { img.hidden = true; img.removeAttribute('src'); return; }
  img.hidden = false;
  img.src = value;
  img.onerror = () => { img.hidden = true; };
}
$('brand-logo').addEventListener('change', updateLogoPreview);
// Upload a unique file per restaurant; no storage overwrite/delete policy required.
$('upload-logo').addEventListener('click', async () => {
  const restaurant = selectedRestaurant;
  if (!restaurant) return;
  const file = $('brand-logo-file').files[0];
  const status = $('logo-upload-status');
  if (!file) { status.textContent = 'Choose a logo file first.'; return; }
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!types[file.type]) { status.textContent = 'Only JPG, PNG or WebP is allowed.'; return; }
  if (file.size > 2 * 1024 * 1024 || file.size === 0) {
    status.textContent = 'Choose a non-empty image smaller than 2 MB.'; return;
  }
  const button = $('upload-logo');
  button.disabled = true;
  $('save-branding').disabled = true;
  status.textContent = 'Uploading logo…';
  try {
    const path = `${restaurant.id}/${crypto.randomUUID()}.${types[file.type]}`;
    const { error: uploadError } = await db.storage.from('restaurant-logos')
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
    if (uploadError) throw uploadError;
    const { data: publicData } = db.storage.from('restaurant-logos').getPublicUrl(path);
    const url = publicData.publicUrl;
    const { data, error: saveError } = await db.from('restaurants')
      .update({ logo_url: url }).eq('id', restaurant.id)
      .select('id,logo_url').single();
    if (saveError) throw new Error('File uploaded, but database URL update failed: ' + saveError.message);
    if (selectedRestaurant?.id === restaurant.id) {
      selectedRestaurant = { ...selectedRestaurant, logo_url: data.logo_url };
      $('brand-logo').value = data.logo_url;
      $('brand-logo-file').value = '';
      updateLogoPreview();
    }
    status.textContent = 'Logo uploaded and saved! Refresh the customer website.';
    await refreshRestaurants();
  } catch (error) {
    status.textContent = 'Upload failed: ' + error.message;
  } finally {
    button.disabled = false;
    $('save-branding').disabled = false;
  }
});

$('cancel-branding').addEventListener('click', () => { $('branding-section').hidden = true; selectedRestaurant = null; });
$('branding-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!selectedRestaurant) return;
  const name = $('brand-name').value.trim();
  const primary_color = $('brand-primary').value;
  const secondary_color = $('brand-secondary').value;
  const logo_url = $('brand-logo').value.trim() || null;
  if (!name || !/^#[0-9a-f]{6}$/i.test(primary_color) || !/^#[0-9a-f]{6}$/i.test(secondary_color)) {
    $('branding-status').textContent = 'Please enter a valid name and colors.'; return;
  }
  if (logo_url && !/^https:\/\//i.test(logo_url)) {
    $('branding-status').textContent = 'Logo URL must start with https://'; return;
  }
  const btn = $('save-branding'); btn.disabled = true;
  $('branding-status').textContent = 'Saving…';
  try {
    const { data, error } = await db.from('restaurants')
      .update({ name, primary_color, secondary_color, logo_url })
      .eq('id', selectedRestaurant.id)
      .select('id,name,primary_color,secondary_color,logo_url').single();
    if (error) throw error;
    selectedRestaurant = { ...selectedRestaurant, ...data };
    $('branding-status').textContent = 'Saved! Refresh the customer menu to see the new branding.';
    await refreshRestaurants();
    message('Branding saved for ' + data.name + '.');
  } catch (err) { $('branding-status').textContent = 'Could not save: ' + err.message; }
  finally { btn.disabled = false; }
});

let selectedSubscriptionRestaurant = null;
let subscriptionRequest = 0;

async function openSubscription(restaurant) {
  const request = ++subscriptionRequest;
  selectedSubscriptionRestaurant = null;
  $('subscription-section').hidden = true;
  $('subscription-status').textContent = '';
  message('Loading subscription…');
  try {
    const { data, error } = await db.from('restaurant_subscriptions')
      .select('restaurant_id,plan_name,monthly_fee,currency,starts_on,expires_on,payment_status,notes')
      .eq('restaurant_id', restaurant.id).maybeSingle();
    if (error) throw error;
    if (request !== subscriptionRequest) return;
    selectedSubscriptionRestaurant = restaurant;
    $('subscription-restaurant').textContent = 'Restaurant: ' + restaurant.name + ' (' + restaurant.slug + ')';
    $('sub-plan').value = data?.plan_name || 'Standard';
    $('sub-fee').value = data?.monthly_fee ?? 0;
    $('sub-currency').value = ['PKR','USD'].includes(data?.currency) ? data.currency : 'PKR';
    $('sub-start').value = data?.starts_on || '';
    $('sub-expiry').value = data?.expires_on || '';
    $('sub-payment').value = ['paid','unpaid','overdue'].includes(data?.payment_status) ? data.payment_status : 'unpaid';
    $('sub-notes').value = data?.notes || '';
    $('subscription-section').hidden = false;
    $('subscription-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    message('Subscription settings loaded.');
  } catch (err) {
    if (request === subscriptionRequest) message('Could not load subscription: ' + err.message);
  }
}

$('close-subscription').addEventListener('click', () => {
  ++subscriptionRequest;
  selectedSubscriptionRestaurant = null;
  $('subscription-section').hidden = true;
});

$('subscription-form').addEventListener('submit', async event => {
  event.preventDefault();
  const restaurant = selectedSubscriptionRestaurant;
  if (!restaurant) return;
  const plan_name = $('sub-plan').value.trim();
  const monthly_fee = Number($('sub-fee').value);
  const starts_on = $('sub-start').value || null;
  const expires_on = $('sub-expiry').value || null;
  const status = $('subscription-status');
  if (!plan_name || !Number.isFinite(monthly_fee) || monthly_fee < 0 || monthly_fee > 999999999) {
    status.textContent = 'Enter a valid plan name and monthly fee.'; return;
  }
  if (starts_on && expires_on && expires_on < starts_on) {
    status.textContent = 'Expiry date cannot be before start date.'; return;
  }
  const button = $('save-subscription'); button.disabled = true;
  status.textContent = 'Saving subscription…';
  try {
    const payload = {
      restaurant_id: restaurant.id,
      plan_name, monthly_fee,
      currency: $('sub-currency').value,
      starts_on, expires_on,
      payment_status: $('sub-payment').value,
      notes: $('sub-notes').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('restaurant_subscriptions')
      .upsert(payload, { onConflict: 'restaurant_id' });
    if (error) throw error;
    status.textContent = 'Subscription saved successfully!';
    message('Subscription updated for ' + restaurant.name + '.');
  } catch (err) {
    status.textContent = 'Could not save subscription: ' + err.message;
  } finally { button.disabled = false; }
});

async function checkSession() {
  const seq = ++epoch;
  $('dashboard').hidden = true; $('login').hidden = false;
  $('branding-section').hidden = true; selectedRestaurant = null;
  ++subscriptionRequest; selectedSubscriptionRestaurant = null;
  $('subscription-section').hidden = true;
  const { data: { user }, error } = await db.auth.getUser();
  if (seq !== epoch) return;
  if (error || !user) { message('Sign in with your existing admin account.'); return; }
  const { data: admin, error: accessError } = await db.from('super_admins')
    .select('user_id').eq('user_id', user.id).maybeSingle();
  if (seq !== epoch) return;
  if (accessError || !admin) { message('This account is not a super admin.'); return; }
  $('login').hidden = true; $('dashboard').hidden = false;
  try { await refreshRestaurants(); message('Super admin connected.'); }
  catch (e) { message(e.message); }
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); message('Signing in…');
  const { error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  $('password').value = '';
  if (error) { message(error.message); return; }
  await checkSession();
});
$('logout').addEventListener('click', async () => { await db.auth.signOut(); await checkSession(); });
$('reload').addEventListener('click', async () => { try { await refreshRestaurants(); message('List refreshed.'); } catch (e) { message(e.message); } });
$('create-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim(), slug = $('slug').value.trim().toLowerCase();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { message('Enter a valid name and lowercase URL slug.'); return; }
  const button = e.target.querySelector('button'); button.disabled = true;
  try {
    const { error } = await db.from('restaurants').insert({ name, slug, status: 'active' });
    if (error) throw error;
    e.target.reset(); await refreshRestaurants(); message('Restaurant created: ' + name);
  } catch (err) { message('Could not create restaurant: ' + err.message); }
  finally { button.disabled = false; }
});
checkSession();
