import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
const page=await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const click=async selector=>{await page.waitForSelector(selector);await page.click(selector);await wait(650);};
const text=()=>page.evaluate(()=>document.body.innerText);
const screenshots=resolve('docs/screens');
await page.setViewport({width:390,height:844});
await page.goto('http://127.0.0.1:5180/?chain=mock',{waitUntil:'networkidle0'});
await page.evaluate(()=>localStorage.clear()); await page.reload({waitUntil:'networkidle0'});await wait(1000);
// Search and formatting, then a different asset's strike data.
await page.focus('[role=listbox]'); await page.keyboard.type('doge'); await wait(1600);
assert.match(await text(),/DOGE/); assert.match(await text(),/\$0\.0\d{3}/);
await page.keyboard.press('Home');await wait(700);
await page.keyboard.press('Enter'); await wait(700);
await page.keyboard.press('2'); await wait(200);
assert.equal(await page.$eval('.dir-card--down',e=>e.getAttribute('aria-checked')),'true');
await page.keyboard.press('Enter'); await wait(700);
assert.match(await text(),/Bitcoin/); assert.match(await text(),/You win if BTC is below/);
await click('.sentence .pill:first-of-type');
await page.focus('[role=listbox]');await page.keyboard.type('sol');await wait(1600);
await click('.continue-btn');await page.keyboard.press('1');await page.keyboard.press('Enter');await wait(700);
assert.match(await text(),/You win if SOL is at or above \$1\d\d/);
// Mobile touch-style drag changes the strike.
const slider=await page.$('[aria-label="Price level"]'); const box=await slider.boundingBox();
const before=await page.$eval('[aria-label="Price level"]',e=>e.getAttribute('aria-valuenow'));
await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-75,{steps:12});await page.mouse.up();await wait(900);
assert.notEqual(await page.$eval('[aria-label="Price level"]',e=>e.getAttribute('aria-valuenow')),before);
await click('.continue-btn');await page.focus('[aria-label="Expiry date"]');await page.keyboard.press('Home');await wait(700);
assert.match(await text(),/Today|Tomorrow/);await page.keyboard.press('PageUp');await wait(700);
await click('.continue-btn');await page.focus('[aria-label="Amount to put in"]');await page.keyboard.press('End');await wait(700);
assert.equal(await page.$eval('.big-amount',e=>e.textContent),'$1,000');await page.keyboard.press('Home');await wait(650);
assert.equal(await page.$eval('.big-amount',e=>e.textContent),'$1');
await click('.big-amount');await page.$eval('#amount-input',e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.keyboard.press('Enter');await wait(700);
// Drag payout to loss and win endpoints, including keyboard operation.
await page.focus('.sim__chart');await page.keyboard.press('Home');await wait(250);
assert.match(await page.$eval('.sim__pl',e=>e.textContent),/loss/);
await page.keyboard.press('End');await wait(250);assert.match(await page.$eval('.sim__pl',e=>e.textContent),/profit/);
await click('.continue-btn');await wait(2400);await click('.btn--sign');await page.waitForSelector('[aria-modal=true]');
assert.equal(await page.$eval('.app',e=>e.inert),true);
await click('.wallet-opt');await wait(1600);assert.match(await text(),/Demo ticket placed/);
assert.doesNotMatch(await text(),/Placed onchain/);
await page.screenshot({path:`${screenshots}/success-mobile.png`});
await click('.tickets-btn');await wait(700);assert.match(await text(),/My tickets/);assert.ok(await page.$('.pos'));
// A settled demo ticket can be claimed, and an open one sold.
const claim=await page.evaluate(()=>[...document.querySelectorAll('.pos button')].find(e=>e.textContent.includes('Claim'))?.textContent);
assert.ok(claim);await page.evaluate(()=>[...document.querySelectorAll('.pos button')].find(e=>e.textContent.includes('Claim')).click());await wait(1600);
assert.match(await text(),/Claimed/);
await page.evaluate(()=>[...document.querySelectorAll('.pos button')].find(e=>e.textContent==='Sell' && !e.disabled).click());await wait(200);
await page.evaluate(()=>[...document.querySelectorAll('.pos button')].find(e=>e.textContent.trim()==='Confirm').click());await wait(1600);assert.match(await text(),/Sold/);
await page.keyboard.press('Escape');await wait(250);assert.equal(await page.$('[aria-modal=true]'),null);
await click('.wallet-btn');await wait(300);await page.evaluate(()=>[...document.querySelectorAll('.sheet button')].find(e=>e.textContent.includes('Get test funds')).click());await wait(2300);assert.match(await text(),/Test funds on the way/);
await page.keyboard.press('Escape');await wait(300);
// Existing positions persist, but a new session connects explicitly.
await page.reload({waitUntil:'networkidle0'});await wait(700);assert.equal(await page.$eval('.wallet-btn',e=>e.getAttribute('aria-label')),'Connect wallet');
// Small mobile viewport all six steps fit without horizontal overflow.
await page.setViewport({width:375,height:740});await page.goto('http://127.0.0.1:5180/?chain=mock',{waitUntil:'networkidle0'});
for(let i=1;i<=6;i++) {await wait(i===6?2700:750);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375);if(i===5){await page.screenshot({path:`${screenshots}/step-5-small-mobile.png`});const r=await page.$eval('.sim',e=>({bottom:e.getBoundingClientRect().bottom}));const c=await page.$eval('.cta',e=>e.getBoundingClientRect().top);assert.ok(r.bottom<=c+1,`amount chart overlaps CTA ${r.bottom} > ${c}`);}if(i<6)await click('.continue-btn');}
await page.screenshot({path:`${screenshots}/step-6-small-mobile.png`});
// Reduced motion scene must be static over time.
await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await wait(600);
const canvas1=await page.$eval('.scene__canvas',e=>e.toDataURL());await wait(500);assert.equal(await page.$eval('.scene__canvas',e=>e.toDataURL()),canvas1);
await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await wait(300);
await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
const hiddenFrame=await page.$eval('.scene__canvas',e=>e.toDataURL());await wait(400);assert.equal(await page.$eval('.scene__canvas',e=>e.toDataURL()),hiddenFrame);
assert.deepEqual(errors,[]);
console.log('PASS: asset search/formatting, both directions, asset-switch strike data, drag strike, Today timeline, amount bounds, binary simulator, connect/place, demo wording, positions, claim/sell, faucet, Escape/focus, persistence, 375px layout, reduced motion; no browser exceptions.');
} finally { await browser.close(); }
