// End-to-end flow in headless Chrome: menu -> lobby -> join -> drive/fire -> pause -> garage -> leave.
// usage: node tools/e2e.mjs [--url http://127.0.0.1:8090] [--chrome path]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const base = get('--url', 'http://127.0.0.1:8090');
const chrome = get('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const outDir = get('--out', 'screenshots/e2e');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };

const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1400,820', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1400, height: 820 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
// "VALIDATE_STATUS false" with an empty info log is a sporadic, harmless validateProgram quirk of software GL (SwiftShader)
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('VALIDATE_STATUS false')) { errors.push(m.text()); console.log('[console.error]', m.text()); } });
page.on('response', (r) => { if (r.status() >= 400) console.log('[http ' + r.status() + ']', r.url()); });
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
// click through the DOM to avoid detached-handle races when screens re-render
const click = async (sel) => { const ok = await page.evaluate((q) => { const el = document.querySelector(q); if (!el) return false; el.click(); return true; }, sel); if (!ok) throw new Error('no element for ' + sel); };
const state = () => page.evaluate(() => ({ screen: window.app.screen, battle: !!window.app.battle, alive: window.app.battle?.me?.alive, ready: !!window.app.battle?.ready, pos: window.app.battle?.me?.pos, tanks: window.app.battle?.tanks.size, snaps: window.app.battle?.snaps.length, paused: window.app.paused, profile: window.app.profile && { name: window.app.profile.name, crystals: window.app.profile.crystals, xp: window.app.profile.xp } }));

const nick = 'E2E_' + (Date.now() % 1000000).toString(36); // fresh profile every run (full supply stock)
await page.goto(`${base}/?name=${nick}`, { waitUntil: 'load' });
await sleep(5000);
let s = await state();
check('menu shown', s.screen === 'menu', JSON.stringify(s.profile));
// software rendering in headless Chrome is slow: use the low preset so the game loop keeps up
await page.evaluate(() => window.app.setSettings({ quality: 'low', scale: 0.5, shadows: 0, bloom: false, ao: false }));
await shot('01-menu');

// lobby
await click('#menu-play');
await sleep(1500);
s = await state();
const cards = await page.$$('.battle-card');
check('lobby shown with battles', s.screen === 'lobby' && cards.length >= 4, `${cards.length} battles`);
await shot('02-lobby');

// settings round trip
await click('#lobby-back'); await sleep(300);
await click('#menu-settings'); await sleep(500);
check('settings shown', (await state()).screen === 'settings');
await shot('03-settings');
await click('#st-back'); await sleep(300);

// garage
await click('#menu-garage'); await sleep(800);
check('garage shown', (await state()).screen === 'garage');
await click('.garage-tabs button[data-tab="turret"]'); await sleep(400);
const cardsG = await page.$$('#garage-list .item-card');
check('garage lists turrets', cardsG.length === 12, `${cardsG.length} items`);
await click('#garage-list .item-card:nth-child(2)'); await sleep(400); // firebird (1000 crystals, rank 1 -> locked at rank 0)
await shot('04-garage');
await click('#garage-back'); await sleep(300);

// join a battle (first card)
await click('#menu-play'); await sleep(1200);
await click('.battle-card'); await sleep(300);
await click('#join-auto');
await sleep(3000);
// the scene is built once the map's assets are loaded (slow under software rendering): wait for it
for (let i = 0; i < 120 && !(await state()).ready; i++) await sleep(500);
await sleep(2500);
s = await state();
check('joined battle', s.battle && s.ready && s.snaps > 0 && s.tanks >= 2, JSON.stringify({ tanks: s.tanks, snaps: s.snaps, alive: s.alive, ready: s.ready }));
await shot('05-battle-spawn');

// drive forward for 2.5 s and verify movement (retried when nearby bots freeze or destroy us right after spawning)
await page.evaluate(() => { window.app.input.enabled = true; });
let moved = 0;
for (let attempt = 0; attempt < 4 && moved < 5; attempt++) {
  const st = await page.evaluate(async () => { const { TF } = await import('/shared/constants.mjs'); const b = window.app.battle; return { alive: b.me.alive, frozen: !!(b.me.state && (b.me.state.flags & TF.FROZEN)) }; });
  if (!st.alive || st.frozen) { await sleep(3000); continue; }
  const before = (await state()).pos;
  await page.keyboard.down('KeyW');
  await sleep(2500);
  await page.keyboard.up('KeyW');
  await sleep(400);
  const after = (await state()).pos;
  moved = before && after ? Math.hypot(after[0] - before[0], after[2] - before[2]) : 0;
}
check('tank moves with W', moved > 5, `moved ${moved.toFixed(1)} m`);

// turn + fire, count shot events
await page.evaluate(() => { window.__shots = 0; const b = window.app.battle; const orig = b.onEvent.bind(b); b.onEvent = (e) => { if (e.e === 'shot' && e.p === b.myId) window.__shots++; return orig(e); }; });
await page.keyboard.down('KeyD');
await page.keyboard.down('Space');
await sleep(3200);
await page.keyboard.up('Space');
await page.keyboard.up('KeyD');
await sleep(300);
const shots = await page.evaluate(() => window.__shots);
check('tank fires with Space', shots >= 1, `${shots} shots`);
await shot('06-battle-firing');

// supply use (repair when full hp -> rejected; use nitro instead)
let nitro = false;
for (let attempt = 0; attempt < 3 && !nitro; attempt++) {
  for (let w = 0; w < 20 && !(await state()).alive; w++) await sleep(500); // supplies only work while alive
  await page.keyboard.press('Digit4');
  await sleep(1500);
  nitro = await page.evaluate(() => { const b = window.app.battle; return !!b.cooldowns.nitro || !!(b.me.state && (b.me.state.flags & 8)); });
}
check('nitro supply activates', nitro);

// chat
await page.keyboard.press('Enter'); await sleep(200);
await page.keyboard.type('gl hf'); await page.keyboard.press('Enter'); await sleep(600);
const chatText = await page.$eval('#hud-chat-log', (el) => el.textContent);
check('chat message delivered', chatText.includes('gl hf'));

// scoreboard
await page.keyboard.down('Tab'); await sleep(1200);
const sbVisible = await page.$eval('#hud-scoreboard', (el) => !el.classList.contains('hidden'));
await shot('07-scoreboard');
await page.keyboard.up('Tab');
check('scoreboard on Tab', sbVisible);

// pause -> garage -> back -> resume
await page.keyboard.press('Escape'); await sleep(400);
s = await state();
check('pause menu', s.paused && s.screen === 'pause');
await shot('08-pause');
await click('#pz-garage'); await sleep(600);
check('garage from battle', (await state()).screen === 'garage');
await click('#garage-back'); await sleep(300);
await click('#pz-resume'); await sleep(300);
check('resumed', !(await state()).paused);

// self destruct and respawn
await page.keyboard.press('Delete');
await sleep(2500);
const dead = (await state()).alive === false;
await shot('09-destroyed');
await sleep(4000);
const respawned = (await state()).alive === true;
check('self destruct then respawn', dead && respawned, `dead=${dead} respawned=${respawned}`);

// leave
await page.keyboard.press('Escape'); await sleep(300);
await click('#pz-leave'); await sleep(1500);
s = await state();
check('left to lobby', !s.battle && s.screen === 'lobby');
await shot('10-lobby-after');

// create battle flow
await click('#lobby-create'); await sleep(400);
await page.select('#cb-map', 'kungur'); await page.select('#cb-mode', 'CTF');
await click('#cb-go'); await sleep(6000);
s = await state();
check('created and joined custom CTF battle', s.battle && s.tanks >= 2, JSON.stringify({ tanks: s.tanks }));
await shot('11-custom-ctf');
await page.keyboard.press('Escape'); await sleep(300);
await click('#pz-leave'); await sleep(1000);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
