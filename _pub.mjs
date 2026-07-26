import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
const root=resolve('.');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff2':'font/woff2','.json':'application/json'};
const srv=createServer(async(req,res)=>{try{let p=join(root,decodeURIComponent(req.url.split('?')[0]));if(p.endsWith('/'))p=join(p,'index.html');const b=await readFile(p);res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end('nf');}});
await new Promise(r=>srv.listen(0,r));
const base='http://127.0.0.1:'+srv.address().port;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const errs=[];
// 1) build the snapshot in the coach page
const c=await b.newPage({viewport:{width:1440,height:900}});
c.on('pageerror',e=>errs.push('coach: '+e.message));
await c.goto(base+'/coach/'); await c.waitForTimeout(800);
// give an exercise a cue so we can prove it transmits
await c.click('[data-act="open"][data-b="0"][data-e="0"]'); await c.waitForTimeout(250);
await c.fill('[data-act="cue"][data-b="0"][data-e="0"]','Work up to 120kg. Belt on for the last two.');
const snap=await c.evaluate(()=>{
  // reach the conversion the assign flow uses
  const f=Object.getOwnPropertyNames(window).length; // no-op, keeps eval honest
  return window.__emitSnapshot ? window.__emitSnapshot() : null;
});
await b.close(); srv.close();
console.log(JSON.stringify({snap,errs}));
