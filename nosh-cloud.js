(function(){
  function client(role){
    const c=window.NOSH_CONFIG;
    if(!c||c.url.includes('YOUR_')||c.publicKey.includes('YOUR_'))throw Error('Supabase setup required. Check configuration.');
    if(!window.supabase)throw Error('Connection library could not load. Check internet.');
    return window.supabase.createClient(c.url.replace(/\/rest\/v1\/?$/,''),c.publicKey,{
      auth:{persistSession:role!=='customer',autoRefreshToken:role!=='customer',
        detectSessionInUrl:false,storageKey:'nosh-'+role+'-auth'}
    });
  }
  window.createNoshClient=(kitchen=false)=>client(kitchen?'kitchen':'customer');
  window.createNoshAdminClient=()=>client('admin');
})();
