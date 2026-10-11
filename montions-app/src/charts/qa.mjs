/** Run with the app at :5180; uses the workspace's existing external Chromium QA install. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const origin = process.env.CHART_QA_URL ?? 'http://127.0.0.1:4180';
const errors = [];
const report = [];
await fs.mkdir('docs/screens', { recursive: true });
try {
 for (const mode of ['serious', 'uwu']) for (const [device, width, height] of [['desktop',1440,900], ['mobile',390,844]]) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width, height, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
  await page.goto(`${origin}/?chain=mock&mode=${mode}`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('.continue-btn');
  const click = async sel => { await page.click(sel); await wait(750); };
  for (let step=1; step<=6; step++) {
   await wait(step === 6 ? 2800 : 700);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
   if ([1,3,4].includes(step)) {
    const plot = await page.$('.stage__item:not(.is-exiting) .pc__plot');
    assert.ok(plot);
    const before = await plot.evaluate(e => [Number(e.dataset.viewStart),Number(e.dataset.viewEnd)]);
    const box = await plot.boundingBox();
    // Wheel zoom, followed by a real pointer drag, must change the time window.
    await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
    await page.mouse.wheel({deltaY:-100}); await wait(150);
    const zoom = await plot.evaluate(e => [Number(e.dataset.viewStart),Number(e.dataset.viewEnd)]);
    assert.ok(zoom[1]-zoom[0] < before[1]-before[0]);
    await page.mouse.down(); await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2,{steps:8}); await page.mouse.up(); await wait(100);
    const pan = await plot.evaluate(e => Number(e.dataset.viewStart));
    assert.ok(Math.abs(pan-zoom[0]) > 1);
    await plot.focus(); await page.keyboard.press('Home'); await wait(100);
    // Hover at an actual historical sample, not inside the future cone.
    const dot = await page.$('.pc__spot'); const d = await dot.boundingBox();
    await page.mouse.move(box.x+Math.max(55, (d.x-box.x)*.5),box.y+box.height*.55); await wait(150);
    assert.ok(await page.$('.pc__tip'), 'price/time crosshair tooltip');
    if (step > 1) {
      assert.ok(await page.$('.pc__strike')); assert.ok(await page.$('.pc__expiry')); assert.ok(await page.$('.pc__cone'));
    }
    if (device === 'mobile') {
      const cdp = await page.createCDPSession();
      const y=box.y+box.height/2, x=box.x+box.width/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-65,y,id:1},{x:x+65,y,id:2}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await wait(100);
      const pinch = await plot.evaluate(e => [Number(e.dataset.viewStart),Number(e.dataset.viewEnd)]);
      assert.ok(pinch[1]-pinch[0] < before[1]-before[0], 'touch pinch zoom');
      await plot.focus(); await page.keyboard.press('Home');
    }
    if (step===4) {
      await page.setViewport({width:width-30,height,isMobile:device==='mobile',hasTouch:device==='mobile'}); await wait(150);
      assert.ok(await plot.evaluate(e=>Math.abs(e.clientWidth-Number(e.querySelector('svg').getAttribute('width')))<2), 'SVG tracks resize without scaling blur');
      await page.setViewport({width,height,isMobile:device==='mobile',hasTouch:device==='mobile'}); await wait(150);
    }
    // The full price plot must sit above Continue, including on expiry.
    const plotBottom = await plot.evaluate(e => e.getBoundingClientRect().bottom);
    const ctaTop = await page.$eval('.cta',e=>e.getBoundingClientRect().top);
    assert.ok(plotBottom <= ctaTop + 1, `step ${step}: price plot ${plotBottom} overlaps CTA ${ctaTop}`);
    await page.screenshot({path:`docs/screens/charts-${step===1?'asset':step===3?'strike':'expiry'}-${mode}-${device}.png`});
   }
   if (step === 5 || step === 6) {
    await page.waitForSelector('.sim__chart');
    const sim = await page.$('.sim__chart'); await sim.focus();
    await page.keyboard.press('Home'); await wait(200);
    assert.match(await page.$eval('.sim__pl',e=>e.textContent),/loss/);
    await page.keyboard.press('End'); await wait(200);
    assert.match(await page.$eval('.sim__pl',e=>e.textContent),/profit/);
    await page.keyboard.press('s'); await wait(100);
    assert.ok(await page.$('.sim.is-snap'));
    assert.match(await sim.evaluate(e=>e.getAttribute('aria-valuetext')),/return/);
    const box=await sim.boundingBox();
    await page.mouse.move(box.x+50,box.y+box.height/2); await page.mouse.down();
    await page.mouse.move(box.x+box.width-15,box.y+box.height/2,{steps:10}); await page.mouse.up(); await wait(100);
    assert.match(await page.$eval('.sim__pl',e=>e.textContent),/profit/);
    // Keyboard input must supersede a stale mouse hover preview.
    await page.mouse.move(box.x+box.width-15,box.y+box.height/2);
    await sim.focus(); await page.keyboard.press('Home'); await wait(100);
    assert.match(await page.$eval('.sim__pl',e=>e.textContent),/loss/);
    await page.keyboard.press('End');
    if (device==='mobile') {
      const cdp=await page.createCDPSession();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+48,y:box.y+box.height/2,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-16,y:box.y+box.height/2,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await wait(100);
      assert.match(await page.$eval('.sim__pl',e=>e.textContent),/profit/);
    }
    await sim.focus(); await wait(50);
    const tipBounds=await page.$eval('.sim__tip',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));
    assert.ok(tipBounds.left>=0 && tipBounds.right<=width, 'simulator tooltip contained');
    await page.screenshot({path:`docs/screens/charts-${step===5?'simulator':'ticket'}-${mode}-${device}.png`});
   }
   if (step === 3) {
    await click('.book-disc__btn');
    await page.waitForSelector('.dc__plot');
    await page.focus('.dc__plot'); await page.keyboard.press('End');
    assert.ok(await page.$('.dc__tip'));
    assert.ok(await page.$('.book__ladder'));
    assert.ok(await page.$('.odds__v'));
    await page.screenshot({path:`docs/screens/charts-depth-${mode}-${device}.png`});
    await page.keyboard.press('Escape'); await wait(250);
   }
   if (step<6) await click('.continue-btn');
  }
  report.push(`PASS ${mode} ${device}: all price steps, hover, pan, wheel${device==='mobile'?', touch pinch':''}, strike/expiry/cone, payout drag/keyboard/snap${device==='mobile'?'/touch':''}, depth/ladder/odds, no overflow`);
  await page.close();
 }
 // NO must lose exactly at the strike and win strictly below it.
 const page=await browser.newPage(); await page.goto(`${origin}/?chain=mock`);
 await page.waitForSelector('.continue-btn'); await page.click('.continue-btn'); await wait(700);
 await page.click('.dir-card--down'); await page.click('.continue-btn'); await wait(700);
 await page.click('.continue-btn'); await wait(700); await page.click('.continue-btn'); await wait(1000);
 await page.focus('.sim__chart'); await page.keyboard.press('s'); await wait(100);
 assert.match(await page.$eval('.sim__pl',e=>e.textContent),/loss/);
 await page.keyboard.press('Home'); await wait(100); assert.match(await page.$eval('.sim__pl',e=>e.textContent),/profit/);
 await page.keyboard.press('End'); await wait(100); assert.match(await page.$eval('.sim__pl',e=>e.textContent),/loss/);
 await page.goto('http://127.0.0.1:5180/?chain=mock', {waitUntil:'networkidle0'});
 // Regression tests exercise the actual loader with deterministic contract responses.
 const dataTests = await page.evaluate(async () => {
   const {loadAggregator,loadHistory}=await import('/src/charts/history.ts');
   const {evmFeed}=await import('/src/charts/feeds.ts');
   if(evmFeed('base','TSLA')?.kind !== 'keeper') throw Error('stock oracle incorrectly labeled Chainlink');
   const now=Math.floor(Date.now()/1000), base=2n<<64n;
   const round=i=>[base|i,10000000000n+i,BigInt(now-Number(300n-i)*600),BigInt(now-Number(300n-i)*600),base|i];
   let calls=0;
   const client={readContract:async ({functionName})=> functionName==='decimals'?8:round(300n),multicall:async ({contracts})=>{calls++;return contracts.map(c=>({status:'success',result:round(c.args[0]&((1n<<64n)-1n))}));}};
   const points=await loadAggregator(client,'0x0000000000000000000000000000000000000001',86400);
   if(points.length<140 || points.length>146) throw Error('lookback range');
   if(points.at(-1).value!==100.000003) throw Error('real prices changed');
   if(points.at(-1).time!==now) throw Error('round timestamp changed');
   if(calls>14) throw Error('unbounded RPC requests');
   const mock=await loadHistory({chain:'mock',symbol:'ETH',spot:2000,vol:.6});
   if(mock.source!=='synthetic' || mock.points.length<80) throw Error('mock history');
   return {points:points.length,multicalls:calls,last:points.at(-1)};
 });
 report.push(`PASS NO equality/below/above; loader time-window and unmodified-round regression: ${JSON.stringify(dataTests)}`);
 assert.deepEqual(errors,[]);
 report.forEach(line=>console.log(line));
} finally { await browser.close(); }
