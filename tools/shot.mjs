// Dev helper: load the game in headless Chrome, capture console output and screenshots.
// usage: node tools/shot.mjs [--url http://127.0.0.1:8090/?name=Dev&auto=battle] [--wait 12000] [--out screenshots/x.png] [--actions]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = get('--url', 'http://127.0.0.1:8090/?name=Dev&auto=menu');
const wait = +get('--wait', 8000);
const out = get('--out', 'screenshots/shot.png');
const chrome = get('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const script = get('--script', null);

fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1400,820', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 820 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error' || m.type() === 'warning') console.log(t); });
page.on('pageerror', (e) => { logs.push('[pageerror] ' + e.message); console.log('[pageerror]', e.message); });
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http ' + r.status() + ']', r.url()); });
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, wait));
if (script) {
  const code = fs.readFileSync(script, 'utf8');
  const res = await page.evaluate(code);
  console.log('[script]', JSON.stringify(res));
}
await page.screenshot({ path: out });
const state = await page.evaluate(() => {
  const a = window.app;
  const vis = [...document.querySelectorAll('#ui > *')].filter((e) => !e.classList.contains('hidden')).map((e) => e.id);
  return { screen: a?.screen, battle: !!a?.battle, visible: vis, profile: a?.profile?.name, tanks: a?.battle ? a.battle.tanks.size : 0, snaps: a?.battle ? a.battle.snaps.length : 0, alive: a?.battle?.me?.alive, fps: a?.battle?.fps?.value, hp: a?.battle?.me?.hp };
});
console.log('[state]', JSON.stringify(state));
console.log('[logs]', logs.length, 'lines;', logs.filter((l) => l.startsWith('[error') || l.startsWith('[pageerror')).length, 'errors');
await browser.close();
