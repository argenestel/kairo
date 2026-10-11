import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const puppeteer = createRequire(resolve(process.env.MONTIONS_QA_DIR ?? '/tmp/montions-qa', 'package.json'))('puppeteer-core');
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.goto('http://127.0.0.1:5180/?chain=mock',{waitUntil:'networkidle0'});
const result=await page.evaluate(()=>new Promise(resolve=>{let prev=0;const samples=[];function frame(t){if(prev)samples.push(t-prev);prev=t;if(samples.length<180)requestAnimationFrame(frame);else{const sorted=[...samples].sort((a,b)=>a-b);resolve({average:samples.reduce((a,b)=>a+b)/samples.length,p95:sorted[Math.floor(sorted.length*.95)],over25:samples.filter(n=>n>25).length,frames:samples.length});}}requestAnimationFrame(frame);}));
console.log('Desktop scene rAF ms:',result);await browser.close();
