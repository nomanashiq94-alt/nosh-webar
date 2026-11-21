'use strict';
const db = window.createNoshAdminClient();
const $ = id => document.getElementById(id);
const message = s => { $('message').textContent = s; };
let epoch = 0;
async function refreshRestaurants(){
  const {data,error} = await db.from('restaurants').select('id,name,slug,status,created_at').order('created_at',{ascending:false});
  if(error) throw error;
  const list=$('restaurants'); list.replaceChildren();
  for(const r of data){
    const li=document.createElement('li');
    const strong=document.createElement('strong'); strong.textContent=r.name;
    const small=document.createElement('small'); small.textContent=' · '+r.slug+' · '+r.status;
    li.append(strong,small); list.append(li);
  }
  if(!data.length){const li=document.createElement('li');li.textContent='No restaurants yet.';list.append(li);}
}
async function checkSession(){
  const seq=++epoch;
  $('dashboard').hidden=true; $('login').hidden=false;
  const {data:{user},error}=await db.auth.getUser();
  if(seq!==epoch)return;
  if(error||!user){message('Sign in with your existing admin account.');return;}
  const {data:admin,error:accessError}=await db.from('super_admins').select('user_id').eq('user_id',user.id).maybeSingle();
  if(seq!==epoch)return;
  if(accessError||!admin){message('This account is not a super admin.');return;}
  $('login').hidden=true;$('dashboard').hidden=false;
  try{await refreshRestaurants();message('Super admin connected.');}catch(e){message(e.message);}
}
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();message('Signing in…');
  const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
  $('password').value='';
  if(error){message(error.message);return;}
  await checkSession();
});
$('logout').addEventListener('click',async()=>{await db.auth.signOut();await checkSession();});
$('reload').addEventListener('click',async()=>{try{await refreshRestaurants();message('List refreshed.');}catch(e){message(e.message);}});
$('create-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const name=$('name').value.trim(),slug=$('slug').value.trim().toLowerCase();
  if(!name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){message('Enter a valid name and lowercase URL slug.');return;}
  const button=e.target.querySelector('button');button.disabled=true;
  try{
    const {error}=await db.from('restaurants').insert({name,slug,status:'active'});
    if(error)throw error;
    e.target.reset();await refreshRestaurants();message('Restaurant created: '+name);
  }catch(err){message('Could not create restaurant: '+err.message);}finally{button.disabled=false;}
});
checkSession();
