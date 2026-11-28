'use strict';
const db = window.createNoshAdminClient();
const $ = id => document.getElementById(id);
const message = s => { $('message').textContent = s; };
let epoch = 0;
let selectedRestaurant = null;
const fallbackPrimary = '#f59e0b';
const fallbackSecondary = '#fb923c';
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
  const [{data,error},{data:modes,error:modeError}] = await Promise.all([db.from('restaurant_subscription_status').select('restaurant_id,restaurant_name,plan_name,monthly_fee,currency,payment_status,expires_on,grace_period_days,subscription_status,days_until_expiry'),db.from('restaurant_subscriptions').select('restaurant_id,access_mode')]);
  if (error) {
    summary.textContent = 'Subscription status records unavailable.';
    rows.replaceChildren(); alerts.replaceChildren();
    errorBox.textContent = 'Could not load subscription status: ' + error.message;
    return;
  }
  
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
  renderPickers(data || []);
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
    const copy = document.createElement('button'); copy.type='button'; copy.textContent='Copy menu link'; copy.onclick=async()=>{const url=new URL('./',location.href);url.searchParams.set('restaurant',r.slug);try{await navigator.clipboard.writeText(url.href);message('Menu link copied.');}catch{message(url.href);}};
    const security=document.createElement('button');security.type='button';security.textContent='Order security';security.onclick=()=>openOrderSecurity(r);
    const openMenu=document.createElement('a');openMenu.className='restaurant-edit';openMenu.textContent='Open menu';const menuUrl=new URL('./',location.href);menuUrl.searchParams.set('restaurant',r.slug);openMenu.href=menuUrl.href;openMenu.target='_blank';openMenu.rel='noopener noreferrer';
    li.append(strong, small, edit, manage, subscription, payments, settings, security, copy, openMenu); list.append(li);
  }
  filterRestaurants();
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
  showView('payments');
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

const themeKeys = ['primary_color','secondary_color','background_color','card_color','text_color','price_color','button_text_color','border_color','muted_text_color'];
const themeIds = ['primary','secondary','background','card','text','price','button_text','border','muted_text'];
const themeLabels = ['Primary','Secondary','Background','Card','Text','Price','Button text','Border','Muted text'];
const themePresets = {
'Midnight Amber':['#f59e0b','#f97316','#020617','#0f172a','#ffffff','#f59e0b','#000000'],
'Luxury Gold':['#d4af37','#8b6914','#101010','#202020','#ffffff','#eac75b','#101010'],
'Classic Italian':['#b91c1c','#15803d','#fff7ed','#ffffff','#292524','#b91c1c','#ffffff'],
'Ocean Blue':['#0284c7','#155e75','#eff6ff','#ffffff','#172554','#0369a1','#ffffff'],
'Modern Dark':['#06b6d4','#2563eb','#0f172a','#1e293b','#f8fafc','#67e8f9','#111827'],
'Minimal White':['#171717','#525252','#fafafa','#ffffff','#171717','#171717','#ffffff'],
'Coffee House':['#78350f','#a16207','#f5e9d9','#fffaf3','#422006','#92400e','#ffffff'],
'Fast Food':['#dc2626','#ea580c','#fff7ed','#ffffff','#292524','#dc2626','#ffffff'],
'Emerald Green':['#047857','#059669','#ecfdf5','#ffffff','#064e3b','#047857','#ffffff']};
for (const colors of Object.values(themePresets)) { const dark = lum(colors[2]) < .179; colors.push(dark ? '#334155' : '#e2e8f0', dark ? '#94a3b8' : '#475569'); }
let themeDraft = [], brandingRequest = 0, brandingBusy = false;
function lum(c){const a=c.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*a[0]+.7152*a[1]+.0722*a[2];}
function effectiveTheme(){const p=validColor(themeDraft[0],fallbackPrimary),s=validColor(themeDraft[1],'#fb923c');return [p,s,validColor(themeDraft[2],'#111827'),validColor(themeDraft[3],'#1f2937'),validColor(themeDraft[4],'#f3f4f6'),validColor(themeDraft[5],'#fbbf24'),validColor(themeDraft[6],lum(p)>.179?'#111827':'#ffffff'),validColor(themeDraft[7],lum(validColor(themeDraft[2],'#111827'))<.179?'#334155':'#e2e8f0'),validColor(themeDraft[8],lum(validColor(themeDraft[2],'#111827'))<.179?'#94a3b8':'#475569')];}
function previewTheme(){const [p,s,b,c,t,price,bt,border,muted]=effectiveTheme();const preview=$('theme-preview');preview.style.background=b;preview.style.color=t;$('theme-header').style.background=`linear-gradient(120deg,${p},${s})`;$('theme-header').style.color=bt;$('theme-name').textContent=$('brand-name').value||'Restaurant';for(const el of preview.querySelectorAll('.theme-demo-card')){el.style.background=c;el.style.border='1px solid '+border;}for(const el of preview.querySelectorAll('.theme-demo-card p'))el.style.color=muted;for(const el of preview.querySelectorAll('.theme-demo-price'))el.style.color=price;for(const el of preview.querySelectorAll('.theme-demo-action')){el.style.background=p;el.style.color=bt;}const warnings=[];for(const [a,z,label] of [[t,b,'Text / background'],[t,c,'Text / card'],[price,c,'Price / card'],[muted,c,'Muted text / card'],[bt,p,'Button text / primary'],[bt,s,'Header text / secondary']]){const x=lum(a),y=lum(z);if((Math.max(x,y)+.05)/(Math.min(x,y)+.05)<4.5)warnings.push(label);} $('theme-warning').textContent=warnings.length?'Low contrast (below 4.5:1): '+warnings.join(', '):'Sample color pairs meet 4.5:1 contrast.';}
function renderTheme(){const effective=effectiveTheme();themeIds.forEach((id,i)=>{$('brand-'+id).value=effective[i];$('hex-'+id).value=themeDraft[i]||'';$('hex-'+id).removeAttribute('aria-invalid');});previewTheme();}
function loadTheme(r){themeDraft=themeKeys.map(k=>validColor(r[k],null));renderTheme();}
function lockBranding(b){brandingBusy=b;for(const el of $('branding-form').querySelectorAll('input,button'))el.disabled=b;}
for(const [name,colors] of Object.entries(themePresets)){const b=document.createElement('button');b.type='button';const sw=document.createElement('span');sw.className='theme-swatches';for(const c of colors){const x=document.createElement('span');x.style.background=c;sw.append(x);}b.append(sw,document.createTextNode(name));b.onclick=()=>{themeDraft=[...colors];renderTheme();};$('theme-presets').append(b);}
themeIds.forEach((id,i)=>{const row=document.createElement('div');row.className='theme-control';const label=document.createElement('label');label.htmlFor='brand-'+id;label.textContent=themeLabels[i];const picker=document.createElement('input');picker.type='color';picker.id='brand-'+id;const hex=document.createElement('input');hex.type='text';hex.id='hex-'+id;hex.placeholder='Default';hex.maxLength=7;hex.setAttribute('aria-label',themeLabels[i]+' HEX');const reset=document.createElement('button');reset.type='button';reset.textContent='Default';picker.oninput=()=>{themeDraft[i]=picker.value;hex.value=picker.value;hex.removeAttribute('aria-invalid');previewTheme();};hex.oninput=()=>{const v=hex.value.trim();if(v&&!validColor(v,null)){hex.setAttribute('aria-invalid','true');return;}hex.removeAttribute('aria-invalid');themeDraft[i]=v||null;picker.value=effectiveTheme()[i];previewTheme();};reset.onclick=()=>{themeDraft[i]=null;renderTheme();};row.append(label,picker,hex,reset);$('theme-controls').append(row);});
$('theme-reset').onclick=()=>{if(selectedRestaurant)loadTheme(selectedRestaurant);};
$('theme-default').onclick=()=>{themeDraft=[themeDraft[0],themeDraft[1],null,null,null,null,null,null,null];renderTheme();};
$('brand-name').addEventListener('input',previewTheme);


let libraryRequest=0;
function brandingDirty(){return !!selectedRestaurant && (themeKeys.some((k,i)=>(selectedRestaurant[k]||null)!==(themeDraft[i]||null)) || $('brand-name').value.trim()!==selectedRestaurant.name || ($('brand-logo').value.trim()||null)!==(selectedRestaurant.logo_url||null) || themeIds.some(id=>$('hex-'+id).getAttribute('aria-invalid')==='true'));}
function allowLeaveBranding(){return !brandingDirty() || confirm('Discard unsaved branding changes?');}
window.addEventListener('beforeunload',e=>{if(brandingDirty()){e.preventDefault();e.returnValue='';}});
$('preview-mobile').onclick=()=>$('theme-preview').classList.remove('desktop-preview');
$('preview-desktop').onclick=()=>$('theme-preview').classList.add('desktop-preview');
async function refreshThemeLibrary(){
 const ticket=++libraryRequest, sessionEpoch=epoch;
 const list=$('custom-theme-list'), status=$('custom-theme-status');
 list.replaceChildren();
 const {data,error}=await db.from('custom_themes').select('id,name,colors').order('created_at',{ascending:false});
 if(ticket!==libraryRequest||sessionEpoch!==epoch||!selectedRestaurant)return;
 if(error){status.textContent=error.message;return;}
 if(!data.length)list.textContent='No saved custom themes yet.';
 for(const theme of data){
  if(!Array.isArray(theme.colors)||theme.colors.length!==9||theme.colors.some(c=>!validColor(c,null)))continue;
  const card=document.createElement('div');card.className='theme-library-card';
  const title=document.createElement('strong');title.textContent=theme.name;
  const sw=document.createElement('span');sw.className='theme-swatches';
  for(const color of theme.colors){const x=document.createElement('span');x.style.background=color;sw.append(x);}
  const apply=document.createElement('button');apply.type='button';apply.textContent='Use theme';apply.onclick=()=>{if(brandingBusy)return;themeDraft=[...theme.colors];renderTheme();status.textContent='Theme loaded. Save & Apply to update this restaurant.';};
  const duplicate=document.createElement('button');duplicate.type='button';duplicate.textContent='Duplicate';duplicate.onclick=()=>{if(brandingBusy)return;themeDraft=[...theme.colors];renderTheme();$('custom-theme-name').value=(theme.name+' copy').slice(0,80);status.textContent='Choose a name and save as a new theme.';};
  const del=document.createElement('button');del.type='button';del.textContent='Delete';del.onclick=async()=>{if(brandingBusy||!confirm('Delete saved theme '+theme.name+'? Applied restaurant colors will stay unchanged.'))return;lockBranding(true);try{const {error}=await db.from('custom_themes').delete().eq('id',theme.id).select('id').single();if(error)throw error;status.textContent='Theme deleted.';await refreshThemeLibrary();}catch(e){status.textContent=e.message;}finally{lockBranding(false);}};
  card.append(title,sw,apply,duplicate,del);list.append(card);
 }
}
$('custom-theme-save').onclick=async()=>{
 if(!selectedRestaurant||brandingBusy)return;
 const name=$('custom-theme-name').value.trim(), status=$('custom-theme-status');
 if(!name||themeIds.some(id=>$('hex-'+id).getAttribute('aria-invalid')==='true')){status.textContent='Enter a theme name and valid colors.';return;}
 lockBranding(true);
 try{const {error}=await db.from('custom_themes').insert({name,colors:effectiveTheme()});if(error)throw error;$('custom-theme-name').value='';status.textContent='Custom theme saved.';await refreshThemeLibrary();}catch(e){status.textContent=e.message;}finally{lockBranding(false);}
};

async function openBranding(id) {
  if(brandingBusy||!allowLeaveBranding())return;
  const ticket=++brandingRequest, sessionEpoch=epoch;
  selectedRestaurant=null;
  showView('branding');
  $('branding-section').hidden = true;
  message('Loading branding settings…');
  const { data: r, error } = await db.from('restaurants')
    .select('id,name,slug,logo_url,'+themeKeys.join(',')).eq('id', id).single();
  if(ticket!==brandingRequest||sessionEpoch!==epoch)return;
  if (error || !r) { message('Cannot load restaurant: ' + (error?.message || 'Not found')); return; }
  selectedRestaurant = r;
  $('selected-restaurant').textContent = 'Editing: ' + r.name + ' (' + r.slug + ')';
  $('brand-name').value = r.name;
  loadTheme(r);
  $('brand-logo').value = r.logo_url || '';
  $('branding-status').textContent = '';
  $('logo-upload-status').textContent = '';
  $('brand-logo-file').value = '';
  updateLogoPreview();
  $('branding-section').hidden = false;
  $('branding-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  message('Branding settings loaded.');
  $('custom-theme-name').value='';$('custom-theme-status').textContent='';refreshThemeLibrary();
}

function updateLogoPreview() {
  const value = $('brand-logo').value.trim();
  const img = $('logo-preview');
  const demo=$('theme-logo');demo.hidden=true;demo.removeAttribute('src');if(/^https:\/\//i.test(value)){demo.src=value;demo.hidden=false;demo.onerror=()=>{demo.hidden=true;};}
  if (!value || !/^https:\/\//i.test(value)) { img.hidden = true; img.removeAttribute('src'); return; }
  img.hidden = false;
  img.src = value;
  img.onerror = () => { img.hidden = true; };
}
$('brand-logo').addEventListener('input', updateLogoPreview);
// Upload a unique file per restaurant; no storage overwrite/delete policy required.
$('upload-logo').addEventListener('click', async () => {
  const restaurant = selectedRestaurant;
  if (!restaurant || brandingBusy) return;
  const file = $('brand-logo-file').files[0];
  const status = $('logo-upload-status');
  if (!file) { status.textContent = 'Choose a logo file first.'; return; }
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!types[file.type]) { status.textContent = 'Only JPG, PNG or WebP is allowed.'; return; }
  if (file.size > 2 * 1024 * 1024 || file.size === 0) {
    status.textContent = 'Choose a non-empty image smaller than 2 MB.'; return;
  }
  const button = $('upload-logo');
  lockBranding(true);
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
    lockBranding(false);
  }
});

$('cancel-branding').addEventListener('click', () => { if(brandingBusy||!allowLeaveBranding())return; ++brandingRequest; $('branding-section').hidden = true; selectedRestaurant = null; });
$('branding-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!selectedRestaurant || brandingBusy) return;
  const target=selectedRestaurant; const sessionEpoch=epoch;
  const name = $('brand-name').value.trim();
  const logo_url = $('brand-logo').value.trim() || null;
  if (!name || themeIds.some(id=>$('hex-'+id).getAttribute('aria-invalid')==='true')) { $('branding-status').textContent='Enter valid name and HEX colors.';return; }
  const payload=Object.fromEntries(themeKeys.map((k,i)=>[k,themeDraft[i]||null]));
  if (logo_url && !/^https:\/\//i.test(logo_url)) {
    $('branding-status').textContent = 'Logo URL must start with https://'; return;
  }
  lockBranding(true);
  $('branding-status').textContent = 'Saving…';
  try {
    const { data, error } = await db.from('restaurants')
      .update({ name, ...payload, logo_url })
      .eq('id', target.id)
      .select('id,name,logo_url,'+themeKeys.join(',')).single();
    if(sessionEpoch!==epoch)return;
    if (error) throw error;
    selectedRestaurant = { ...selectedRestaurant, ...data };
    $('branding-status').textContent = 'Saved! Refresh the customer menu to see the new branding.';
    await refreshRestaurants();
    message('Branding saved for ' + data.name + '.');
  } catch (err) { $('branding-status').textContent = 'Could not save: ' + err.message; }
  finally { lockBranding(false); }
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
  showView('subscriptions');
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
  showView('settings');
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
  anReset();
  ksReset();
  owReset();
  resetSettings();
  ++brandingRequest;
  const seq = ++epoch;
  onboardUser=null;onboardDraft=null;$('onboard-panel').hidden=true;$('onboard-resume').hidden=true;
  $('dashboard').hidden = true; $('login').hidden = true; message('Restoring workspace…');
  $('branding-section').hidden = true; selectedRestaurant = null;
  ++subscriptionRequest; selectedSubscriptionRestaurant = null;
  $('subscription-section').hidden = true; resetRenewalAttempt();
  ++paymentRequest; selectedPaymentRestaurant = null; $('payment-section').hidden = true;
  const { data: { user }, error } = await db.auth.getUser();
  if (seq !== epoch) return;
  if (error || !user) { $('login').hidden=false; message('Sign in with your existing admin account.'); return; }
  const { data: admin, error: accessError } = await db.from('super_admins')
    .select('user_id').eq('user_id', user.id).maybeSingle();
  if (seq !== epoch) return;
  if (accessError || !admin) { $('login').hidden=false; message('This account is not a super admin.'); return; }
  onboardUser=user.id;onboardRefresh();
  $('login').hidden = true; $('dashboard').hidden = false; showView('dashboard');
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
$('logout').addEventListener('click', async () => { if(onboardBusy||brandingBusy||!allowLeaveBranding())return; await db.auth.signOut(); await checkSession(); });
$('reload').addEventListener('click', async () => { try { await refreshRestaurants(); message('List refreshed.'); } catch (e) { message(e.message); } });



let onboardUser=null,onboardDraft=null,onboardBusy=false;
const onboardKey=()=> 'nosh-onboard-v1:'+onboardUser;
function onboardPersist(){try{localStorage.setItem(onboardKey(),JSON.stringify(onboardDraft));return true;}catch{return false;}}
function onboardRead(){try{return (()=>{const d=JSON.parse(localStorage.getItem(onboardKey())||'null');if(d&&!d.version){d.step=d.step===2?3:d.step===1?2:0;d.version=2;d.colors=[...themePresets['Midnight Amber']];d.logo='';d.manualSlug=!!d.slug;}return d;})();}catch{return null;}}
function onboardRefresh(){ $('onboard-resume').hidden=!onboardUser||!onboardRead(); }
function onboardAdvance(d){delete d.staffUser;delete d.staffName;if(d.step===6){try{localStorage.removeItem(onboardKey());}catch{}onboardDraft=null;$('onboard-panel').hidden=true;onboardRefresh();message('Onboarding finished for '+d.name+'. Review any skipped setup in management sections.');refreshRestaurants().catch(e=>message(e.message));return;}d.step++;if(d.step===6){d.plan='Standard';d.fee='0';d.start=pakistanToday();d.expiry='';}onboardPersist();onboardRender();}
function onboardRender(){
 const d=onboardDraft, fields=$('onboard-fields');fields.replaceChildren();
 $('onboard-title').textContent=['Step 1 of 7 — Restaurant details','Step 2 of 7 — Branding','Step 3 of 7 — Initial settings','Step 4 of 7 — Review & create','Step 5 of 7 — Kitchen account','Step 6 of 7 — Owner account','Step 7 of 7 — Subscription & finish'][d.step];
 $('onboard-back').disabled=d.step===0||d.step>=4;$('onboard-next').textContent=d.step===3?'Create restaurant':d.step===6?'Save & finish':d.step>=4?'Create account & continue':'Next';
 const field=(label,key,type,attrs={})=>{const l=document.createElement('label');l.textContent=label+' ';const i=document.createElement('input');i.type=type;Object.assign(i,attrs);if(type==='checkbox')i.checked=d[key];else i.value=d[key]??'';i.oninput=()=>{d[key]=type==='checkbox'?i.checked:i.value;if(!onboardPersist())$('onboard-status').textContent='Draft storage unavailable.';};l.append(i);fields.append(l);return i;};
 if(d.step===0){const n=field('Restaurant name','name','text',{required:true,maxLength:120});const sl=field('URL slug','slug','text',{required:true,maxLength:60,pattern:'[a-z0-9]+(-[a-z0-9]+)*'});n.addEventListener('input',()=>{if(!d.manualSlug){d.slug=n.value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/,'');sl.value=d.slug;onboardPersist();}});sl.addEventListener('input',()=>{d.manualSlug=!!sl.value;onboardPersist();});}
 if(d.step===1){
 const select=document.createElement('select');select.append(new Option('Choose theme…',''));const palettes=new Map();for(const [name,colors] of Object.entries(themePresets)){palettes.set('preset:'+name,colors);select.append(new Option(name,'preset:'+name));}fields.append(select);
 const controls=document.createElement('div'),preview=document.createElement('div');preview.style.cssText='padding:16px;border-radius:12px;margin:12px 0';fields.append(controls,preview);
 const logo=field('Logo URL (HTTPS, optional)','logo','url');logo.addEventListener('input',draw);
 function draw(){const [p,s,b,c,t,price,bt,border,muted]=d.colors;preview.replaceChildren();preview.style.background=b;preview.style.color=t;const h=document.createElement('h3');h.textContent=d.name;h.style.cssText='padding:12px;background:linear-gradient(120deg,'+p+','+s+');color:'+bt;const card=document.createElement('div');card.style.cssText='padding:12px;background:'+c+';border:1px solid '+border+';border-radius:8px';const title=document.createElement('strong');title.textContent='Signature Pizza';const desc=document.createElement('p');desc.textContent='Freshly prepared';desc.style.color=muted;const cost=document.createElement('p');cost.textContent='Rs. 999';cost.style.color=price;const action=document.createElement('div');action.textContent='+ Add to cart';action.style.cssText='padding:8px;background:'+p+';color:'+bt;card.append(title,desc,cost,action);if(/^https:\/\//i.test(d.logo||'')){const img=document.createElement('img');img.src=d.logo;img.alt='Logo preview';img.style.cssText='width:48px;height:48px;object-fit:contain';preview.append(img);}preview.append(h,card);}
 function pickers(){controls.replaceChildren();themeLabels.forEach((name,i)=>{const l=document.createElement('label');l.textContent=name+' ';const p=document.createElement('input');p.type='color';p.value=d.colors[i];p.oninput=()=>{d.colors[i]=p.value;onboardPersist();draw();};l.append(p);controls.append(l);});draw();}
 select.onchange=()=>{if(palettes.has(select.value)){d.colors=[...palettes.get(select.value)];onboardPersist();pickers();}};pickers();
 db.from('custom_themes').select('id,name,colors').order('name').then(({data,error})=>{if(!select.isConnected||onboardDraft!==d)return;if(error){$('onboard-status').textContent='Custom themes unavailable: '+error.message;return;}for(const t of data||[]){if(t.colors?.length===9&&t.colors.every(c=>validColor(c,null))){palettes.set(t.id,t.colors);select.append(new Option('Custom: '+t.name,t.id));}}});
 const hint=document.createElement('p');hint.textContent='Direct logo upload is available in Edit branding after creation.';fields.append(hint);
 }
 if(d.step===2){field('Tables','tables','number',{required:true,min:1,max:500,step:1});field('Tax %','tax','number',{required:true,min:0,max:100,step:.01});field('Service charge %','service','number',{required:true,min:0,max:100,step:.01});field('Cash enabled','cash','checkbox');field('Card enabled','card','checkbox');}
 if(d.step===3){const p=document.createElement('p');p.textContent=d.name+' · '+d.slug+' · '+d.tables+' tables · Tax '+d.tax+'% · Service '+d.service+'% · '+[d.cash?'Cash':'',d.card?'Card':''].filter(Boolean).join(' / ');fields.append(p);const note=document.createElement('p');note.textContent='Creates an active restaurant with an empty menu. The restaurant is created first, then accounts and subscription are configured. You can resume after creation.';fields.append(note);}
 if(d.step>=4){
 const info=document.createElement('p');info.textContent='Restaurant: '+d.name+' — already created.';fields.append(info);
 if(d.step===4||d.step===5){
 const role=d.step===4?'Kitchen':'Owner';field(role+' username','staffUser','text',{required:true,maxLength:80,autocomplete:'off'});field('Display name','staffName','text',{required:true,maxLength:120});
 const l=document.createElement('label');l.textContent='Password (12 characters minimum) ';const pw=document.createElement('input');pw.id='onboard-password';pw.type='password';pw.required=true;pw.minLength=12;pw.autocomplete='new-password';l.append(pw);fields.append(l);
 }else{field('Plan name','plan','text',{required:true,maxLength:80});field('Monthly fee (PKR)','fee','number',{required:true,min:0,max:999999999,step:.01});field('Start date','start','date');field('Expiry date','expiry','date');}
 const skip=document.createElement('button');skip.type='button';skip.textContent='Skip for now';skip.onclick=()=>{if(onboardBusy||!confirm('Skip this setup step? You can configure it later.'))return;onboardAdvance(d);};fields.append(skip);
 }
 $('onboard-panel').hidden=false;onboardRefresh();
}
$('onboard-start').onclick=()=>{if(onboardBusy||!onboardUser)return;if(onboardRead()){ $('onboard-status').textContent='Resume or discard your existing draft first.';onboardDraft=onboardRead();onboardRender();return;}onboardDraft={id:crypto.randomUUID(),step:0,version:2,colors:[...themePresets['Midnight Amber']],logo:'',manualSlug:false,name:'',slug:'',tables:'10',tax:'0',service:'0',cash:true,card:true};onboardPersist();onboardRender();};
$('onboard-resume').onclick=()=>{if(onboardBusy)return;onboardDraft=onboardRead();if(onboardDraft)onboardRender();};
$('onboard-back').onclick=()=>{if(onboardBusy||!onboardDraft)return;if(onboardDraft.step>=4)return;onboardDraft.step=Math.max(0,onboardDraft.step-1);onboardPersist();onboardRender();};
$('onboard-close').onclick=()=>{if(onboardBusy)return;if(!onboardPersist()){ $('onboard-status').textContent='Could not save draft on this browser.';return;}$('onboard-panel').hidden=true;onboardRefresh();};
$('onboard-discard').onclick=()=>{if(onboardBusy||!confirm(onboardDraft?.step>=4?'Discard remaining setup? The created restaurant and accounts will remain.':'Discard this onboarding draft?'))return;try{localStorage.removeItem(onboardKey());}catch{}onboardDraft=null;$('onboard-panel').hidden=true;onboardRefresh();};
$('onboard-form').onsubmit=async e=>{
 e.preventDefault();if(onboardBusy||!onboardDraft||!onboardUser)return;const d=onboardDraft,status=$('onboard-status');status.textContent='';
 if(d.step>=4){
 const session=epoch;onboardBusy=true;for(const el of $('onboard-form').querySelectorAll('button,input,select'))el.disabled=true;
 try{
 if(d.step===4||d.step===5){const call=d.step===4?ksCall:owCall;const key=d.step===4?'staff':'owners';const username=(d.staffUser||'').trim().toLowerCase();const password=$('onboard-password').value;if(!username||!(d.staffName||'').trim()||password.length<12||new TextEncoder().encode(password).length>72)throw Error('Enter valid username, display name and password (12 characters minimum, 72 bytes maximum).');const result=await call({action:'list'});const existing=(result[key]||[]).find(x=>x.restaurant_id===d.id&&x.username===username);if(!existing)await call({action:'create',restaurant_id:d.id,username,display_name:d.staffName.trim(),password});}
 else{if(!d.plan?.trim()||d.fee===''||!Number.isFinite(Number(d.fee))||Number(d.fee)<0||Number(d.fee)>999999999||(d.start&&d.expiry&&d.expiry<d.start))throw Error('Invalid subscription details.');const {error}=await db.from('restaurant_subscriptions').upsert({restaurant_id:d.id,plan_name:d.plan.trim(),monthly_fee:Number(d.fee),currency:'PKR',starts_on:d.start||null,expires_on:d.expiry||null,grace_period_days:0,payment_status:'unpaid',updated_at:new Date().toISOString()},{onConflict:'restaurant_id'});if(error)throw error;}
 if(session===epoch)onboardAdvance(d);
 }catch(err){if(session===epoch)status.textContent='Setup not confirmed: '+err.message+' — retry or skip.';}finally{onboardBusy=false;if(session===epoch){for(const el of $('onboard-form').querySelectorAll('button,input,select'))el.disabled=false;$('onboard-back').disabled=true;const pw=$('onboard-password');if(pw)pw.value='';}}return;
 }
 if(d.step===0){d.name=d.name.trim();d.slug=d.slug.trim();if(!d.name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)){status.textContent='Enter valid name and slug.';return;}}
 if(d.step===1&&d.logo&&!/^https:\/\//i.test(d.logo)){status.textContent='Logo URL must start with https://';return;}
 if(d.step===2&&(!d.cash&&!d.card)){status.textContent='Enable at least one payment method.';return;}
 if(d.step<3){d.step++;onboardPersist();onboardRender();return;}
 if(!Array.isArray(d.colors)||d.colors.length!==9||d.colors.some(c=>!validColor(c,null))||(d.logo&&!/^https:\/\//i.test(d.logo))||!d.name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)||!Number.isInteger(Number(d.tables))||Number(d.tables)<1||Number(d.tables)>500||![d.tax,d.service].every(v=>v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100)||(!d.cash&&!d.card)){status.textContent='Invalid draft. Go back and check settings.';return;}
 const session=epoch;onboardBusy=true;for(const b of $('onboard-form').querySelectorAll('button'))b.disabled=true;
 try{const {data:existing,error:lookup}=await db.from('restaurants').select('id,name,slug').eq('id',d.id).maybeSingle();if(lookup)throw lookup;if(!existing){const {error}=await db.from('restaurants').insert({id:d.id,name:d.name,slug:d.slug,status:'active',table_count:Number(d.tables),tax_percent:Number(d.tax),service_charge_percent:Number(d.service),cash_enabled:d.cash,card_enabled:d.card,logo_url:d.logo||null,...Object.fromEntries(themeKeys.map((k,i)=>[k,d.colors[i]]))});if(error)throw error;}if(session!==epoch)return;d.step=4;onboardPersist();onboardRender();message('Restaurant created: '+d.name+' — continue account setup.');await refreshRestaurants();}catch(err){if(session===epoch)status.textContent='Creation not confirmed: '+err.message+' — retry using the same draft.';}finally{onboardBusy=false;for(const b of $('onboard-form').querySelectorAll('button'))b.disabled=false;if(onboardDraft&&session===epoch)$('onboard-back').disabled=onboardDraft.step===0||onboardDraft.step>=4;}
};

const viewTitles={dashboard:'Overview',restaurants:'Restaurants',settings:'Restaurant settings',branding:'Themes & branding',subscriptions:'Subscriptions',payments:'Payments',menu:'Menu management',kitchen:'Kitchen management',owners:'Owner management',analytics:'Analytics'};
function showView(view){
 if(view!=='branding' && selectedRestaurant && !$('branding-section').classList.contains('view-hidden') && !$('branding-section').hidden){if(brandingBusy||!allowLeaveBranding())return;selectedRestaurant=null;++brandingRequest;$('branding-section').hidden=true;}
 if(!Object.hasOwn(viewTitles,view))view='dashboard';
 document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('view-hidden',n.dataset.view!==view));
 document.querySelectorAll('[data-nav]').forEach(n=>{if(n.dataset.nav===view)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
 $('view-title').textContent=viewTitles[view];
 if(view==='kitchen')ksLoad();else ksClose();
 if(view==='owners')owLoad();else owClose();
 if(view==='analytics')anOpen();else anReset();
}
function renderPickers(restaurants){
 document.querySelectorAll('[data-picker]').forEach(panel=>{
 panel.replaceChildren();
 for(const r of restaurants){const b=document.createElement('button');b.type='button';b.textContent=r.name;b.onclick=()=>{switch(panel.dataset.picker){case 'settings':openSettings(r);break;case 'branding':openBranding(r.id);break;case 'payments':openPayments(r);break;case 'subscriptions':openSubscription(r);break;case 'menu':location.href='admin.html?restaurant_id='+encodeURIComponent(r.id);break;}};panel.append(b);}
 if(!restaurants.length)panel.textContent='No restaurants yet.';
 });
 filterRestaurants();
}
function filterRestaurants(){const q=$('restaurant-search').value.trim().toLowerCase();for(const li of $('restaurants').children)li.hidden=!li.textContent.toLowerCase().includes(q);}
$('restaurant-search').addEventListener('input',filterRestaurants);
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));
$('nav-toggle').onclick=()=>document.body.classList.toggle('sidebar-closed');
try{document.body.classList.toggle('light',localStorage.getItem('nosh-admin-theme')==='light');}catch{}
$('theme-toggle').onclick=()=>{document.body.classList.toggle('light');try{localStorage.setItem('nosh-admin-theme',document.body.classList.contains('light')?'light':'dark');}catch{}};

// Kitchen management — server authorization is enforced by the Edge Function.
let ksStaff=[], ksRestaurants=[], ksMode='', ksTarget=null, ksBusy=false, ksTicket=0;
function ksClose(){ $('ks-form').reset(); $('ks-form').hidden=true; ksMode=''; ksTarget=null; }
function ksReset(){ ++ksTicket; ksClose(); ksStaff=[]; ksRestaurants=[]; $('ks-rows').replaceChildren(); $('ks-stats').replaceChildren(); $('ks-status').textContent=''; }
async function ksCall(body){
 const {data,error}=await db.functions.invoke('manage-kitchen-staff',{body});
 if(error){let detail;try{detail=await error.context.json();}catch{} throw Error(detail?.error||error.message);}
 if(!data?.success)throw Error(data?.error||'Request not confirmed');return data;
}
function ksLock(value){ksBusy=value;for(const el of $('kitchen-management').querySelectorAll('button,input,select'))el.disabled=value;}
function ksOption(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function ksRender(){
 const stats=$('ks-stats');stats.replaceChildren();
 for(const [label,value] of [['Total accounts',ksStaff.length],['Active',ksStaff.filter(s=>s.is_active).length],['Disabled',ksStaff.filter(s=>!s.is_active).length]]){const c=document.createElement('div');c.className='billing-stat';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;c.append(l,v);stats.append(c);}
 const rows=$('ks-rows');rows.replaceChildren();const q=$('ks-search').value.trim().toLowerCase(), f=$('ks-filter').value;
 for(const s of ksStaff){const r=ksRestaurants.find(r=>r.id===s.restaurant_id);const name=r?.name||'Unassigned / unknown';if(f&&f!==s.restaurant_id)continue;if(![name,s.username,s.display_name].join(' ').toLowerCase().includes(q))continue;
 const tr=document.createElement('tr');for(const v of [name,s.display_name||'Not configured',s.username||'Legacy email login']){const td=document.createElement('td');td.textContent=v;tr.append(td);}const td=document.createElement('td');const badge=document.createElement('span');badge.className='status-pill '+(s.is_active?'status-active':'status-suspended');badge.textContent=s.is_active?'Active':'Disabled';td.append(badge);tr.append(td);const actions=document.createElement('td');
 for(const [label,fn] of [['Edit',()=>ksOpen('update_profile',s)],['Reset password',()=>ksOpen('reset_password',s)],[s.is_active?'Disable':'Enable',()=>{if(confirm((s.is_active?'Disable':'Enable')+' account for '+name+'?'))ksMutate({action:'set_active',user_id:s.user_id,is_active:!s.is_active});}]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=ksBusy;b.onclick=fn;actions.append(b);}tr.append(actions);rows.append(tr);}
 if(!rows.children.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='No matching accounts.';tr.append(td);rows.append(tr);}
}
async function ksLoad(){if(ksBusy||$('dashboard').hidden)return;const ticket=++ksTicket, session=epoch;ksLock(true);$('ks-status').textContent='Loading accounts…';try{const [result,restaurants]=await Promise.all([ksCall({action:'list'}),db.from('restaurants').select('id,name,status').order('name')]);if(ticket!==ksTicket||session!==epoch)return;if(restaurants.error)throw restaurants.error;ksStaff=result.staff||[];ksRestaurants=restaurants.data||[];const f=$('ks-filter'), old=f.value;f.replaceChildren(ksOption('','All restaurants'),...ksRestaurants.map(r=>ksOption(r.id,r.name)));if([...f.options].some(o=>o.value===old))f.value=old;ksRender();$('ks-status').textContent='Accounts loaded.';}catch(e){if(ticket===ksTicket){ksStaff=[];ksRestaurants=[];ksRender();$('ks-status').textContent='Could not load accounts: '+e.message;}}finally{ksLock(false);}}
function ksOpen(mode,s=null){if(ksBusy)return;ksClose();ksMode=mode;ksTarget=s;const create=mode==='create', edit=mode==='update_profile';$('ks-title').textContent=create?'Create kitchen account':(edit?'Edit staff name':'Reset password')+' — '+(s.username||s.display_name||'Legacy account');for(const [key,visible] of [['restaurant',create],['user',create],['name',create||edit],['password',!edit]]){$('ks-'+key+'-label').hidden=!visible;$('ks-'+key).required=visible;}$('ks-restaurant').replaceChildren(ksOption('','Select restaurant'),...ksRestaurants.filter(r=>r.status==='active').map(r=>ksOption(r.id,r.name)));$('ks-name').value=s?.display_name||'';$('ks-form').hidden=false;$('ks-form').scrollIntoView({behavior:'smooth',block:'nearest'});}
async function ksMutate(body){if(ksBusy||$('dashboard').hidden)return;const session=epoch;ksLock(true);$('ks-status').textContent='Saving…';let saved=false;try{const result=await ksCall(body);if(session!==epoch)return;saved=true;ksClose();$('ks-status').textContent=result.message;}catch(e){if(session===epoch)$('ks-status').textContent='Request not confirmed: '+e.message+' — refresh before retrying.';}finally{$('ks-password').value='';ksLock(false);}if(saved&&session===epoch){await ksLoad();if(session===epoch)$('ks-status').textContent='Saved. '+$('ks-status').textContent;}}
$('ks-form').onsubmit=e=>{e.preventDefault();if(!ksMode||ksBusy)return;const body={action:ksMode};if(ksTarget)body.user_id=ksTarget.user_id;if(ksMode==='create'){body.restaurant_id=$('ks-restaurant').value;body.username=$('ks-user').value.trim().toLowerCase();}if(ksMode!=='reset_password')body.display_name=$('ks-name').value.trim();if(ksMode!=='update_profile'){body.password=$('ks-password').value;if(body.password.length<12||new TextEncoder().encode(body.password).length>72){$('ks-status').textContent='Password must be 12 characters minimum and 72 bytes maximum.';return;}}ksMutate(body);};
$('ks-create').onclick=()=>ksOpen('create');$('ks-cancel').onclick=ksClose;$('ks-refresh').onclick=()=>{ksClose();ksLoad();};$('ks-search').oninput=ksRender;$('ks-filter').onchange=ksRender;$('ks-link').onclick=async()=>{const url=new URL('kitchen.html',location.href).href;try{await navigator.clipboard.writeText(url);$('ks-status').textContent='Shared kitchen login link copied.';}catch{$('ks-status').textContent=url;}};


// Owner management — separate Edge Function.
let owStaff=[], owRestaurants=[], owMode='', owTarget=null, owBusy=false, owTicket=0;
function owClose(){ $('ow-form').reset(); $('ow-password').type='password'; $('ow-reveal').textContent='Show password'; $('ow-reveal').setAttribute('aria-pressed','false'); $('ow-form').hidden=true; owMode=''; owTarget=null; }
function owReset(){ ++owTicket; $('ow-search').value=''; $('ow-state').value=''; $('ow-filter').replaceChildren(); owClose(); owStaff=[]; owRestaurants=[]; $('ow-rows').replaceChildren(); $('ow-stats').replaceChildren(); $('ow-status').textContent=''; }
async function owCall(body){
 const {data,error}=await db.functions.invoke('manage-restaurant-owners',{body});
 if(error){let detail;try{detail=await error.context.json();}catch{} throw Error(detail?.error||error.message);}
 if(!data?.ok)throw Error(data?.error||'Request not confirmed');return data;
}
function owLock(value){owBusy=value;for(const el of $('owner-management').querySelectorAll('button,input,select'))el.disabled=value;}
function owOption(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function owRender(){
 const stats=$('ow-stats');stats.replaceChildren();
 for(const [label,value] of [['Total accounts',owStaff.length],['Active',owStaff.filter(s=>s.is_active).length],['Disabled',owStaff.filter(s=>!s.is_active).length]]){const c=document.createElement('div');c.className='billing-stat';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;c.append(l,v);stats.append(c);}
 const rows=$('ow-rows');rows.replaceChildren();const q=$('ow-search').value.trim().toLowerCase(), f=$('ow-filter').value;
 for(const s of owStaff){const r=owRestaurants.find(r=>r.id===s.restaurant_id);const name=r?.name||'Unassigned / unknown';if(f&&f!==s.restaurant_id)continue;const state=$('ow-state').value;if(state&&state!==(s.is_active?'active':'disabled'))continue;if(![name,s.username,s.display_name].join(' ').toLowerCase().includes(q))continue;
 const tr=document.createElement('tr');for(const v of [name,s.display_name||'Not configured',s.username||'Unknown username']){const td=document.createElement('td');td.textContent=v;tr.append(td);}const td=document.createElement('td');const badge=document.createElement('span');badge.className='status-pill '+(s.is_active?'status-active':'status-suspended');badge.textContent=s.is_active?'Active':'Disabled';td.append(badge);tr.append(td);const actions=document.createElement('td');
 for(const [label,fn] of [['Edit',()=>owOpen('update_profile',s)],['Reset password',()=>owOpen('reset_password',s)],[s.is_active?'Disable':'Enable',()=>{if(confirm((s.is_active?'Disable':'Enable')+' account for '+name+'?'))owMutate({action:'set_active',user_id:s.user_id,is_active:!s.is_active});}]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=owBusy;b.onclick=fn;actions.append(b);}tr.append(actions);rows.append(tr);}
 if(!rows.children.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='No matching accounts.';tr.append(td);rows.append(tr);}
}
async function owLoad(){if(owBusy||$('dashboard').hidden||$('owner-management').classList.contains('view-hidden'))return;const ticket=++owTicket, session=epoch;owLock(true);$('ow-status').textContent='Loading accounts…';try{const [result,restaurants]=await Promise.all([owCall({action:'list'}),db.from('restaurants').select('id,name,status').order('name')]);if(ticket!==owTicket||session!==epoch)return;if(restaurants.error)throw restaurants.error;owStaff=result.owners||[];owRestaurants=restaurants.data||[];const f=$('ow-filter'), old=f.value;f.replaceChildren(owOption('','All restaurants'),...owRestaurants.map(r=>owOption(r.id,r.name)));if([...f.options].some(o=>o.value===old))f.value=old;owRender();$('ow-status').textContent='Accounts loaded.';}catch(e){if(ticket===owTicket){owStaff=[];owRestaurants=[];owRender();$('ow-status').textContent='Could not load accounts: '+e.message;}}finally{owLock(false);}}
function owOpen(mode,s=null){if(owBusy)return;owClose();owMode=mode;owTarget=s;const create=mode==='create', edit=mode==='update_profile';$('ow-title').textContent=create?'Create owner account':(edit?'Edit owner name':'Reset password')+' — '+(s.username||s.display_name||'Owner account');for(const [key,visible] of [['restaurant',create],['user',create],['name',create||edit],['password',!edit]]){$('ow-'+key+'-label').hidden=!visible;$('ow-'+key).required=visible;}$('ow-restaurant').replaceChildren(owOption('','Select restaurant'),...owRestaurants.filter(r=>r.status==='active').map(r=>owOption(r.id,r.name)));$('ow-name').value=s?.display_name||'';$('ow-form').hidden=false;$('ow-form').scrollIntoView({behavior:'smooth',block:'nearest'});}
async function owMutate(body){if(owBusy||$('dashboard').hidden)return;const session=epoch;owLock(true);$('ow-status').textContent='Saving…';let saved=false;try{const result=await owCall(body);if(session!==epoch)return;saved=true;owClose();$('ow-status').textContent=result.message;}catch(e){if(session===epoch)$('ow-status').textContent='Request not confirmed: '+e.message+' — refresh before retrying.';}finally{$('ow-password').value='';owLock(false);}if(saved&&session===epoch){await owLoad();if(session===epoch)$('ow-status').textContent='Saved. '+$('ow-status').textContent;}}
$('ow-form').onsubmit=e=>{e.preventDefault();if(!owMode||owBusy)return;const body={action:owMode};if(owTarget)body.user_id=owTarget.user_id;if(owMode==='create'){body.restaurant_id=$('ow-restaurant').value;body.username=$('ow-user').value.trim().toLowerCase();}if(owMode!=='reset_password')body.display_name=$('ow-name').value.trim();if(owMode!=='update_profile'){body.password=$('ow-password').value;if(body.password.length<12||new TextEncoder().encode(body.password).length>72){$('ow-status').textContent='Password must be 12 characters minimum and 72 bytes maximum.';return;}}owMutate(body);};
$('ow-create').onclick=()=>owOpen('create');$('ow-cancel').onclick=owClose;$('ow-refresh').onclick=()=>{owClose();owLoad();};$('ow-search').oninput=owRender;$('ow-filter').onchange=owRender;$('ow-state').onchange=owRender;$('ow-reveal').onclick=()=>{const p=$('ow-password'),show=p.type==='password';p.type=show?'text':'password';$('ow-reveal').textContent=show?'Hide password':'Show password';$('ow-reveal').setAttribute('aria-pressed',String(show));};$('ow-link').onclick=async()=>{const url=new URL('owner.html',location.href).href;try{await navigator.clipboard.writeText(url);$('ow-status').textContent='Shared owner portal login link copied.';}catch{$('ow-status').textContent=url;}};



// Step 56.5.2: read-only analytics, using existing admin session.
let anTicket=0, anTab='overview', anExport=null;
function anSelectTab(tab){
 anTab=tab;
 document.querySelectorAll('[data-an-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.anTab===tab)));
 $('an-overview').hidden=tab!=='overview'; $('an-details').hidden=tab==='overview';
 $('an-restaurant-label').hidden=tab!=='overview';
}
document.querySelectorAll('[data-an-tab]').forEach(b=>b.onclick=()=>{anSelectTab(b.dataset.anTab);anLoad();});
function anReset(){++anTicket;anExport=null;$('an-export').disabled=true;$('an-details').replaceChildren();$('an-stats').replaceChildren();$('an-breakdown').replaceChildren();$('an-status').textContent='';$('an-refresh').disabled=false;}
async function anOpen(){
 anSelectTab('overview'); anReset(); const ticket=anTicket, session=epoch;
 $('an-period').value='year'; const today=pakistanToday(); $('an-start').value=today.slice(0,4)+'-01-01';$('an-end').value=today;
 $('an-restaurant').replaceChildren(new Option('All restaurants',''));
 $('an-refresh').disabled=true; $('an-status').textContent='Loading restaurants…';
 try{const {data,error}=await db.from('restaurants').select('id,name').order('name');
 if(ticket!==anTicket||session!==epoch)return;if(error)throw error;
 for(const r of data||[])$('an-restaurant').append(new Option(r.name,r.id));
 await anLoad();
 }catch(e){if(ticket===anTicket&&session===epoch){$('an-status').textContent='Could not load restaurants: '+e.message;$('an-refresh').disabled=false;}}
}
async function anLoad(){
 if($('dashboard').hidden)return;anReset();const ticket=anTicket,session=epoch;
 const start=$('an-start').value,end=$('an-end').value,id=$('an-restaurant').value;
 if(!start||!end||start>end||daysBetween(start,end)>365){$('an-status').textContent='Choose a valid date range of up to 366 days.';return;}
 $('an-refresh').disabled=true;$('an-status').textContent='Loading analytics…';
 try{if(anTab!=='overview'){await anDetails(start,end,id,ticket,session);if(ticket===anTicket&&session===epoch)$('an-status').textContent='Report: '+start+' to '+end+' · All restaurants';return;}
 const {data:r,error}=await db.rpc('get_restaurant_analytics',{p_start_date:start,p_end_date:end,p_restaurant_id:id||null});
 if(ticket!==anTicket||session!==epoch||$('dashboard').hidden)return;if(error)throw error;
 if(r && typeof r==='object' && r.served_value==null)r.served_value=r.total_served_value;
 if(!r||typeof r!=='object'||!['total_orders','served_orders','pending_orders','cancelled_orders','served_value','average_order_value'].every(k=>r[k]!=null&&Number.isFinite(Number(r[k]))))throw Error('Unexpected analytics response.');
 const money=v=>formatMoney(v,r.currency||'PKR');
 for(const [label,value] of [['Total orders',r.total_orders],['Served order value',money(r.served_value)],['Served orders',r.served_orders],['Pending orders',r.pending_orders],['Cancelled orders',r.cancelled_orders],['Average served order value',money(r.average_order_value)]]){const c=document.createElement('div');c.className='billing-stat';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;c.append(l,v);$('an-stats').append(c);}
 for(const [label,value,color] of [['Served',r.served_orders,'#22c55e'],['Pending',r.pending_orders,'#eab308'],['Cancelled',r.cancelled_orders,'#ef4444']]){const l=document.createElement('div');l.textContent=label+' — '+value;const t=document.createElement('div');t.className='an-track';const f=document.createElement('div');f.className='an-fill';f.style.background=color;f.style.width=Math.min(100,Math.max(0,r.total_orders?100*value/r.total_orders:0))+'%';t.append(f);$('an-breakdown').append(l,t);}
 anDonut(r);anSave(r,start,end,id);
 $('an-status').textContent='Report: '+start+' to '+end+(Number(r.total_orders)===0?' · No orders in this period.':'');

 }catch(e){if(ticket===anTicket&&session===epoch){$('an-stats').replaceChildren();$('an-breakdown').replaceChildren();$('an-status').textContent='Could not load analytics: '+e.message;}}
 finally{if(ticket===anTicket&&session===epoch)$('an-refresh').disabled=false;}
}

// Step 56.5.3: independent read-only reports, scoped by the same filters.
async function anDetails(start,end,id,ticket,session){
 const root=$('an-details');
 const valid=()=>ticket===anTicket&&session===epoch&&!$('dashboard').hidden;
 const args={p_start_date:start,p_end_date:end,p_restaurant_id:id||null};
 const money=(v,c='PKR')=>v==null?'—':formatMoney(v,c);
 const text=v=>v==null?'—':String(v);
 const specs=anTab==='restaurants'?[['Restaurant comparison — all restaurants','get_restaurant_comparison_analytics',{p_start_date:start,p_end_date:end}]]:[['SaaS subscription income — all restaurants','get_saas_subscription_analytics',{p_start_date:start,p_end_date:end}]];
 function node(tag,value){const n=document.createElement(tag);if(value!=null)n.textContent=value;return n;}
 function table(panel,title,headers,rows){
  if(!Array.isArray(rows))throw Error('Unexpected report rows: '+title);
  panel.append(node('h3',title));const wrap=node('div');wrap.className='payment-table-wrap';wrap.style.maxHeight='420px';wrap.style.overflow='auto';
  const t=node('table');t.className='billing-table';const head=node('thead'),hr=node('tr');for(const h of headers){const th=node('th',h);th.scope='col';hr.append(th);}head.append(hr);t.append(head);const body=node('tbody');
  for(const row of rows){const tr=node('tr');for(const v of row)tr.append(node('td',text(v)));body.append(tr);}
  if(!rows.length){const tr=node('tr'),td=node('td','No records in this period.');td.colSpan=headers.length;tr.append(td);body.append(tr);}t.append(body);wrap.append(t);panel.append(wrap);
 }
 const jobs=specs.map(async ([title,fn,params],i)=>{
  const panel=node('div');panel.className='renew-panel';panel.append(node('h3',title));const status=node('p','Loading…');status.className='hint';panel.append(status);root.append(panel);
  try{const {data:r,error}=await db.rpc(fn,params);if(!valid())return;if(error)throw error;if(!r||typeof r!=='object')throw Error('Unexpected report response');const c=r.currency||'PKR';const m=v=>money(v,c);const rows=(key,mapper)=>{if(!Array.isArray(r[key]))throw Error('Missing '+key);return r[key].map(mapper);};
   if(fn==='get_restaurant_comparison_analytics'){panel.append(node('p','Comparison always includes all restaurants for the selected dates, regardless of restaurant filter.'));table(panel,'Ranked by served value',['Restaurant','Orders','Served','Cancelled','Served value','Cancellation rate'],rows('restaurants',x=>[x.restaurant_name,x.total_orders,x.served_orders,x.cancelled_orders,m(x.served_value??x.total_served_value),Number(x.total_orders)>0&&x.cancellation_rate!=null?x.cancellation_rate+'%': '—']));}
   if(fn==='get_saas_subscription_analytics'){
    panel.append(node('p','Recorded payments for '+start+' to '+end+' · All restaurants, independent of restaurant filter. Not restaurant food sales or net profit.'));
    panel.append(node('p','Subscription fees and statuses are current as of '+text(r.subscription_snapshot_date)+', not historical income. Currencies are never added together.'));
    const cash=(v,c)=>v==null||!c?'—':money(v,c);
    const grid=node('div');grid.className='billing-grid';
    const stat=(label,value)=>{const card=node('div');card.className='billing-stat';card.append(node('small',label),node('strong',text(value)));grid.append(card);};
    stat('Payments recorded',r.total_payment_count);stat('Paying restaurants',r.paying_restaurants);stat('Configured subscriptions',text(r.configured_subscriptions)+' / '+text(r.total_restaurants));
    for(const x of rows('payment_totals',x=>x))stat('Recorded income ('+x.currency+')',cash(x.recorded_income,x.currency));
    if(!r.payment_totals.length)stat('Recorded income','No payments in period');
    for(const x of rows('monthly_fee_summary',x=>x)){stat('Configured monthly fees ('+x.currency+')',cash(x.configured_monthly_fees,x.currency));stat('Active monthly fees ('+x.currency+')',cash(x.active_monthly_fees,x.currency));}
    panel.append(grid);
    panel.append(node('p','Active monthly fees include active restaurants with active or expiring-soon subscriptions only.'));
    table(panel,'Monthly payments',['Month','Currency','Payments','Recorded income'],rows('monthly_payments',x=>[x.month,x.currency,x.payment_count,cash(x.recorded_income,x.currency)]));
    table(panel,'Restaurant income',['Restaurant','Currency','Payments','Recorded income'],rows('restaurant_income',x=>[x.restaurant_name,x.currency,x.payment_count,cash(x.recorded_income,x.currency)]));
    table(panel,'Payment methods',['Method','Currency','Payments','Recorded income'],rows('payment_methods',x=>[paymentMethods[x.payment_method]||x.payment_method,x.currency,x.payment_count,cash(x.recorded_income,x.currency)]));
    table(panel,'Subscription status snapshot',['Status','Restaurants'],rows('subscription_status_breakdown',x=>[x.subscription_status==='expired'?'Expired':subscriptionStatusLabels[x.subscription_status]||x.subscription_status,x.restaurant_count]));
    table(panel,'Current subscriptions',['Restaurant','Plan','Monthly fee','Status','Expiry','Grace days','Access mode'],rows('subscriptions',x=>[x.restaurant_name,x.plan_name,cash(x.monthly_fee,x.currency),x.subscription_status==='expired'?'Expired':subscriptionStatusLabels[x.subscription_status]||x.subscription_status,x.expires_on,x.grace_period_days,x.access_mode]));
   }
   if(fn==='get_restaurant_comparison_analytics')anBars(panel,'Orders by restaurant',r.restaurants.map(x=>[x.restaurant_name,x.total_orders]));
   if(fn==='get_saas_subscription_analytics')for(const c of new Set(r.monthly_fee_summary.map(x=>x.currency)))anBars(panel,'Monthly fees — '+c,r.subscriptions.filter(x=>x.currency===c&&x.monthly_fee!=null).map(x=>[x.restaurant_name,x.monthly_fee]));
   anSave(r,start,end,'');status.textContent='Loaded.';
  }catch(e){if(valid()){panel.replaceChildren(node('h3',title),node('p','Could not load report: '+e.message));}}
 });await Promise.all(jobs);
}

function anDateShift(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
$('an-period').onchange=()=>{const p=$('an-period').value,t=pakistanToday(),m=t.slice(0,7)+'-01';if(p==='custom')return;let a=t,b=t;if(p==='yesterday')a=b=anDateShift(t,-1);if(p==='7'||p==='30')a=anDateShift(t,1-Number(p));if(p==='month')a=m;if(p==='year')a=t.slice(0,4)+'-01-01';if(p==='lastmonth'){b=anDateShift(m,-1);a=b.slice(0,7)+'-01';}$('an-start').value=a;$('an-end').value=b;anLoad();};
function anDonut(r){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 140 140');svg.setAttribute('role','img');svg.setAttribute('aria-label','Order status chart');let offset=0;const total=Number(r.total_orders),circ=2*Math.PI*52;for(const [v,c] of [[total,'#64748b'],[r.served_orders,'#22c55e'],[r.pending_orders,'#eab308'],[r.cancelled_orders,'#ef4444']]){const n=document.createElementNS(ns,'circle');for(const [k,val] of Object.entries({cx:70,cy:70,r:52,fill:'none',stroke:c,'stroke-width':18,'stroke-dasharray':(total?circ*Number(v)/total:circ)+' '+circ,'stroke-dashoffset':-offset,transform:'rotate(-90 70 70)'}))n.setAttribute(k,val);svg.append(n);offset+=total?circ*Number(v)/total:0;if(!total)break;}const label=document.createElementNS(ns,'text');label.setAttribute('x','70');label.setAttribute('y','76');label.setAttribute('text-anchor','middle');label.setAttribute('fill','currentColor');label.textContent=total;svg.append(label);const wrap=document.createElement('div');wrap.className='an-chart';wrap.append(svg);$('an-breakdown').prepend(wrap);}
function anBars(panel,title,rows){const wrap=document.createElement('div');wrap.className='an-chart';const h=document.createElement('h3');h.textContent=title;wrap.append(h);const max=Math.max(1,...rows.map(x=>Number(x[1])||0));for(const [name,value] of rows.slice(0,20)){const l=document.createElement('div');l.textContent=name+' — '+value;const track=document.createElement('div');track.className='an-track';const fill=document.createElement('div');fill.className='an-fill';fill.style.width=Math.max(0,Math.min(100,100*Number(value)/max))+'%';track.append(fill);wrap.append(l,track);}if(rows.length>20){const note=document.createElement('p');note.textContent='Chart shows first 20 rows; full report is in the table.';wrap.append(note);}panel.append(wrap);}
function anSave(r,start,end,id){anExport={r,start,end,id,tab:anTab};$('an-export').disabled=false;}
function anCsvCell(v){let s=v==null?'':String(v);if(typeof v==='string'&&/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
$('an-export').onclick=()=>{if(!anExport)return;const {r,start,end,id,tab}=anExport;const rows=[['Report',tab],['Start',start],['End',end],['Restaurant',id?$('an-restaurant').selectedOptions[0].textContent:'All restaurants']];const scalars=Object.entries(r).filter(([k,v])=>v==null||['string','number','boolean'].includes(typeof v));rows.push([],['Metric','Value'],...scalars);for(const [key,items] of Object.entries(r)){if(!Array.isArray(items)||!items.length)continue;const keys=[...new Set(items.flatMap(x=>Object.keys(x)))].filter(k=>!['logo_url'].includes(k));rows.push([],[key],keys,...items.map(x=>keys.map(k=>typeof x[k]==='object'&&x[k]!=null?JSON.stringify(x[k]):x[k])));}const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(anCsvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=tab+'-'+start+'-'+end+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('an-refresh').onclick=anLoad;
for(const id of ['an-start','an-end','an-restaurant'])$(id).addEventListener('change',()=>{if(id!=='an-restaurant')$('an-period').value='custom';anReset();$('an-status').textContent='Filters changed. Select Load report.';});

// Restaurant-level security controls.
let securityDialog=null,securityTicket=0;
async function openOrderSecurity(r){
 const ticket=++securityTicket,sessionEpoch=epoch;
 if(securityDialog)securityDialog.remove();
 const d=document.createElement('dialog');securityDialog=d;
 d.style.cssText='max-width:min(92vw,480px);width:100%;padding:24px;border-radius:16px;background:Canvas;color:CanvasText;border:1px solid GrayText';
 d.innerHTML='<h2>Order security</h2><p id="sec-restaurant"></p><p id="sec-status" role="status">Loading…</p><form id="sec-form" hidden><label><input type="checkbox" id="sec-enforcement"> Enforce secure checkout</label><label><input type="checkbox" id="sec-pilot"> Secure checkout pilot (without blocking legacy orders)</label><p>Turnstile is mandatory when secure checkout is used.</p><label><input type="checkbox" id="sec-rate"> Enable rate limiting</label><label>Orders per device / minute<input id="sec-minute" type="number" min="1" max="100" required></label><label>Orders per device / 15 minutes<input id="sec-window" type="number" min="1" max="500" required></label><label>Orders per table / 5 minutes<input id="sec-table" type="number" min="1" max="500" required></label><p class="hint">Enabling enforcement blocks legacy checkout. Verify the deployed menu before enabling. Pilot mode, if enabled, uses verification even when enforcement is OFF.</p><fieldset style="margin:16px 0;padding:12px;border:1px solid GrayText;border-radius:10px"><legend>Table PIN security</legend><label><input type="checkbox" id="sec-pin-enabled" disabled> Require table PIN at checkout</label><p class="hint">Activation locked until customer verification and security testing are complete.</p><label>Table session duration<select id="sec-pin-duration"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option><option value="manual">Until staff closes table</option></select></label><p class="hint">Duration applies to newly opened sessions.</p></fieldset><button type="submit">Save security settings</button></form><button type="button" id="sec-close">Close</button>';
 document.body.append(d);const q=id=>d.querySelector('#'+id);
 q('sec-restaurant').textContent=r.name;
 q('sec-close').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();if(securityDialog===d){securityDialog=null;++securityTicket;}});
 d.showModal();
 const current=()=>ticket===securityTicket&&sessionEpoch===epoch&&d.isConnected;
 try{
 const {data,error}=await db.from('restaurant_order_security').select('*').eq('restaurant_id',r.id).maybeSingle();
 if(!current())return;if(error)throw error;
 if(!data)throw Error('Security configuration missing. Contact administrator.');
 const c=data;
 q('sec-pin-enabled').checked=!!c.table_pin_enabled;q('sec-pin-duration').value=data?(c.table_pin_duration_minutes===null?'manual':String(c.table_pin_duration_minutes)):'120';
 q('sec-pilot').checked=!!c.secure_checkout_pilot;q('sec-enforcement').checked=c.enforce_secure_checkout; let savedEnforcement=c.enforce_secure_checkout; let savedRevision=data.revision;
 q('sec-rate').checked=c.rate_limit_enabled;q('sec-minute').value=c.device_per_minute;q('sec-window').value=c.device_per_15_minutes;q('sec-table').value=c.table_per_5_minutes;
 q('sec-status').textContent=data?'Settings loaded.':'Not configured. Save to initialize.';
 q('sec-form').hidden=false;
 q('sec-form').onsubmit=async e=>{
 e.preventDefault();if(!current())return;
 const a=Number(q('sec-minute').value),b=Number(q('sec-window').value),t=Number(q('sec-table').value);
 if(![a,b,t].every(Number.isInteger)||a<1||a>100||b<a||b>500||t<1||t>500){q('sec-status').textContent='Check limits: 15-minute limit must be at least the minute limit.';return;}
 const duration=q('sec-pin-duration').value;
 if(!['30','60','120','240','manual'].includes(duration)){q('sec-status').textContent='Invalid table session duration.';return;}
 const enforce=q('sec-enforcement').checked;
 const pinEnabled=q('sec-pin-enabled').checked;
 if(pinEnabled&&!enforce){q('sec-status').textContent='Table PIN requires secure checkout enforcement.';return;}
 if(enforce!==savedEnforcement&&!confirm(enforce?'Enable secure checkout? Older checkout pages may stop accepting orders.':'Disable enforcement? Direct legacy orders will be allowed.'))return;
 const button=e.target.querySelector('button[type=submit]');button.disabled=true;
 try{
 const {data:result,error}=await db.functions.invoke('manage-order-security',{body:{action:'save',p_restaurant_id:r.id,p_revision:savedRevision,p_enforce:enforce,p_pilot:q('sec-pilot').checked,p_rate:q('sec-rate').checked,p_minute:a,p_window:b,p_table:t,p_pin:pinEnabled,p_duration:duration==='manual'?null:Number(duration)}});
 if(error){let code;try{code=(await error.context.json()).error;}catch{}throw Error(code==='SETTINGS_CHANGED'?'Settings changed in another session. Close and reopen settings before saving.':code||error.message);}
 if(!result?.success||!Number.isSafeInteger(result.revision)||result.revision!==savedRevision+1)throw Error('Settings save could not be confirmed. Close and reopen settings.');
 savedEnforcement=enforce;savedRevision=result.revision;
 if(current())q('sec-status').textContent='Security settings saved.';
 }catch(err){if(current())q('sec-status').textContent='Save failed: '+err.message;}finally{button.disabled=false;}
 };
 }catch(err){if(current())q('sec-status').textContent='Load failed: '+err.message;}
}
showView('dashboard');

checkSession().catch(e=>{ $('login').hidden=false; message(e.message||'Connection unavailable.'); });