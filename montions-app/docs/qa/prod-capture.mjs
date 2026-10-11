import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');
const ORIGIN = process.env.KAIRO_ORIGIN ?? 'http://127.0.0.1:4180';
const out = resolve('docs/screens');
await fs.mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log('shot', name);
}

async function goto(page, path) {
  const url = `${ORIGIN}${path}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
}

async function waitSel(page, sel, t = 15000) {
  await page.waitForSelector(sel, { timeout: t });
}

try {
  const views = [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
  ];
  const modes = ['serious', 'uwu'];

  for (const [view, width, height] of views) {
    for (const mode of modes) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
      const q = `chain=mock&mode=${mode}`;
      const tag = mode === 'serious' ? view : `uwu-${view}`;

      // Markets
      await goto(page, `/markets?${q}`);
      try { await waitSel(page, '.mkt-group, .page__skel, .coming-banner', 20000); } catch { /* still shot */ }
      await sleep(2500);
      await shot(page, `markets-${tag}`);

      // Predictions list
      await goto(page, `/predictions?${q}`);
      await waitSel(page, '.pred-card, .coming-banner', 15000);
      await sleep(400);
      await shot(page, `predictions-${tag}`);

      // Event detail
      const href = await page.evaluate(() => document.querySelector('.pred-card')?.getAttribute('href'));
      assert.ok(href, 'expected a prediction card');
      await goto(page, href.includes('?') ? href : `${href}?${q}`);
      await waitSel(page, '.event-q, .event-rules', 15000);
      await sleep(400);
      await shot(page, `event-detail-${tag}`);

      // Event ticket
      const print = await page.$('.continue-btn:not(:disabled)');
      if (print) {
        await print.click();
        await sleep(mode === 'uwu' ? 2600 : 2500);
        await shot(page, `event-ticket-${tag}`);
      }

      // Prices flow → strike → book
      await goto(page, `/?${q}`);
      await waitSel(page, '.continue-btn', 15000);
      for (let i = 0; i < 2; i++) {
        const btn = await page.$('.continue-btn:not(:disabled)');
        if (btn) { await btn.click(); await sleep(700); }
      }
      const bookBtn = await page.$('.book-disc__btn');
      if (bookBtn) {
        await bookBtn.click();
        try { await waitSel(page, '.book__ladder', 8000); } catch { /* empty book still shot */ }
        await sleep(500);
        await shot(page, `book-${tag}`);
      } else {
        await shot(page, `book-${tag}`);
      }

      await page.close();
    }
  }

  // 404
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await goto(page, '/no-such-page?chain=mock');
    await shot(page, '404-desktop');
    await page.close();
  }

  // axe-core on key routes
  const axePath = '/tmp/montions-qa/node_modules/axe-core/axe.min.js';
  let axeOk = false;
  try { await fs.access(axePath); axeOk = true; } catch { /* try cdn later */ }
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const routes = ['/?chain=mock', '/markets?chain=mock', '/predictions?chain=mock'];
  const findings = [];
  for (const r of routes) {
    await goto(page, r);
    await sleep(600);
    try {
      if (axeOk) await page.addScriptTag({ path: axePath });
      else await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js' });
      const res = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
        return {
          url: location.pathname,
          violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
        };
      });
      findings.push(res);
      console.log('axe', r, res.violations.length, 'violations');
    } catch (e) {
      console.log('axe skipped', r, e.message);
    }
  }
  await fs.writeFile(resolve('docs/qa/axe-prod.json'), JSON.stringify(findings, null, 2));
  await page.close();
} finally {
  await browser.close();
}
