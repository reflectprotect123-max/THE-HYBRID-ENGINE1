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
/* A conditioning block runs by live heart rate instead of set-by-set. It has no
   exercises; kind:'conditioning' is what tells every path to treat it that way. */
function newCondBlock(){return{id:uid(),kind:'conditioning',heading:'Conditioning',condFmt:'intervals',targetZone:'mod',minutes:''}}
function isCond(b){return b&&b.kind==='conditioning'}
function blockExercises(b){return (b&&b.exercises)||[]}
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
async function acquireWake(){
  try{if(window.AndroidHR&&window.AndroidHR.keepAwake)window.AndroidHR.keepAwake(true);}catch(e){}
  try{if('wakeLock'in navigator&&!_wakeLock){_wakeLock=await navigator.wakeLock.request('screen');_wakeLock.addEventListener('release',()=>{_wakeLock=null});}}catch(e){}}
async function releaseWake(){
  try{if(window.AndroidHR&&window.AndroidHR.keepAwake)window.AndroidHR.keepAwake(false);}catch(e){}
  try{if(_wakeLock){const w=_wakeLock;_wakeLock=null;await w.release();}}catch(e){}}
function updateWake(){(((CURRENT==='training'||CURRENT==='logger')&&curSession())||(CURRENT==='conditioning'&&CON.live))?acquireWake():releaseWake();}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')updateWake();});
function renderScreen(id){
  if(id==='home')renderHome();
  else if(id==='training')renderTraining();
  else if(id==='logger')renderLoggerScreen();
  else if(id==='builder')renderBuilder();
  else if(id==='settings')renderSettings();
  else if(id==='history')renderHistory();
  else if(id==='progress')renderProgress();
  else if(id==='conditioning')renderConditioning();
  else if(id==='import')renderImport();
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
    s.blocks.forEach(b=>{
      if(isCond(b)){
        const r=b.condResult;const fN=(CON_FORMATS[b.condFmt]?CON_FORMATS[b.condFmt].name:'Conditioning');
        const sum=r?conMmss(r.dur)+' · avg '+(r.avg||'—')+' · max '+(r.max||'—')+' bpm'+(r.hrr!=null?' · ▼'+r.hrr+' recovery':''):'not run';
        body+='<div class="card exrow plain'+(r?' done':'')+(r?'" style="cursor:pointer" data-click="conOpenResult" data-args="[&quot;'+esc(r.id)+'&quot;]':'"')+'><div class="t"><b>'+esc(fN)+'</b><span>'+esc(b.heading||'Conditioning')+' · '+esc(sum)+'</span></div><div class="'+(r?'chev':'st')+'">'+(r?'›':'✓')+'</div></div>';
        return;
      }
      b.exercises.forEach(ex=>{
        const logged=ex.sets.filter(st=>st.done||st.aVal||st.aVal2||st.felt);
        const allDone=ex.sets.length&&ex.sets.every(st=>st.done);
        const sum=logged.length?logged.map(st=>loggedSetSummary(ex,st)).join(' · '):'—';
        body+='<div class="card exrow plain'+(allDone?' done':'')+'"><div class="t"><b>'+esc(ex.name||'Exercise')+'</b><span>'+esc(b.heading)+' · '+esc(sum)+'</span></div><div class="st">✓</div></div>';
      });
    });
    body+='</div>';
  });
  // standalone conditioning sessions logged on this day (Conditioning tab)
  const condDay=(Array.isArray(DB.settings.conditioning)?DB.settings.conditioning:[]).filter(r=>r.date===HIST_DATE);
  condDay.forEach(r=>{
    const fN=(CON_FORMATS[r.fmt]?CON_FORMATS[r.fmt].name:r.fmt)+(r.sim?' · demo':'');
    body+='<div class="section"><div class="sec-head"><h2>Conditioning</h2><span>completed</span></div>'+
      '<div class="card exrow nav" style="cursor:pointer" data-click="conOpenResult" data-args="[&quot;'+esc(r.id)+'&quot;]"><div><b>'+esc(fN)+'</b><p>'+conMmss(r.dur)+' · avg '+(r.avg||'—')+' · max '+(r.max||'—')+' bpm'+(r.hrr!=null?' · ▼'+r.hrr+' recovery':'')+'</p></div><span class="chev">›</span></div></div>';
  });
  if(active.length)body+='<div class="card guidebar" style="margin-top:16px">A session from this day is still in progress — it will appear here once finished.</div>';
  if(!body)body='<div class="card empty"><div class="ei"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 11h16"/></svg></div><h3>A quiet day</h3><p>No training logged this day. Rest counts too — or start something from Home.</p></div>';
  el.innerHTML=
    '<div class="backrow"><button class="backbtn" aria-label="Back" data-click="go" data-args="[&quot;home&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">History</div><h1 style="font-size:24px">'+esc(prettyDay(HIST_DATE))+'</h1></div></div>'+
    '<div class="histnav"><button class="markall" data-click="shiftHistory" data-args="[-1]">‹ Previous day</button><button class="markall" data-click="shiftHistory" data-args="[1]">Next day ›</button></div>'+
    body;
}

/* ---------- HOME (mock layout: greeting, week, session card, WHOOP mini) ---------- */
function activeSession(){return DB.sessions.find(s=>s.status==='active')||null}
function workoutKind(w){
  const strength=w.blocks.some(b=>!isCond(b)&&blockExercises(b).some(e=>e.mode==='reps_kg'||e.mode==='amrap'));
  const conditioning=w.blocks.some(b=>isCond(b)||blockExercises(b).some(e=>e.mode==='seconds'||e.mode==='reps_seconds'));
  return [strength?'Strength':'',conditioning?'Conditioning':''].filter(Boolean).join(' + ')||'Session';
}
function workoutChips(w){
  const mins=(w.blocks||[]).reduce((n,b)=>n+(+b.minutes||0),0);
  const exs=(w.blocks||[]).reduce((n,b)=>n+blockExercises(b).length,0);
  const rpe=w.blocks.some(b=>blockExercises(b).some(e=>e.sets.some(s=>s.rpe)));
  const tempo=w.blocks.some(b=>blockExercises(b).some(e=>e.tempo));
  const chips=[];
  chips.push('<span class="chip gold">'+(mins?'~'+mins+' min':exs+' exercises')+'</span>');
  if(rpe)chips.push('<span class="chip">RPE-based</span>');
  if(tempo)chips.push('<span class="chip">Tempo work</span>');
  return chips.join('');
}
function sessionCardHtml(w,kicker,fn,id){
  return '<div class="card sessioncard" data-click="'+fn+'" data-args="[&quot;'+esc(id)+'&quot;]">'+
    '<div class="sc-kicker">'+esc(kicker)+'</div>'+
    '<h3>'+esc(w.name||'Session template')+'</h3>'+
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
    '<div class="quickrow">'+
      '<button class="card quickact" data-click="conNav"><span class="qi">⚡</span><b>Start conditioning</b><span>Live heart-rate zones</span></button>'+
      '<button class="card quickact" data-click="openImport"><span class="qi">📋</span><b>Import a workout</b><span>From text or a photo</span></button></div>'+
    homeMiniStats()+
    whoopCardHtml()+
    (WHOOP_OPEN?readinessCardHtml():'');
}
/* glanceable numbers under the fold — only once there's real data */
function homeMiniStats(){
  const done=completedList().length;
  const cond=(Array.isArray(DB.settings.conditioning)?DB.settings.conditioning:[]).filter(r=>!r.sim).length;
  if(!done&&!cond)return '';
  const wd=(DB.settings.whoopDaily||[]).filter(h=>Number.isFinite(h.recovery));
  const rec=wd.length?Math.round(wd[wd.length-1].recovery):null;
  return '<div class="stats" style="margin-top:16px">'+
    '<div class="stat"><b>'+fmtK(thisWeekVolume())+'</b><span>kg this week</span></div>'+
    '<div class="stat"><b>'+dayStreak()+'</b><span>Day streak</span></div>'+
    '<div class="stat"><b>'+(rec!=null?rec+'%':'—')+'</b><span>Last recovery</span></div></div>';
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
/* One visual language for the body: recovery bands share the conditioning
   zone palette (green=go, gold=steady, red=easy day). */
function whoopTone(v){const n=Number(v);if(!Number.isFinite(n))return{cls:'',label:'No score yet',pct:0,val:null,color:null};const r=Math.max(0,Math.min(100,Math.round(n)));if(r>=67)return{cls:'good',label:'Strong',pct:r,val:r,color:'#9fc59b'};if(r>=34)return{cls:'watch',label:'Steady',pct:r,val:r,color:'#cf9d4f'};return{cls:'low',label:'Low',pct:r,val:r,color:'#e0524d'};}
async function loadWhoop(){
  try{
    const r=await fetch(WHOOP_ENDPOINTS.status,{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)throw new Error('Request failed ('+r.status+')');
    const d=await r.json();
    WHOOP.connected=!!(d.whoop&&d.whoop.connected);
    WHOOP.sample=d.whoop&&d.whoop.normalized?d.whoop.normalized:null;
    if(WHOOP.sample)recordWhoopDaily(WHOOP.sample);
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
    if(d.normalized){WHOOP.sample=d.normalized;recordWhoopDaily(d.normalized);}
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
const STRAIN_BLUE='#5b8def',RING_IDLE_COLOR='rgba(255,255,255,.14)';
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
    // Skeleton loader — a shimmering placeholder that matches the card's real
    // shape so the layout doesn't jump when recovery arrives.
    return '<div class="card whoopmini" id="whoopCard" aria-busy="true" aria-label="Loading WHOOP recovery">'+
      '<div style="display:flex;align-items:center;gap:14px">'+
      '<div class="skel skel-ring"></div>'+
      '<div style="flex:1"><div class="skel skel-line" style="width:52%"></div>'+
      '<div class="skel skel-line" style="width:78%"></div></div></div>'+
      '<div class="skel" style="width:44px;height:18px;border-radius:9px"></div></div>';
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
function hasLoggedWork(s){return s&&s.blocks.some(b=>(isCond(b)&&b.condResult)||blockExercises(b).some(e=>e.sets.some(st=>st.done||st.aVal||st.aVal2||st.felt)));}
/* Deep-clone a workout's blocks into a pristine session shape: strength sets
   cleared, conditioning blocks reset (no result yet). One helper so every
   entry point (preview, start) treats hybrid blocks identically. */
function freshSessionBlocks(blocks){
  return JSON.parse(JSON.stringify(blocks||[])).map(b=>{
    if(isCond(b)){delete b.condResult;return b;}
    (b.exercises||[]).forEach(e=>(e.sets||[]).forEach(st=>{st.aVal='';st.aVal2='';st.felt='';st.done=false;}));
    return b;
  });
}
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
    s.blocks=freshSessionBlocks(clean.blocks);
  }
  save();
  if(s)CUR_SESSION=s.id;else{CUR_SESSION=null;const w=DB.workouts.find(x=>x.id===WK.id);if(w){const ns={id:uid(),workoutId:w.id,name:w.name,date:ymd(new Date()),status:'active',startedAt:Date.now(),blocks:freshSessionBlocks(w.blocks)};DB.sessions.push(ns);CUR_SESSION=ns.id;save();}}
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
       blocks:freshSessionBlocks(w.blocks)};
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
    if(isCond(b))return renderCondBlockRow(b,bi);
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
    '<div class="backrow"><button class="backbtn" aria-label="Back" data-click="go" data-args="[&quot;home&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">'+esc(prettyDay(s.date))+' · in progress</div><h1 style="font-size:24px">'+esc(s.name||'Workout')+'</h1></div></div>'+
    '<div id="sessBody">'+body+'</div>'+
    '<div class="completebar"><button class="bigbtn'+(allDone?' donestate':'')+'" data-click="finishSession" data-args="[&quot;@self&quot;]">'+(allDone?'Everything logged — finish ✓':'Mark session complete')+'</button></div>';
}
function condZoneName(key){const z=conZones().list.find(x=>x.key===key);return z?z.name:'Conditioning';}
function renderCondBlockRow(b,bi){
  const f=CON_FORMATS[b.condFmt];
  const title=f?f.name:'Conditioning';
  const done=!!b.condResult;
  const head='<div class="sec-head"><h2>'+esc(b.heading||'Conditioning')+'</h2><span>heart rate</span></div>';
  let sub;
  if(done){const r=b.condResult;sub=conMmss(r.dur)+' · avg '+(r.avg||'—')+' · max '+(r.max||'—')+' bpm'+(r.hrr!=null?' · ▼'+r.hrr+' recovery':'');}
  else{sub=(f?f.desc:'Live zone session')+' · target '+condZoneName(b.targetZone);}
  const endcap=done?'<div class="st">✓</div>':'<div class="chev" aria-hidden="true">›</div>';
  return '<div class="section">'+head+'<div class="card exrow condrow nav'+(done?' done':'')+'" data-click="conRunBlock" data-args="['+bi+']"><div class="t"><b>'+esc(title)+'</b><span>'+esc(sub)+'</span></div>'+endcap+'</div></div>';
}
/* Run (or review) a conditioning block inside the live session. Reuses the whole
   Conditioning screen; CON.sink tells conFinish to write the result onto the
   block instead of the standalone history. */
function conRunBlock(bi){
  const s=curSession();if(!s)return;
  const b=s.blocks[bi];if(!isCond(b))return;
  if(b.condResult){CON.sink={scope:'session',sid:s.id,bi:bi};CON.record=b.condResult;CON.view='results';CON.error='';CON.info='';go('conditioning');return;}
  CON.sink={scope:'session',sid:s.id,bi:bi};
  CON.fmt=(b.condFmt&&CON_FORMATS[b.condFmt])?b.condFmt:'intervals';
  CON.view='setup';CON.record=null;CON.error='';CON.info='';
  go('conditioning');
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
  for(let bi=0;bi<s.blocks.length;bi++){const b=s.blocks[bi];if(isCond(b))continue;for(let ei=0;ei<blockExercises(b).length;ei++){if(!b.superset&&b.exercises[ei].mode!=='completion')return{bi,ei};}}
  for(let bi=0;bi<s.blocks.length;bi++){if(!isCond(s.blocks[bi])&&blockExercises(s.blocks[bi]).length)return{bi,ei:0};}
  return null;
}
/* Training is the one training destination; the logger is its detail
   view, opened from an exercise row and stepped through in place. */
function loggableList(s){
  const out=[];
  s.blocks.forEach((b,bi)=>{if(b.superset||isCond(b))return;b.exercises.forEach((ex,ei)=>{if(ex.mode!=='completion')out.push({bi,ei})})});
  return out;
}
function exFinished(ex){return ex.sets.length>0&&ex.sets.every(st=>st.done)}
function blockDone(b){return isCond(b)?!!b.condResult:(blockExercises(b).length>0&&blockExercises(b).every(exFinished));}
function sessionAllDone(s){
  return s.blocks.length>0&&s.blocks.every(blockDone);
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
    '<div class="backrow"><button class="backbtn" aria-label="Back" data-click="go" data-args="[&quot;training&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">'+kicker+'</div><h1 style="font-size:24px">'+esc(ex.name||'Exercise')+'</h1><div class="logmeta">'+(ex.tempo?'Tempo <i>@'+esc(ex.tempo)+'</i> · ':'')+restNote+'</div></div></div>'+
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
    '<button class="addbtn" style="margin-top:14px" data-click="openImport">📋 Import from text or photo</button>'+
    '<div class="field" style="margin-top:18px"><label>Workout name</label><input id="wkName" value="'+esc(WK.name)+'" placeholder="e.g. Upper Pump — Day 1" data-input="setWkName" data-args="[&quot;@value&quot;]"></div>'+
    '<div class="field"><label>Train on</label><div class="daychips">'+[0,1,2,3,4,5,6].map(i=>'<button class="daychip'+((WK.days||[]).includes(i)?' on':'')+'" data-click="toggleDay" data-args="['+i+']">'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]+'</button>').join('')+'</div></div>'+
    '<div id="builderBody"></div>'+
    '<div class="addrow"><button class="addbtn" data-click="addBlock">+ Add block</button><button class="addbtn cond" data-click="addCondBlock">♥ Add conditioning</button></div>'+
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
    if(isCond(b))return condBlockCard(b,bi,open);
    return '<div class="bblock '+(open?'open':'')+'"><div class="bblock-head"><button class="bexp" data-click="toggleBlock" data-args="['+bi+']" aria-label="expand block">'+(open?'▾':'▸')+'</button><input class="bhead" value="'+esc(b.heading)+'" placeholder="Block name" data-input="editBlock" data-args="['+bi+',&quot;heading&quot;,&quot;@value&quot;]"><div class="bctrls"><button data-click="moveBlock" data-args="['+bi+',-1]" aria-label="move up">↑</button><button data-click="moveBlock" data-args="['+bi+',1]" aria-label="move down">↓</button><button class="del" data-click="delBlock" data-args="['+bi+']" aria-label="delete block">✕</button></div></div>'+
      (open?
        '<div class="brow2"><input class="bmin" value="'+esc(b.minutes)+'" placeholder="min" inputmode="numeric" data-input="editBlock" data-args="['+bi+',&quot;minutes&quot;,&quot;@value&quot;]"><input class="bfmt" value="'+esc(b.format)+'" placeholder="format — e.g. Every 2:30 × 4 sets" data-input="editBlock" data-args="['+bi+',&quot;format&quot;,&quot;@value&quot;]"><label class="bss"><input type="checkbox" '+(b.superset?'checked':'')+' data-change="toggleSS" data-args="['+bi+',&quot;@checked&quot;]"> Superset</label></div>'+
        b.exercises.map((ex,ei)=>exCard(b,ex,bi,ei)).join('')+
        '<button class="addbtn small" data-click="addEx" data-args="['+bi+']">+ Add exercise</button>'
       :'<div class="bsummary" data-click="toggleBlock" data-args="['+bi+']">'+blockSummary(b)+'</div>')+
    '</div>';
  }).join('');
}
function blockSummary(b){const n=blockExercises(b).length;return n+' exercise'+(n===1?'':'s')+(b.minutes?' · '+esc(b.minutes)+' min':'')+(b.format?' · '+esc(b.format):'')}
/* Conditioning block in the Builder: no exercises — pick a format and a target
   zone. Runs by live heart rate inside the session. */
function condBlockSummary(b){const f=CON_FORMATS[b.condFmt];return (f?f.name+' · '+f.desc:'Conditioning')+' · target '+condZoneName(b.targetZone);}
function condBlockCard(b,bi,open){
  const head='<div class="bblock-head"><button class="bexp" data-click="toggleBlock" data-args="['+bi+']" aria-label="expand block">'+(open?'▾':'▸')+'</button><input class="bhead" value="'+esc(b.heading)+'" placeholder="Conditioning" data-input="editBlock" data-args="['+bi+',&quot;heading&quot;,&quot;@value&quot;]"><span class="bkindtag">♥ HR</span><div class="bctrls"><button data-click="moveBlock" data-args="['+bi+',-1]" aria-label="move up">↑</button><button data-click="moveBlock" data-args="['+bi+',1]" aria-label="move down">↓</button><button class="del" data-click="delBlock" data-args="['+bi+']" aria-label="delete block">✕</button></div></div>';
  if(!open)return '<div class="bblock cond">'+head+'<div class="bsummary" data-click="toggleBlock" data-args="['+bi+']">'+condBlockSummary(b)+'</div></div>';
  let body='<div class="condbuild">';
  body+='<div class="lbl2">Format</div><div class="fmtpick build">'+Object.keys(CON_FORMATS).map(k=>{const ff=CON_FORMATS[k];return '<button aria-pressed="'+(b.condFmt===k)+'" data-click="setCondFmt" data-args="['+bi+',&quot;'+k+'&quot;]">'+ff.name+'<small>'+ff.desc+'</small></button>';}).join('')+'</div>';
  body+='<div class="lbl2" style="margin-top:12px">Target zone</div><div class="zonepick">'+conZones().list.map(z=>'<button aria-pressed="'+(b.targetZone===z.key)+'" data-click="setCondZone" data-args="['+bi+',&quot;'+z.key+'&quot;]"><i style="background:'+z.color+'"></i>'+z.name+'</button>').join('')+'</div>';
  body+='</div>';
  return '<div class="bblock cond open">'+head+body+'</div>';
}
function setCondFmt(bi,k){if(CON_FORMATS[k])WK.blocks[bi].condFmt=k;renderBuilderBody();}
function setCondZone(bi,k){WK.blocks[bi].targetZone=k;renderBuilderBody();}
function addCondBlock(){WK.blocks.push(newCondBlock());openBlock=WK.blocks.length-1;renderBuilderBody();}
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
function exportData(){
  const text=JSON.stringify({app:'THE Hybrid Engine',exportedAt:new Date().toISOString(),db:DB},null,2);
  // Inside the installed app, blob downloads don't exist — hand the file to native.
  try{if(window.AndroidHR&&window.AndroidHR.saveFile){window.AndroidHR.saveFile('hybrid-engine-backup.json',text);return;}}catch(e){}
  const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='hybrid-engine-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
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
  else if(!WHOOP.connected){whoop='<div class="sc-meta">'+(WHOOP.error?'<b>Can&rsquo;t reach WHOOP right now — it works from the live app.</b> ':'')+'Connect WHOOP to bring recovery, sleep and strain into Home.</div><a class="bigbtn" style="display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;margin-top:12px" href="'+WHOOP_ENDPOINTS.connect+'">Connect WHOOP</a>';}
  else{whoop='<div class="sc-meta">WHOOP connected'+(WHOOP.lastSyncAt?' · last sync '+esc(new Date(WHOOP.lastSyncAt).toLocaleString()):'')+'.</div><div style="display:flex;gap:8px;margin-top:12px"><button class="bigbtn" style="flex:1" data-click="syncWhoop">'+(WHOOP.busy?'Syncing…':'Sync now')+'</button><button class="addbtn" style="flex:1;margin-top:0" data-click="disconnectWhoop">Disconnect</button></div>';}
  // Training profile (drives conditioning HR zones)
  const prof=DB.settings.profile||{},zz=conZones();
  const methodLine=zz.method==='hrr'
    ? 'Zones use <b>Heart-Rate Reserve</b> (resting '+zz.rest+' → max '+zz.max+') — the personalised, gold-standard method.'
    : 'Zones use <b>% of max HR</b>. Add a resting HR (or connect WHOOP) to switch to the personalised Heart-Rate Reserve method.';
  const recLine=zz.rec==null?'' : (zz.adj>0?' · widened for a strong '+zz.rec+'% recovery' : zz.adj<0?' · eased for a low '+zz.rec+'% recovery' : ' · '+zz.rec+'% recovery today');
  const profile='<div class="sc-meta">Sets your heart-rate zones. Max HR uses the Tanaka formula (208 &minus; 0.7 &times; age); enter a tested max to override. '+methodLine+'</div>'+
    '<div style="display:flex;gap:8px;margin-top:12px">'+
    '<div class="field" style="flex:1"><label>Age</label><input type="number" min="10" max="100" inputmode="numeric" value="'+(prof.age||'')+'" placeholder="30" data-change="setProfile" data-args="[&quot;age&quot;,&quot;@value&quot;]"></div>'+
    '<div class="field" style="flex:1"><label>Resting HR</label><input type="number" min="30" max="110" inputmode="numeric" value="'+(prof.restingHr||'')+'" placeholder="'+(WHOOP.sample&&WHOOP.sample.restingHr?'WHOOP '+WHOOP.sample.restingHr:'auto')+'" data-change="setProfile" data-args="[&quot;restingHr&quot;,&quot;@value&quot;]"></div>'+
    '<div class="field" style="flex:1"><label>Max HR (override)</label><input type="number" min="120" max="230" inputmode="numeric" value="'+(prof.maxHr||'')+'" placeholder="'+conMaxHr()+'" data-change="setProfile" data-args="[&quot;maxHr&quot;,&quot;@value&quot;]"></div></div>'+
    '<div class="zonekey" style="margin-top:12px">'+zz.list.map(function(z){return '<div class="zk"><i style="background:'+z.color+'"></i><span class="n">'+z.name+'</span><span class="r">'+z.lo+'&ndash;'+(z.key==='high'?z.hi+'+':z.hi)+'</span></div>';}).join('')+'</div>'+
    '<div class="sc-meta" style="margin-top:8px">Max '+zz.max+' bpm'+recLine+'.</div>';
  el.innerHTML=
    '<div class="backrow"><button class="backbtn" aria-label="Back" data-click="go" data-args="[&quot;home&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">Settings</div><h1 style="font-size:24px">Cloud, WHOOP &amp; data</h1></div></div>'+
    '<div class="section"><div class="sec-head"><h2>Cloud sync</h2></div><div class="card" style="margin-top:10px;padding:14px">'+cloud+'</div></div>'+
    '<div class="section"><div class="sec-head"><h2>WHOOP</h2></div><div class="card" style="margin-top:10px;padding:14px">'+whoop+'</div></div>'+
    '<div class="section"><div class="sec-head"><h2>Training profile</h2></div><div class="card" style="margin-top:10px;padding:14px">'+profile+'</div></div>'+
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

/* ============================================================
   PROGRESS — turn logged data into trend charts. Inline SVG
   (CSP-safe, no libs), one axis per chart, recessive grid,
   ink-coloured text, legend + direct end-labels for the two
   series chart, native <title> hover, prefers-reduced-motion safe.
   ============================================================ */
function recordWhoopDaily(sample){
  const date=String(sample&&sample.date||'').slice(0,10);
  if(!date)return;
  const rec=Number(sample.recoveryScore),str=Number(sample.strain);
  DB.settings=DB.settings||{};
  const hist=Array.isArray(DB.settings.whoopDaily)?DB.settings.whoopDaily:[];
  const row={date,recovery:Number.isFinite(rec)?rec:null,strain:Number.isFinite(str)?str:null};
  const i=hist.findIndex(h=>h.date===date);
  if(i>=0)hist[i]=row;else hist.push(row);
  hist.sort((a,b)=>a.date.localeCompare(b.date));
  DB.settings.whoopDaily=hist.slice(-120);
  try{localStorage.setItem(LS_KEY,JSON.stringify(DB))}catch(e){}
}
function completedList(){
  return DB.sessions.filter(s=>(s.status==='completed'||s.status==='incomplete')&&s.completedAt)
    .sort((a,b)=>(a.completedAt||0)-(b.completedAt||0));
}
function sessionVolume(s){
  let v=0;s.blocks.forEach(b=>b.exercises.forEach(e=>{if(e.mode==='reps_kg'||e.mode==='amrap')e.sets.forEach(st=>{if(st.done){const kg=parseFloat(st.aVal),r=parseFloat(st.aVal2);if(Number.isFinite(kg)&&Number.isFinite(r))v+=kg*r;}})}));
  return Math.round(v);
}
function sessionRpe(s){
  const t=[],f=[];s.blocks.forEach(b=>b.exercises.forEach(e=>e.sets.forEach(st=>{if(st.done){const tt=parseFloat(st.rpe),ff=parseFloat(st.felt);if(Number.isFinite(tt))t.push(tt);if(Number.isFinite(ff))f.push(ff);}})));
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return {target:avg(t),felt:avg(f)};
}
function weekStart(ms){const d=new Date(ms);d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d;}
function weeklyVolume(n){
  const now=new Date();now.setHours(0,0,0,0);
  const buckets=[];
  for(let i=n-1;i>=0;i--){const d=new Date(now);d.setDate(now.getDate()-d.getDay()-i*7);buckets.push({key:ymd(d),d,vol:0});}
  const idx=new Map(buckets.map((b,i)=>[b.key,i]));
  completedList().forEach(s=>{const k=ymd(weekStart(s.completedAt));if(idx.has(k))buckets[idx.get(k)].vol+=sessionVolume(s);});
  return buckets.map(b=>({label:(b.d.getMonth()+1)+'/'+b.d.getDate(),value:b.vol,full:'Week of '+prettyDay(b.key)}));
}
function dayStreak(){
  const days=new Set(completedList().map(s=>ymd(new Date(s.completedAt))));
  let n=0;const d=new Date();d.setHours(0,0,0,0);
  if(!days.has(ymd(d)))d.setDate(d.getDate()-1); // today not required to have started
  while(days.has(ymd(d))){n++;d.setDate(d.getDate()-1);}
  return n;
}
function thisWeekVolume(){const k=ymd(weekStart(Date.now()));return completedList().filter(s=>ymd(weekStart(s.completedAt))===k).reduce((v,s)=>v+sessionVolume(s),0);}
/* --- SVG chart builders --- */
function niceMax(v){if(v<=0)return 10;const p=Math.pow(10,Math.floor(Math.log10(v)));const n=v/p;const m=n<=1?1:n<=2?2:n<=5?5:10;return m*p;}
function chartBars(data,unit){
  const W=320,H=150,padB=20,padT=16,padL=4,padR=4,innerW=W-padL-padR,innerH=H-padB-padT;
  const max=niceMax(Math.max(1,...data.map(d=>d.value)));
  const n=data.length,slot=innerW/n,bw=Math.min(26,slot*0.56);
  const y=v=>padT+innerH*(1-v/max);
  let g='';[0,.5,1].forEach(f=>{const yy=padT+innerH*(1-f);g+='<line class="grid" x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'"/>'+'<text class="axt" x="'+padL+'" y="'+(yy-3)+'">'+fmtK(max*f)+'</text>';});
  let bars='';data.forEach((d,i)=>{const cx=padL+slot*i+slot/2,h=Math.max(0,innerH*(d.value/max)),yy=padT+innerH-h;
    bars+='<rect class="bar" x="'+(cx-bw/2)+'" y="'+yy+'" width="'+bw+'" height="'+h+'" rx="4"><title>'+esc(d.full)+': '+d.value+' '+unit+'</title></rect>';
    bars+='<text class="axt" x="'+cx+'" y="'+(H-6)+'" text-anchor="middle">'+esc(d.label)+'</text>';
    if(i===n-1&&d.value>0)bars+='<text class="val" x="'+cx+'" y="'+(yy-5)+'" text-anchor="middle">'+fmtK(d.value)+'</text>';
  });
  return '<div class="chart"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Bar chart">'+g+bars+'</svg></div>';
}
function chartLines(series,xlabels,domain,unit){
  const W=320,H=150,padB=20,padT=16,padL=6,padR=16,innerW=W-padL-padR,innerH=H-padB-padT;
  const lo=domain[0],hi=domain[1],n=xlabels.length;
  const X=i=>n<=1?padL+innerW/2:padL+innerW*(i/(n-1));
  const Y=v=>padT+innerH*(1-(v-lo)/(hi-lo));
  let g='';[0,.5,1].forEach(f=>{const v=lo+(hi-lo)*f,yy=Y(v);g+='<line class="grid" x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'"/>'+'<text class="axt" x="'+padL+'" y="'+(yy-3)+'">'+(Math.round(v*10)/10)+'</text>';});
  let lab='';xlabels.forEach((l,i)=>{if(n<=6||i%Math.ceil(n/6)===0||i===n-1)lab+='<text class="axt" x="'+X(i)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(l)+'</text>';});
  let paths='';series.forEach(s=>{
    const pts=s.pts.map((v,i)=>v==null?null:[X(i),Y(v)]);
    const d=pts.filter(Boolean).map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    paths+='<path class="ln" d="'+d+'" stroke="'+s.color+'"/>';
    pts.forEach((p,i)=>{if(!p)return;paths+='<circle class="dot" cx="'+p[0]+'" cy="'+p[1]+'" r="3.2" fill="'+s.color+'"><title>'+esc(xlabels[i]+' · '+s.name+' '+(Math.round(s.pts[i]*10)/10)+unit)+'</title></circle>';});
    // direct end-label on last present point
    for(let i=pts.length-1;i>=0;i--){if(pts[i]){paths+='<text class="val" x="'+(pts[i][0]+5)+'" y="'+(pts[i][1]+3)+'" fill="'+s.color+'">'+(Math.round(s.pts[i]*10)/10)+'</text>';break;}}
  });
  return '<div class="chart"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Line chart">'+g+lab+paths+'</svg></div>';
}
function fmtK(v){v=Math.round(v);return v>=1000?(v/1000).toFixed(v>=10000?0:1).replace(/\.0$/,'')+'k':String(v);}
function chartCard(title,sub,inner,legend){return '<div class="card chartcard"><div class="chart-head"><h2>'+esc(title)+'</h2>'+(sub?'<span class="csub">'+esc(sub)+'</span>':'')+'</div>'+(legend||'')+inner+'</div>';}
function renderProgress(){
  const el=document.getElementById('s-progress');if(!el)return;
  const head='<div class="kicker">Progress</div><h1 style="font-size:24px">Your trends</h1><p class="sub">Everything you log, turned into a picture over time.</p>';
  const done=completedList();
  if(!done.length){
    el.innerHTML=head+'<div class="card empty"><div class="ei"><svg viewBox="0 0 24 24"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-4M13 16V8M18 16v-6"/></svg></div><h3>Nothing to chart yet</h3><p>Finish a session and your trends — training volume, planned vs felt RPE, and WHOOP recovery — start building here.</p></div>';
    return;
  }
  // stat tiles
  const stats='<div class="stats">'+
    '<div class="stat"><b>'+done.length+'</b><span>Sessions</span></div>'+
    '<div class="stat"><b>'+fmtK(thisWeekVolume())+'</b><span>kg this week</span></div>'+
    '<div class="stat"><b>'+dayStreak()+'</b><span>Day streak</span></div></div>';
  // volume by week
  const wk=weeklyVolume(8);
  const volCard=chartCard('Volume by week','kg lifted',chartBars(wk,'kg'));
  // RPE planned vs felt (last 12 sessions with any rpe)
  const rpeRows=done.map(s=>({d:s,r:sessionRpe(s)})).filter(x=>x.r.target!=null||x.r.felt!=null).slice(-12);
  let rpeCard='';
  if(rpeRows.length>=2){
    const xl=rpeRows.map(x=>{const p=String(x.d.date).split('-');return (+p[1])+'/'+(+p[2]);});
    const vals=rpeRows.flatMap(x=>[x.r.target,x.r.felt]).filter(v=>v!=null);
    const lo=Math.max(0,Math.floor(Math.min(...vals)-1)),hi=Math.min(10,Math.ceil(Math.max(...vals)+1));
    const series=[{name:'Planned',color:'#cf9d4f',pts:rpeRows.map(x=>x.r.target)},{name:'Felt',color:'#5b8def',pts:rpeRows.map(x=>x.r.felt)}];
    const legend='<div class="legend"><span><i style="background:#cf9d4f"></i>Planned</span><span><i style="background:#5b8def"></i>Felt</span></div>';
    rpeCard=chartCard('Planned vs felt RPE','last '+rpeRows.length+' sessions',chartLines(series,xl,[lo,hi],''),legend);
  }
  // WHOOP recovery (persisted daily history)
  const wd=(DB.settings.whoopDaily||[]).filter(h=>Number.isFinite(h.recovery)).slice(-14);
  let recCard='';
  if(wd.length>=2){
    const xl=wd.map(h=>{const p=h.date.split('-');return (+p[1])+'/'+(+p[2]);});
    recCard=chartCard('WHOOP recovery','last '+wd.length+' days',chartLines([{name:'Recovery',color:'#9fc59b',pts:wd.map(h=>h.recovery)}],xl,[0,100],'%'));
  }
  el.innerHTML=head+stats+volCard+rpeCard+recCard+progConditioningCards()+
    (rpeCard?'':'<div class="card guidebar" style="margin-top:16px"><b>Tip:</b> add target RPE in the Builder and log the RPE you felt — a planned-vs-felt trend appears here.</div>');
}
/* --- conditioning trends (real sessions; demos excluded) --- */
function progZoneBars(bk){
  const W=320,H=150,padB=20,padT=16,padL=4,padR=4,innerW=W-padL-padR,innerH=H-padB-padT;
  const totals=bk.map(b=>b.low+b.mod+b.high);
  const max=niceMax(Math.max(1,...totals));
  const slot=innerW/bk.length,bw=Math.min(26,slot*.56);
  let g='';[0,.5,1].forEach(f=>{const yy=padT+innerH*(1-f);g+='<line class="grid" x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'"/><text class="axt" x="'+padL+'" y="'+(yy-3)+'">'+Math.round(max*f)+'</text>';});
  let bars='';
  bk.forEach((b,i)=>{
    const cx=padL+slot*i+slot/2;let y=padT+innerH;
    [['low','#5b8def'],['mod','#33c07a'],['high','#e0524d']].forEach(pair=>{
      const h=innerH*(b[pair[0]]/max);
      if(h>0.5){y-=h;bars+='<rect x="'+(cx-bw/2).toFixed(1)+'" y="'+(y+1).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0.5,h-2).toFixed(1)+'" rx="2" fill="'+pair[1]+'"><title>Week of '+b.key+' · '+pair[0]+' '+Math.round(b[pair[0]])+' min</title></rect>';}
    });
    bars+='<text class="axt" x="'+cx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+b.label+'</text>';
  });
  return '<div class="chart"><svg viewBox="0 0 320 150" role="img" aria-label="Zone minutes by week">'+g+bars+'</svg></div>';
}
function progConditioningCards(){
  const cond=allCondRecords().filter(r=>!r.sim);
  if(!cond.length)return '';
  let out='';
  const now=new Date();now.setHours(0,0,0,0);
  const buckets=[];
  for(let i=7;i>=0;i--){const d=new Date(now);d.setDate(now.getDate()-now.getDay()-i*7);buckets.push({key:ymd(d),label:(d.getMonth()+1)+'/'+d.getDate(),low:0,mod:0,high:0});}
  const bidx=new Map(buckets.map((b,i)=>[b.key,i]));
  cond.forEach(r=>{const k=ymd(weekStart(r.startedAt||Date.now()));if(bidx.has(k)){const b=buckets[bidx.get(k)];b.low+=(r.zsec.low||0)/60;b.mod+=(r.zsec.mod||0)/60;b.high+=(r.zsec.high||0)/60;}});
  if(buckets.some(b=>b.low+b.mod+b.high>0))
    out+=chartCard('Zone minutes by week','conditioning',progZoneBars(buckets),
      '<div class="legend"><span><i style="background:#5b8def"></i>Recovery</span><span><i style="background:#33c07a"></i>Conditioning</span><span><i style="background:#e0524d"></i>Overload</span></div>');
  const rows=cond.slice(-12);
  if(rows.length>=2){
    const xl=rows.map(r=>{const p=String(r.date).split('-');return (+p[1])+'/'+(+p[2]);});
    const hrr=rows.map(r=>Number.isFinite(r.hrr)?r.hrr:null);
    if(hrr.filter(v=>v!=null).length>=2)
      out+=chartCard('HR recovery','60s drop after peak · higher is fitter',chartLines([{name:'HRR',color:'#9fc59b',pts:hrr}],xl,[0,Math.max(40,...hrr.filter(v=>v!=null))+10],' bpm'));
    const avg=rows.map(r=>r.avg||null),vals=avg.filter(v=>v!=null);
    if(vals.length>=2)
      out+=chartCard('Average heart rate','per conditioning session',chartLines([{name:'Avg HR',color:'#5b8def',pts:avg}],xl,[Math.min(...vals)-8,Math.max(...vals)+8],' bpm'));
  }
  return out?'<div class="section" style="margin-top:24px;margin-bottom:-4px"><div class="sec-head"><h2>Conditioning</h2></div></div>'+out:'';
}

/* ============================================================
   CONDITIONING — live heart-rate zone training.
   HR arrives over Web Bluetooth from WHOOP's Heart Rate Broadcast
   (standard BLE Heart Rate Service 0x180D / measurement 0x2A37).
   Live screen is built once, then updated with targeted DOM writes
   so nothing flickers at 1Hz. Sessions persist (downsampled) into
   DB.settings.conditioning, capped, and ride the normal cloud sync.
   ============================================================ */
const CON={view:'setup',fmt:'intervals',live:false,ble:{dev:null,chr:null,connected:false,sim:false},
  startedAt:0,samples:[],avgSum:0,avgN:0,max:0,lastBpm:null,phases:[],phaseIdx:-1,round:0,rounds:0,
  timer:null,simBpm:95,simNext:0,record:null,error:'',info:'',
  /* sink = where a finished session writes. Standalone (the Conditioning tab)
     saves to DB.settings.conditioning as ever; a session-scoped run writes the
     result onto its block inside a hybrid workout instead. */
  sink:{scope:'standalone'}};

/* --- profile & zone model (3 bands, Morpheus-style) ---
   Max HR uses Tanaka (208 - 0.7*age), the meta-analysis-validated formula that
   beats 220-age (which overestimates for the young, underestimates past ~40).
   A manual override wins; and if a live session ever records a beat above the
   estimate we remember it (obsMaxHr) and use it — exactly what Morpheus does. */
function conMaxHr(){
  const p=DB.settings.profile||{};
  const age=parseInt(p.age,10)||30;
  const manual=parseInt(p.maxHr,10)||0;
  const est=manual>0?manual:Math.round(208-0.7*age);
  const obs=parseInt(p.obsMaxHr,10)||0;
  return Math.max(est,obs);
}
function conProfile(){const p=DB.settings.profile||{};const age=parseInt(p.age,10)||30;return{age,maxHr:conMaxHr()};}
/* Resting HR: manual override, else WHOOP's measured resting HR, else null. */
function restingHr(){
  const p=DB.settings.profile||{};const manual=parseInt(p.restingHr,10)||0;
  if(manual>0)return manual;
  const w=WHOOP.sample?parseInt(WHOOP.sample.restingHr,10):0;
  return w>0?w:null;
}
/* Remember a new observed max whenever a live beat exceeds the estimate. */
function conNoteMax(bpm){
  if(!Number.isFinite(bpm)||bpm<100||bpm>240)return;
  const p=Object.assign({},DB.settings.profile);
  const cur=parseInt(p.obsMaxHr,10)||0;
  if(bpm>cur&&bpm>conMaxHr()-1){p.obsMaxHr=bpm;DB.settings.profile=p;save();}
}
/* Three dynamic bands (Recovery / Conditioning / Overload = blue / green / red).
   Thresholds are computed on Heart-Rate Reserve (Karvonen: resting + pct*(max-resting))
   whenever resting HR is known — the gold-standard, fitness-individualised method —
   and fall back to plain %max when it isn't. The bands then shift each day with
   WHOOP recovery, asymmetrically like Morpheus: a low-recovery day broadens blue
   and drops red so "hard" arrives sooner and protects you; a high-recovery day
   expands green and lifts the overload line so you can safely push. */
function conZones(){
  const m=conMaxHr(),rest=restingHr();
  const recRaw=WHOOP.sample?Number(WHOOP.sample.recoveryScore):NaN;
  const rec=Number.isFinite(recRaw)?Math.round(recRaw):null;
  // asymmetric daily re-zoning on Morpheus's 80/40 recovery bands
  let dLow=0,dMod=0;
  if(rec!=null){ if(rec<40){dLow=+0.03;dMod=-0.05;} else if(rec>80){dLow=-0.03;dMod=+0.04;} }
  let floor,lowTop,modTop,method;
  if(rest&&rest>0&&rest<m-20){
    const R=m-rest;method='hrr';
    floor =Math.round(rest+R*0.30);
    lowTop=Math.round(rest+R*(0.60+dLow));
    modTop=Math.round(rest+R*(0.85+dMod));
  }else{
    method='pctmax';
    floor =Math.round(m*0.50);
    lowTop=Math.round(m*(0.70+dLow));
    modTop=Math.round(m*(0.88+dMod));
  }
  lowTop=Math.max(floor+4,Math.min(lowTop,m-6));
  modTop=Math.max(lowTop+4,Math.min(modTop,m-2));
  return{floor,max:m,rest:rest||null,rec,adj:dMod,method,list:[
    {key:'low', name:'Recovery',    color:'#5b8def', lo:floor, hi:lowTop},
    {key:'mod', name:'Conditioning',color:'#33c07a', lo:lowTop,hi:modTop},
    {key:'high',name:'Overload',    color:'#e0524d', lo:modTop,hi:m}]};
}
function conZoneOf(bpm,z){z=z||conZones();return bpm<z.list[0].hi?z.list[0]:bpm<z.list[1].hi?z.list[1]:z.list[2];}
function conMmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function setProfile(key,val){
  const p=Object.assign({},DB.settings.profile);const n=parseInt(val,10);
  if(Number.isFinite(n)&&n>0)p[key]=n;else delete p[key];
  DB.settings.profile=p;save();
  if(CURRENT==='settings')renderSettings();
}

/* --- session formats --- */
const CON_FORMATS={
  steady:{name:'Steady-state',desc:'Zone 2 · 20 min',rounds:0,build:function(){return[
    {name:'Warm-up',dur:120,kind:'warm'},{name:'Zone 2',dur:1200,kind:'work2'},{name:'Cool-down',dur:120,kind:'cool'}];}},
  intervals:{name:'Intervals',desc:'8×30s / 90s',rounds:8,build:function(){
    const s=[{name:'Warm-up',dur:180,kind:'warm'}];
    for(let i=1;i<=8;i++){s.push({name:'Work '+i,dur:30,kind:'work',round:i});s.push({name:'Recover',dur:90,kind:'rest',round:i});}
    s.push({name:'Cool-down',dur:120,kind:'cool'});return s;}},
  tempo:{name:'Tempo',desc:'10×15s / 60s',rounds:10,build:function(){
    const s=[{name:'Warm-up',dur:180,kind:'warm'}];
    for(let i=1;i<=10;i++){s.push({name:'Work '+i,dur:15,kind:'work',round:i});s.push({name:'Recover',dur:60,kind:'rest',round:i});}
    s.push({name:'Cool-down',dur:120,kind:'cool'});return s;}}
};
function conPickFmt(f){if(CON_FORMATS[f]){CON.fmt=f;if(CURRENT==='conditioning')renderConditioning();}}

/* --- Native HR bridge (the installed Android app injects window.AndroidHR;
       native BLE streams samples back through the conNative* globals) --- */
function conHasNative(){try{return !!(window.AndroidHR&&typeof window.AndroidHR.startScan==='function');}catch(e){return false;}}
function conNativeSample(bpm){conSample(Number(bpm));}
function conNativeState(state,msg){
  if(state==='connected'){
    if(!CON.live){CON.info='';CON.ble={dev:null,chr:null,connected:true,sim:false,native:true};conStart();}
    else{CON.ble.connected=true;conStatus('');}
  }else if(state==='scanning'){
    CON.info='Scanning for your WHOOP… make sure HR Broadcast is on.';CON.error='';
    if(CURRENT==='conditioning'&&CON.view==='setup')renderConditioning();
  }else if(state==='reconnecting'){conStatus('Signal lost — reconnecting…');}
  else if(state==='lost'){conStatus('Connection lost. Finish to keep what was recorded.',true);}
  else{ // error
    if(!CON.live){CON.info='';CON.error=String(msg||'Bluetooth error');if(CURRENT==='conditioning')renderConditioning();}
    else conStatus(String(msg||'Bluetooth error'),true);
  }
}

/* --- Web Bluetooth (WHOOP HR broadcast = standard BLE heart_rate) --- */
function conParseHr(dv){const flags=dv.getUint8(0);return (flags&1)?dv.getUint16(1,true):dv.getUint8(1);}
function conOnHr(e){try{conSample(conParseHr(e.target.value));}catch(err){}}
async function conConnect(){
  CON.error='';
  if(conHasNative()){try{window.AndroidHR.startScan();}catch(e){CON.error='Bluetooth: '+String(e&&e.message||e);renderConditioning();}return;}
  if(!('bluetooth' in navigator)){CON.error='Live HR needs Chrome on Android or desktop — this browser has no Web Bluetooth. You can still run the demo.';renderConditioning();return;}
  try{
    const dev=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}]});
    const server=await dev.gatt.connect();
    const svc=await server.getPrimaryService('heart_rate');
    const chr=await svc.getCharacteristic('heart_rate_measurement');
    await chr.startNotifications();
    chr.addEventListener('characteristicvaluechanged',conOnHr);
    dev.addEventListener('gattserverdisconnected',conOnDrop);
    CON.ble={dev,chr,connected:true,sim:false};
    conStart();
  }catch(e){
    if(e&&e.name==='NotFoundError')return; // user closed the picker
    CON.error='Bluetooth: '+String(e&&e.message||e);renderConditioning();
  }
}
function conOnDrop(){
  if(!CON.live){conCleanupBle();return;}
  CON.ble.connected=false;conStatus('Signal lost — reconnecting…');
  conReconnect();
}
async function conReconnect(){
  for(let i=0;i<5&&CON.live&&CON.ble.dev;i++){
    try{
      const server=await CON.ble.dev.gatt.connect();
      const svc=await server.getPrimaryService('heart_rate');
      const chr=await svc.getCharacteristic('heart_rate_measurement');
      await chr.startNotifications();
      chr.addEventListener('characteristicvaluechanged',conOnHr);
      CON.ble.chr=chr;CON.ble.connected=true;conStatus('');return;
    }catch(e){await new Promise(r=>setTimeout(r,2000));}
  }
  if(CON.live)conStatus('Connection lost. Finish to keep what was recorded.',true);
}
function conCleanupBle(){
  try{if(CON.ble.native&&window.AndroidHR)window.AndroidHR.stop();}catch(e){}
  try{if(CON.ble.chr)CON.ble.chr.removeEventListener('characteristicvaluechanged',conOnHr);}catch(e){}
  try{if(CON.ble.dev)CON.ble.dev.removeEventListener('gattserverdisconnected',conOnDrop);}catch(e){}
  try{if(CON.ble.dev&&CON.ble.dev.gatt&&CON.ble.dev.gatt.connected)CON.ble.dev.gatt.disconnect();}catch(e){}
  CON.ble={dev:null,chr:null,connected:false,sim:false};
}
function conStatus(msg,isErr){const el=document.getElementById('conStatus');if(el){el.textContent=msg||'';el.className='constatus'+(isErr?' err':'');}}

/* demo mode: simulated stream — for trying the flow without a band (and for tests) */
function conStartDemo(){CON.ble={dev:null,chr:null,connected:true,sim:true};conStart();}

/* --- session lifecycle --- */
let CON_AC=null;
function conBeep(freq,ms){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    if(!CON_AC)CON_AC=new AC();
    if(CON_AC.state==='suspended')CON_AC.resume();
    const o=CON_AC.createOscillator(),g=CON_AC.createGain();
    o.type='sine';o.frequency.value=freq;g.gain.value=.08;
    o.connect(g);g.connect(CON_AC.destination);o.start();
    g.gain.exponentialRampToValueAtTime(.0001,CON_AC.currentTime+ms/1000);
    o.stop(CON_AC.currentTime+ms/1000);
  }catch(e){}
}
function conSkip(){
  if(!CON.live)return;
  const t=(Date.now()-CON.startedAt)/1000;
  const info=conPhaseAt(t);
  if(info.done)return;
  CON.startedAt-=Math.ceil(info.left)*1000; // jump the clock to the next phase
  conTick();
}
function conStart(){
  if(CON.live)return;
  const f=CON_FORMATS[CON.fmt]||CON_FORMATS.intervals;
  CON.phases=[{name:'Get ready',dur:5,kind:'ready'}].concat(f.build());
  CON.rounds=f.rounds||0;CON.round=0;CON.phaseIdx=-1;
  CON.samples=[];CON.avgSum=0;CON.avgN=0;CON.max=0;CON.lastBpm=null;
  CON.simBpm=95;CON.simNext=0;CON.error='';
  CON.startedAt=Date.now();CON.live=true;CON.view='live';
  if(CURRENT!=='conditioning')go('conditioning');else{renderConditioning();updateWake();}
  CON.timer=setInterval(conTick,500);
}
function conPhaseAt(t){
  let acc=0;
  for(let i=0;i<CON.phases.length;i++){const p=CON.phases[i];if(t<acc+p.dur)return{p,idx:i,left:acc+p.dur-t};acc+=p.dur;}
  return{done:true};
}
function conTick(){
  if(!CON.live)return;
  const t=(Date.now()-CON.startedAt)/1000;
  const info=conPhaseAt(t);
  if(info.done){conFinish();return;}
  if(info.idx!==CON.phaseIdx){
    const first=CON.phaseIdx===-1;
    CON.phaseIdx=info.idx;
    if(info.p.round)CON.round=info.p.round;
    conPaintPhase(info.p);
    try{if(navigator.vibrate)navigator.vibrate(info.p.kind==='work'?[180,90,180]:[120]);}catch(e){}
    if(!first)conBeep(info.p.kind==='work'?880:520,150);
  }
  const pc=document.getElementById('conPhaseClock');if(pc)pc.textContent=conMmss(info.left);
  const elp=document.getElementById('conElapsed');if(elp)elp.textContent=conMmss(t);
  if(CON.ble.sim&&t>=CON.simNext){
    CON.simNext=Math.floor(t)+1;
    const z=conZones(),k=info.p.kind;
    const target=k==='work'?z.max*.93:k==='rest'?z.max*.68:k==='work2'?z.max*.72:k==='cool'?105:k==='ready'?100:118;
    CON.simBpm+= (target-CON.simBpm)*.15 + (Math.random()*7-3.5);
    CON.simBpm=Math.max(70,Math.min(z.max+2,CON.simBpm));
    conSample(Math.round(CON.simBpm));
  }
}
function conSample(bpm){
  if(!CON.live||!Number.isFinite(bpm)||bpm<25||bpm>250)return;
  const t=Math.max(0,Math.round((Date.now()-CON.startedAt)/1000));
  CON.samples.push({t,bpm});
  CON.avgSum+=bpm;CON.avgN++;if(bpm>CON.max){CON.max=bpm;conNoteMax(bpm);}CON.lastBpm=bpm;
  conPaintHr(bpm);
}
function conAbort(){
  if(!CON.live)return;
  if(!confirm('Discard this session? Nothing will be saved.'))return;
  CON.live=false;clearInterval(CON.timer);CON.timer=null;
  conCleanupBle();CON.view='setup';CON.record=null;
  const sink=CON.sink||{scope:'standalone'};CON.sink={scope:'standalone'};
  if(sink.scope==='session'&&DB.sessions.find(x=>x.id===sink.sid)){CUR_SESSION=sink.sid;go('training');return;}
  renderConditioning();updateWake();
}
function conDownsample(samples,dur){
  const every=2,n=Math.max(1,Math.min(Math.ceil(dur/every)+1,2700));
  const sum=new Array(n).fill(0),cnt=new Array(n).fill(0);
  samples.forEach(s=>{const i=Math.max(0,Math.min(n-1,Math.floor(s.t/every)));sum[i]+=s.bpm;cnt[i]++;});
  return{every,pts:sum.map((v,i)=>cnt[i]?Math.round(v/cnt[i]):null)};
}
function conFinish(){
  if(!CON.live)return;
  CON.live=false;clearInterval(CON.timer);CON.timer=null;
  conCleanupBle();
  const dur=Math.min(Math.round((Date.now()-CON.startedAt)/1000),3*3600);
  if(!CON.avgN){CON.view='setup';CON.error='No heart-rate data was received, so nothing was saved.';renderConditioning();updateWake();return;}
  const z=conZones(),ds=conDownsample(CON.samples,dur);
  const zsec={low:0,mod:0,high:0};
  ds.pts.forEach(b=>{if(b!=null)zsec[conZoneOf(b,z).key]+=ds.every;});
  // HR recovery: peak, then how far it fell 60s later
  let peakI=0;ds.pts.forEach((b,i)=>{if(b!=null&&(ds.pts[peakI]==null||b>ds.pts[peakI]))peakI=i;});
  let after=null;for(let i=Math.min(ds.pts.length-1,peakI+Math.round(60/ds.every));i>peakI&&after==null;i--)after=ds.pts[i];
  const hrr=(ds.pts[peakI]!=null&&after!=null)?Math.max(0,ds.pts[peakI]-after):null;
  const avg=Math.round(CON.avgSum/CON.avgN);
  const cal=Math.max(0,Math.round((dur/60)*((avg*0.62-55)*0.12+7)));
  const rec={id:uid(),date:ymd(new Date()),startedAt:CON.startedAt,dur,fmt:CON.fmt,maxHr:z.max,
    every:ds.every,hr:ds.pts,zsec,max:CON.max,avg,hrr,cal,sim:CON.ble.sim||undefined};
  const sink=CON.sink||{scope:'standalone'};
  let persisted=false;
  if(sink.scope==='session'){
    const s=DB.sessions.find(x=>x.id===sink.sid),b=s&&s.blocks[sink.bi];
    if(isCond(b)){b.condResult=rec;save();persisted=true;}
  }
  if(!persisted){ // standalone (the Conditioning tab) — the original path, unchanged
    const list=Array.isArray(DB.settings.conditioning)?DB.settings.conditioning.slice():[];
    list.push(rec);DB.settings.conditioning=list.slice(-40);
    save();CON.sink={scope:'standalone'};
  }
  CON.record=rec;CON.view='results';
  renderConditioning();updateWake();
}
function conOpenResult(id){
  const r=allCondRecords().find(x=>x.id===id);
  if(!r)return;
  CON.sink={scope:'standalone'};
  CON.record=r;CON.view='results';
  if(CURRENT!=='conditioning')go('conditioning');else renderConditioning();
}
/* Every conditioning result the app knows: legacy standalone history plus the
   ones embedded in completed hybrid sessions. Read paths (History, Progress)
   take the union so both kinds show up everywhere. */
function allCondRecords(){
  const legacy=Array.isArray(DB.settings.conditioning)?DB.settings.conditioning.slice():[];
  const fromSess=[];
  DB.sessions.forEach(s=>{if(s.status==='active')return;(s.blocks||[]).forEach(b=>{if(isCond(b)&&b.condResult)fromSess.push(Object.assign({},b.condResult,{date:b.condResult.date||s.date}));});});
  return legacy.concat(fromSess);
}
function conDone(){
  const sink=CON.sink||{scope:'standalone'};
  CON.sink={scope:'standalone'};CON.record=null;CON.error='';
  if(sink.scope==='session'&&DB.sessions.find(x=>x.id===sink.sid)){CON.view='setup';CUR_SESSION=sink.sid;go('training');return;}
  CON.view='setup';renderConditioning();
}
/* The Conditioning nav tab and Home shortcut always mean a standalone session —
   reset the sink unless a session run is mid-flight (don't hijack it). */
function conNav(btn){if(!CON.live)CON.sink={scope:'standalone'};go('conditioning',btn);}

/* --- SVG helpers --- */
function conArc(cx,cy,r,a0,a1){
  const x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0),x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
  return 'M'+x0.toFixed(1)+' '+y0.toFixed(1)+' A'+r+' '+r+' 0 '+((a1-a0)>Math.PI?1:0)+' 1 '+x1.toFixed(1)+' '+y1.toFixed(1);
}
function conGaugeSvg(z){
  const A0=Math.PI,A1=2*Math.PI;let s='<path d="'+conArc(100,100,82,A0,A1)+'" stroke="rgba(255,255,255,.09)" stroke-width="11" fill="none" stroke-linecap="round"/>';
  z.list.forEach(zz=>{
    const f0=Math.max(0,(zz.lo-z.floor)/(z.max-z.floor)),f1=Math.min(1,(zz.hi-z.floor)/(z.max-z.floor));
    s+='<path d="'+conArc(100,100,82,A0+(A1-A0)*f0,A0+(A1-A0)*f1)+'" stroke="'+zz.color+'" stroke-opacity=".22" stroke-width="10" fill="none"/>';
  });
  return s+'<path id="conGaugeFill" d="" stroke="'+z.list[0].color+'" stroke-width="11" fill="none" stroke-linecap="round"/>';
}
function conLiveGridSvg(z,lo,hi){
  const Y=v=>10+(150-10-18)*(1-(v-lo)/(hi-lo));let s='';
  [z.floor,z.list[0].hi,z.list[1].hi,z.max].forEach(v=>{const y=Y(v);s+='<line class="grid" x1="6" y1="'+y.toFixed(1)+'" x2="310" y2="'+y.toFixed(1)+'"/>';});
  return s;
}
/* targeted paints for the live screen */
function conPaintPhase(p){
  const bar=document.getElementById('conPhaseBar');if(!bar)return;
  const cls=p.kind==='work'?'work':p.kind==='rest'?'rest':p.kind==='cool'?'cool':'warm';
  bar.className='phasebar '+cls;
  document.getElementById('conPhaseBig').textContent=p.kind==='work'?'WORK':p.kind==='rest'?'RECOVER':p.name.toUpperCase();
  document.getElementById('conRounds').textContent=CON.rounds?('Round '+CON.round+' / '+CON.rounds):(CON_FORMATS[CON.fmt]?CON_FORMATS[CON.fmt].name:'');
  const zn=document.getElementById('conZnow');if(zn)zn.textContent=p.name;
  const pl=document.getElementById('conPhaseLabel');if(pl)pl.textContent=p.kind==='work'?'Work':p.kind==='rest'?'Recover':p.kind==='cool'?'Cool-down':p.kind==='work2'?'Zone 2':p.kind==='ready'?'Get ready':'Warm-up';
}
function conPaintHr(bpm){
  const el=document.getElementById('conBpm');if(!el)return;
  const z=conZones(),zn=conZoneOf(bpm,z);
  el.textContent=bpm;el.style.color=zn.color;
  document.getElementById('conZLabel').textContent=zn.name;
  document.getElementById('conAvg').textContent=CON.avgN?Math.round(CON.avgSum/CON.avgN):'—';
  document.getElementById('conMax').textContent=CON.max||'—';
  const fill=document.getElementById('conGaugeFill');
  if(fill){
    const frac=Math.max(0,Math.min(1,(bpm-z.floor)/(z.max-z.floor)));
    fill.setAttribute('d',frac>0.005?conArc(100,100,82,Math.PI,Math.PI+Math.PI*frac):'');
    fill.setAttribute('stroke',zn.color);
  }
  conPaintLine(z);
}
function conPaintLine(z){
  const g=document.getElementById('conLiveSeg');if(!g)return;
  const pts=CON.samples.slice(-110).map(s=>s.bpm);
  const lo=z.floor-6,hi=z.max+4,n=Math.max(60,pts.length);
  const X=i=>6+(310-6)*(i/(n-1)),Y=v=>10+(150-10-18)*(1-(v-lo)/(hi-lo));
  let s='';
  for(let i=1;i<pts.length;i++){
    const zn=conZoneOf((pts[i]+pts[i-1])/2,z);
    s+='<line x1="'+X(i-1).toFixed(1)+'" y1="'+Y(pts[i-1]).toFixed(1)+'" x2="'+X(i).toFixed(1)+'" y2="'+Y(pts[i]).toFixed(1)+'" stroke="'+zn.color+'" stroke-width="2.4" stroke-linecap="round"/>';
  }
  if(pts.length)s+='<circle cx="'+X(pts.length-1).toFixed(1)+'" cy="'+Y(pts[pts.length-1]).toFixed(1)+'" r="3.2" fill="'+conZoneOf(pts[pts.length-1],z).color+'" stroke="#141312" stroke-width="1.5"/>';
  g.innerHTML=s;
}
function conPaintAll(){
  const t=(Date.now()-CON.startedAt)/1000,info=conPhaseAt(t);
  if(!info.done){conPaintPhase(info.p);const pc=document.getElementById('conPhaseClock');if(pc)pc.textContent=conMmss(info.left);}
  const elp=document.getElementById('conElapsed');if(elp)elp.textContent=conMmss(t);
  if(CON.lastBpm!=null)conPaintHr(CON.lastBpm);
}

/* --- views --- */
function conSetupHtml(){
  const z=conZones(),f=CON_FORMATS[CON.fmt];
  const rec=WHOOP.sample&&Number.isFinite(Number(WHOOP.sample.recoveryScore))?Math.round(Number(WHOOP.sample.recoveryScore)):null;
  const sess=(CON.sink||{}).scope==='session'?curSession():null;
  let h;
  if(sess){
    h='<div class="backrow"><button class="backbtn" aria-label="Back to workout" data-click="go" data-args="[&quot;training&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">'+esc(sess.name||'Workout')+' · conditioning</div><h1 style="font-size:24px">Zone session</h1></div></div>';
  }else{
    h='<div class="kicker">Conditioning</div><h1 style="font-size:24px">Zone session</h1><p class="sub">Train by live heart rate. Zones adapt to your recovery — tune your profile in Settings.</p>';
  }
  if(rec!=null)h+='<div class="recpill"><b>Your recovery today</b><span class="v">'+rec+'%</span></div>';
  h+='<div class="card" style="margin-top:14px;padding:15px"><div class="lbl" style="color:var(--dim);font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">Today&rsquo;s heart-rate zones · max '+z.max+(z.adj>0?' · widened for '+z.rec+'% recovery':z.adj<0?' · eased for '+z.rec+'% recovery':'')+'</div>';
  z.list.forEach(zz=>{h+='<div class="zrow"><span class="zdot" style="background:'+zz.color+'"></span><span class="znm">'+zz.name+'</span><span class="zbar"><span class="zfill" style="background:linear-gradient(90deg,'+zz.color+'55,'+zz.color+')"></span></span><span class="zrng">'+zz.lo+'&ndash;'+zz.hi+'</span></div>';});
  h+='</div>';
  h+='<div style="margin-top:16px"><div class="lbl" style="color:var(--dim);font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase">Choose format</div><div class="fmtpick">';
  Object.keys(CON_FORMATS).forEach(k=>{const ff=CON_FORMATS[k];
    h+='<button aria-pressed="'+(CON.fmt===k)+'" data-click="conPickFmt" data-args="[&quot;'+k+'&quot;]">'+ff.name+'<small>'+ff.desc+'</small></button>';});
  h+='</div></div>';
  if(conHasNative()||('bluetooth' in navigator)){
    h+='<button class="bigbtn" style="margin-top:16px" data-click="conConnect">Connect WHOOP HR &amp; start</button>';
    h+='<p class="con-hint">Turn on <b>HR Broadcast</b> in the WHOOP app (Device Settings) so the band shows up'+(conHasNative()?'.':' in the Bluetooth picker.')+'</p>';
  }else{
    h+='<div class="con-note"><b>Live HR needs Chrome.</b> Open this app in Chrome on Android (or desktop) to connect your WHOOP — this browser doesn&rsquo;t support Web Bluetooth. The demo below still works.</div>';
  }
  h+='<button class="addbtn" style="margin-top:10px" data-click="conStartDemo">Run a demo with simulated HR</button>';
  if(CON.info)h+='<div class="constatus" style="margin-top:12px">'+esc(CON.info)+'</div>';
  if(CON.error)h+='<div class="constatus err" style="margin-top:12px">'+esc(CON.error)+'</div>';
  const hist=sess?[]:(Array.isArray(DB.settings.conditioning)?DB.settings.conditioning:[]).slice(-3).reverse();
  if(hist.length){
    h+='<div class="section" style="margin-top:22px"><div class="sec-head"><h2>Recent sessions</h2></div><div class="conlist">';
    hist.forEach(r=>{const fN=CON_FORMATS[r.fmt]?CON_FORMATS[r.fmt].name:r.fmt;
      h+='<div class="card exrow nav" style="cursor:pointer" data-click="conOpenResult" data-args="[&quot;'+r.id+'&quot;]"><div><b>'+esc(fN)+(r.sim?' · demo':'')+'</b><p>'+esc(prettyDay(r.date))+' · '+conMmss(r.dur)+' · avg '+(r.avg||'—')+' bpm</p></div><span class="chev">›</span></div>';});
    h+='</div></div>';
  }
  return h;
}
function conLiveHtml(){
  const z=conZones(),f=CON_FORMATS[CON.fmt];
  return '<div class="livetop"><div><div class="znow" id="conZnow">Starting…</div><span class="chip" id="conFmtBadge">'+(f?f.name:'')+(CON.ble.sim?' · demo':'')+'</span></div>'+
    '<div class="clockbox"><b id="conPhaseClock">–:––</b><span id="conPhaseLabel">&nbsp;</span></div></div>'+
    '<div class="congauge"><svg viewBox="0 0 200 118" aria-hidden="true">'+conGaugeSvg(z)+'</svg>'+
    '<div class="gbpm"><b id="conBpm">—</b><span>bpm · <span id="conZLabel">waiting for signal</span></span></div></div>'+
    '<div class="livemid"><div class="m"><b id="conAvg">—</b><span>avg hr</span></div>'+
    '<div class="m mbig"><b id="conElapsed">0:00</b><span>elapsed</span></div>'+
    '<div class="m"><b id="conMax">—</b><span>max hr</span></div></div>'+
    '<div class="phasebar" id="conPhaseBar"><span id="conPhaseBig">READY</span><span class="rounds" id="conRounds"></span></div>'+
    '<div class="card chartcard"><div class="chart-head"><h2>Heart rate</h2><span class="csub">live</span></div>'+
    '<div class="chart"><svg viewBox="0 0 320 150" role="img" aria-label="Live heart rate">'+conLiveGridSvg(z,z.floor-6,z.max+4)+'<g id="conLiveSeg"></g></svg></div></div>'+
    '<div class="conctrls"><button data-click="conSkip">Skip ›</button><button class="finish" data-click="conFinish">Finish</button><button class="abort" data-click="conAbort">Discard</button></div>'+
    '<div class="constatus" id="conStatus"></div>';
}
function conDonutSvg(zsec,total){
  const C=2*Math.PI*46;let off=0,s='<circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="13"/>';
  conZones().list.forEach(zz=>{
    const sec=zsec[zz.key]||0;if(!sec||!total)return;
    const len=(sec/total)*C;
    s+='<circle cx="60" cy="60" r="46" fill="none" stroke="'+zz.color+'" stroke-width="13" stroke-dasharray="'+len.toFixed(1)+' '+(C-len).toFixed(1)+'" stroke-dashoffset="'+(-off).toFixed(1)+'" transform="rotate(-90 60 60)"/>';
    off+=len;
  });
  return s;
}
function conResChartSvg(rec){
  const z=conZones();const m=rec.maxHr||z.max;
  const floor=Math.round(m*.5),lowTop=Math.round(m*.70),modTop=Math.round(m*.88);
  const zoneAt=b=>b<lowTop?'#5b8def':b<modTop?'#33c07a':'#e0524d';
  const pts=rec.hr||[],n=pts.length;if(n<2)return'<div class="sc-meta">Not enough data for a graph.</div>';
  const lo=floor-8,hi=m+4;
  const X=i=>6+(310-6)*(i/(n-1)),Y=v=>10+(150-10-20)*(1-(v-lo)/(hi-lo));
  let g='';[floor,lowTop,modTop,m].forEach(v=>{const y=Y(v);g+='<line class="grid" x1="6" y1="'+y.toFixed(1)+'" x2="310" y2="'+y.toFixed(1)+'"/><text class="axt" x="6" y="'+(y-2).toFixed(1)+'">'+v+'</text>';});
  const step=Math.max(1,Math.floor(n/240));let s='';
  let prev=null,prevI=0;
  for(let i=0;i<n;i+=step){const b=pts[i];if(b==null){prev=null;continue;}
    if(prev!=null)s+='<line x1="'+X(prevI).toFixed(1)+'" y1="'+Y(prev).toFixed(1)+'" x2="'+X(i).toFixed(1)+'" y2="'+Y(b).toFixed(1)+'" stroke="'+zoneAt((b+prev)/2)+'" stroke-width="2" stroke-linecap="round"/>';
    prev=b;prevI=i;}
  return '<div class="chart"><svg viewBox="0 0 320 150" role="img" aria-label="Session heart rate">'+g+s+'</svg></div>';
}
function conResultsHtml(rec){
  if(!rec)return conSetupHtml();
  const total=(rec.zsec.low||0)+(rec.zsec.mod||0)+(rec.zsec.high||0);
  const fN=CON_FORMATS[rec.fmt]?CON_FORMATS[rec.fmt].name:rec.fmt;
  let h='<div class="rhead" style="display:flex;align-items:baseline;justify-content:space-between"><div><div class="kicker">Session complete</div><h1 style="font-size:24px">'+esc(fN)+(rec.sim?' · demo':'')+'</h1></div><span class="chip">'+conMmss(rec.dur)+'</span></div>';
  h+='<div class="card" style="margin-top:14px;padding:15px"><div class="donutwrap"><div class="dcell"><svg viewBox="0 0 120 120">'+conDonutSvg(rec.zsec,total)+'</svg><div class="dctxt"><div><b>'+conMmss(rec.dur)+'</b><span>total</span></div></div></div><div class="zlist">';
  conZones().list.forEach(zz=>{h+='<div class="zi"><i style="background:'+zz.color+'"></i><span class="n">'+zz.name+'</span><span class="t">'+conMmss(rec.zsec[zz.key]||0)+'</span></div>';});
  h+='</div></div></div>';
  h+='<div class="card chartcard" style="margin-top:14px"><div class="chart-head"><h2>Heart rate</h2><span class="csub">whole session · colored by zone</span></div>'+conResChartSvg(rec)+'</div>';
  h+='<div class="stats stats2">'+
    '<div class="stat"><b>'+(rec.max||'—')+'</b><span>max hr</span></div>'+
    '<div class="stat"><b>'+(rec.avg||'—')+'</b><span>avg hr</span></div>'+
    '<div class="stat hrr"><b>'+(rec.hrr!=null?'▼ '+rec.hrr:'—')+'</b><span>hr recovery · 60s</span></div>'+
    '<div class="stat"><b>'+(rec.cal!=null?rec.cal:'—')+'</b><span>est calories</span></div></div>';
  h+='<p class="con-hint">HR recovery = how far your heart rate dropped in the 60s after your peak — a real conditioning-fitness marker.</p>';
  const inSession=(CON.sink||{}).scope==='session';
  h+='<button class="bigbtn" style="margin-top:14px" data-click="conDone">'+(inSession?'Back to workout ✓':'Done')+'</button>';
  return h;
}
function renderConditioning(){
  const el=document.getElementById('s-conditioning');if(!el)return;
  el.innerHTML=CON.view==='live'?conLiveHtml():CON.view==='results'?conResultsHtml(CON.record):conSetupHtml();
  if(CON.view==='live')conPaintAll();
}

/* ============================================================
   IMPORTER — write/paste/photograph a workout, get a template.
   Meaning-only questions (never nags about blank numbers), fixes
   happen inline in the draft, and every confirmed fix is learned
   into DB.settings.lexicon (synced with the account). Photo OCR
   runs fully on-device via self-hosted tesseract.js (lazy-loaded;
   ~7MB on first use, then browser-cached). No cloud, no cost.
   ============================================================ */
const IMP_LIB_RAW=[
 /* barbell */
 ['Back squat','reps_kg',['squat','squats','bb squat','back squats','high bar squat','low bar squat']],
 ['Front squat','reps_kg',['front squats','fs']],
 ['Overhead squat','reps_kg',['ohs','overhead squats']],
 ['Box squat','reps_kg',['box squats']],
 ['Deadlift','reps_kg',['dl','deadlifts','deads','conventional deadlift']],
 ['Romanian deadlift','reps_kg',['rdl','rdls','romanian deadlifts','stiff leg deadlift','sldl']],
 ['Sumo deadlift','reps_kg',['sumo','sumo deadlifts']],
 ['Trap bar deadlift','reps_kg',['trap bar','hex bar deadlift','trap bar deadlifts']],
 ['Bench press','reps_kg',['bench','bb bench','flat bench','benchpress']],
 ['Incline bench press','reps_kg',['incline bench','incline press','incline bb press']],
 ['Close grip bench press','reps_kg',['cgbp','close grip bench']],
 ['Overhead press','reps_kg',['ohp','press','shoulder press','military press','strict press']],
 ['Push press','reps_kg',['push presses']],
 ['Barbell row','reps_kg',['bb row','bent over row','pendlay row','barbell rows','bor']],
 ['Hip thrust','reps_kg',['hip thrusts','bb hip thrust']],
 ['Good morning','reps_kg',['good mornings','gm']],
 ['Clean','reps_kg',['power clean','cleans','hang clean','squat clean','power cleans']],
 ['Clean and jerk','reps_kg',['c&j','clean & jerk','clean and jerks']],
 ['Snatch','reps_kg',['power snatch','snatches','hang snatch']],
 ['Thruster','reps_kg',['thrusters']],
 ['Front rack lunge','reps_kg',['front rack lunges']],
 ['Barbell curl','reps_kg',['bb curl','barbell curls']],
 /* dumbbell / kettlebell */
 ['Dumbbell bench press','reps_kg',['db bench','db press','db bench press','dumbbell press']],
 ['Incline dumbbell press','reps_kg',['incline db press','incline db bench','incline dumbbell bench']],
 ['Dumbbell row','reps_kg',['db row','db rows','single arm row','one arm row']],
 ['Dumbbell shoulder press','reps_kg',['db shoulder press','db ohp','seated db press']],
 ['Dumbbell curl','reps_kg',['db curl','db curls','bicep curl','bicep curls','curls']],
 ['Hammer curl','reps_kg',['hammer curls']],
 ['Lateral raise','reps_kg',['lateral raises','side raise','side raises','lat raise']],
 ['Dumbbell fly','reps_kg',['db fly','db flys','chest fly','flyes']],
 ['Goblet squat','reps_kg',['goblet squats']],
 ['Dumbbell lunge','reps_kg',['db lunge','db lunges']],
 ['Dumbbell romanian deadlift','reps_kg',['db rdl','db rdls']],
 ['Kettlebell swing','reps',['kb swing','kb swings','kettlebell swings','swing','swings','russian swing']],
 ['Kettlebell snatch','reps',['kb snatch','kb snatches']],
 ['Kettlebell clean and press','reps',['kb clean and press','kb clean & press']],
 ['Turkish get-up','reps',['tgu','turkish getup','turkish get ups','get up','get-ups']],
 ['Devils press','reps',['devil press','devil’s press','devils presses']],
 ['Dumbbell snatch','reps',['db snatch','db snatches','alt db snatch']],
 /* machine / cable */
 ['Lat pulldown','reps_kg',['pulldown','pulldowns','lat pull down']],
 ['Seated cable row','reps_kg',['cable row','cable rows','seated row','low row']],
 ['Cable fly','reps_kg',['cable flys','cable crossover']],
 ['Tricep pushdown','reps_kg',['pushdown','pushdowns','rope pushdown','tricep extension']],
 ['Face pull','reps_kg',['face pulls','facepull']],
 ['Leg press','reps_kg',['leg presses']],
 ['Leg extension','reps_kg',['leg extensions']],
 ['Leg curl','reps_kg',['leg curls','hamstring curl','ham curl']],
 ['Calf raise','reps_kg',['calf raises','calves']],
 ['Chest supported row','reps_kg',['chest supported rows','seal row']],
 ['Hack squat','reps_kg',['hack squats']],
 /* bodyweight / gymnastics */
 ['Pull-up','reps',['pull up','pullup','pull-ups','pullups','pull ups','chin up','chin-up','chins','chinups']],
 ['Push-up','reps',['push up','pushup','push-ups','pushups','push ups','press up','press-ups','press ups']],
 ['Dip','reps',['dips','ring dip','ring dips','bar dip','bar dips']],
 ['Ring row','reps',['ring rows','inverted row','inverted rows']],
 ['Muscle-up','reps',['muscle up','muscle ups','ring muscle up','bar muscle up','mu']],
 ['Handstand push-up','reps',['hspu','handstand pushup','handstand push ups']],
 ['Wall walk','reps',['wall walks','wallwalk','wall-walk']],
 ['Burpee','reps',['burpees','burpee over bar','bar facing burpee']],
 ['Air squat','reps',['air squats','bodyweight squat','bw squat']],
 ['Lunge','reps',['lunges','walking lunge','walking lunges','reverse lunge','reverse lunges']],
 ['Box jump','reps',['box jumps','box jump over']],
 ['Jump squat','reps',['jump squats']],
 ['Broad jump','reps',['broad jumps']],
 ['Step-up','reps',['step up','step ups','box step up','box step-ups']],
 ['Sit-up','reps',['sit up','situp','sit-ups','situps','sit ups','abmat sit up']],
 ['V-up','reps',['v up','v ups','vups']],
 ['Toes-to-bar','reps',['toes to bar','ttb','t2b']],
 ['Knees-to-elbow','reps',['knees to elbow','k2e']],
 ['Hanging knee raise','reps',['knee raises','hanging knee raises','leg raise','leg raises','hanging leg raise']],
 ['Mountain climber','reps',['mountain climbers','climbers']],
 ['Wall ball','reps',['wall balls','wallball','wallballs','wb']],
 ['Slam ball','reps',['slam balls','ball slam','ball slams','med ball slam']],
 ['Russian twist','reps',['russian twists']],
 ['Back extension','reps',['back extensions','hyperextension','hyperextensions','45 degree back extension']],
 ['Glute bridge','reps',['glute bridges']],
 ['Nordic curl','reps',['nordic curls','nordics']],
 ['Pistol squat','reps',['pistol','pistols','pistol squats']],
 ['Band pull-apart','reps',['band pull aparts','band pull apart','pull aparts']],
 ['Scap push-up','reps',['scap pushup','scap push ups','scap pushups']],
 /* timed holds & carries */
 ['Plank','seconds',['planks','front plank','plank hold']],
 ['Side plank','seconds',['side planks']],
 ['Dead hang','seconds',['deadhang','dead hangs','hang','bar hang']],
 ['Hollow hold','seconds',['hollow','hollow holds','hollow body hold']],
 ['Wall sit','seconds',['wall sits','wall sit hold']],
 ['L-sit','seconds',['l sit','l-sits','l sits']],
 ['Handstand hold','seconds',['handstand holds','hs hold','wall handstand hold']],
 ['Farmer carry','seconds',['farmers carry','farmer walk','farmers walk','farmer hold','farmers hold','carry','carries']],
 ['Suitcase carry','seconds',['suitcase carries']],
 ['Overhead carry','seconds',['oh carry','overhead carries','waiter carry']],
 ['Sled push','seconds',['sled pushes','prowler','prowler push']],
 ['Sled drag','seconds',['sled drags']],
 /* cardio */
 ['Cardio','seconds',['cardio of choice','bike','assault bike','echo bike','air bike','ski','ski erg','skierg','row erg','rower','erg','run','running','jog','treadmill','skip','skipping','jump rope','double unders','singles','shuttle runs','shuttles']],
 ['Bike (calories)','reps',['cal bike','cals bike','bike cals','cal assault bike','cal echo bike']],
 ['Row (calories)','reps',['cal row','cals row','row cals']],
 ['Ski (calories)','reps',['cal ski','cals ski','ski cals']],
 ['Run (metres)','reps',['m run','metre run','meter run']],
 ['Row (metres)','reps',['m row','metre row','meter row']]
];
const IMP_ALIAS={};
IMP_LIB_RAW.forEach(e=>{IMP_ALIAS[e[0].toLowerCase()]={name:e[0],mode:e[1]};e[2].forEach(a=>{IMP_ALIAS[a]={name:e[0],mode:e[1]};});});
function impLex(){const l=DB.settings.lexicon;return (l&&typeof l==='object')?{kw:l.kw||{},ex:l.ex||{}}:{kw:{},ex:{}};}
function impLearnWord(word,meaning){const l=impLex();l.kw[word]=meaning;DB.settings.lexicon=l;save();}
function impLearnMove(alias,name,mode){const l=impLex();l.ex[alias.toLowerCase()]={name,mode};DB.settings.lexicon=l;save();}
function impUnlearn(type,key){const l=impLex();delete l[type][key];DB.settings.lexicon=l;save();if(CURRENT==='import')renderImport();}
function impEdit(a,b){const m=a.length,n=b.length,d=[];for(let i=0;i<=m;i++)d[i]=[i];for(let j=0;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n];}
function impLookup(phrase){
  const p=phrase.toLowerCase().trim().replace(/[.,:]+$/,'');if(!p)return null;
  const lex=impLex();
  if(lex.ex[p])return{name:lex.ex[p].name,mode:lex.ex[p].mode,learned:true};
  if(IMP_ALIAS[p])return{name:IMP_ALIAS[p].name,mode:IMP_ALIAS[p].mode};
  if(p.slice(-1)==='s'&&IMP_ALIAS[p.slice(0,-1)])return{name:IMP_ALIAS[p.slice(0,-1)].name,mode:IMP_ALIAS[p.slice(0,-1)].mode};
  let best=null,bd=99;
  for(const k in IMP_ALIAS){if(Math.abs(k.length-p.length)>2)continue;const dd=impEdit(k,p);if(dd<bd){bd=dd;best=k;}}
  for(const k in lex.ex){if(Math.abs(k.length-p.length)>2)continue;const dd=impEdit(k,p);if(dd<bd){bd=dd;best=k;}}
  if(best&&bd<=1){const hit=IMP_ALIAS[best]||lex.ex[best];return{name:hit.name,mode:hit.mode,fuzzy:true};}
  return null;
}
const IMP_HEADINGS=/^(warm[\s-]?up|warmup|cool[\s-]?down|cooldown|finisher|accessor(y|ies)|main|strength|conditioning|power primer|primer|prep|core|circuit|metcon|for time|for reps|rft|chipper|buy[\s-]?in|cash[\s-]?out|part [a-d]|block \d|section)\b/i;
const IMP_PROSE_RX=/\b(the|your|you|they|is|are|was|were|be|been|before|after|with|that|this|which|while|need|needs|select|matches|contains|including|broken|because|should|would|could|about|between|than|then|when|where|into a)\b/i;
/* A movement line has a number, a rep scheme, or matches the library.
   A line with none of those that reads like a sentence is prose (a note). */
function impLooksProse(line,lower){
  if(/\d/.test(line))return false;                 // any number → treat as workout data
  const words=line.split(/\s+/).filter(Boolean).length;
  if(words<3)return false;                          // short → probably a movement name
  const clean=lower.replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
  if(impLookup(clean)||impLookup(clean.replace(/^\d+\s+/,'')))return false; // known movement
  if(IMP_HEADINGS.test(lower))return false;         // section heading
  return IMP_PROSE_RX.test(lower);                  // reads like a sentence → prose/note
}
function impRpe(lower){const m=lower.match(/@?\s*rpe\s*(\d\d?)/)||lower.match(/@\s*(\d\d?)\b/);return m?+m[1]:0;}
function impTitle(s){return s.replace(/\b\w/g,c=>c.toUpperCase());}
let IMP_ISSUE_ID=0;
function impParse(text){
  const lines=text.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const wk={name:'Imported workout',blocks:[],issues:[],notes:[]};
  let cur=null,lastMarker='';
  const newBlock=(h,opts)=>{cur=Object.assign({heading:h||'Main',format:'',rounds:0,rest:0,superset:false,exercises:[]},opts||{});wk.blocks.push(cur);return cur;};
  const ensure=()=>cur||newBlock('Main');
  const issue=o=>{o.id=++IMP_ISSUE_ID;o.resolved=false;wk.issues.push(o);return o;};
  const lex=impLex();
  let noteMode=false,pendingReps=null;
  lines.forEach((raw,idx)=>{
    let line=raw.replace(/^[\-•\*]+\s*/,'').trim();
    let lowr=line.toLowerCase();
    // Coaching notes: once we see a "Note/Stimulus/Scaling/Coach" header,
    // everything after is prose — keep it as a note, never an exercise.
    if(/^(effort\s+)?note|^notes\b|^stimulus|^scaling|^coach|^strategy/i.test(lowr)){noteMode=true;
      const after=line.replace(/^[^:]*:\s*/,'');if(after&&after!==line)wk.notes.push(after);return;}
    if(noteMode){wk.notes.push(line);return;}
    // Prose rejection: a line with no numbers that reads like a sentence
    // (contains function words, or is long) is a note — not a movement.
    if(impLooksProse(line,lowr)){wk.notes.push(line);return;}
    const mk=line.match(/^([a-d])\s?(\d)[).:\s]\s*/i)||line.match(/^(\d)([a-d])[).:\s]\s*/i);
    if(mk){const letter=(/[a-d]/i.test(mk[1])?mk[1]:mk[2]).toLowerCase();
      if(letter===lastMarker&&cur){cur.superset=true;if(!cur.format)cur.format='superset';}
      else if(cur&&cur.exercises.length){newBlock('Block '+letter.toUpperCase());}
      lastMarker=letter;line=line.replace(mk[0],'').trim();}
    let lower=line.toLowerCase();
    if(/^day\s*\d/.test(lower)&&idx>0){wk.notes.push('Looks like more than one day — import each day separately for now.');return;}
    if(idx===0&&!/\d/.test(line)&&line.split(' ').length<=5&&!IMP_HEADINGS.test(line)&&!impLookup(line)){wk.name=impTitle(line);return;}
    const emom=lower.match(/^emom\s*(\d+)/),amrap=lower.match(/^amrap\s*(\d+)/);
    if(emom){newBlock('EMOM',{format:'EMOM · '+emom[1]+' min'});return;}
    if(amrap){newBlock('AMRAP',{format:'AMRAP · '+amrap[1]+' min'});return;}
    const thenRounds=lower.match(/^then\s+(\d+)\s*rounds?/);
    if(thenRounds){newBlock('Circuit',{superset:true,rounds:+thenRounds[1],format:thenRounds[1]+' rounds'});return;}
    const rounds=lower.match(/(\d+)\s*rounds?(\s+of\s+that)?/);
    let intoNew=false;if(/^into\b/.test(lower)){intoNew=true;line=line.replace(/^into\s+/i,'');lower=line.toLowerCase();}
    const rm=lower.match(/\b(rest|test|rst|reset)\s*(\d+)\s*(s|sec|secs|min|mins|m)?\b/);
    let restVal=0,typo=null;
    if(rm){restVal=+rm[2]*((/min|m$/).test(rm[3]||'')?60:1);
      if(rm[1]!=='rest'&&lex.kw[rm[1]]!=='rest')typo=rm[1];
      line=line.replace(rm[0],'').replace(/between (sets?|rounds?)/i,'').trim();lower=line.toLowerCase();}
    if(!line&&restVal&&cur&&cur.exercises.length){const le=cur.exercises[cur.exercises.length-1];le.rest=restVal;
      if(typo)issue({kind:'typo',ref:le,word:typo,rest:restVal});return;}
    if(!line&&restVal&&cur){cur.rest=restVal;if(typo)issue({kind:'typo',ref:cur,word:typo,rest:restVal});return;}
    const scheme=lower.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
    const headWithScheme=IMP_HEADINGS.test(lower)&&scheme&&!impLookup(lower.replace(/\d+\s*x\s*\d+(\s*-\s*\d+)?/,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim());
    const isHeading=IMP_HEADINGS.test(lower)&&!scheme&&!impLookup(lower.replace(/\d.*$/,'').trim());
    if(isHeading&&!intoNew){
      newBlock(impTitle(line).replace(/Warm ?Up/i,'Warm-up').replace(/Cool ?Down/i,'Cool-down'));
      if(rounds){cur.rounds=+rounds[1];cur.format=rounds[1]+' rounds';cur.superset=true;}
      if(restVal)cur.rest=restVal;return;}
    if(intoNew)newBlock('Circuit',{superset:true});
    // A lone rep scheme / ladder with no movement ("18-16-14-12-10", "5x5")
    // belongs to the movement on the next line — hold it and attach.
    const bareLadder=lower.match(/^\d+(?:\s*-\s*\d+){2,}$/)||lower.match(/^\d+\s*x\s*\d+$/);
    if(bareLadder&&!impLookup(lower.replace(/[\d\sx-]/g,'').trim())){
      const parts=lower.split(/\s*[x-]\s*/).map(Number).filter(n=>Number.isFinite(n));
      pendingReps=/x/.test(lower)?{sets:parts[0],reps:parts[1]}:{sets:parts.length,reps:parts[0],varied:parts};
      return;}
    if(headWithScheme){
      const hz=impTitle(line.replace(/\d+\s*x\s*\d+.*/i,'').trim());
      newBlock(hz);
      const exH={name:'',mode:'reps_kg',sets:+scheme[1],reps:+scheme[2],range:scheme[3]?scheme[2]+'-'+scheme[3]:'',rpe:impRpe(lower),rest:restVal};
      cur.exercises.push(exH);
      issue({kind:'nameOrSection',ref:exH,block:hz,blockObj:cur});
      if(typo)issue({kind:'typo',ref:exH,word:typo,rest:restVal});
      return;}
    const ex=impParseExercise(line,lower,issue);
    if(!ex){if(line)issue({kind:'unreadable',text:raw});return;}
    ensure();if(restVal)ex.rest=restVal;
    // apply a held rep scheme from the previous line if this movement had none
    if(pendingReps&&ex.sets===1&&!ex.reps&&!ex.secs){ex.sets=pendingReps.sets;ex.reps=pendingReps.reps;if(pendingReps.varied)ex.varied=pendingReps.varied;}
    pendingReps=null;
    if(typo)issue({kind:'typo',ref:ex,word:typo,rest:restVal});
    cur.exercises.push(ex);
    if(rounds&&!thenRounds){cur.rounds=+rounds[1];cur.format=rounds[1]+' rounds';cur.superset=true;if(restVal)cur.rest=restVal;}
  });
  wk.blocks=wk.blocks.filter(b=>b.exercises.length);
  return wk;
}
function impParseExercise(line,lower,issue){
  const rpe=impRpe(lower);
  const time=lower.match(/(\d+)\s*(s|sec|secs|min|mins)\b/);
  const scheme=lower.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
  // rep ladder: "8,8,6,6" or a descending scheme "18-16-14-12-10"
  const list=lower.match(/\b(\d+(?:\s*,\s*\d+){2,})\b/)||lower.match(/\b(\d+(?:\s*-\s*\d+){2,})\b/);
  const lead=lower.match(/^(\d+)\s+([a-z].*)/);
  const kg=lower.match(/(\d+(?:\.\d+)?)\s*kg/);
  const eachSide=/\b(each side|per side|per leg|per arm|e\/s|ea)\b/.test(lower);
  const namePart=line.replace(/@?\s*rpe\s*\d\d?/ig,'').replace(/@\s*\d\d?\b/g,'')
    .replace(/\b\d+(?:\s*-\s*\d+){2,}\b/g,'')
    .replace(/\d+\s*x\s*\d+(\s*-\s*\d+)?/ig,'').replace(/\b\d+(?:\s*,\s*\d+){2,}\b/g,'')
    .replace(/\d+\s*(s|sec|secs|min|mins)\b/ig,'').replace(/\d+(?:\.\d+)?\s*kg/ig,'')
    .replace(/\b(each side|per side|per leg|per arm|e\/s|ea)\b/ig,'')
    .replace(/^\d+\s+/,'').replace(/\d+\s*rounds?.*$/i,'')
    .replace(/[^A-Za-z ()\-/&’']/g,' ').replace(/\s+/g,' ').trim();
  if(!namePart)return null;
  const look=impLookup(namePart);
  const name=look?look.name:impTitle(namePart);
  const mode=look?look.mode:(time?'seconds':'reps');
  const ex={name,mode,rpe,rest:0,eachSide};
  if(list){const arr=list[1].split(/\s*[,-]\s*/).map(Number);ex.sets=arr.length;ex.reps=arr[0];ex.varied=arr;}
  else if(scheme){ex.sets=+scheme[1];ex.reps=+scheme[2];if(scheme[3])ex.range=scheme[2]+'-'+scheme[3];}
  else if(time){ex.sets=1;ex.secs=+time[1]*((/min/).test(time[2])?60:1);if(mode==='reps')ex.mode='seconds';}
  else if(lead){ex.sets=1;ex.reps=+lead[1];}
  else{ex.sets=1;ex.reps=0;}
  if(kg)ex.kg=+kg[1];
  if(!look)issue({kind:'confirmName',ref:ex,raw:namePart,name});
  else if(look.fuzzy)issue({kind:'confirmName',ref:ex,raw:namePart,name,fuzzy:true});
  return ex;
}
/* ---- importer UI ---- */
const IMP={text:'',wk:null,builtAnyway:false,ocrBusy:false,ocrMsg:'',photoUrl:'',listening:false};
function openImport(){IMP.wk=null;IMP.builtAnyway=false;IMP.ocrMsg='';IMP.photoUrl='';go('import');}
function impPending(){return IMP.wk?IMP.wk.issues.filter(i=>!i.resolved):[];}
const IMP_MODE_LABEL={reps_kg:'Reps × kg',reps:'Reps',seconds:'Time',reps_seconds:'Reps × time',amrap:'Max reps',completion:'For time'};
function impTargetStr(ex){
  let s;
  if(ex.mode==='seconds')s=ex.sets+' × '+(ex.secs!=null?ex.secs+'s':'—');
  else if(ex.mode==='amrap')s=ex.sets+' × max reps';
  else if(ex.varied)s=ex.sets+' sets · '+ex.varied.join(', ');
  else s=ex.sets+' × '+(ex.range?ex.range:(ex.reps||'—'));
  if(ex.mode==='reps_kg'&&ex.kg)s+=' @ '+ex.kg+'kg';
  if(ex.eachSide)s+=' each side';
  if(ex.rpe)s+=' · @RPE '+ex.rpe;
  if(ex.rest)s+=' · rest '+(ex.rest%60===0&&ex.rest>=60?(ex.rest/60)+'min':ex.rest+'s');
  return s;
}
function impIssueChip(iss){
  const label=iss.kind==='confirmName'?(iss.fuzzy?('Did you mean '+iss.name+'?'):'New movement — confirm'):
    iss.kind==='typo'?('“'+iss.word+'” → rest?'):
    iss.kind==='nameOrSection'?'Exercise or section?':'Couldn’t read';
  return '<span class="imp-needs">⚑ '+esc(label)+'</span>';
}
function impFixerHtml(iss){
  const id=iss.id;
  if(iss.kind==='confirmName')return '<div class="imp-fixer"><div class="fq">'+(iss.fuzzy?('Did you mean <code>'+esc(iss.name)+'</code>?'):('I don’t know <code>'+esc(iss.raw)+'</code> yet.'))+'</div>'+
    '<div class="fopts"><button data-click="impResolve" data-args="['+id+',&quot;yes&quot;]">'+(iss.fuzzy?'Yes — that’s it':'Add “'+esc(iss.name)+'” to my movements')+'<small>Remembered — won’t ask again</small></button></div>'+
    '<div class="frow"><input id="impIn'+id+'" placeholder="No — correct name…"><button data-click="impResolve" data-args="['+id+',&quot;rename&quot;]">Set</button></div></div>';
  if(iss.kind==='typo')return '<div class="imp-fixer"><div class="fq">You wrote <code>'+esc(iss.word)+' '+iss.rest+'s</code> — read it as <code>rest '+iss.rest+'s</code>?</div>'+
    '<div class="fopts"><button data-click="impResolve" data-args="['+id+',&quot;yes&quot;]">Yes — and remember “'+esc(iss.word)+'” = rest<small>Your spelling, learned</small></button>'+
    '<button data-click="impResolve" data-args="['+id+',&quot;no&quot;]">No — drop it</button></div></div>';
  if(iss.kind==='nameOrSection')return '<div class="imp-fixer"><div class="fq">Is <code>'+esc(iss.block)+'</code> the exercise itself, or a section?</div>'+
    '<div class="fopts"><button data-click="impResolve" data-args="['+id+',&quot;isex&quot;]">It’s the exercise<small>Use the name as the movement (remembered)</small></button></div>'+
    '<div class="frow"><input id="impIn'+id+'" placeholder="It’s a section — movement is…"><button data-click="impResolve" data-args="['+id+',&quot;setmove&quot;]">Set</button></div>'+
    '<div class="fnote">Named here for <b>this workout only</b> — “'+esc(iss.block)+'” stays a section, so next time it can hold something else.</div></div>';
  if(iss.kind==='unreadable')return '<div class="imp-fixer"><div class="fq">Couldn’t read <code>'+esc(iss.text)+'</code>.</div>'+
    '<div class="fopts"><button data-click="impResolve" data-args="['+id+',&quot;skip&quot;]">Skip it</button></div></div>';
  return '';
}
function renderImport(){
  const el=document.getElementById('s-import');if(!el)return;
  let h='<div class="backrow"><button class="backbtn" aria-label="Back" data-click="go" data-args="[&quot;builder&quot;]">←</button><div><div class="kicker" style="margin-bottom:3px">Builder · Import</div><h1 style="font-size:24px">Add a workout</h1></div></div>'+
    '<p class="sub">Type it, paste it, or attach a photo/screenshot — any style, typos welcome. It asks only when a <b>meaning</b> is unclear; blank weights and reps just stay blank, like always.</p>'+
    '<textarea class="imp-src" id="impSrc" spellcheck="false" placeholder="e.g.&#10;Push Day&#10;Bench 4x8 @RPE8 rest 3min&#10;into 5 deadlifts&#10;10s dead hang rest 30s 2 rounds of that">'+esc(IMP.text)+'</textarea>'+
    '<div class="imp-inputs">'+
      '<button class="addbtn imp-in" data-click="impVoice">'+(IMP.listening?'⏹ Stop':'🎤 Say it')+'</button>'+
      '<button class="addbtn imp-in" data-click="impPickPhoto">📷 Photo</button>'+
    '</div>'+
    '<input type="file" id="impFile" accept="image/*" style="display:none" data-change="impPhoto" data-args="[&quot;@event&quot;]">'+
    (IMP.listening?'<div class="imp-listen"><span class="dot"></span>Listening… say your workout, then tap Stop.</div>':'')+
    '<div class="imp-photo'+(IMP.photoUrl||IMP.ocrBusy||IMP.ocrMsg?' on':'')+'" id="impPhotoBox">'+
      (IMP.photoUrl?'<img src="'+IMP.photoUrl+'" alt="">':'')+
      '<div class="pt2">'+(IMP.ocrBusy?'<b>Reading your photo on this device…</b> '+esc(IMP.ocrMsg)+'<div class="imp-scan"></div>':(IMP.ocrMsg?esc(IMP.ocrMsg):''))+'</div></div>'+
    '<button class="bigbtn" style="margin-top:14px" data-click="impRead">Read my workout →</button>'+
    '<div id="impOut">'+impDraftHtml()+'</div>'+impLexHtml();
  el.innerHTML=h;
  const ta=document.getElementById('impSrc');
  if(ta)ta.addEventListener('input',()=>{IMP.text=ta.value;},{once:false});
}
function impDraftHtml(){
  if(!IMP.wk)return '';
  const wk=IMP.wk,pend=impPending();
  let h='';
  if(pend.length&&!IMP.builtAnyway)h+='<div class="imp-state warn"><span>⚑</span><span class="grow">'+pend.length+' thing'+(pend.length===1?'':'s')+' need'+(pend.length===1?'s':'')+' you — fix in place below</span><button data-click="impAnyway">Build anyway</button></div>';
  else h+='<div class="imp-state okay"><span>✓</span><span class="grow">'+(wk.issues.length?'All sorted — template ready':'Read cleanly — nothing to check')+'</span></div>';
  h+='<div style="margin-top:10px;font-size:13px;color:var(--muted)">Template: <b style="color:var(--text)">'+esc(wk.name)+'</b></div>';
  wk.blocks.forEach(b=>{
    const meta=[];if(b.format)meta.push(b.format);if(b.rest)meta.push('rest '+b.rest+'s');if(b.superset&&!b.format)meta.push('superset');
    h+='<div class="card" style="margin-top:14px;overflow:hidden"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:12px 14px 6px"><b style="font-size:13px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--gold2)">'+esc(b.heading)+'</b><span style="font-size:11px;color:var(--dim)">'+esc(meta.join(' · '))+'</span></div>';
    b.exercises.forEach(e=>{
      h+='<div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,.04)"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1"><b style="font-size:14.5px;font-weight:750">'+(e.name?esc(e.name):'<span style="color:#d8a24a">Movement — name it below</span>')+'</b><p style="margin-top:2px;color:var(--muted);font-size:12px">'+esc(impTargetStr(e))+'</p></div><span class="chip">'+IMP_MODE_LABEL[e.mode]+'</span></div>';
      wk.issues.forEach(iss=>{if(iss.ref===e)h+=iss.resolved?'<span class="imp-needs done">✓ sorted</span>':impIssueChip(iss)+impFixerHtml(iss);});
      h+='</div>';
    });
    h+='</div>';
  });
  wk.issues.filter(i=>!i.resolved&&i.kind==='unreadable').forEach(iss=>{h+='<div class="card" style="margin-top:14px;padding:12px 14px">'+impIssueChip(iss)+impFixerHtml(iss)+'</div>';});
  if(wk.notes.length)h+='<div style="margin-top:12px;color:var(--dim);font-size:11.5px;line-height:1.6">'+wk.notes.map(esc).join('<br>')+'</div>';
  const ready=!pend.length||IMP.builtAnyway;
  h+='<button class="bigbtn" style="margin-top:16px'+(ready?'':';opacity:.35;pointer-events:none')+'" data-click="impSave">'+(ready?'Save & open in Builder':'Save — '+pend.length+' to sort first')+'</button>';
  return h;
}
function impLexHtml(){
  const lex=impLex();let items='';let n=0;
  Object.keys(lex.kw).forEach(k=>{n++;items+='<div class="li"><i></i><code>'+esc(k)+'</code> → '+esc(lex.kw[k])+'<span class="tag">word</span><button class="rm" data-click="impUnlearn" data-args="[&quot;kw&quot;,&quot;'+esc(k)+'&quot;]">✕</button></div>';});
  Object.keys(lex.ex).forEach(k=>{n++;items+='<div class="li"><i></i><code>'+esc(k)+'</code> → '+esc(lex.ex[k].name)+'<span class="tag">movement</span><button class="rm" data-click="impUnlearn" data-args="[&quot;ex&quot;,&quot;'+esc(k)+'&quot;]">✕</button></div>';});
  return '<div class="imp-lex"><div class="lh">Your lexicon · learns from your fixes · tap ✕ to unlearn</div>'+(n?items:'<div class="empty">Empty so far. Every fix you confirm becomes a permanent rule — your abbreviations, your spellings, your movements. Chatty the first week, then it goes quiet.</div>')+'</div>';
}
function impRead(){
  const ta=document.getElementById('impSrc');IMP.text=ta?ta.value:IMP.text;
  if(!IMP.text.trim()){alert('Type, paste, or attach a photo first.');return;}
  IMP.builtAnyway=false;IMP.wk=impParse(IMP.text.trim());renderImport();
  const out=document.getElementById('impOut');if(out)out.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function impAnyway(){IMP.builtAnyway=true;renderImport();}
function impResolve(id,action){
  const iss=IMP.wk&&IMP.wk.issues.find(i=>i.id===id);if(!iss)return;
  const inp=document.getElementById('impIn'+id);const val=inp?inp.value.trim():'';
  if(iss.kind==='confirmName'){
    if(action==='yes')impLearnMove(iss.raw,iss.name,iss.ref.mode);
    else if(action==='rename'){if(!val){alert('Type the correct name (or tap Yes).');return;}iss.ref.name=impTitle(val);impLearnMove(iss.raw,iss.ref.name,iss.ref.mode);}
  }else if(iss.kind==='typo'){
    if(action==='yes')impLearnWord(iss.word,'rest');else iss.ref.rest=0;
  }else if(iss.kind==='nameOrSection'){
    if(action==='isex'){iss.ref.name=iss.block;iss.blockObj.heading='Main';impLearnMove(iss.block,iss.block,iss.ref.mode);}
    else if(action==='setmove'){if(!val){alert('Type the movement name.');return;}iss.ref.name=impTitle(val);
      if(!impLookup(val))impLearnMove(val,iss.ref.name,iss.ref.mode);}
  }
  iss.resolved=true;renderImport();
}
function impSave(){
  const wk=IMP.wk;if(!wk)return;
  const w={id:uid(),name:wk.name,days:[],blocks:wk.blocks.map(b=>({
    id:uid(),heading:b.heading,minutes:'',format:b.format,superset:!!b.superset,
    exercises:b.exercises.map(e=>{
      const rest=e.rest||b.rest||0;
      const mkT=(i)=>{
        let t;
        if(e.mode==='seconds')t=e.secs!=null?String(e.secs):'';
        else if(e.mode==='amrap')t='max';
        else if(e.varied)t=String(e.varied[Math.min(i,e.varied.length-1)]);
        else t=e.range?e.range:(e.reps?String(e.reps):'');
        if(e.kg&&e.mode==='reps_kg'&&t)t+=' @'+e.kg+'kg';
        if(e.eachSide&&t)t+=' e/s';
        return t;
      };
      const n=Math.max(1,e.sets||1);
      return{id:uid(),name:e.name||'Movement',mode:e.mode,tempo:'',rest,
        sets:Array.from({length:n},(_,i)=>({t:mkT(i),rpe:e.rpe?String(e.rpe):''}))};
    })
  }))};
  DB.workouts.push(w);save();
  IMP.wk=null;IMP.text='';
  editWorkout(w.id);
}
/* ---- voice input: browser speech recognition → the same parser ---- */
let IMP_REC=null,IMP_BASE='';
const IMP_NUM={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100};
function impNumberWords(s){
  return s
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/gi,(m,a,b)=>IMP_NUM[a.toLowerCase()]+IMP_NUM[b.toLowerCase()])
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred\b/gi,(m,a)=>IMP_NUM[a.toLowerCase()]*100)
    .replace(/\b(a|one)\s+hundred\b/gi,'100')
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi,m=>IMP_NUM[m.toLowerCase()]);
}
function impTidySpoken(s){
  return impNumberWords(' '+s+' ')
    .replace(/\bby\b/gi,'x')                       // "four by eight" → 4x8
    .replace(/\b(?:at\s+)?@?\s*rpe\s*(\d\d?)/gi,'@RPE $1')
    .replace(/\bat\s+(?=\d)/gi,' ')                // "at 100 kg" → "100 kg"
    .replace(/\b(kilos?|kilograms?)\b/gi,'kg')
    .replace(/(\d)\s+kg\b/gi,'$1kg')
    .replace(/\bseconds?\b/gi,'s').replace(/\bminutes?\b/gi,'min').replace(/\bmins?\b/gi,'min')
    .replace(/\b(\d+)\s*s\b/gi,'$1s').replace(/\b(\d+)\s*min\b/gi,'$1min')
    .replace(/\breps?\b/gi,'')                      // "8 reps" → "8"
    .replace(/\bsuperset(ted)?\s+with\b/gi,'\nA2 ')
    .replace(/\s+/g,' ').trim();
}
const IMP_UNIT_RX=/^(x|s|sec|secs|min|mins|m|kg|kilos?|rounds?|reps?|rpe|rest|cals?|calories|seconds?|minutes?|met(?:er|re)s?|each|per|at|by|to|of)$/i;
function impSplitSpoken(s){
  // Break a spoken run into lines at natural workout boundaries, then before
  // each "<number> <movement>" so run-on dictation still separates.
  return impTidySpoken(s)
    .replace(/\s+(into|then|next|after that|followed by)\s+/gi,'\n')
    .replace(/\s*,\s*/g,'\n')
    .replace(/(\S)\s+(\d+)\s+([a-z][a-z-]+)/gi,(m,pre,n,w)=>IMP_UNIT_RX.test(w)?m:(pre+'\n'+n+' '+w))
    .split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
}
function impHasNativeVoice(){try{return !!(window.AndroidVoice&&typeof window.AndroidVoice.start==='function');}catch(e){return false;}}
function impVoice(){
  if(IMP.listening){impVoiceStop();return;}
  const ta=document.getElementById('impSrc');IMP.text=ta?ta.value:IMP.text;
  IMP_BASE=IMP.text?IMP.text.replace(/\s+$/,'')+'\n':'';
  if(impHasNativeVoice()){
    try{window.AndroidVoice.start();IMP.listening=true;IMP.ocrMsg='';renderImport();}
    catch(e){IMP.ocrMsg='Could not start voice: '+String(e&&e.message||e);renderImport();}
    return;
  }
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){IMP.ocrMsg='Voice needs Chrome or the installed app — this browser has no speech recognition. You can still type or paste.';renderImport();return;}
  try{
    IMP_REC=new SR();IMP_REC.lang='en-US';IMP_REC.continuous=true;IMP_REC.interimResults=true;
    IMP_REC.onresult=e=>{
      let said='';for(let i=0;i<e.results.length;i++)said+=e.results[i][0].transcript+' ';
      IMP.text=IMP_BASE+impSplitSpoken(said);
      const t=document.getElementById('impSrc');if(t){t.value=IMP.text;t.scrollTop=t.scrollHeight;}
    };
    IMP_REC.onerror=ev=>{IMP.listening=false;IMP_REC=null;IMP.ocrMsg=ev&&ev.error==='not-allowed'?'Microphone permission was refused.':'Voice error: '+(ev&&ev.error||'unknown');renderImport();};
    IMP_REC.onend=()=>{if(IMP.listening){IMP.listening=false;renderImport();}};
    IMP_REC.start();IMP.listening=true;IMP.ocrMsg='';renderImport();
  }catch(e){IMP.listening=false;IMP_REC=null;IMP.ocrMsg='Could not start voice: '+String(e&&e.message||e);renderImport();}
}
function impVoiceStop(){
  IMP.listening=false;
  try{if(impHasNativeVoice())window.AndroidVoice.stop();}catch(e){}
  try{if(IMP_REC)IMP_REC.stop();}catch(e){}
  IMP_REC=null;renderImport();
}
/* callbacks from the native speech bridge */
function impNativeVoicePartial(text){
  if(!IMP.listening)return;
  IMP.text=IMP_BASE+impSplitSpoken(String(text||''));
  const t=document.getElementById('impSrc');if(t){t.value=IMP.text;t.scrollTop=t.scrollHeight;}
}
function impNativeVoiceFinal(text){
  IMP_BASE=(IMP_BASE+impSplitSpoken(String(text||''))).replace(/\s+$/,'')+'\n';
  IMP.text=IMP_BASE.replace(/\n$/,'');
  const t=document.getElementById('impSrc');if(t)t.value=IMP.text;
}
function impNativeVoiceEnd(){if(IMP.listening){IMP.listening=false;renderImport();}}
function impNativeVoiceErr(msg){IMP.listening=false;IMP.ocrMsg=(msg==='denied')?'Microphone permission was refused.':'Voice error: '+(msg||'unknown');renderImport();}
function impHasNativeOcr(){try{return !!(window.AndroidOCR&&typeof window.AndroidOCR.scan==='function');}catch(e){return false;}}
function impPickPhoto(){
  // Installed app: native ML Kit reads the photo (faster, more accurate,
  // immune to WebView WASM quirks). Browsers fall back to tesseract.js.
  if(impHasNativeOcr()){
    IMP.ocrMsg='';IMP.wk=null;
    try{window.AndroidOCR.scan();}catch(e){IMP.ocrMsg='Could not open the photo picker.';renderImport();}
    return;
  }
  const f=document.getElementById('impFile');if(f)f.click();
}
/* callbacks from the native OCR bridge */
function impNativeOcrBusy(){IMP.photoUrl='';IMP.ocrBusy=true;IMP.ocrMsg='';if(CURRENT==='import')renderImport();}
function impNativeOcr(text){
  IMP.ocrBusy=false;
  const t=String(text||'').split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
  if(!t){IMP.ocrMsg='No text found in that photo — try a clearer shot.';if(CURRENT==='import')renderImport();return;}
  IMP.text=t;IMP.wk=null;
  IMP.ocrMsg='Text extracted ✓ — check it below, fix any misreads, then “Read my workout”.';
  if(CURRENT==='import')renderImport();
}
function impNativeOcrErr(msg){IMP.ocrBusy=false;IMP.ocrMsg='Photo reading failed: '+(msg&&msg!=='null'&&msg!=='undefined'?msg:'unknown error');if(CURRENT==='import')renderImport();}
let IMP_TESS=null;
function impLoadTesseract(){
  if(window.Tesseract)return Promise.resolve();
  if(IMP_TESS)return IMP_TESS;
  IMP_TESS=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='./vendor/tesseract/tesseract.min.js';
    s.onload=()=>res();s.onerror=()=>{IMP_TESS=null;rej(new Error('Could not load the photo reader.'));};
    document.head.appendChild(s);
  });
  return IMP_TESS;
}
async function impPhoto(ev){
  const f=ev.target.files&&ev.target.files[0];if(!f)return;
  try{if(IMP.photoUrl)URL.revokeObjectURL(IMP.photoUrl);}catch(e){}
  IMP.photoUrl=URL.createObjectURL(f);
  IMP.ocrBusy=true;IMP.ocrMsg='(first time downloads the reader, ~7 MB)';renderImport();
  try{
    await impLoadTesseract();
    IMP.ocrMsg='recognising…';renderImport();
    const worker=await Tesseract.createWorker('eng',1,{
      workerPath:'./vendor/tesseract/worker.min.js',
      corePath:'./vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
      langPath:'./vendor/tesseract/',gzip:true
    });
    const {data}=await worker.recognize(f);
    await worker.terminate();
    const text=(data.text||'').split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
    IMP.ocrBusy=false;
    if(!text){IMP.ocrMsg='No text found in that photo — try a clearer shot.';renderImport();return;}
    IMP.text=text;IMP.ocrMsg='Text extracted ✓ — check it below, fix any misreads, then “Read my workout”.';
    IMP.wk=null;renderImport();
  }catch(e){
    IMP.ocrBusy=false;
    const m=(e&&(e.message||(''+e)))||'unknown error';
    IMP.ocrMsg='Photo reading failed: '+m+'. If you are in the installed app, update to the newest APK — it reads photos natively.';
    renderImport();
  }
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
