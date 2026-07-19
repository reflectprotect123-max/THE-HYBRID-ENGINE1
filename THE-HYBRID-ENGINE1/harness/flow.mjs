import { withPage } from './lib.mjs';
const errors = await withPage(async (page)=>{
  const res = await page.evaluate(()=>{
    const log={};
    // ---- Test A: Builder editor stores mode + per-set targets ----
    try{
      newTemplateDirect('strength');
      let bi=draft.blocks.findIndex(b=>b.type==='strength'); if(bi<0){addStrength('Strength');bi=draft.blocks.length-1;}
      exerciseSheet(bi,-1);
      document.getElementById('exName').value='Plank Hold';
      EX_EDIT.mode='seconds'; EX_EDIT.targets=['30','30','45'];
      saveExercise(bi,-1);
      let ex=draft.blocks[bi].exercises.at(-1);
      log.builder={mode:ex.mode,reps:ex.reps,sets:ex.sets};
    }catch(e){log.builder='ERR:'+e.message;}
    // ---- Test B: Logger across all modes ----
    try{
      const mk=(name,mode,sets,reps)=>({id:id(),exerciseId:'',name,category:'Strength',mode,sets,reps,restSec:60,coachNote:name+' cue'});
      const tmpl={id:id(),name:'MODETEST',coachInstructions:'',templateKind:'custom',blocks:[
        {id:id(),type:'strength',heading:'Strength',exercises:[
          mk('RepsKg','reps_kg',2,'5, 5'),
          mk('SecOnly','seconds',2,'30s, 30s'),
          mk('RepsSec','reps_seconds',1,'8'),
          mk('RepsOnly','reps',2,'12, 12'),
          mk('Comp','completion',2,'')
        ]},
        {id:id(),type:'strength',heading:'Superset',superset:true,exercises:[
          mk('SSA','reps_kg',2,'10, 10'), mk('SSB','completion',2,'')
        ]}
      ]};
      S.templates.push(tmpl);
      const sess=makeSession(tmpl,'2026-07-18'); S.sessions.push(sess);
      startSessionNow(sess.id);
      const x=ses(sess.id);
      log.taskKinds=x.tasks.map(t=>t.kind);
      const cols={};
      for(let k=0;k<x.tasks.length;k++){
        x.taskIndex=k; const t=current();
        if(t.kind==='strength'){
          const html=strengthTask(t);
          // capture header spans
          const heads=[...html.matchAll(/<div class=settablehead[^>]*>(.*?)<\/div>/gs)].map(m=>m[1])[0]||'';
          const labels=[...heads.matchAll(/<span>(.*?)<\/span>/g)].map(m=>m[1]);
          cols[t.name]=labels;
          // log each row per mode
          const m=trackMode(exMode(t));
          t.rows.forEach((r,i)=>{
            if(m.id==='reps_kg'){updateSet(i,'reps',5);updateSet(i,'weight',100);}
            else if(m.id==='seconds'){updateSet(i,'seconds',30);}
            else if(m.id==='reps_seconds'){updateSet(i,'reps',8);updateSet(i,'seconds',3);}
            else if(m.id==='reps'){updateSet(i,'reps',12);}
            toggleSet(i);
          });
          completeStrength();
          cols[t.name+'::complete']=t.complete;
        } else if(t.kind==='superset'){
          let guard=0;
          while(supersetCurrent(t)&&guard++<20){
            const it=supersetCurrent(t), ex=t.exercises[it.exIndex], m=trackMode(exMode(ex));
            if(m.id==='reps_kg'){setSupersetValue('reps',10);setSupersetValue('weight',50);}
            logSupersetSet();
          }
          cols['superset::complete']=t.complete;
        }
      }
      log.cols=cols;
      // finish + read summary
      x.taskIndex=x.tasks.length;
      if(typeof finishSession==='function') finishSession();
      const done=S.sessions.find(s=>s.id===sess.id);
      log.summary={status:done.status, tonnage:done.summary&&done.summary.tonnage, sets:done.summary&&done.summary.sets};
    }catch(e){log.logger='ERR:'+e.message+' @ '+(e.stack||'').split('\n')[1];}
    return log;
  });
  console.log(JSON.stringify(res,null,2));
});
console.log('CONSOLE ERRORS:', errors.length, errors.slice(0,10));
