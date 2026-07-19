import { withPage } from './lib.mjs';
const errors = await withPage(async (page)=>{
  const res = await page.evaluate(()=>{
    const log={};
    const mk=(name,mode,sets,reps)=>({id:id(),exerciseId:'',name,category:'Strength',mode,sets,reps,restSec:60,coachNote:name+' CUE'});
    // Builder round-trip: create seconds exercise, save, re-open, check editor state
    try{
      newTemplateDirect('strength');
      let bi=draft.blocks.findIndex(b=>b.type==='strength'); if(bi<0){addStrength('Strength');bi=draft.blocks.length-1;}
      draft.blocks[bi].exercises.push(mk('Row Hold','reps_seconds',2,'10, 10'));
      // reopen editor for it
      exerciseSheet(bi,0);
      log.roundtrip={mode:EX_EDIT.mode, targets:EX_EDIT.targets.slice(), modeSelect:document.getElementById('exMode')?.value, setRows:document.querySelectorAll('#exSetRows .exsetrow').length};
      // completion builder rows show no inputs
      changeExMode('completion');
      log.completionRows={rows:document.querySelectorAll('#exSetRows .exsetrow').length, inputs:document.querySelectorAll('#exSetRows .exsetrow input').length};
      closeSheet();
    }catch(e){log.builder='ERR:'+e.message;}
    // Logger: instruction header + superset overview + completion gating
    try{
      const tmpl={id:id(),name:'DET',templateKind:'custom',blocks:[
        {id:id(),type:'strength',heading:'Strength',exercises:[mk('BackSquat','reps_kg',1,'5')]},
        {id:id(),type:'strength',heading:'Superset',superset:true,exercises:[mk('SSA','reps_kg',1,'10'),mk('SSB','completion',1,'')]}
      ]};
      S.templates.push(tmpl);
      const sess=makeSession(tmpl,'2026-07-18'); S.sessions.push(sess); startSessionNow(sess.id);
      const x=ses(sess.id);
      x.taskIndex=0; const st=current(); const shtml=strengthTask(st);
      log.instruction=/runnerinstruction/.test(shtml) && /BackSquat CUE/.test(shtml);
      // superset task
      x.taskIndex=1; const ss=current(); const sshtml=supersetTask(ss);
      log.superOverview=/superoverview/.test(sshtml);
      // current superset exercise is SSA(reps_kg) -> has Weight+Reps inputs
      log.superFirstInputs=(sshtml.match(/setSupersetValue/g)||[]).length;
      // advance SSA, then SSB should show completion message
      setSupersetValue('reps',10);setSupersetValue('weight',40);logSupersetSet();
      const sshtml2=supersetTask(current());
      log.superCompletionMsg=/For completion/.test(sshtml2);
    }catch(e){log.logger='ERR:'+e.message;}
    return log;
  });
  console.log(JSON.stringify(res,null,2));
});
console.log('CONSOLE ERRORS:', errors.length, errors.slice(0,10));
