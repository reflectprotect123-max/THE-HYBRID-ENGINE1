// Seeds a realistic DB and screenshots the main screens. Usage: node checks/_shots.mjs <label>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
const label = process.argv[2] || 'shot';
const root = resolve('.');
const M={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const s=createServer(async(q,r)=>{try{const p=decodeURIComponent(new URL(q.url,'http://x').pathname);let f=normalize(join(root,p==='/'?'index.html':p));if(!f.startsWith(root)||!existsSync(f)){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':M[extname(f)]||'application/octet-stream'});r.end(await readFile(f));}catch(e){r.writeHead(500);r.end(String(e));}});
await new Promise(k=>s.listen(0,'127.0.0.1',k));const base=`http://127.0.0.1:${s.address().port}`;
let b;try{b=await chromium.launch();}catch{b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});}
const pg=await b.newPage({viewport:{width:412,height:915},deviceScaleFactor:2});
await pg.goto(base+'/',{waitUntil:'networkidle'});
await pg.evaluate(()=>{
  const today=ymd(new Date());
  const mkW=(name,dates,ex)=>({id:uid(),name,days:[],dates,blocks:[{id:uid(),heading:'Main',minutes:'',format:'',superset:false,exercises:ex}]});
  const S=(t,rpe,aVal,aVal2,felt,done)=>({t,rpe,aVal,aVal2,felt,done});
  DB.workouts=[
    mkW('Heavy Lower',[today],[
      {id:uid(),name:'Back squat',mode:'reps_kg',tempo:'30X1',rest:180,sets:[S('5','8'),S('5','8'),S('5','9')]},
      {id:uid(),name:'Romanian deadlift',mode:'reps_kg',tempo:'',rest:120,sets:[S('8','8'),S('8','8')]}]),
    mkW('Heavy Upper',[],[
      {id:uid(),name:'Bench press',mode:'reps_kg',tempo:'',rest:150,sets:[S('5','8'),S('5','8')]},
      {id:uid(),name:'Weighted pull-up',mode:'reps_kg',tempo:'',rest:120,sets:[S('6','8'),S('6','8')]}]),
    {id:uid(),name:'Zone 2 Row',days:[],dates:[],blocks:[newCondBlock()]}
  ];
  // history: a few completed sessions across recent days
  const past=[];
  for(let i=1;i<=6;i++){const d=new Date();d.setDate(d.getDate()-i*2);
    past.push({id:uid(),workoutId:'x',name:i%2?'Heavy Lower':'Heavy Upper',date:ymd(d),status:'completed',completedAt:d.getTime(),startedAt:d.getTime()-3600e3,
      blocks:[{id:uid(),heading:'Main',exercises:[
        {id:uid(),name:'Back squat',mode:'reps_kg',rest:180,sets:[{t:'5',rpe:'8',aVal:String(90+i*2),aVal2:'5',felt:'8',done:true},{t:'5',rpe:'8',aVal:String(90+i*2),aVal2:'5',felt:'8',done:true}]}]}]});
  }
  DB.sessions=past;
  DB.settings.profile={age:30,restingHr:52};
  DB.settings.conditioning=[{id:uid(),fmt:'intervals',date:today,dur:1180,avg:148,max:176,hrr:32,zsec:{low:300,mod:600,high:280},cal:210}];
  DB.settings.whoopDaily=[{date:today,recovery:72,strain:12.4}];
  WHOOP.loaded=true;WHOOP.connected=true;WHOOP.sample={date:today,recoveryScore:72,strain:12.4,hrvMs:64,restingHr:52,sleepPerformance:88};
  WHOOP_OPEN=true;
  save();go('home');
});
await pg.waitForTimeout(800);
const shot=async(name)=>{await pg.waitForTimeout(500);await pg.screenshot({path:`/tmp/${label}-${name}.png`});};
await shot('home');
// training (start today's session)
await pg.evaluate(()=>{const w=DB.workouts.find(x=>x.name==='Heavy Lower');startWorkout(w.id);});
await pg.waitForTimeout(400);
await pg.evaluate(()=>{try{openLogger(0,0);}catch(e){}});
await shot('training');
// library
await pg.evaluate(()=>go('library'));await shot('library');
// calendar
await pg.evaluate(()=>{CAL_VIEW=null;go('calendar');});await shot('calendar');
// conditioning
await pg.evaluate(()=>{if(!CON.live){CON.sink={scope:'standalone'};CON.targetZone='mod';CON.view='setup';}go('conditioning');});await shot('conditioning');
// progress
await pg.evaluate(()=>go('progress'));await shot('progress');
// settings
await pg.evaluate(()=>go('settings'));await shot('settings');
console.log(label+' shots done');
await b.close();s.close();
