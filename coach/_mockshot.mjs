import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const label=process.argv[2]||'mock';
let b;try{b=await chromium.launch();}catch{b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});}
const pg=await b.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errs=[];pg.on('pageerror',e=>errs.push('PAGEERR: '+e.message));pg.on('console',m=>{if(m.type()==='error')errs.push('CON: '+m.text());});
await pg.goto(pathToFileURL(resolve('coach/coach-design-mock.html')).href,{waitUntil:'networkidle'});
await pg.waitForTimeout(500);await pg.screenshot({path:`/tmp/${label}-programs.png`});
await pg.click('.nav button[data-view="library"]').catch(()=>{});await pg.waitForTimeout(400);await pg.screenshot({path:`/tmp/${label}-library.png`});
await pg.click('#sessGrid .lcard').catch(()=>{});await pg.waitForTimeout(500);await pg.screenshot({path:`/tmp/${label}-editor.png`});
await pg.click('#edClose').catch(()=>{});await pg.waitForTimeout(300);
await pg.click('.nav button[data-view="review"]').catch(()=>{});await pg.waitForTimeout(1100);await pg.screenshot({path:`/tmp/${label}-review.png`});
console.log(label,'errors:',errs.length);errs.slice(0,8).forEach(e=>console.log(' ',e));
await b.close();
