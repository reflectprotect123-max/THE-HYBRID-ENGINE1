import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = process.env.APP_ROOT || path.resolve('build');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};
export function serve(root=ROOT){
  const srv=http.createServer((req,res)=>{
    let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
    let fp=path.join(root,p);
    fs.readFile(fp,(e,buf)=>{ if(e){res.writeHead(404);res.end('nf');return;}
      res.writeHead(200,{'content-type':MIME[path.extname(fp)]||'application/octet-stream'}); res.end(buf); });
  });
  return new Promise(r=>srv.listen(0,()=>r({srv,port:srv.address().port})));
}
export async function withPage(fn){
  const {srv,port}=await serve();
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:390,height:840}});
  const page=await ctx.newPage();
  const errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  await page.goto('http://localhost:'+port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(600);
  try{ await fn(page,errors); } finally { await browser.close(); srv.close(); }
  return errors;
}
