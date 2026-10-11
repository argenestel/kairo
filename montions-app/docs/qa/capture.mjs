import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
const out=resolve('docs/screens');
await fs.mkdir(out,{recursive:true});
for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
 const page=await browser.newPage(); await page.setViewport({width,height,deviceScaleFactor:1});
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.goto('http://127.0.0.1:5180/?chain=mock',{waitUntil:'networkidle0'});
 for(let step=1;step<=6;step++) {
 await new Promise(r=>setTimeout(r,step===6?2800:900));
 await page.screenshot({path:`${out}/step-${step}-${name}.png`});
 console.log(name,step,await page.evaluate(()=>({title:document.querySelector('h1,h2')?.textContent,width:document.documentElement.scrollWidth,body:document.body.innerText.slice(-250)})));
 if(step<6) { const btn=await page.$('.continue-btn:not(:disabled)'); assert.ok(btn, 'Expected a working Continue button'); await btn.click(); }
 }
 await page.close();
}
} finally { await browser.close(); }
