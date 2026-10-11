import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {const page=await browser.newPage();await page.setViewport({width:390,height:844});const wait=ms=>new Promise(r=>setTimeout(r,ms));
await page.goto('http://127.0.0.1:5180/?chain=mock',{waitUntil:'networkidle0'});
for(let i=0;i<3;i++){await page.click('.continue-btn');await wait(700);}
await page.evaluate(()=>[...document.querySelectorAll('.timeline-zoom button')].find(e=>e.textContent==='Today').click());await wait(800);assert.match(await page.$eval('.big-date',e=>e.textContent),/Today/);
await page.screenshot({path:'docs/screens/today-zoom-mobile.png'});
await page.click('.continue-btn');await wait(700);await page.click('.continue-btn');await wait(850);assert.match(await page.$eval('.printer__status',e=>e.textContent),/Printing/);await page.screenshot({path:'docs/screens/printing-mobile.png'});await wait(1900);
await page.evaluate(()=>{window.open=(url)=>{window.__postUrl=url;return null;};});
await page.evaluate(()=>[...document.querySelectorAll('.dock button')].find(e=>e.textContent.includes('Post on X')).click());
assert.match(await page.evaluate(()=>window.__postUrl),/^https:\/\/x.com\/intent\/post\?text=/);
await page.evaluate(()=>[...document.querySelectorAll('.dock button')].find(e=>e.textContent.includes('Share')).click());await wait(500);assert.match(await page.evaluate(()=>document.body.innerText),/Link copied|Copied/);
await page.click('.wallet-btn');await wait(400);await page.screenshot({path:'docs/screens/connect-mobile.png'});
await page.keyboard.press('Escape');await wait(250);assert.equal(await page.$('[aria-modal=true]'),null);
console.log('PASS: Today zoom, printing phase, X compose URL, clipboard share, connect sheet and Escape dismissal.');
}finally{await browser.close();}
