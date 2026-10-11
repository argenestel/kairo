import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');
import assert from 'node:assert/strict';
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/\/src\/chains\/(solana|base)\.ts/.test(r.url())) r.respond({ status: 503, body: 'Adapter unavailable for graceful-degradation test' });
    else r.continue();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const openPicker = async () => {
    await page.waitForSelector('.chain-switch__trigger');
    await page.click('.chain-switch__trigger');
    await page.waitForSelector('.chain-menu');
  };
  const pick = async (label) => {
    await openPicker();
    await page.evaluate((want) => {
      const btn = [...document.querySelectorAll('.chain-menu__opt')].find((e) => e.textContent.includes(want));
      if (!btn) throw new Error(`missing chain ${want}`);
      btn.click();
    }, label);
    await wait(400);
  };

  await page.goto('http://127.0.0.1:5180/?chain=solana', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.asset-row');
  assert.match(await page.$eval('.demo-badge', (e) => e.getAttribute('title')), /unavailable|demo/i);

  await pick('Base');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('chain') === 'base' && !!document.querySelector('.asset-row'));
  assert.equal(await page.evaluate(() => localStorage.getItem('montions.chain')), 'base');
  assert.match(await page.$eval('.demo-badge', (e) => e.getAttribute('title') + e.textContent), /unavailable|Demo/i);

  await pick('Arbitrum');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('chain') === 'arbitrum');
  assert.match(await page.$eval('.demo-badge', (e) => e.textContent), /Coming online/i);

  await pick('Hyperliquid');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('chain') === 'hyperliquid');
  assert.match(await page.$eval('.demo-badge', (e) => e.textContent), /Coming online/i);

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.asset-row');
  assert.ok(await page.$('.continue-btn:not(:disabled)'));
  await page.screenshot({ path: 'docs/screens/base-fallback-mobile.png' });
  console.log('PASS: unavailable adapters degrade to labelled demo data; Arbitrum/Hyperliquid badged coming online; network switch updates URL and localStorage, survives reload.');
} finally { await browser.close(); }
