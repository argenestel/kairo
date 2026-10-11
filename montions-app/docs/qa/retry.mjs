import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
const page=await browser.newPage();await page.setViewport({width:1440,height:900});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await page.goto('http://127.0.0.1:5180/?chain=mock',{waitUntil:'networkidle0'});
await page.evaluate(()=>localStorage.setItem('montions.mock.v1.demo',JSON.stringify({collateral:0,native:2.5,positions:[],seeded:false})));
const expiry=Math.floor(Date.now()/1000)+7*86400;
await page.goto(`http://127.0.0.1:5180/?chain=mock&t=SOL~a~115~${expiry}~100`,{waitUntil:'networkidle0'});await wait(2800);
await page.click('.btn--sign');await wait(400);await page.click('.wallet-opt');await wait(2200);
assert.ok(await page.$('.panel__err'));assert.match(await page.$eval('.panel__err',e=>e.textContent),/Insufficient/);
await page.screenshot({path:'docs/screens/error-retry-desktop.png'});
await page.click('.wallet-btn');await wait(500);await page.evaluate(()=>[...document.querySelectorAll('.sheet button')].find(e=>e.textContent.includes('Get test funds')).click());await wait(2500);
await page.keyboard.press('Escape');await wait(300);await page.click('.btn--sign');await wait(2200);assert.match(await page.$eval('.printer__status',e=>e.textContent),/Demo ticket placed/);
assert.equal(await page.$('.panel__err'),null);await page.screenshot({path:'docs/screens/success-desktop.png'});
// Shares reconstruct the same idea and edits return to the amount control.
await page.evaluate(()=>[...document.querySelectorAll('.dock button')].find(e=>e.textContent.includes('Edit')).click());await wait(600);assert.ok(await page.$('.big-amount'));
console.log('PASS: inline insufficient-balance error, faucet, retry purchase, success receipt, edit, shared-ticket reconstruction. No real-chain transactions.');
} finally {await browser.close();}
