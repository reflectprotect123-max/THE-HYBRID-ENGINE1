import { withPage } from './lib.mjs';
import fs from 'fs';
const raw = JSON.parse(fs.readFileSync('/home/claude/thproject/THE-hybrid-top100-import.json','utf8'));
const errors = await withPage(async (page)=>{
  await page.evaluate((raw)=>{
    window.__r=mergeImportPayload(extractImportPayload(raw));
    newTemplateDirect('strength');
    let bi=draft.blocks.findIndex(b=>b.type==='strength'); if(bi<0){addStrength('Strength');bi=draft.blocks.length-1;}
    exerciseSheet(bi,-1);
  }, raw);
  await page.waitForTimeout(80);
  const res = await page.evaluate(()=>{
    const groups=[...document.querySelectorAll('#exPick optgroup')].map(g=>g.label+' ('+g.querySelectorAll('option').length+')');
    const firstSquat=[...document.querySelectorAll('#exPick optgroup')][0]?.querySelector('option')?.value;
    closeSheet();
    // calendar card meta on a day with sessions
    S.selected='2026-07-13'; calendar();
    const cardText=document.querySelector('#appScreen').innerText;
    const has0000=/00:00/.test(cardText), has0kg=/\b0 kg/.test(cardText);
    const julyCard=cardText.split('\n').filter(l=>/kg|sets|COMPLETED/.test(l)).slice(0,4);
    const s0=performance.now(); save(); const saveMs=Math.round(performance.now()-s0);
    let mem; try{ mem=lastRows('','Bench Press').slice(0,3).map(x=>x.weight+'x'+x.reps);}catch(e){mem='ERR';}
    return {added:__r, groups, firstSquat, has0000, has0kg, julyCard, saveMs,
      stateKB:Math.round(((localStorage.getItem(Object.keys(localStorage)[0])||'').length)/1024), benchMem:mem};
  });
  console.log(JSON.stringify(res,null,2));
});
console.log('CONSOLE ERRORS:', errors.length, errors.slice(0,6));
