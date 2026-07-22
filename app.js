/* THE Hybrid Engine — application logic (externalized for a strict CSP).
   Classic script (global functions); loaded with defer after the Supabase
   client. Inline on* handlers were replaced by data-fn/data-args event
   delegation so the page needs no script-src 'unsafe-inline'. */
/* ============================================================
   THE Hybrid Engine — the design mock, made real.
   Every screen renders the mock's exact markup; underneath,
   a persistent local-first engine: workouts, live sessions,
   history, WHOOP (server-side) and optional cloud sync.
   ============================================================ */

/* ---------- persistence ---------- */
const LS_KEY='hybrid-engine-v1';
let DB={workouts:[],sessions:[],settings:{}};
function uid(){return Math.random().toString(36).slice(2,10)}
function sanitizeDB(d){
  d=(d&&typeof d==='object')?d:{};
  const arr=v=>Array.isArray(v)?v:[];
  const cleanEx=e=>{e=(e&&typeof e==='object')?e:{};e.sets=arr(e.sets).map(s=>(s&&typeof s==='object')?s:{});if(!e.sets.length)e.sets=[newSet()];e.mode=MODES[e.mode]?e.mode:'reps_kg';return e;};
  const cleanBlock=b=>{b=(b&&typeof b==='object')?b:{};b.exercises=arr(b.exercises).map(cleanEx);if(!b.exercises.length)b.exercises=[newEx()];return b;};
  const cleanBlocks=v=>{const bl=arr(v).map(cleanBlock);return bl;};
  return {
    workouts:arr(d.workouts).map(w=>{w=(w&&typeof w==='object')?w:{};w.blocks=cleanBlocks(w.blocks);if(!w.id)w.id=uid();return w;}),
    sessions:arr(d.sessions).map(s=>{s=(s&&typeof s==='object')?s:{};s.blocks=cleanBlocks(s.blocks);if(!s.id)s.id=uid();return s;}),
    settings:(d.settings&&typeof d.settings==='object')?d.settings:{},
  };
}
function load(){try{const raw=localStorage.getItem(LS_KEY);if(raw)DB=sanitizeDB(JSON.parse(raw));}catch(e){DB={workouts:[],sessions:[],settings:{}};}}
function save(){try{localStorage.setItem(LS_KEY,JSON.stringify(DB));flashSaved()}catch(e){}if(typeof queueCloudPush==='function')queueCloudPush();}
let savedTimer=null;
function flashSaved(){const el=document.getElementById('sideStatus');if(!el)return;el.textContent='Saved ✓';clearTimeout(savedTimer);savedTimer=setTimeout(()=>{if(el)el.textContent='Saved locally'},1200)}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- CSP-safe event delegation (no inline on* handlers) ----------
   Markup carries data-click/-input/-change="fnName" plus a JSON data-args
   array; sentinels @self/@value/@checked/@event resolve at dispatch time to
   the element, its value, its checked state, or the event. This lets the app
   run under script-src 'self' with no 'unsafe-inline'. */
function _hbArgs(raw,el,ev){let a=[];if(raw){try{a=JSON.parse(raw)}catch(e){a=[]}}return a.map(x=>x==='@self'?el:x==='@value'?el.value:x==='@checked'?el.checked:x==='@event'?ev:x);}
function _hbRun(el,name,ev){const fn=window[name];if(typeof fn==='function')fn.apply(null,_hbArgs(el.getAttribute('data-args'),el,ev));}
document.addEventListener('click',e=>{const el=e.target.closest('[data-click]');if(el)_hbRun(el,el.getAttribute('data-click'),e);});
document.addEventListener('input',e=>{const el=e.target.closest('[data-input]');if(el)_hbRun(el,el.getAttribute('data-input'),e);});
document.addEventListener('change',e=>{const el=e.target.closest('[data-change]');if(el)_hbRun(el,el.getAttribute('data-change'),e);});
function noop(){}
function setWkName(v){WK.name=v;}
function triggerImport(){const el=document.getElementById('importFile');if(el)el.click();}

/* ---------- shared training model ---------- */
const MODES={
  reps_kg:{label:'Reps + Kilos',unit:'',ph:'reps'},
  amrap:{label:'Max reps',unit:'',ph:'max'},
  seconds:{label:'Seconds',unit:'s',ph:'secs'},
  reps_seconds:{label:'Reps + Seconds',unit:'s',ph:'secs'},
  reps:{label:'Reps only',unit:'',ph:'reps'},
  completion:{label:'For completion',unit:'',ph:''},
};
const MODEKEYS=Object.keys(MODES);
function newSet(){return{t:'',rpe:''}}
function newEx(){return{id:uid(),name:'',mode:'reps_kg',tempo:'',rest:90,sets:[newSet(),newSet(),newSet()]}}
function newBlock(){return{id:uid(),heading:'New block',minutes:'',format:'',superset:false,exercises:[newEx()]}}
function fmtRest(s){s=+s||0;return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function rxLine(ex){
  const cfg=MODES[ex.mode]||MODES.reps_kg,n=ex.sets.length;let rx;
  if(ex.mode==='completion'){rx=n+' × complete'}
  else{
    const vals=ex.sets.map(s=>(ex.mode==='amrap'||s.t==='max')?'max':(s.t||'—')+cfg.unit),u=[...new Set(vals)];
    rx=n+' × '+(u.length===1?u[0]:vals.join('/'));
    const rpes=ex.sets.map(s=>s.rpe).filter(Boolean);
    if(rpes.length){const uu=[...new Set(rpes)];rx+=' · RPE '+(uu.length===1?uu[0]:rpes[0]+'→'+rpes[rpes.length-1])}
  }
  if(ex.tempo)rx+=' · @'+ex.tempo;
  if(ex.rest)rx+=' · rest '+fmtRest(ex.rest);
  return rx;
}
function blockCountLabel(w){
  const exs=(w.blocks||[]).reduce((n,b)=>n+(b.exercises||[]).length,0);
  return (w.blocks||[]).length+' block'+((w.blocks||[]).length===1?'':'s')+' · '+exs+' exercise'+(exs===1?'':'s');
}

/* ---------- navigation ---------- */
let CURRENT='home';
function go(id,btn){
  CURRENT=id;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  const scr=document.getElementById('s-'+id);if(scr)scr.classList.add('on');
  document.querySelectorAll('.navlink').forEach(b=>b.classList.remove('active'));
  // The logger is a detail view of Training — keep Training lit while logging.
  const navId=id==='logger'?'training':id;
  const navBtn=btn||document.querySelector('.navlink[data-s="'+navId+'"]');
  if(navBtn)navBtn.classList.add('active');
  renderScreen(id);
  updateWake();
  window.scrollTo({top:0});
}
/* Wake Lock — keep the phone screen awake while training so it never sleeps
   between sets. Held only on the Training/Logger screens with a live session. */
let _wakeLock=null;
async function acquireWake(){try{if('wakeLock'in navigator&&!_wakeLock){_wakeLock=await navigator.wakeLock.request('screen');_wakeLock.addEventListener('release',()=>{_wakeLock=null});}}catch(e){}}
async function releaseWake(){try{if(_wakeLock){const w=_wakeLock;_wakeLock=null;await w.release();}}catch(e){}}
function updateWake(){((CURRENT==='training'||CURRENT==='logger')&&curSession())?acquireWake():releaseWake();}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')updateWake();});
function renderScreen(id){
  if(id==='home')renderHome();
  else if(id==='training')renderTraining();
  else if(id==='logger')renderLoggerScreen();
  else if(id==='builder')renderBuilder();
  else if(id==='settings')renderSettings();
  else if(id==='history')renderHistory();
}

/* ---------- week strip (Sunday-first, exactly like the mock) ---------- */
function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function weekDays(){
  const now=new Date(),sun=new Date(now);sun.setDate(now.getDate()-now.getDay());
  const todayKey=ymd(now),out=[];
  for(let i=0;i<7;i++){const d=new Date(sun);d.setDate(sun.getDate()+i);const k=ymd(d);
    const trained=DB.sessions.some(s=>s.date===k);
    const planned=k>=todayKey&&DB.workouts.some(w=>(w.days||[]).includes(d.getDay()));
    out.push({key:k,dow:'SMTWTFS'[d.getDay()],num:d.getDate(),today:k===todayKey,has:trained||planned})}
  return out;
}
function weekStripHtml(){
  return '<div class="card week">'+weekDays().map(d=>
    '<div class="wd'+(d.today?' today':'')+(d.has?' has':'')+'" data-click="openHistory" data-args="[&quot;'+d.key+'&quot;]" title="View this day"><span>'+d.dow+'</span><b>'+d.num+'</b></div>').join('')+'</div>';
}

/* ---------- HISTORY (tap any week-strip day) ---------- */
let HIST_DATE=null;
function openHistory(key){HIST_DATE=key;go('history');}
function shiftHistory(d){const p=HIST_DATE.split('-');const dt=new Date(+p[0],+p[1]-1,+p[2]+d);HIST_DATE=ymd(dt);renderHistory();}
function loggedSetSummary(ex,st){
  if(ex.mode==='completion')return '✓';
  const bits=[];
  if(st.aVal)bits.push(st.aVal+(ex.mode==='seconds'||ex.mode==='reps_seconds'?'s':(ex.mode==='reps_kg'||ex.mode==='amrap'?'kg':'')));
  if(st.aVal2)bits.push('× '+st.aVal2);
  if(st.felt)bits.push('@RPE '+st.felt);
  return bits.join(' ')||'✓';
}
function renderHistory(){
  const el=document.getElementById('s-history');if(!el)return;
  if(!HIST_DATE)HIST_DATE=ymd(new Date());
  const done=DB.sessions.filter(s=>s.date===HIST_DATE&&s.status!=='active');
  const active=DB.sessions.filter(s=>s.date===HIST_DATE&&s.status==='active');
  let body='';
  done.forEach(s=>{
    body+='<div class="section"><div class="sec-head"><h2>'+esc(s.name||'Workout')+'</h2><span>'+(s.status==='incomplete'?'incomplete':'completed')+'</span></div>';
    s.blocks.forEach(b=>{b.exercises.forEach(ex=>{
      const logged=ex.sets.filter(st=>st.done||st.aVal||st.aVal2||st.felt);
      const allDone=ex.sets.length&&ex.sets.every(st=>st.done);
      const sum=logged.length?logged.map(st=>loggedSetSummary(ex,st)).join(' · '):'—';
      body+='<div class="card exrow plain'+(allDone?' done':'')+'"><div class="t"><b>'+esc(ex.name||'Exercise')+'</b><span>'+esc(b.heading)+' · '+esc(sum)+'</span></div><div class="st">✓</div></div>';
    });});
    body+='</div>';
  });
  if(active.length)body+='<div class="card guidebar" style="margin-top:16px">A session from this day is still in progress — it will appear here once finished.</div>';
  if(!body)body='<div class="card lastbox" style="margin-top:16px">No training logged this day.</div>';
  el.innerHTML=
    '<div class="backrow"><button class="backbtn" data-click="go" data-args="[&quot;home&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">History</div><h1 style="font-size:24px">'+esc(prettyDay(HIST_DATE))+'</h1></div></div>'+
    '<div class="histnav"><button class="markall" data-click="shiftHistory" data-args="[-1]">‹ Previous day</button><button class="markall" data-click="shiftHistory" data-args="[1]">Next day ›</button></div>'+
    body;
}

/* ---------- HOME (mock layout: greeting, week, session card, WHOOP mini) ---------- */
function activeSession(){return DB.sessions.find(s=>s.status==='active')||null}
function workoutKind(w){
  const strength=w.blocks.some(b=>b.exercises.some(e=>e.mode==='reps_kg'||e.mode==='amrap'));
  const conditioning=w.blocks.some(b=>b.exercises.some(e=>e.mode==='seconds'||e.mode==='reps_seconds'));
  return [strength?'Strength':'',conditioning?'Conditioning':''].filter(Boolean).join(' + ')||'Session';
}
function workoutChips(w){
  const mins=(w.blocks||[]).reduce((n,b)=>n+(+b.minutes||0),0);
  const exs=(w.blocks||[]).reduce((n,b)=>n+(b.exercises||[]).length,0);
  const rpe=w.blocks.some(b=>b.exercises.some(e=>e.sets.some(s=>s.rpe)));
  const tempo=w.blocks.some(b=>b.exercises.some(e=>e.tempo));
  const chips=[];
  chips.push('<span class="chip gold">'+(mins?'~'+mins+' min':exs+' exercises')+'</span>');
  if(rpe)chips.push('<span class="chip">RPE-based</span>');
  if(tempo)chips.push('<span class="chip">Tempo work</span>');
  return chips.join('');
}
function sessionCardHtml(w,kicker,fn,id){
  return '<div class="card sessioncard" data-click="'+fn+'" data-args="[&quot;'+esc(id)+'&quot;]">'+
    '<div class="sc-kicker">'+esc(kicker)+'</div>'+
    '<h3>'+esc(w.name||'Untitled workout')+'</h3>'+
    '<div class="sc-meta">'+esc((w.blocks||[]).map(b=>b.heading).filter(Boolean).join(' · '))+'</div>'+
    '<div class="sc-chips">'+workoutChips(w)+'</div></div>';
}
function daysLabel(w){
  const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (w.days||[]).slice().sort().map(i=>names[i]).join(' & ');
}
function renderHome(){
  const el=document.getElementById('s-home');
  const act=activeSession();
  const now=new Date();
  const dstr=now.toLocaleDateString(undefined,{weekday:'long'});
  const wc=DB.workouts.length;
  const todayDow=now.getDay();
  const anyScheduled=DB.workouts.some(w=>w.days&&w.days.length);
  const todays=DB.workouts.filter(w=>(w.days||[]).includes(todayDow));
  const sub=act?dstr+' · One session in progress.'
    :!wc?dstr+' · Nothing built yet.'
    :!anyScheduled?dstr+' · '+(wc===1?'One session planned.':wc+' sessions ready.')
    :todays.length===1?dstr+' · One session planned.'
    :todays.length>1?dstr+' · '+todays.length+' sessions planned.'
    :dstr+' · Rest day — '+wc+' workout'+(wc===1?'':'s')+' ready.';
  let cards='';
  if(act){
    const w=DB.workouts.find(x=>x.id===act.workoutId)||{name:act.name,blocks:act.blocks};
    cards+=sessionCardHtml(Object.assign({},w,{name:act.name||w.name}),'In progress · resume','openSession',act.id);
  }
  if(!wc){
    cards+='<div class="card sessioncard" data-click="newWorkout"><div class="sc-kicker">Start</div><h3>No workouts yet</h3><div class="sc-meta">Build your first workout in the Builder, then run it from here.</div><div class="sc-chips"><span class="chip gold">+ New workout</span></div></div>';
  } else {
    const rest=DB.workouts.filter(w=>!(act&&act.workoutId===w.id));
    const ordered=[...rest.filter(w=>(w.days||[]).includes(todayDow)),...rest.filter(w=>!(w.days||[]).includes(todayDow))];
    let first=!act;
    ordered.forEach(w=>{
      const scheduledToday=(w.days||[]).includes(todayDow);
      let kicker;
      if(scheduledToday)kicker='Today · '+workoutKind(w);
      else if(w.days&&w.days.length)kicker=daysLabel(w)+' · '+workoutKind(w);
      else kicker=(!anyScheduled&&first?'Today · ':'')+workoutKind(w);
      first=false;
      cards+=sessionCardHtml(w,kicker,'startWorkout',w.id);
    });
  }
  el.innerHTML=
    '<div class="kicker">Welcome back</div><h1>Train today</h1>'+
    '<p class="sub">'+esc(sub)+'</p>'+
    weekStripHtml()+
    cards+
    (wc?'<button class="addbtn" data-click="newWorkout">+ New workout</button>':'')+
    whoopCardHtml()+
    (WHOOP_OPEN?readinessCardHtml():'');
}

/* ---------- READINESS: WHOOP recovery × target-vs-felt RPE ---------- */
function rpeGapInfo(){
  const done=DB.sessions
    .filter(s=>(s.status==='completed'||s.status==='incomplete')&&s.completedAt&&Date.now()-s.completedAt<7*864e5)
    .sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));
  for(const s of done){
    const gaps=[];
    s.blocks.forEach(b=>b.exercises.forEach(e=>e.sets.forEach(st=>{
      const t=parseFloat(st.rpe),f=parseFloat(st.felt);
      if(st.done&&Number.isFinite(t)&&Number.isFinite(f))gaps.push(f-t);
    })));
    if(gaps.length)return{gap:gaps.reduce((a,b)=>a+b,0)/gaps.length,date:s.date,n:gaps.length};
  }
  return null;
}
function readinessCardHtml(){
  const recRaw=WHOOP.sample?Number(WHOOP.sample.recoveryScore):NaN;
  const rec=Number.isFinite(recRaw)?Math.round(recRaw):null;
  const g=rpeGapInfo();
  if(rec==null&&!g)return '';
  const parts=[];
  if(rec!=null)parts.push('Recovery '+rec+'%');
  if(g){
    const s=g.gap>=0.25?'ran RPE +'+g.gap.toFixed(1)+' over target':g.gap<=-0.25?'ran RPE '+Math.abs(g.gap).toFixed(1)+' under target':'hit its RPE targets';
    parts.push('last session '+s);
  }
  let advice;
  if((g&&g.gap>=1)||(rec!=null&&rec<34))advice='Pull back today — cap the top sets about one RPE lower.';
  else if((rec==null||rec>=67)&&(!g||g.gap<=0.25))advice='Green light — train as planned, with room to push the top sets.';
  else advice='Train as planned today.';
  return '<div class="card guidebar" id="readinessCard"><b>Readiness:</b> '+esc(parts.join(' · '))+'. '+esc(advice)+'</div>';
}

/* ---------- WHOOP (server-side via Netlify functions) ---------- */
const WHOOP_ENDPOINTS={status:'/.netlify/functions/integrations-status',connect:'/.netlify/functions/whoop-connect',sync:'/.netlify/functions/whoop-sync',disconnect:'/.netlify/functions/integrations-disconnect'};
let WHOOP={loaded:false,connected:false,sample:null,lastSyncAt:null,busy:false,error:''};
function whoopTone(v){const n=Number(v);if(!Number.isFinite(n))return{cls:'',label:'No score yet',pct:0,val:null,color:null};const r=Math.max(0,Math.min(100,Math.round(n)));if(r>=67)return{cls:'good',label:'Strong',pct:r,val:r,color:'#16ec06'};if(r>=34)return{cls:'watch',label:'Steady',pct:r,val:r,color:'#ffde00'};return{cls:'low',label:'Low',pct:r,val:r,color:'#ff0026'};}
async function loadWhoop(){
  try{
    const r=await fetch(WHOOP_ENDPOINTS.status,{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)throw new Error('Request failed ('+r.status+')');
    const d=await r.json();
    WHOOP.connected=!!(d.whoop&&d.whoop.connected);
    WHOOP.sample=d.whoop&&d.whoop.normalized?d.whoop.normalized:null;
    WHOOP.lastSyncAt=d.whoop?d.whoop.lastSyncAt:null;
    WHOOP.error='';
  }catch(e){WHOOP.connected=false;WHOOP.sample=null;WHOOP.error=String(e&&e.message||e);}
  WHOOP.loaded=true;
  if(CURRENT==='home')updateWhoopCard();
  if(CURRENT==='settings')renderSettings();
  // keep today's card fresh without user work
  if(WHOOP.connected&&!WHOOP.busy){
    const today=ymd(new Date());
    if(!WHOOP.sample||String(WHOOP.sample.date||'').slice(0,10)!==today)syncWhoop(true);
  }
}
async function syncWhoop(silent){
  if(WHOOP.busy)return;WHOOP.busy=true;if(!silent){updateWhoopCard();if(CURRENT==='settings')renderSettings();}
  try{
    const r=await fetch(WHOOP_ENDPOINTS.sync,{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)throw new Error('Sync failed ('+r.status+')');
    const d=await r.json();
    if(d.connected===false)throw new Error('WHOOP is not connected.');
    if(d.normalized)WHOOP.sample=d.normalized;
    WHOOP.lastSyncAt=new Date().toISOString();
    WHOOP.error='';
  }catch(e){if(!silent)WHOOP.error=String(e&&e.message||e);}
  WHOOP.busy=false;
  if(CURRENT==='home')updateWhoopCard();
  if(CURRENT==='settings')renderSettings();
}
async function disconnectWhoop(){
  if(!confirm('Disconnect WHOOP from this app?'))return;
  WHOOP.busy=true;if(CURRENT==='settings')renderSettings();
  try{await fetch(WHOOP_ENDPOINTS.disconnect+'?provider=whoop',{method:'POST',credentials:'same-origin',cache:'no-store'});}catch(e){}
  WHOOP.busy=false;WHOOP.sample=null;WHOOP.connected=false;
  await loadWhoop();
  if(CURRENT==='settings')renderSettings();
}
function updateWhoopCard(){if(CURRENT==='home')renderHome();}
/* Details stay hidden behind the card until tapped — the rings carry the
   picture; numbers and readiness only appear on request. */
let WHOOP_OPEN=false;
function toggleWhoopDetails(){WHOOP_OPEN=!WHOOP_OPEN;if(CURRENT==='home')renderHome();}
const STRAIN_BLUE='#0093e7',RING_IDLE_COLOR='rgba(255,255,255,.14)';
function whoopRings(recColor,recPct,strainPct,center){
  // Arc targets + colors feed CSS custom properties; the CSS animates each
  // arc up from 0. A null pct shows a faint full ring (idle/loading).
  const oaT=strainPct==null?100:strainPct, oc=strainPct==null?RING_IDLE_COLOR:STRAIN_BLUE;
  const iaT=recPct==null?100:recPct, ic=recPct==null?RING_IDLE_COLOR:recColor;
  return '<div class="ringx" style="--oaT:'+oaT+';--oc:'+oc+'">'+
    '<div class="ringx-in" style="--iaT:'+iaT+';--ic:'+ic+'"><b>'+center+'</b></div></div>';
}
function whoopSettingsChip(){return '<button class="chip" style="cursor:pointer;font:inherit;font-size:10px;letter-spacing:.06em;text-transform:uppercase" data-click="go" data-args="[&quot;settings&quot;]">WHOOP</button>';}
function whoopCardHtml(){
  let rings,title,line,chip;
  if(!WHOOP.loaded){
    rings=whoopRings(null,null,null,'…');
    title='WHOOP · today';line='Loading recovery…';
    chip='<span class="chip">WHOOP</span>';
  } else if(!WHOOP.connected){
    rings=whoopRings(null,null,null,'—');
    title='Connect WHOOP';line='Bring recovery, sleep and strain into today’s view.';
    chip='<a class="chip gold" style="text-decoration:none" data-click="noop" href="'+WHOOP_ENDPOINTS.connect+'">Connect</a>';
  } else if(!WHOOP.sample){
    rings=whoopRings(null,null,null,'—');
    title='WHOOP connected';line='Sync to pull today’s recovery.';
    chip='<button class="chip gold" style="cursor:pointer;font:inherit;font-size:10px;letter-spacing:.06em;text-transform:uppercase" data-click="syncWhoop">'+(WHOOP.busy?'Syncing…':'Sync')+'</button>';
  } else {
    const t=whoopTone(WHOOP.sample.recoveryScore);
    const strainRaw=Number(WHOOP.sample.strain);
    const strainPct=Number.isFinite(strainRaw)?Math.max(0,Math.min(100,Math.round(strainRaw/21*100))):null;
    chip=whoopSettingsChip();
    if(!WHOOP_OPEN){
      rings=whoopRings(t.color,t.val==null?null:t.pct,strainPct,'');
      title='WHOOP · today';
      line='Tap to show recovery, strain & readiness.';
    } else {
      rings=whoopRings(t.color,t.val==null?null:t.pct,strainPct,(t.val==null?'—':t.val+'%'));
      title='Recovery '+(t.val==null?'—':t.val+'%')+' · '+t.label+(strainPct!=null?' · Strain '+strainRaw.toFixed(1):'');
      line='HRV '+(WHOOP.sample.hrvMs==null?'—':WHOOP.sample.hrvMs+' ms')+' · RHR '+(WHOOP.sample.restingHr==null?'—':WHOOP.sample.restingHr)+' · Sleep '+(WHOOP.sample.sleepPerformance==null?'—':WHOOP.sample.sleepPerformance+'%');
    }
  }
  return '<div class="card whoopmini" id="whoopCard" style="cursor:pointer" data-click="toggleWhoopDetails" title="Show or hide WHOOP details">'+
    '<div style="display:flex;align-items:center;gap:14px">'+rings+'<div><b>'+esc(title)+'</b><p>'+esc(line)+'</p></div></div>'+chip+'</div>';
}

/* ---------- TRAINING (the mock's session day view) ---------- */
function renderTraining(){
  ensureSession();
  renderSession();
}

/* ---------- workout CRUD ---------- */
function newWorkout(){WK=templateWorkout();BUILDER_WID=WK.id;EDIT_EXISTING=false;openBlock=-1;go('builder');}
function editWorkout(id){const w=DB.workouts.find(x=>x.id===id);if(!w)return;WK=JSON.parse(JSON.stringify(w));BUILDER_WID=id;EDIT_EXISTING=true;openBlock=-1;go('builder');}
function hasLoggedWork(s){return s&&s.blocks.some(b=>b.exercises.some(e=>e.sets.some(st=>st.done||st.aVal||st.aVal2||st.felt)));}
function previewWorkout(){
  if(!WK.name.trim())WK.name='Untitled workout';
  if(!WK.blocks.some(b=>b.exercises.length)){alert('Add at least one block with an exercise before previewing.');return;}
  const i=DB.workouts.findIndex(x=>x.id===WK.id);
  const clean=JSON.parse(JSON.stringify(WK));
  if(i>=0)DB.workouts[i]=clean;else DB.workouts.push(clean);
  EDIT_EXISTING=true;BUILDER_WID=WK.id;
  // refresh (or open) the live session for this workout — but never wipe logged sets
  let s=DB.sessions.find(x=>x.workoutId===WK.id&&x.status==='active');
  if(s&&!hasLoggedWork(s)){
    s.name=clean.name;
    s.blocks=JSON.parse(JSON.stringify(clean.blocks)).map(b=>{b.exercises.forEach(e=>e.sets.forEach(st=>{st.aVal='';st.aVal2='';st.felt='';st.done=false}));return b});
  }
  save();
  if(s)CUR_SESSION=s.id;else{CUR_SESSION=null;const w=DB.workouts.find(x=>x.id===WK.id);if(w){const ns={id:uid(),workoutId:w.id,name:w.name,date:ymd(new Date()),status:'active',startedAt:Date.now(),blocks:JSON.parse(JSON.stringify(w.blocks)).map(b=>{b.exercises.forEach(e=>e.sets.forEach(st=>{st.aVal='';st.aVal2='';st.felt='';st.done=false}));return b})};DB.sessions.push(ns);CUR_SESSION=ns.id;save();}}
  LOG_LOC=null;
  go('training');
}
function saveWorkout(){previewWorkout();}

/* ---------- start / open a live session ---------- */
function startWorkout(workoutId){
  const w=DB.workouts.find(x=>x.id===workoutId);if(!w)return;
  let s=DB.sessions.find(x=>x.workoutId===workoutId&&x.status==='active');
  if(!s){
    s={id:uid(),workoutId:workoutId,name:w.name,date:ymd(new Date()),status:'active',startedAt:Date.now(),
       blocks:JSON.parse(JSON.stringify(w.blocks)).map(b=>{b.exercises.forEach(e=>e.sets.forEach(st=>{st.aVal='';st.aVal2='';st.felt='';st.done=false}));return b})};
    DB.sessions.push(s);save();
  }
  openSession(s.id);
}
let CUR_SESSION=null;
function openSession(sessionId){CUR_SESSION=sessionId;go('training');}

/* ---------- SESSION (day view) ---------- */
function curSession(){return DB.sessions.find(s=>s.id===CUR_SESSION)||null}
function prettyDay(key){const p=String(key||'').split('-');if(p.length!==3)return key;const d=new Date(+p[0],+p[1]-1,+p[2]);return d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});}
function prettyMeta(m){return esc(m).replace(/(RPE [^·]+)/g,'<i>$1</i>').replace(/(@[^ ·]+)/g,'<i>$1</i>')}
function renderSession(){
  const el=document.getElementById('s-training');const s=curSession();
  if(!s){el.innerHTML='<div class="kicker">Training</div><h1 style="font-size:24px">No workout yet</h1><p class="sub">Build a workout first — then it runs here.</p><button class="addbtn" style="margin-top:16px" data-click="go" data-args="[&quot;builder&quot;]">Open the Builder</button>';return}
  const body=s.blocks.map((b,bi)=>{
    const head='<div class="sec-head"><h2>'+esc(b.heading||'Block')+'</h2>'+(b.minutes?'<span>'+esc(b.minutes)+' min</span>':'')+'</div>'+(b.format?'<div class="sec-format">'+esc(b.format)+'</div>':'');
    const rows=b.exercises.map((ex,ei)=>{
      const done=ex.sets.length&&ex.sets.every(st=>st.done);
      const open=(!b.superset&&ex.mode!=='completion');
      const endcap=open?'<div class="chev" aria-hidden="true">›</div>':'<div class="st">✓</div>';
      const act=open?'openLogger':'toggleCompletion';
      return '<div class="card exrow '+(open?'nav':'')+(done?' done':'')+'" data-click="'+act+'" data-args="['+bi+','+ei+']"><div class="t"><b>'+esc(ex.name||'Exercise')+'</b><span>'+prettyMeta(rxLine(ex))+'</span></div>'+endcap+'</div>';
    }).join('');
    if(b.superset){
      return '<div class="section">'+head+'<div class="superwrap"><div class="superlabel"><span>'+esc(b.format||'Superset')+'</span><button class="markall" data-click="markSuperset" data-args="['+bi+']">Mark round complete</button></div>'+rows+'</div></div>';
    }
    return '<div class="section">'+head+rows+'</div>';
  }).join('');
  const allDone=sessionAllDone(s);
  el.innerHTML=
    '<div class="backrow"><button class="backbtn" data-click="go" data-args="[&quot;home&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">'+esc(prettyDay(s.date))+' · in progress</div><h1 style="font-size:24px">'+esc(s.name||'Workout')+'</h1></div></div>'+
    '<div id="sessBody">'+body+'</div>'+
    '<div class="completebar"><button class="bigbtn'+(allDone?' donestate':'')+'" data-click="finishSession" data-args="[&quot;@self&quot;]">'+(allDone?'Everything logged — finish ✓':'Mark session complete')+'</button></div>';
}
function toggleCompletion(bi,ei){const s=curSession();if(!s)return;const ex=s.blocks[bi].exercises[ei];const d=!ex.sets.every(st=>st.done);ex.sets.forEach(st=>st.done=d);save();renderSession();}
function markSuperset(bi){const s=curSession();if(!s)return;s.blocks[bi].exercises.forEach(ex=>ex.sets.forEach(st=>st.done=true));save();renderSession();}
function finishSession(btn){
  const s=curSession();if(!s)return;
  s.status='completed';s.completedAt=Date.now();s.date=ymd(new Date());
  CUR_SESSION=null;LOG_LOC=null;
  save();
  btn.textContent='Completed ✓';btn.classList.add('donestate');
  confetti();
  setTimeout(()=>go('home'),1400);
}

/* ---------- LOGGER (the mock's set-by-set screen) ---------- */
let CUR_REST=0,LOG_LOC=null;
function loggerCols(mode){
  if(mode==='reps_kg'||mode==='amrap')return['Set','KG','Reps','RPE felt',''];
  if(mode==='reps_seconds')return['Set','Secs','Reps','RPE felt',''];
  if(mode==='seconds')return['Set','Secs','RPE felt',''];
  if(mode==='reps')return['Set','Reps','RPE felt',''];
  return['Set','Done'];
}
function gridCols(mode){
  return mode==='reps_kg'||mode==='amrap'||mode==='reps_seconds'?'34px 1fr 1fr 64px 40px'
    :mode==='completion'?'34px 1fr':'34px 1fr 64px 40px';
}
function lastTimeFor(name){
  const done=DB.sessions.filter(s=>s.status==='completed'||s.status==='incomplete').sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));
  for(const s of done){for(const b of s.blocks){for(const ex of b.exercises){
    if((ex.name||'').toLowerCase()===(name||'').toLowerCase()){
      const logged=ex.sets.filter(st=>st.done&&(st.aVal||st.aVal2));
      if(logged.length)return {date:s.date,sets:logged};
    }}}}
  return null;
}
function openLogger(bi,ei){
  const s=curSession();if(!s)return;
  LOG_LOC={bi,ei};go('logger');
}
function firstLoggable(s){
  for(let bi=0;bi<s.blocks.length;bi++){const b=s.blocks[bi];for(let ei=0;ei<b.exercises.length;ei++){if(!b.superset&&b.exercises[ei].mode!=='completion')return{bi,ei};}}
  if(s.blocks.length&&s.blocks[0].exercises.length)return{bi:0,ei:0};
  return null;
}
/* Training is the one training destination; the logger is its detail
   view, opened from an exercise row and stepped through in place. */
function loggableList(s){
  const out=[];
  s.blocks.forEach((b,bi)=>{if(b.superset)return;b.exercises.forEach((ex,ei)=>{if(ex.mode!=='completion')out.push({bi,ei})})});
  return out;
}
function exFinished(ex){return ex.sets.length>0&&ex.sets.every(st=>st.done)}
function sessionAllDone(s){
  const exs=s.blocks.flatMap(b=>b.exercises);
  return exs.length>0&&exs.every(exFinished);
}
function stepLogger(d){
  const s=curSession();if(!s||!LOG_LOC)return;
  const list=loggableList(s);
  const idx=list.findIndex(l=>l.bi===LOG_LOC.bi&&l.ei===LOG_LOC.ei);
  const j=idx+d;
  if(j<0||j>=list.length)return;
  LOG_LOC=list[j];renderLoggerScreen();window.scrollTo({top:0});
}
function renderLoggerScreen(){
  const el=document.getElementById('s-logger');let s=curSession()||ensureSession();
  if(s&&(!LOG_LOC||!s.blocks[LOG_LOC.bi]||!s.blocks[LOG_LOC.bi].exercises[LOG_LOC.ei]))LOG_LOC=firstLoggable(s);
  if(!s||!LOG_LOC){el.innerHTML='<div class="kicker">Logger</div><h1 style="font-size:24px">Nothing to log yet</h1><p class="sub">Build a workout first — then log your sets here.</p><button class="addbtn" style="margin-top:16px" data-click="go" data-args="[&quot;builder&quot;]">Open the Builder</button>';return}
  const b=s.blocks[LOG_LOC.bi],ex=b.exercises[LOG_LOC.ei];CUR_REST=+ex.rest||0;
  const cols=loggerCols(ex.mode),grid=gridCols(ex.mode);
  const last=lastTimeFor(ex.name);
  const head='<div class="sethead" style="grid-template-columns:'+grid+'">'+cols.map(c=>'<span>'+c+'</span>').join('')+'</div>';
  const rows=ex.sets.map((st,si)=>{
    const numCell='<div class="n"><b>'+(si+1)+'</b></div>';
    const kgPh=last&&last.sets[si]&&last.sets[si].aVal?esc(last.sets[si].aVal)+' last':'kg';
    let mid='';
    if(ex.mode==='reps_kg'||ex.mode==='amrap')mid='<input inputmode="decimal" placeholder="'+kgPh+'" value="'+esc(st.aVal)+'" data-input="setActual" data-args="['+si+',1,&quot;@value&quot;]"><input inputmode="numeric" placeholder="reps" value="'+esc(st.aVal2)+'" data-input="setActual" data-args="['+si+',2,&quot;@value&quot;]">';
    else if(ex.mode==='reps_seconds')mid='<input inputmode="numeric" placeholder="secs" value="'+esc(st.aVal)+'" data-input="setActual" data-args="['+si+',1,&quot;@value&quot;]"><input inputmode="numeric" placeholder="reps" value="'+esc(st.aVal2)+'" data-input="setActual" data-args="['+si+',2,&quot;@value&quot;]">';
    else if(ex.mode==='seconds')mid='<input inputmode="numeric" placeholder="secs" value="'+esc(st.aVal)+'" data-input="setActual" data-args="['+si+',1,&quot;@value&quot;]">';
    else if(ex.mode==='reps')mid='<input inputmode="numeric" placeholder="reps" value="'+esc(st.aVal)+'" data-input="setActual" data-args="['+si+',1,&quot;@value&quot;]">';
    const rpeIn=ex.mode==='completion'?'':'<input class="rpein" inputmode="decimal" placeholder="felt" value="'+esc(st.felt)+'" data-input="setActual" data-args="['+si+',3,&quot;@value&quot;]">';
    const tickBtn='<button class="tick" data-click="tickSet" data-args="['+si+']">✓</button>';
    const bits=[];
    if(ex.mode!=='completion'){
      if(ex.mode==='amrap')bits.push('max reps');
      else if(st.t==='max')bits.push((ex.mode==='seconds'||ex.mode==='reps_seconds')?'max secs':'max reps');
      else if(st.t)bits.push((ex.mode==='seconds'||ex.mode==='reps_seconds')?esc(st.t)+'s':esc(st.t)+' reps');
      if(st.rpe)bits.push('RPE '+esc(st.rpe));
    }
    const tline='<div class="settarget">Set '+(si+1)+(bits.length?' · target '+bits.join(' · '):(ex.mode==='completion'?' · mark complete':''))+'</div>';
    return tline+'<div class="setrow'+(st.done?' done':'')+'" style="grid-template-columns:'+grid+'">'+numCell+mid+rpeIn+tickBtn+'</div>';
  }).join('');
  const restNote=CUR_REST?'Rest <i>'+fmtRest(CUR_REST)+' auto-starts on ✓</i>':'No prescribed rest';
  const lastBox=last?'<div class="card lastbox"><b>Last time</b> ('+esc(prettyDay(last.date))+'): '+last.sets.map(st=>esc((st.aVal||'')+(st.aVal2?'×'+st.aVal2:'')+(st.felt?' @RPE '+st.felt:''))).join(' · ')+'</div>':'';
  const list=loggableList(s),idx=list.findIndex(l=>l.bi===LOG_LOC.bi&&l.ei===LOG_LOC.ei),total=list.length;
  const kicker=esc(b.heading)+(idx>=0?' · exercise '+(idx+1)+' of '+total:' · set targets');
  const doneHere=exFinished(ex);
  let flow='';
  if(doneHere&&idx>=0&&idx<total-1){
    const nx=s.blocks[list[idx+1].bi].exercises[list[idx+1].ei];
    flow+='<button class="addbtn" data-click="stepLogger" data-args="[1]">Next exercise: '+esc(nx.name||'Exercise')+' →</button>';
  }
  const sessionDone=sessionAllDone(s);
  if(sessionDone)flow+='<div class="completebar" style="margin-top:16px"><button class="bigbtn" data-click="finishSession" data-args="[&quot;@self&quot;]">Everything logged — mark session complete</button></div>';
  const stepNav=(idx>=0&&total>1)?'<div class="histnav">'+
    (idx>0?'<button class="markall" data-click="stepLogger" data-args="[-1]">‹ Previous</button>':'<span></span>')+
    (idx<total-1?'<button class="markall" data-click="stepLogger" data-args="[1]">Next ›</button>':'<span></span>')+'</div>':'';
  el.innerHTML=
    '<div class="backrow"><button class="backbtn" data-click="go" data-args="[&quot;training&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">'+kicker+'</div><h1 style="font-size:24px">'+esc(ex.name||'Exercise')+'</h1><div class="logmeta">'+(ex.tempo?'Tempo <i>@'+esc(ex.tempo)+'</i> · ':'')+restNote+'</div></div></div>'+
    '<div class="card setcard">'+head+(rows||'<div class="lastbox" style="margin-top:0">No sets.</div>')+'</div>'+
    flow+stepNav+lastBox+
    '<div class="card guidebar"><b>Why "RPE felt" matters:</b> target vs. actual RPE per set is data most apps throw away. Paired with the WHOOP recovery you sync, it powers a readiness picture no off-the-shelf app has.</div>';
}
function setActual(si,slot,val){const s=curSession();if(!s||!LOG_LOC)return;const st=s.blocks[LOG_LOC.bi].exercises[LOG_LOC.ei].sets[si];if(slot===1)st.aVal=val;else if(slot===2)st.aVal2=val;else if(slot===3)st.felt=val;save();}
function tickSet(si){const s=curSession();if(!s||!LOG_LOC)return;const st=s.blocks[LOG_LOC.bi].exercises[LOG_LOC.ei].sets[si];st.done=!st.done;save();renderLoggerScreen();if(st.done&&CUR_REST>0)startRest(CUR_REST);}

/* ---------- rest timer: auto-starts on ✓, survives reload, vibrates at zero ---------- */
const REST_KEY=LS_KEY+'-rest-ends';
let restIv=null,restEnds=0;
function startRest(sec){
  stopRest(false);
  restEnds=Date.now()+sec*1000;
  try{localStorage.setItem(REST_KEY,String(restEnds))}catch(e){}
  showRestChip();
}
function showRestChip(){
  const chip=document.getElementById('restchip');
  chip.classList.add('show');paintRest();
  restIv=setInterval(tickRestTimer,500);
}
function tickRestTimer(){
  const left=Math.ceil((restEnds-Date.now())/1000);
  if(left<=0){
    if(navigator.vibrate){try{navigator.vibrate([200,120,200])}catch(e){}}
    stopRest();return;
  }
  paintRest();
}
function paintRest(){
  const left=Math.max(0,Math.ceil((restEnds-Date.now())/1000));
  const m=Math.floor(left/60),s=String(left%60).padStart(2,'0');
  document.getElementById('restclock').textContent=m+':'+s;
}
function stopRest(clear){
  clearInterval(restIv);restIv=null;restEnds=0;
  if(clear!==false){try{localStorage.removeItem(REST_KEY)}catch(e){}}
  const c=document.getElementById('restchip');if(c)c.classList.remove('show');
}
function resumeRest(){
  const ends=Number(localStorage.getItem(REST_KEY))||0;
  if(ends>Date.now()){restEnds=ends;showRestChip();}
  else if(ends){try{localStorage.removeItem(REST_KEY)}catch(e){}}
}

/* ---------- BUILDER ---------- */
let WK={id:uid(),name:'',blocks:[newBlock()]},EDIT_EXISTING=false,openBlock=0;
function refreshExNames(){const names=[...new Set(DB.workouts.flatMap(w=>w.blocks.flatMap(b=>b.exercises.map(e=>e.name).filter(Boolean))))];document.getElementById('exNames').innerHTML=names.map(n=>'<option value="'+esc(n)+'">').join('');}
let BUILDER_WID=null;
function renderBuilder(){
  refreshExNames();
  const cw=currentWorkout();
  if(!BUILDER_WID){
    if(cw){WK=JSON.parse(JSON.stringify(cw));BUILDER_WID=cw.id;EDIT_EXISTING=true;openBlock=-1;}
    else{BUILDER_WID=WK.id;}
  }
  const el=document.getElementById('s-builder');
  el.innerHTML=
    '<div class="kicker">Builder</div>'+
    '<h1 style="font-size:24px">Build your workout</h1>'+
    '<p class="sub">Add blocks, add exercises, set modes, sets, reps &amp; RPE. Then hit “See how it looks”.</p>'+
    '<div class="field" style="margin-top:18px"><label>Workout name</label><input id="wkName" value="'+esc(WK.name)+'" placeholder="e.g. Upper Pump — Day 1" data-input="setWkName" data-args="[&quot;@value&quot;]"></div>'+
    '<div class="field"><label>Train on</label><div class="daychips">'+[0,1,2,3,4,5,6].map(i=>'<button class="daychip'+((WK.days||[]).includes(i)?' on':'')+'" data-click="toggleDay" data-args="['+i+']">'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]+'</button>').join('')+'</div></div>'+
    '<div id="builderBody"></div>'+
    '<button class="addbtn" data-click="addBlock">+ Add block</button>'+
    '<div class="completebar"><button class="bigbtn" data-click="previewWorkout">See how it looks →</button></div>'+
    (EDIT_EXISTING&&DB.workouts.length?'<button class="markall" style="display:block;margin:16px auto 0;color:var(--bad)" data-click="deleteCurrentWorkout">Delete this workout</button>':'');
  renderBuilderBody();
}
function deleteCurrentWorkout(){
  const id=BUILDER_WID,w=DB.workouts.find(x=>x.id===id);
  if(!w)return;
  if(!confirm('Delete "'+(w.name||'this workout')+'"? This cannot be undone.'))return;
  DB.workouts=DB.workouts.filter(x=>x.id!==id);
  DB.sessions=DB.sessions.filter(s=>!(s.workoutId===id&&s.status==='active'));
  if(CUR_SESSION&&!DB.sessions.find(s=>s.id===CUR_SESSION))CUR_SESSION=null;
  BUILDER_WID=null;EDIT_EXISTING=false;WK=templateWorkout();LOG_LOC=null;
  save();go('home');
}
function renderBuilderBody(){
  const box=document.getElementById('builderBody');if(!box)return;
  box.innerHTML=WK.blocks.map((b,bi)=>{
    const open=bi===openBlock;
    return '<div class="bblock '+(open?'open':'')+'"><div class="bblock-head"><button class="bexp" data-click="toggleBlock" data-args="['+bi+']" aria-label="expand block">'+(open?'▾':'▸')+'</button><input class="bhead" value="'+esc(b.heading)+'" placeholder="Block name" data-input="editBlock" data-args="['+bi+',&quot;heading&quot;,&quot;@value&quot;]"><div class="bctrls"><button data-click="moveBlock" data-args="['+bi+',-1]" aria-label="move up">↑</button><button data-click="moveBlock" data-args="['+bi+',1]" aria-label="move down">↓</button><button class="del" data-click="delBlock" data-args="['+bi+']" aria-label="delete block">✕</button></div></div>'+
      (open?
        '<div class="brow2"><input class="bmin" value="'+esc(b.minutes)+'" placeholder="min" inputmode="numeric" data-input="editBlock" data-args="['+bi+',&quot;minutes&quot;,&quot;@value&quot;]"><input class="bfmt" value="'+esc(b.format)+'" placeholder="format — e.g. Every 2:30 × 4 sets" data-input="editBlock" data-args="['+bi+',&quot;format&quot;,&quot;@value&quot;]"><label class="bss"><input type="checkbox" '+(b.superset?'checked':'')+' data-change="toggleSS" data-args="['+bi+',&quot;@checked&quot;]"> Superset</label></div>'+
        b.exercises.map((ex,ei)=>exCard(b,ex,bi,ei)).join('')+
        '<button class="addbtn small" data-click="addEx" data-args="['+bi+']">+ Add exercise</button>'
       :'<div class="bsummary" data-click="toggleBlock" data-args="['+bi+']">'+blockSummary(b)+'</div>')+
    '</div>';
  }).join('');
}
function blockSummary(b){const n=b.exercises.length;return n+' exercise'+(n===1?'':'s')+(b.minutes?' · '+esc(b.minutes)+' min':'')+(b.format?' · '+esc(b.format):'')}
/* Calmer cards: identical set targets collapse to one row; tempo/rest sit
   behind a disclosure until an exercise actually uses them. */
const VARY=new Set(),OPTS=new Set();
function exKey(ex,bi,ei){return ex.id||bi+'-'+ei}
function setsUniform(ex){return ex.sets.length>1&&ex.sets.every(s=>s.t===ex.sets[0].t&&s.rpe===ex.sets[0].rpe)}
function exCard(b,ex,bi,ei){
  const cfg=MODES[ex.mode]||MODES.reps_kg;
  const key=exKey(ex,bi,ei);
  const uniform=setsUniform(ex);
  let setRows;
  const amrap=ex.mode==='amrap';
  const allCell=amrap?'<span class="cmeta">max reps</span>':'<input inputmode="numeric" value="'+esc(ex.sets[0].t)+'" placeholder="'+cfg.ph+'" data-input="editAllSets" data-args="['+bi+','+ei+',&quot;t&quot;,&quot;@value&quot;]">';
  if(ex.mode==='completion'){
    setRows='<div class="bsetrow nomode"><span>'+ex.sets.length+' set'+(ex.sets.length===1?'':'s')+'</span><span class="cmeta">marked complete — no targets</span></div>';
  } else if(uniform&&!VARY.has(key)){
    setRows='<div class="bsetrow"><span>All sets</span>'+allCell+'<input class="rpe" inputmode="decimal" value="'+esc(ex.sets[0].rpe)+'" placeholder="RPE –" data-input="editAllSets" data-args="['+bi+','+ei+',&quot;rpe&quot;,&quot;@value&quot;]"></div>'+
      '<button class="markall" style="margin-top:9px" data-click="varySets" data-args="['+bi+','+ei+']">vary per set →</button>';
  } else {
    setRows=ex.sets.map((s,si)=>'<div class="bsetrow"><span>Set '+(si+1)+'</span>'+(amrap?'<span class="cmeta">max reps</span>':'<input inputmode="numeric" value="'+esc(s.t)+'" placeholder="'+cfg.ph+'" data-input="editSet" data-args="['+bi+','+ei+','+si+',&quot;t&quot;,&quot;@value&quot;]">')+'<input class="rpe" inputmode="decimal" value="'+esc(s.rpe)+'" placeholder="RPE –" data-input="editSet" data-args="['+bi+','+ei+','+si+',&quot;rpe&quot;,&quot;@value&quot;]"></div>').join('')+
      (uniform?'<button class="markall" style="margin-top:9px" data-click="unvarySets" data-args="['+bi+','+ei+']">← same for all sets</button>':'');
  }
  const showOpts=Boolean(ex.tempo)||Boolean(+ex.rest)||OPTS.has(key);
  const modeRow=showOpts
    ? '<div class="bex-grid"><select data-change="setMode" data-args="['+bi+','+ei+',&quot;@value&quot;]">'+MODEKEYS.map(m=>'<option value="'+m+'" '+(m===ex.mode?'selected':'')+'>'+MODES[m].label+'</option>').join('')+'</select><input value="'+esc(ex.tempo)+'" placeholder="tempo" data-input="editEx" data-args="['+bi+','+ei+',&quot;tempo&quot;,&quot;@value&quot;]"><input value="'+esc(ex.rest||'')+'" placeholder="rest s" inputmode="numeric" data-input="editEx" data-args="['+bi+','+ei+',&quot;rest&quot;,&quot;@value&quot;]"></div>'
    : '<div class="bex-grid solo"><select data-change="setMode" data-args="['+bi+','+ei+',&quot;@value&quot;]">'+MODEKEYS.map(m=>'<option value="'+m+'" '+(m===ex.mode?'selected':'')+'>'+MODES[m].label+'</option>').join('')+'</select></div>'+
      '<button class="markall" style="margin-top:9px" data-click="showExOpts" data-args="['+bi+','+ei+']">+ tempo · rest</button>';
  return '<div class="bex"><div class="bex-head"><input class="bexname" list="exNames" value="'+esc(ex.name)+'" placeholder="Exercise name" data-input="editEx" data-args="['+bi+','+ei+',&quot;name&quot;,&quot;@value&quot;]"><button class="del" data-click="delEx" data-args="['+bi+','+ei+']" aria-label="remove">✕</button></div>'+
    modeRow+
    (ex.mode==='completion'?'':'<div class="bsteprow"><button class="stepbtn sm" data-click="bumpSets" data-args="['+bi+','+ei+',-1]">−</button><span>'+ex.sets.length+' set'+(ex.sets.length===1?'':'s')+'</span><button class="stepbtn sm" data-click="bumpSets" data-args="['+bi+','+ei+',1]">+</button></div>')+
    setRows+
    '<div class="rxline" id="rxb'+bi+'e'+ei+'">'+esc(rxLine(ex))+'</div></div>';
}
function normTarget(v){v=String(v).trim();return /^m(ax)?$/i.test(v)?'max':v;}
function editAllSets(bi,ei,k,v){const val=k==='t'?normTarget(v):v.trim();WK.blocks[bi].exercises[ei].sets.forEach(s=>s[k]=val);refreshRx(bi,ei);}
function varySets(bi,ei){VARY.add(exKey(WK.blocks[bi].exercises[ei],bi,ei));renderBuilderBody();}
function unvarySets(bi,ei){VARY.delete(exKey(WK.blocks[bi].exercises[ei],bi,ei));renderBuilderBody();}
function showExOpts(bi,ei){OPTS.add(exKey(WK.blocks[bi].exercises[ei],bi,ei));renderBuilderBody();}
function toggleDay(i){WK.days=WK.days||[];const ix=WK.days.indexOf(i);if(ix>=0)WK.days.splice(ix,1);else WK.days.push(i);renderBuilder();}
function addBlock(){WK.blocks.push(newBlock());openBlock=WK.blocks.length-1;renderBuilderBody();}
function delBlock(bi){if(!confirm('Delete this block?'))return;WK.blocks.splice(bi,1);if(openBlock===bi)openBlock=-1;else if(openBlock>bi)openBlock--;renderBuilderBody();}
function moveBlock(bi,d){const j=bi+d;if(j<0||j>=WK.blocks.length)return;[WK.blocks[bi],WK.blocks[j]]=[WK.blocks[j],WK.blocks[bi]];if(openBlock===bi)openBlock=j;else if(openBlock===j)openBlock=bi;renderBuilderBody();}
function editBlock(bi,k,v){WK.blocks[bi][k]=v;}
function toggleSS(bi,v){WK.blocks[bi].superset=v;renderBuilderBody();}
function addEx(bi){WK.blocks[bi].exercises.push(newEx());renderBuilderBody();}
function delEx(bi,ei){WK.blocks[bi].exercises.splice(ei,1);if(!WK.blocks[bi].exercises.length)WK.blocks[bi].exercises.push(newEx());renderBuilderBody();}
function setMode(bi,ei,m){WK.blocks[bi].exercises[ei].mode=m;renderBuilderBody();}
function bumpSets(bi,ei,d){const ex=WK.blocks[bi].exercises[ei],n=Math.max(1,ex.sets.length+d);if(d>0)while(ex.sets.length<n)ex.sets.push({t:ex.sets[ex.sets.length-1]?.t||'',rpe:ex.sets[ex.sets.length-1]?.rpe||''});else ex.sets=ex.sets.slice(0,n);renderBuilderBody();}
function editEx(bi,ei,k,v){WK.blocks[bi].exercises[ei][k]=v;refreshRx(bi,ei);}
function editSet(bi,ei,si,k,v){WK.blocks[bi].exercises[ei].sets[si][k]=k==='t'?normTarget(v):v.trim();refreshRx(bi,ei);}
function refreshRx(bi,ei){const el=document.getElementById('rxb'+bi+'e'+ei);if(el)el.textContent=rxLine(WK.blocks[bi].exercises[ei]);}
function toggleBlock(bi){openBlock=(openBlock===bi?-1:bi);renderBuilderBody();}

/* ---------- confetti: light, no stats wall ---------- */
function confetti(){const colors=['#c09358','#e0bc87','#82a8e9','#f5f1e9'];for(let i=0;i<36;i++){const c=document.createElement('div');c.className='confetti';c.style.left=(5+Math.random()*90)+'vw';c.style.background=colors[i%colors.length];c.style.animationDelay=(Math.random()*.5)+'s';c.style.transform='rotate('+(Math.random()*360)+'deg)';document.body.appendChild(c);setTimeout(()=>c.remove(),2200);}}

/* ---------- Supabase cloud sync (namespaced under state.hybridEngine) ---------- */
const SUPABASE_URL='https://orysjncrksmdfabpuftd.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yeXNqbmNya3NtZGZhYnB1ZnRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MTE4NzksImV4cCI6MjA5OTk4Nzg3OX0.GTMBfFtH5O6SikzHo75sXGIZoEhmuJ7TvXiACd7T078';
const SB=(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase)?window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}}):null;
const CHANGE_KEY=LS_KEY+'-changedAt';
let cloudUser=null,cloudBusy=false,cloudError='',cloudTimer=null,cloudPending=false,lastSyncedFp=null;
function cloudEnabled(){return !!SB}
function localChangeAt(){return Number(localStorage.getItem(CHANGE_KEY))||0}
function markLocalChange(at){try{localStorage.setItem(CHANGE_KEY,String(at||Date.now()))}catch(e){}}
function cloudFp(engine){try{return JSON.stringify({w:engine.workouts||[],s:engine.sessions||[]})}catch(e){return 'fp-'+Math.random()}}
async function cloudInit(){
  if(!cloudEnabled())return;
  try{const {data}=await SB.auth.getSession();cloudUser=data&&data.session?data.session.user:null;if(cloudUser)await cloudReconcile();}
  catch(e){cloudError=String(e&&e.message||e);}
  SB.auth.onAuthStateChange((event,session)=>{
    const prev=cloudUser;cloudUser=session?session.user:null;
    if(event==='SIGNED_IN'&&cloudUser&&(!prev||prev.id!==cloudUser.id))cloudReconcile();
    if(event==='PASSWORD_RECOVERY'){
      const np=prompt('Enter a new password for your account:');
      if(np)SB.auth.updateUser({password:np}).then(({error})=>alert(error?('Password update failed: '+error.message):'Password updated. You are signed in.'));
    }
    if(CURRENT==='settings')renderSettings();
  });
}
async function cloudReconcile(){
  if(!cloudEnabled()||!cloudUser)return;
  cloudBusy=true;cloudError='';if(CURRENT==='settings')renderSettings();
  try{
    const {data,error}=await SB.from('app_state').select('state,updated_at').eq('user_id',cloudUser.id).maybeSingle();
    if(error)throw error;
    const remote=data&&data.state&&data.state.hybridEngine?data.state.hybridEngine:null;
    if(!remote){await cloudPushNow(true);}
    else{
      const localEmpty=(DB.workouts.length===0&&DB.sessions.length===0);
      if(cloudFp(remote)===cloudFp(DB)){lastSyncedFp=cloudFp(DB);}
      else{
        const remoteAt=data.updated_at?Date.parse(data.updated_at):0,localAt=localChangeAt();
        if(localEmpty||remoteAt>=localAt){
          DB={workouts:remote.workouts||[],sessions:remote.sessions||[],settings:Object.assign({},DB.settings,remote.settings||{})};
          try{localStorage.setItem(LS_KEY,JSON.stringify(DB))}catch(e){}
          markLocalChange(remoteAt||Date.now());lastSyncedFp=cloudFp(DB);
          renderScreen(CURRENT);
        }else{await cloudPushNow(true);}
      }
    }
  }catch(e){cloudError=String(e&&e.message||e);}
  cloudBusy=false;if(CURRENT==='settings')renderSettings();
}
function queueCloudPush(){
  markLocalChange(Date.now());
  if(!cloudEnabled()||!cloudUser)return;
  if(cloudTimer)clearTimeout(cloudTimer);
  cloudTimer=setTimeout(()=>cloudPushNow(false),900);
}
async function cloudPushNow(force){
  if(!cloudEnabled()||!cloudUser)return;
  if(cloudBusy&&!force){cloudPending=true;return;}
  const fp=cloudFp(DB);
  if(!force&&fp===lastSyncedFp)return;
  cloudBusy=true;
  try{
    // merge-preserve: keep any other keys already in this user's state row
    let existing={};
    try{const {data}=await SB.from('app_state').select('state').eq('user_id',cloudUser.id).maybeSingle();if(data&&data.state&&typeof data.state==='object')existing=data.state;}catch(e){}
    const state=Object.assign({},existing,{hybridEngine:{workouts:DB.workouts,sessions:DB.sessions,settings:DB.settings}});
    const {error}=await SB.from('app_state').upsert({user_id:cloudUser.id,state},{onConflict:'user_id'});
    if(error)throw error;
    lastSyncedFp=fp;cloudError='';
  }catch(e){cloudError=String(e&&e.message||e);}
  cloudBusy=false;if(CURRENT==='settings')renderSettings();
  if(cloudPending){cloudPending=false;queueCloudPush();}
}
async function cloudSignIn(mode){
  if(!cloudEnabled())return alert('Cloud sync is not configured.');
  const email=(document.getElementById('cloudEmail')||{}).value||'',password=(document.getElementById('cloudPassword')||{}).value||'';
  if(!email.trim()||!password)return alert('Enter an email and password.');
  cloudError='';
  try{
    if(mode==='signup'){const {data,error}=await SB.auth.signUp({email:email.trim(),password});if(error)throw error;if(!data||!data.session)alert('Account created. Check your email to confirm, then sign in.');}
    else{const {error}=await SB.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;}
  }catch(e){cloudError=String(e&&e.message||e);alert((mode==='signup'?'Sign up':'Sign in')+' failed: '+cloudError);}
  renderSettings();
}
async function cloudSignOut(){if(!cloudEnabled())return;try{await SB.auth.signOut()}catch(e){}cloudUser=null;renderSettings();}
async function cloudResetPassword(){
  if(!cloudEnabled())return alert('Cloud sync is not configured.');
  const email=((document.getElementById('cloudEmail')||{}).value||'').trim();
  if(!email)return alert('Enter your email above first, then tap "Forgot password?".');
  try{
    const {error}=await SB.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
    if(error)throw error;
    alert('Password reset email sent to '+email+'. Open the link on this device to set a new password.');
  }catch(e){alert('Reset failed: '+(e&&e.message||e));}
}

/* ---------- local data export / import / reset ---------- */
function exportData(){const blob=new Blob([JSON.stringify({app:'THE Hybrid Engine',exportedAt:new Date().toISOString(),db:DB},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='hybrid-engine-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
function importData(ev){const f=ev.target.files&&ev.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const p=JSON.parse(rd.result);const d=p.db||p;if(!d||!Array.isArray(d.workouts))throw new Error('Not a valid backup.');DB={workouts:d.workouts||[],sessions:d.sessions||[],settings:d.settings||{}};save();renderSettings();alert('Backup imported.');}catch(e){alert('Import failed: '+(e&&e.message||e));}};rd.readAsText(f);}
function resetLocal(){if(!confirm('Wipe all workouts and history on THIS device? Cloud data (if signed in) is not touched unless you then sync.'))return;DB={workouts:[],sessions:[],settings:{}};try{localStorage.setItem(LS_KEY,JSON.stringify(DB))}catch(e){}renderSettings();}

/* ---------- SETTINGS screen ---------- */
function renderSettings(){
  const el=document.getElementById('s-settings');if(!el)return;
  // Cloud panel
  let cloud;
  if(!cloudEnabled()){cloud='<div class="sc-meta">Cloud sync is not configured in this build.</div>';}
  else if(cloudUser){cloud='<div class="sc-meta">Signed in as <b>'+esc(cloudUser.email||'')+'</b>'+(cloudBusy?' · syncing…':'')+'. Your workouts and history sync to every device you sign into.'+(cloudError?'<br><span style="color:var(--bad)">'+esc(cloudError)+'</span>':'')+'</div><button class="addbtn" style="margin-top:12px" data-click="cloudSignOut">Sign out</button>';}
  else{cloud='<div class="sc-meta">Sign in to sync your training across phone and laptop.</div><div class="field"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email"></div><div class="field"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password"></div><div style="display:flex;gap:8px;margin-top:12px"><button class="bigbtn" style="flex:1" data-click="cloudSignIn" data-args="[&quot;signin&quot;]">Sign in</button><button class="addbtn" style="flex:1;margin-top:0" data-click="cloudSignIn" data-args="[&quot;signup&quot;]">Create account</button></div><button class="markall" style="margin-top:10px" data-click="cloudResetPassword">Forgot password?</button>'+(cloudError?'<div class="sc-meta" style="margin-top:8px;color:var(--bad)">'+esc(cloudError)+'</div>':'');}
  // WHOOP panel
  let whoop;
  if(!WHOOP.loaded){whoop='<div class="sc-meta">Checking WHOOP connection…</div>';}
  else if(!WHOOP.connected){whoop='<div class="sc-meta">'+(WHOOP.error?esc(WHOOP.error)+' ':'')+'Connect WHOOP to bring recovery, sleep and strain into Home. Requires the deployed app.</div><a class="bigbtn" style="display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;margin-top:12px" href="'+WHOOP_ENDPOINTS.connect+'">Connect WHOOP</a>';}
  else{whoop='<div class="sc-meta">WHOOP connected'+(WHOOP.lastSyncAt?' · last sync '+esc(new Date(WHOOP.lastSyncAt).toLocaleString()):'')+'.</div><div style="display:flex;gap:8px;margin-top:12px"><button class="bigbtn" style="flex:1" data-click="syncWhoop">'+(WHOOP.busy?'Syncing…':'Sync now')+'</button><button class="addbtn" style="flex:1;margin-top:0" data-click="disconnectWhoop">Disconnect</button></div>';}
  el.innerHTML=
    '<div class="backrow"><button class="backbtn" data-click="go" data-args="[&quot;home&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">Settings</div><h1 style="font-size:24px">Cloud, WHOOP &amp; data</h1></div></div>'+
    '<div class="section"><div class="sec-head"><h2>Cloud sync</h2></div><div class="card" style="margin-top:10px;padding:14px">'+cloud+'</div></div>'+
    '<div class="section"><div class="sec-head"><h2>WHOOP</h2></div><div class="card" style="margin-top:10px;padding:14px">'+whoop+'</div></div>'+
    '<div class="section"><div class="sec-head"><h2>Your data</h2></div><div class="card" style="margin-top:10px;padding:14px"><div class="sc-meta">Everything is stored on this device and (if signed in) synced to the cloud.</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="addbtn" style="flex:1;min-width:120px;margin-top:0" data-click="exportData">Export backup</button><button class="addbtn" style="flex:1;min-width:120px;margin-top:0" data-click="triggerImport">Import backup</button></div><input id="importFile" type="file" accept="application/json,.json" style="display:none" data-change="importData" data-args="[&quot;@event&quot;]"><button class="addbtn" style="margin-top:10px;border-color:rgba(207,127,124,.5);color:var(--bad)" data-click="resetLocal">Reset local data</button></div></div>';
}

/* ---------- template seed: the mock's session structure, no names — fill in your own ---------- */
function templateWorkout(keepId){return {id:keepId||uid(),name:'',blocks:[
  {id:uid(),heading:'Warm-up',minutes:'8',format:'',superset:false,exercises:[{id:uid(),name:'',mode:'seconds',tempo:'',rest:0,sets:[{t:'120',rpe:''}]}]},
  {id:uid(),heading:'Warm-up prep',minutes:'',format:'Superset · 3 rounds',superset:true,exercises:[
    {id:uid(),name:'',mode:'reps',tempo:'',rest:0,sets:[{t:'15',rpe:''}]},
    {id:uid(),name:'',mode:'reps',tempo:'',rest:0,sets:[{t:'10',rpe:''}]}]},
  {id:uid(),heading:'Strength 1',minutes:'15',format:'4 working sets · straight sets',superset:false,exercises:[{id:uid(),name:'',mode:'reps_kg',tempo:'',rest:180,sets:[{t:'12',rpe:'7'},{t:'10',rpe:'8'},{t:'8',rpe:'9'},{t:'8',rpe:'10'}]}]},
  {id:uid(),heading:'Strength 2',minutes:'12',format:'Every 2:30 × 4 sets',superset:false,exercises:[{id:uid(),name:'',mode:'reps_kg',tempo:'',rest:150,sets:[{t:'10',rpe:'7'},{t:'10',rpe:'8'},{t:'10',rpe:'8'},{t:'10',rpe:'8'}]}]},
  {id:uid(),heading:'Carry finisher',minutes:'8',format:'3 rounds',superset:false,exercises:[{id:uid(),name:'',mode:'seconds',tempo:'',rest:90,sets:[{t:'40',rpe:'8'},{t:'40',rpe:'8'},{t:'40',rpe:'9'}]}]},
  {id:uid(),heading:'Cooldown',minutes:'5',format:'',superset:false,exercises:[{id:uid(),name:'',mode:'completion',tempo:'',rest:0,sets:[{t:'',rpe:''}]}]}
]};}
function isUntouchedDemo(w){
  if(!w||w.name!=='Upper Pump — Day 1')return false;
  const demoNames=['Cardio of choice','Band pull-apart','Scap push-up','Incline Bench Press','Supinated Bent-Over Row','Farmer carry','Stretch flow'];
  const exNames=(w.blocks||[]).flatMap(b=>(b.exercises||[]).map(e=>e.name));
  return exNames.join('|')===demoNames.join('|');
}
function seedIfEmpty(){
  DB.settings=Object.assign({},DB.settings);
  if(DB.settings.seedV===2)return;
  if(!DB.workouts.length){
    DB.workouts=[templateWorkout()];
  }else{
    // swap the old named demo for the nameless template — but never touch a workout
    // the user completed a session with, renamed, or edited
    DB.workouts=DB.workouts.map(w=>{
      const completed=DB.sessions.some(s=>s.workoutId===w.id&&s.status==='completed');
      if(isUntouchedDemo(w)&&!completed){
        DB.sessions=DB.sessions.filter(s=>!(s.workoutId===w.id&&s.status!=='completed'));
        return templateWorkout(w.id);
      }
      return w;
    });
  }
  DB.settings.seedV=2;DB.settings.seeded=true;
  try{localStorage.setItem(LS_KEY,JSON.stringify(DB))}catch(e){}
}
function currentWorkout(){const act=DB.sessions.find(s=>s.status==='active');if(act){const w=DB.workouts.find(x=>x.id===act.workoutId);if(w)return w;}return DB.workouts[0]||null;}
function ensureSession(){let s=curSession();if(s&&s.status==='active')return s;const act=DB.sessions.find(x=>x.status==='active');if(act){CUR_SESSION=act.id;return act;}const w=currentWorkout();if(!w)return null;s={id:uid(),workoutId:w.id,name:w.name,date:ymd(new Date()),status:'active',startedAt:Date.now(),blocks:JSON.parse(JSON.stringify(w.blocks)).map(b=>{b.exercises.forEach(e=>e.sets.forEach(st=>{st.aVal='';st.aVal2='';st.felt='';st.done=false}));return b})};DB.sessions.push(s);CUR_SESSION=s.id;save();return s;}

/* ---------- stale sessions: yesterday's unfinished work becomes history ---------- */
function expireStaleSessions(){
  const today=ymd(new Date());let changed=false;
  DB.sessions=DB.sessions.filter(s=>{
    if(s.status!=='active'||s.date>=today)return true;
    changed=true;
    if(hasLoggedWork(s)){s.status='incomplete';s.completedAt=s.completedAt||s.startedAt||Date.now();return true;}
    return false;
  });
  if(changed){try{localStorage.setItem(LS_KEY,JSON.stringify(DB))}catch(e){}}
}

/* ---------- boot ---------- */
load();
seedIfEmpty();
expireStaleSessions();
go('home');
resumeRest();
loadWhoop();
cloudInit();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&restEnds)paintRest();});
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('./service-worker.js').catch(()=>{})});}
