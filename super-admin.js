'use strict';
const db = window.createNoshAdminClient();
const $ = id => document.getElementById(id);
const message = s => { $('message').textContent = s; };
let epoch = 0;
let selectedRestaurant = null;
const fallbackPrimary = '#f59e0b';
const fallbackSecondary = '#fbbf24';
const validColor = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;

// Step 51.7.2: status is calculated by the Supabase security-invoker view.
// Subscription access is configured separately per restaurant.
const subscriptionStatusLabels = {
  active: 'Active', expiring_soon: 'Expiring Soon', grace_period: 'Grace Period',
  suspended: 'Suspended', not_configured: 'Not Configured',
  no_expiry: 'No Expiry Set', not_started: 'Not Started'
};
function statusBadge(code) {
  const span = document.createElement('span');
  span.className = 'status-pill status-' + (Object.hasOwn(subscriptionStatusLabels, code) ? code : 'not_configured');
  span.textContent = subscriptionStatusLabels[code] || 'Unknown';
  return span;
}
async function refreshBillingOverview(restaurants) {
  const summary = $('billing-summary');
  const rows = $('billing-rows');
  const alerts = $('billing-alerts');
  const errorBox = $('billing-error');
  errorBox.textContent = '';
  const { data, error } = await db.from('restaurant_subscription_status')
    .select('restaurant_id,restaurant_name,plan_name,monthly_fee,currency,payment_status,expires_on,grace_period_days,subscription_status,days_until_expiry');
  if (error) {
    summary.textContent = 'Subscription status records unavailable.';
    rows.replaceChildren(); alerts.replaceChildren();
    errorBox.textContent = 'Could not load subscription status: ' + error.message;
    return;
  }
  const {data: modes, error: modeError} = await db.from('restaurant_subscriptions').select('restaurant_id,access_mode');
  const modeMap = new Map((modes || []).map(s => [s.restaurant_id,s.access_mode]));
  if (modeError) errorBox.textContent = 'Access modes unavailable: ' + modeError.message;
  const subs = (data || []).map(s => ({...s,access_mode:modeMap.get(s.restaurant_id)}));
  const byId = new Map(subs.map(s => [s.restaurant_id, s]));
  const configured = subs.filter(s => s.subscription_status !== 'not_configured');
  const counts = Object.fromEntries(Object.keys(subscriptionStatusLabels).map(k => [k, 0]));
  for (const s of subs) if (Object.hasOwn(counts, s.subscription_status)) counts[s.subscription_status]++;
  const totals = {};
  for (const s of configured) {
    const currency = s.currency || 'PKR';
    totals[currency] = (totals[currency] || 0) + Number(s.monthly_fee || 0);
  }
  const expected = Object.entries(totals).map(([currency, amount]) =>
    currency + ' ' + amount.toLocaleString('en-PK', {maximumFractionDigits:2})).join(' / ') || '—';
  const stats = [
    ['Total restaurants', restaurants.length],
    ['Subscriptions configured', configured.length],
    ['Active', counts.active],
    ['Expiring soon', counts.expiring_soon],
    ['Grace period', counts.grace_period],
    ['Suspended', counts.suspended],
    ['Not configured / no expiry / not started', counts.not_configured + counts.no_expiry + counts.not_started],
    ['Paid / Unpaid / Overdue', `${configured.filter(s => s.payment_status === 'paid').length} / ${configured.filter(s => s.payment_status === 'unpaid').length} / ${configured.filter(s => s.payment_status === 'overdue').length}`],
    ['Expected monthly fees', expected]
  ];
  summary.replaceChildren();
  for (const [label, value] of stats) {
    const card = document.createElement('div'); card.className = 'billing-stat';
    const name = document.createElement('small'); name.textContent = label;
    const val = document.createElement('strong'); val.textContent = String(value);
    card.append(name, val); summary.append(card);
  }
  alerts.replaceChildren();
  const alertCodes = new Set(['expiring_soon','grace_period','suspended']);
  const alertsData = restaurants.map(r => ({r, s:byId.get(r.id)}))
    .filter(({s}) => s && alertCodes.has(s.subscription_status))
    .sort((a,b) => (a.s.days_until_expiry ?? 999999) - (b.s.days_until_expiry ?? 999999));
  if (!alertsData.length) alerts.textContent = 'No expiring-soon, grace-period or suspended-status subscriptions.';
  for (const {r,s} of alertsData) {
    const alert = document.createElement('div');
    alert.className = 'billing-alert status-' + s.subscription_status;
    const title = document.createElement('strong'); title.textContent = r.name;
    const desc = document.createElement('span');
    const days = s.days_until_expiry;
    desc.textContent = (days < 0 ? 'Expired ' + (-days) + ' day(s) ago' : days === 0 ? 'Expires today' : 'Expires in ' + days + ' day(s)') +
      ' · expiry: ' + s.expires_on + ' · grace: ' + s.grace_period_days + ' day(s) · payment: ' + s.payment_status;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Manage / Renew';
    button.addEventListener('click', () => openSubscription(r, true));
    alert.append(title, statusBadge(s.subscription_status), document.createElement('div'), desc, document.createElement('div'), button);
    alerts.append(alert);
  }
  rows.replaceChildren();
  for (const restaurant of restaurants) {
    const s = byId.get(restaurant.id);
    const tr = document.createElement('tr');
    for (const value of [restaurant.name, s?.plan_name || 'Not set',
      s?.plan_name ? (s.currency || 'PKR') + ' ' + Number(s.monthly_fee).toLocaleString('en-PK') : '—',
      s?.payment_status || 'Not set']) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    const statusTd = document.createElement('td'); statusTd.append(statusBadge(s?.subscription_status || 'not_configured')); tr.append(statusTd);
    const expiryTd = document.createElement('td'); expiryTd.textContent = s?.expires_on || '—'; tr.append(expiryTd);
    const graceTd = document.createElement('td'); graceTd.textContent = s?.grace_period_days == null ? '—' : s.grace_period_days + ' days'; tr.append(graceTd);
    const modeTd = document.createElement('td'); modeTd.textContent = s?.access_mode || '—'; tr.append(modeTd);
    const action = document.createElement('td');
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = s?.plan_name ? 'Edit' : 'Set up';
    button.addEventListener('click', () => openSubscription(restaurant));
    action.append(button);
    if (s?.plan_name) {
      const renew = document.createElement('button'); renew.type = 'button';
      renew.textContent = 'Renew'; renew.addEventListener('click', () => openSubscription(restaurant, true));
      action.append(renew);
    }
    tr.append(action); rows.append(tr);
  }
  if (!restaurants.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 9; td.textContent = 'No restaurants yet.'; tr.append(td); rows.append(tr);
  }
}

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
    const payments = document.createElement('button');
    payments.type = 'button'; payments.className = 'restaurant-edit';
    payments.textContent = 'Payment History';
    payments.addEventListener('click', () => openPayments(r));
    const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'restaurant-edit'; settings.textContent = 'Manage Settings';
    settings.addEventListener('click', () => openSettings(r));
    li.append(strong, small, edit, manage, subscription, payments, settings); list.append(li);
  }
  await refreshBillingOverview(data || []);
  if (!data.length) { const li = document.createElement('li'); li.textContent = 'No restaurants yet.'; list.append(li); }
}

// Step 51.5.2: manual received-payment records (not coupled to renewal).
let selectedPaymentRestaurant = null;
let paymentRequest = 0;
let paymentSaving = false;
const paymentMethods = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', jazzcash: 'JazzCash',
  easypaisa: 'Easypaisa', other: 'Other'
};
function formatMoney(amount, currency) {
  return (currency || 'PKR') + ' ' + Number(amount).toLocaleString('en-PK', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
async function openPayments(restaurant) {
  const request = ++paymentRequest;
  selectedPaymentRestaurant = null;
  $('payment-section').hidden = true;
  $('payment-status').textContent = 'Loading payment history…';
  $('payment-restaurant').textContent = 'Restaurant: ' + restaurant.name + ' (' + restaurant.slug + ')';
  $('payment-form').reset();
  $('payment-date').value = pakistanToday();
  $('payment-rows').replaceChildren();
  $('payment-totals').replaceChildren();
  try {
    const { data, error } = await db.from('restaurant_payments')
      .select('id,amount,currency,payment_method,payment_date,transaction_reference,notes,created_at')
      .eq('restaurant_id', restaurant.id)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    if (request !== paymentRequest) return;
    selectedPaymentRestaurant = restaurant;
    renderPayments(data || []);
    $('payment-status').textContent = '';
    $('payment-section').hidden = false;
    $('payment-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (request === paymentRequest) message('Could not load payments: ' + error.message);
  }
}
function renderPayments(payments) {
  const totals = {};
  for (const p of payments) totals[p.currency] = (totals[p.currency] || 0) + Number(p.amount);
  const summary = $('payment-totals'); summary.replaceChildren();
  const stats = [['Payments displayed', payments.length],
    ...Object.entries(totals).map(([currency, amount]) => ['Total displayed (' + currency + ')', formatMoney(amount, currency)])];
  for (const [name, value] of stats) {
    const card = document.createElement('div'); card.className = 'billing-stat';
    const label = document.createElement('small'); label.textContent = name;
    const strong = document.createElement('strong'); strong.textContent = String(value);
    card.append(label, strong); summary.append(card);
  }
  const rows = $('payment-rows'); rows.replaceChildren();
  if (!payments.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 5; td.textContent = 'No received payments recorded yet.';
    tr.append(td); rows.append(tr); return;
  }
  for (const p of payments) {
    const tr = document.createElement('tr');
    for (const value of [p.payment_date, formatMoney(p.amount,p.currency),
      paymentMethods[p.payment_method] || p.payment_method,
      p.transaction_reference || '—', p.notes || '—']) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    rows.append(tr);
  }
}
$('payment-close').addEventListener('click', () => {
  if (paymentSaving) return;
  ++paymentRequest;
  selectedPaymentRestaurant = null;
  $('payment-section').hidden = true;
});
$('payment-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (paymentSaving || !selectedPaymentRestaurant) return;
  const restaurant = selectedPaymentRestaurant;
  const amount = Number($('payment-amount').value);
  const currency = $('payment-currency').value;
  const payment_method = $('payment-method').value;
  const payment_date = $('payment-date').value;
  const transaction_reference = $('payment-reference').value.trim() || null;
  const notes = $('payment-notes').value.trim() || null;
  const status = $('payment-status');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99 ||
      !['PKR','USD'].includes(currency) || !Object.hasOwn(paymentMethods,payment_method) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payment_date) || payment_date > pakistanToday()) {
    status.textContent = 'Enter a valid amount, payment method and non-future date.'; return;
  }
  if (!confirm('Record received payment of ' + formatMoney(amount,currency) +
    ' for ' + restaurant.name + '? This cannot be edited here.')) return;
  paymentSaving = true; $('payment-save').disabled = true;
  status.textContent = 'Recording payment…';
  try {
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth?.user) throw new Error('Sign in again before recording a payment.');
    const { error } = await db.from('restaurant_payments').insert({
      restaurant_id: restaurant.id, amount, currency, payment_method, payment_date,
      transaction_reference, notes, created_by: auth.user.id
    });
    if (error) throw error;
    // Payment was saved; do not offer retry if a subsequent refresh fails.
    status.textContent = 'Payment recorded successfully! Subscription expiry was not changed.';
    $('payment-amount').value = '';
    $('payment-method').value = '';
    $('payment-reference').value = '';
    $('payment-notes').value = '';
    const { data: refreshed, error: refreshError } = await db.from('restaurant_payments')
      .select('id,amount,currency,payment_method,payment_date,transaction_reference,notes,created_at')
      .eq('restaurant_id', restaurant.id)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);
    if (refreshError) {
      status.textContent += ' Refresh failed: ' + refreshError.message + '. Do not submit again; reload history.';
    } else if (selectedPaymentRestaurant?.id === restaurant.id) {
      renderPayments(refreshed || []);
    }
  } catch (error) { status.textContent = 'Payment not confirmed: ' + error.message + '. Check history before retrying.'; }
  finally { paymentSaving = false; $('payment-save').disabled = false; }
});

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

// Date-only arithmetic avoids daylight-saving and locale formatting issues.
function pakistanToday() {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function daysBetween(from, to) {
  const asUTC = d => Date.UTC(...d.split('-').map((n,i) => i===1 ? Number(n)-1 : Number(n)));
  return Math.round((asUTC(to)-asUTC(from))/86400000);
}
function addOneMonth(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const month = m === 12 ? 1 : m+1;
  const year = m === 12 ? y+1 : y;
  const lastDay = new Date(Date.UTC(year,month,0)).getUTCDate();
  return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(d,lastDay)).padStart(2,'0')}`;
}
let loadedSubscription = null;
let selectedSubscriptionRestaurant = null;
let subscriptionRequest = 0;
let renewalSaving = false;
let renewalAttempt = null;
function resetRenewalAttempt() { renewalAttempt = null; }
function renewalPayload(restaurant, requestId) {
  return {
    p_restaurant_id: restaurant.id,
    p_request_id: requestId,
    p_amount: Number($('renew-amount').value),
    p_currency: $('renew-currency').value,
    p_payment_method: $('renew-method').value,
    p_payment_date: $('renew-paid-on').value,
    p_new_expiry: $('renew-expiry').value,
    p_transaction_reference: $('renew-reference').value.trim() || null,
    p_notes: $('renew-notes').value.trim() || null
  };
}

async function openSubscription(restaurant, showRenew = false) {
  if (renewalSaving) { message("Wait for the renewal request to finish."); return; }
  resetRenewalAttempt();
  const request = ++subscriptionRequest;
  selectedSubscriptionRestaurant = null;
  loadedSubscription = null;
  $('renew-panel').hidden = true;
  $('subscription-section').hidden = true;
  $('subscription-status').textContent = '';
  message('Loading subscription…');
  try {
    const { data, error } = await db.from('restaurant_subscriptions')
      .select('restaurant_id,plan_name,monthly_fee,currency,starts_on,expires_on,payment_status,notes,grace_period_days,access_mode')
      .eq('restaurant_id', restaurant.id).maybeSingle();
    if (error) throw error;
    if (request !== subscriptionRequest) return;
    selectedSubscriptionRestaurant = restaurant;
    loadedSubscription = data || null;
    $('subscription-restaurant').textContent = 'Restaurant: ' + restaurant.name + ' (' + restaurant.slug + ')';
    $('sub-plan').value = data?.plan_name || 'Standard';
    $('sub-fee').value = data?.monthly_fee ?? 0;
    $('sub-currency').value = ['PKR','USD'].includes(data?.currency) ? data.currency : 'PKR';
    $('sub-start').value = data?.starts_on || '';
    $('sub-expiry').value = data?.expires_on || '';
    $('sub-payment').value = ['paid','unpaid','overdue'].includes(data?.payment_status) ? data.payment_status : 'unpaid';
    $('sub-notes').value = data?.notes || '';
    $('sub-grace').value = data?.grace_period_days ?? 5;
    $('sub-access-mode').value = data?.access_mode === 'enforce' ? 'enforce' : 'monitor';
    $('access-saved-mode').textContent = data ? (data.access_mode === 'enforce' ? 'Enforce Subscription' : 'Monitor Only') : 'Not configured';
    $('save-access-mode').disabled = !data;
    $('access-status').textContent = data ? '' : 'Save subscription details first to configure access.';
    $('access-current-status').textContent = 'Loading…';
    const {data: liveStatus, error: liveError} = await db.from('restaurant_subscription_status')
      .select('subscription_status').eq('restaurant_id', restaurant.id).maybeSingle();
    if (request !== subscriptionRequest) return;
    $('access-current-status').textContent = liveError ? 'Unavailable' : (subscriptionStatusLabels[liveStatus?.subscription_status] || 'Unknown');
    $('subscription-section').hidden = false;
    if (showRenew) prepareRenewal();
    $('subscription-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    message('Subscription settings loaded.');
  } catch (err) {
    if (request === subscriptionRequest) message('Could not load subscription: ' + err.message);
  }
}

$('close-subscription').addEventListener('click', () => {
  if (renewalSaving) return;
  resetRenewalAttempt();
  ++subscriptionRequest;
  selectedSubscriptionRestaurant = null;
  loadedSubscription = null;
  $('renew-panel').hidden = true;
  $('subscription-section').hidden = true;
});

function prepareRenewal() {
  if (renewalSaving) return;
  resetRenewalAttempt();
  if (!selectedSubscriptionRestaurant || !loadedSubscription) {
    $('subscription-status').textContent = 'Save the subscription first, then renew it.';
    return;
  }
  const today = pakistanToday();
  const base = loadedSubscription.expires_on && loadedSubscription.expires_on > today
    ? loadedSubscription.expires_on : today;
  $('renew-amount').value = Number(loadedSubscription.monthly_fee || 0) > 0 ? loadedSubscription.monthly_fee : '';
  $('renew-currency').value = loadedSubscription.currency || 'PKR';
  $('renew-method').value = '';
  $('renew-reference').value = '';
  $('renew-notes').value = '';
  $('renew-paid-on').value = today;
  $('renew-expiry').value = addOneMonth(base);
  $('renew-expiry').min = today;
  $('renew-confirm').value = '';
  $('renew-status').textContent = '';
  $('renew-panel').hidden = false;
  $('renew-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
$('start-renew').addEventListener('click', prepareRenewal);
$('renew-cancel').addEventListener('click', () => { if (renewalSaving) return; resetRenewalAttempt(); $('renew-panel').hidden = true; });
$('renew-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (renewalSaving) return;
  const restaurant = selectedSubscriptionRestaurant;
  if (!restaurant || !loadedSubscription) return;
  const today = pakistanToday();
  const status = $('renew-status');
  const amount = Number($('renew-amount').value);
  const paidOn = $('renew-paid-on').value;
  const expiry = $('renew-expiry').value;
  const previous = loadedSubscription.expires_on;
  if ($('renew-confirm').value !== 'received') { status.textContent = 'Confirm actual payment received first.'; return; }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999) { status.textContent = 'Enter a valid positive payment amount.'; return; }
  if (!Object.hasOwn(paymentMethods, $('renew-method').value)) { status.textContent = 'Choose a payment method.'; return; }
  if (!paidOn || paidOn > today) { status.textContent = 'Payment date cannot be in the future.'; return; }
  if (!expiry || expiry <= today || (previous && expiry <= previous) || (loadedSubscription.starts_on && expiry < loadedSubscription.starts_on)) {
    status.textContent = 'New expiry must be later than today and the previous expiry/start.'; return;
  }
  const candidate = renewalPayload(restaurant, renewalAttempt?.requestId || crypto.randomUUID());
  const signature = JSON.stringify({...candidate, p_request_id: null});
  if (renewalAttempt && renewalAttempt.signature !== signature) {
    status.textContent = 'Details changed after a previous attempt. Check Payment History and subscription expiry before trying a new request.';
    return;
  }
  if (!confirm('Confirm '+formatMoney(amount, candidate.p_currency)+' was actually received for '+restaurant.name+' and renew until '+expiry+'?')) return;
  if (!renewalAttempt) renewalAttempt = {requestId: candidate.p_request_id, signature};
  renewalSaving = true;
  const btn = $('renew-submit'); btn.disabled = true;
  $('renew-cancel').disabled = true;
  $('close-subscription').disabled = true;
  status.textContent = 'Recording payment and renewing atomically…';
  try {
    const {data,error} = await db.rpc('renew_restaurant_subscription', candidate);
    if (error) throw error;
    // The RPC committed successfully. Do not retry even if refreshing the UI fails.
    resetRenewalAttempt();
    const result = Array.isArray(data) ? data[0] : data;
    status.textContent = result?.already_processed
      ? 'This renewal was already processed; no duplicate payment was created.'
      : 'Payment recorded and subscription renewed successfully!';
    $('renew-panel').hidden = true;
    $('subscription-status').textContent = status.textContent;
    const {data: updated, error: reloadError} = await db.from('restaurant_subscriptions')
      .select('restaurant_id,plan_name,monthly_fee,currency,starts_on,expires_on,payment_status,notes,grace_period_days,access_mode')
      .eq('restaurant_id', restaurant.id).single();
    if (reloadError) { $('subscription-status').textContent += ' Refresh failed; reload the page to verify.'; }
    else if (selectedSubscriptionRestaurant?.id === restaurant.id) {
      loadedSubscription = updated;
      $('sub-start').value = updated.starts_on || '';
      $('sub-expiry').value = updated.expires_on || '';
      $('sub-payment').value = updated.payment_status;
    }
    try { await refreshRestaurants(); } catch(e) { $('subscription-status').textContent += ' Billing refresh failed: '+e.message; }
  } catch(e) {
    status.textContent = 'Renewal not confirmed: '+e.message+'. Check Payment History and expiry before retrying. Keep the form unchanged to retry with the same request ID.';
  } finally {
    renewalSaving = false; btn.disabled = false;
    $('renew-cancel').disabled = false;
    $('close-subscription').disabled = false;
  }
});

// Access mode is saved separately to prevent accidental enforcement changes.
let accessSaving = false;
$('save-access-mode').addEventListener('click', async () => {
  if (accessSaving || renewalSaving || !selectedSubscriptionRestaurant || !loadedSubscription) return;
  const restaurant = selectedSubscriptionRestaurant;
  const desired = $('sub-access-mode').value;
  const status = $('access-status');
  if (!['monitor','enforce'].includes(desired)) return;
  if (desired === 'enforce') {
    const warning = 'Enable subscription enforcement for ' + restaurant.name + '? If the subscription is suspended (expired beyond grace period), NEW customer orders will be BLOCKED immediately. Continue?';
    if (!confirm(warning)) { $('sub-access-mode').value = loadedSubscription.access_mode === 'enforce' ? 'enforce' : 'monitor'; return; }
  }
  accessSaving = true;
  $('save-access-mode').disabled = true;
  status.textContent = 'Saving access mode…';
  try {
    const {data, error} = await db.from('restaurant_subscriptions')
      .update({access_mode: desired, updated_at: new Date().toISOString()})
      .eq('restaurant_id', restaurant.id)
      .select('restaurant_id,access_mode').single();
    if (error) throw error;
    if (selectedSubscriptionRestaurant?.id === restaurant.id) {
      loadedSubscription = {...loadedSubscription, access_mode: data.access_mode};
      $('access-saved-mode').textContent = data.access_mode === 'enforce' ? 'Enforce Subscription' : 'Monitor Only';
      status.textContent = 'Access mode saved successfully.';
    }
    await refreshRestaurants();
  } catch (error) {
    status.textContent = 'Could not confirm access mode save: ' + error.message + '. Reload to verify before retrying.';
  } finally {
    accessSaving = false;
    $('save-access-mode').disabled = !loadedSubscription;
  }
});

$('subscription-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (renewalSaving || accessSaving) return;
  const restaurant = selectedSubscriptionRestaurant;
  if (!restaurant) return;
  const plan_name = $('sub-plan').value.trim();
  const monthly_fee = Number($('sub-fee').value);
  const starts_on = $('sub-start').value || null;
  const expires_on = $('sub-expiry').value || null;
  const grace_period_days = Number($('sub-grace').value);
  const status = $('subscription-status');
  if (!plan_name || !Number.isFinite(monthly_fee) || monthly_fee < 0 || monthly_fee > 999999999) {
    status.textContent = 'Enter a valid plan name and monthly fee.'; return;
  }
  if (!Number.isInteger(grace_period_days) || grace_period_days < 0 || grace_period_days > 30) {
    status.textContent = 'Grace period must be a whole number between 0 and 30.'; return;
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
      starts_on, expires_on, grace_period_days,
      payment_status: $('sub-payment').value,
      notes: $('sub-notes').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('restaurant_subscriptions')
      .upsert(payload, { onConflict: 'restaurant_id' });
    if (error) throw error;
    loadedSubscription = {...loadedSubscription, ...payload};
    $('save-access-mode').disabled = false;
    if ($('access-saved-mode').textContent === 'Not configured') {
      $('access-saved-mode').textContent = 'Monitor Only';
      $('sub-access-mode').value = 'monitor';
    }
    $('access-status').textContent = '';
    $('renew-panel').hidden = true;
    status.textContent = 'Subscription saved successfully!';
    await refreshRestaurants();
    message('Subscription updated for ' + restaurant.name + '.');
  } catch (err) {
    status.textContent = 'Could not save subscription: ' + err.message;
  } finally { button.disabled = false; }
});


// Restaurant-specific settings. Database RLS remains the authorization boundary.
const settingsFields = {table_count:'settings-tables',tax_percent:'settings-tax',service_charge_percent:'settings-service',cash_enabled:'settings-cash',card_enabled:'settings-card',customer_name_required:'settings-name',customer_phone_required:'settings-phone'};
const settingsColumns = Object.keys(settingsFields).join(',');
let settingsTarget = null, settingsRequest = 0, settingsSaving = false;
function resetSettings(){ ++settingsRequest; settingsTarget = null; $('settings-section').hidden = true; }
function lockSettings(lock){ for(const id of [...Object.values(settingsFields),'settings-save','settings-close']) $(id).disabled = lock; }
function previewSettings(){
  const tax = Number($('settings-tax').value), service = Number($('settings-service').value);
  const valid = [tax,service].every(n=>Number.isFinite(n)&&n>=0&&n<=100);
  $('settings-preview').textContent = valid ? `Tax: ${formatMoney(10*tax,'PKR')} · Service: ${formatMoney(10*service,'PKR')} · Total: ${formatMoney(1000+10*tax+10*service,'PKR')}` : 'Enter valid percentages.';
}
async function openSettings(r){
  if(settingsSaving){message('Wait for settings save to finish.');return;}
  resetSettings(); const ticket=settingsRequest, sessionEpoch=epoch;
  message('Loading restaurant settings…');
  try {
    const {data,error}=await db.from('restaurants').select('id,name,slug,'+settingsColumns).eq('id',r.id).single();
    if(ticket!==settingsRequest||sessionEpoch!==epoch)return;
    if(error||!data)throw error||Error('Restaurant not found');
    settingsTarget=data;
    for(const [key,id] of Object.entries(settingsFields)){const field=$(id); if(field.type==='checkbox')field.checked=data[key]===true;else field.value=data[key];}
    lockSettings(false); $('settings-restaurant').textContent=data.name+' ('+data.slug+')'; $('settings-status').textContent=''; previewSettings(); $('settings-section').hidden=false; $('settings-section').scrollIntoView({behavior:'smooth'}); message('Restaurant settings loaded.');
  }catch(e){if(ticket===settingsRequest&&sessionEpoch===epoch)message('Settings unavailable: '+e.message);}
}
$('settings-form').addEventListener('input',previewSettings);
$('settings-close').addEventListener('click',()=>{if(!settingsSaving)resetSettings();});
$('settings-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(settingsSaving||!settingsTarget||$('dashboard').hidden)return;
  const target=settingsTarget, ticket=settingsRequest, sessionEpoch=epoch, payload={};
  for(const [key,id] of Object.entries(settingsFields)){const field=$(id); payload[key]=field.type==='checkbox'?field.checked:Number(field.value);}
  const status=$('settings-status');
  if(!e.target.checkValidity()||!Number.isInteger(payload.table_count)||payload.table_count<1||payload.table_count>500||![payload.tax_percent,payload.service_charge_percent].every(n=>Number.isFinite(n)&&n>=0&&n<=100)){status.textContent='Enter valid table count and percentages.';return;}
  if(!payload.cash_enabled&&!payload.card_enabled){status.textContent='Enable at least one payment method.';return;}
  if(!confirm('Save ordering settings for '+target.name+'? These affect new orders.'))return;
  settingsSaving=true; lockSettings(true); status.textContent='Saving settings…';
  try{
    const {data,error}=await db.from('restaurants').update(payload).eq('id',target.id).select('id,name,slug,'+settingsColumns).single();
    if(ticket!==settingsRequest||sessionEpoch!==epoch)return;
    if(error||!data)throw error||Error('Save not confirmed');
    settingsTarget=data; status.textContent='Settings saved successfully. Customer menu refreshes within its normal polling interval.';
  }catch(err){if(ticket===settingsRequest&&sessionEpoch===epoch)status.textContent='Save not confirmed: '+err.message+'. Reopen settings to verify.';}
  finally{settingsSaving=false;if(ticket===settingsRequest&&sessionEpoch===epoch)lockSettings(false);}
});

async function checkSession() {
  resetSettings();
  const seq = ++epoch;
  $('dashboard').hidden = true; $('login').hidden = false;
  $('branding-section').hidden = true; selectedRestaurant = null;
  ++subscriptionRequest; selectedSubscriptionRestaurant = null;
  $('subscription-section').hidden = true; resetRenewalAttempt();
  ++paymentRequest; selectedPaymentRestaurant = null; $('payment-section').hidden = true;
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