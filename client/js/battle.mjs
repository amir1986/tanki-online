// Battle client: scene, snapshot interpolation, events -> effects/audio/HUD, input -> server.
import * as THREE from 'three';
import { buildMap } from '/shared/maps.mjs';
import { finalizeMap } from '/shared/sim/nav.mjs';
import { unpackTank, PS, DS, MS, DROP_TYPES, C2S } from '/shared/protocol.mjs';
import { TF, TEAM_NAMES, MODES, RESPAWN_DELAY, SUPPLY_COOLDOWN, MINE_COOLDOWN } from '/shared/constants.mjs';
import { getTurret, getHull, getSupply, RANKS, hullStats } from '/shared/items.mjs';
import { getDrone } from '/shared/drones.mjs';
import { qToYaw, angleDiff } from '/shared/sim/math.mjs';
import { buildTerrain } from './render/terrain.mjs';
import { buildSky } from './render/sky.mjs';
import { buildProps, buildClutter, buildFlagBase, buildFlag, animateFlag, buildControlPoint, setControlPointState, buildBall } from './render/props.mjs';
import { buildFoliage } from './render/foliage.mjs';
import { buildTank } from './render/tankmesh.mjs';
import { Effects, TURRET_COLORS } from './render/effects.mjs';
import { Textures, TEXTURE_SETS } from './render/textures.mjs';
import { Assets } from './render/assets.mjs';
import { TANK_MODELS } from './render/tankmesh.mjs';
import { skyFor } from './render/sky.mjs';
import { propModelIds } from './render/props.mjs';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Hud } from './ui/hud.mjs';
import { Tutorial } from './ui/tutorial.mjs';

const INTERP = 0.1;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const teamCls = (t) => (t === 1 ? 'r' : t === 2 ? 'b' : '');
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const DROP_COLORS = { repair: 0xff4d4d, da: 0x4da6ff, dd: 0xffb84d, nitro: 0x7dff7d, gold: 0xffd54f };
const DROP_NAMES = { repair: 'Repair kit', da: 'Double armor', dd: 'Double damage', nitro: 'Nitro', gold: 'Gold box' };

/** DOM nameplate (CSS2D): rank + name and a health bar, constant screen size. */
function makeNameplate(r, isMe) {
  const el = document.createElement('div');
  const obj = new CSS2DObject(el);
  obj.userData.el = el;
  refreshNameplate(obj, r, isMe, 1, false);
  return obj;
}
function refreshNameplate(obj, r, isMe, hpFrac, jugger) {
  const el = obj.userData.el;
  el.className = 'nameplate' + (jugger ? ' jug' : isMe ? ' me' : r.team === 1 ? ' r' : r.team === 2 ? ' b' : '');
  const rank = r.rank != null && RANKS[r.rank] ? RANKS[r.rank].name.split(' ')[0].slice(0, 10) : '';
  el.innerHTML = `<span class="nm">${jugger ? '&#9819; ' : ''}${r.clan ? `<span class="rk">[${esc(r.clan)}]</span>` : ''}${rank ? `<span class="rk">${esc(rank)}</span>` : ''}${esc(r.name)}</span><div class="hp"><i style="width:${Math.round(hpFrac * 100)}%"></i></div>`;
  obj.userData.hp = el.querySelector('.hp i');
}

/** Small support drone hovering beside a tank. */
function buildDroneMesh(color) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.6, metalness: 0.6 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), dark));
  const rotors = new THREE.Group();
  for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.06), dark);
    arm.position.set(x / 2, 0, z / 2); arm.rotation.y = -Math.atan2(z, x); g.add(arm);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 12), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.35 }));
    disc.position.set(x, 0.05, z); rotors.add(disc);
  }
  g.add(rotors);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
  eye.position.set(0, -0.02, 0.22); g.add(eye);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.get('particle'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  glow.scale.set(0.8, 0.8, 1); g.add(glow);
  g.userData.rotors = rotors;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class BattleClient {
  constructor(app, joined) {
    this.app = app;
    this.view = app.view;
    this.scene = app.view.scene;
    this.net = app.net;
    this.input = app.input;
    this.audio = app.audio;
    this.cam = app.cam;
    this.info = joined.battle;
    this.myId = joined.you;
    this.mode = this.info.mode;
    this.teams = !!MODES[this.mode]?.teams;
    this.map = finalizeMap(buildMap(joined.map || this.info.map));
    this.roster = new Map();
    this.tanks = new Map();
    this.snaps = [];
    this.renderTime = 0;
    this.projectiles = new Map();
    this.drops = new Map();
    this.mines = new Map();
    this.scores = new Map();
    this.teamScore = [0, 0];
    this.timeLeft = -1;
    this.running = true;
    this.me = { alive: false, hp: 0, maxHp: 100, deadAt: 0, killer: null, team: 0, yaw: 0, pos: [0, 2, 0], state: null, lastSpawnSeen: 0 };
    this.cooldowns = {};
    this.now = 0;
    this.inputTimer = 0;
    this.seq = 0;
    this.centerUntil = 0;
    this.mouseAim = !!app.settings.mouseAim;
    this.showScoreboard = false;
    this.paused = false;
    this.unsubs = [];
    this.fps = { frames: 0, t: 0, value: 0 };
    this.loops = new Set();
    this.lastSnapAt = performance.now();

    // scene (built asynchronously once the map's assets are loaded); handlers may run before it exists
    this.points = [];
    this.flags = {};
    this.effects = null;
    this.sky = null;
    this.foliage = null;
    this.ready = false;
    this.destroyed = false;
    this.pendingRoster = null;
    this.buildPromise = this.build().catch((e) => console.error('[tanki] battle build failed', e));

    // HUD
    this.hud = new Hud(document.getElementById('hud'), {
      onChat: (msg, team) => { this.net.send({ t: C2S.CHAT, msg, team }); this.input.textFocus = false; },
      onSupply: (id) => this.useSupply(id),
    });
    this.hud.setMode(this.mode, `${this.map.name} · ${MODES[this.mode].name}`, this.teams);
    this.hud.show();
    this.hud.setHint(this.mouseAim ? 'WASD drive · Mouse aim · LMB fire · 1-5 supplies · F keyboard mode · Tab scores · Enter chat · Esc menu' : 'WASD drive · Z/X turret · Space fire · C center · 1-5 supplies · F mouse mode · Tab scores · Enter chat · Esc menu');
    this.applyRoster(joined.players || []);

    // network
    const on = (t, fn) => this.unsubs.push(this.net.on(t, fn));
    on('snap', (m) => this.onSnapshot(m));
    on('ev', (m) => { for (const e of m.ev) this.onEvent(e); });
    on('players', (m) => this.applyRoster(m.players));
    on('restart', (m) => this.onRestart(m));
    on('end', () => { this.running = false; this.input.releaseLock(); });

    // input
    this.input.enabled = true;
    this.input.wantLock = true;
    const act = (name, fn) => { this.input.onAction(name, fn); this.unsubs.push(() => this.input.actions.get(name)?.delete(fn)); };
    act('supply', (n) => { const s = getSupply(['repair', 'da', 'dd', 'nitro', 'mine'][n - 1]); if (s) this.useSupply(s.id); });
    act('chat', () => this.openChat(false));
    act('teamChat', () => this.openChat(true));
    act('chatCancel', () => { this.hud.closeChat(); this.input.textFocus = false; });
    act('pause', () => this.app.openPause());
    act('camera', () => this.toggleMouseAim());
    act('selfDestruct', () => this.net.send({ t: C2S.SELF_DESTRUCT }));
    act('center', () => { this.centerUntil = this.now + 3; });
    act('scoreboard', () => { this.showScoreboard = true; });
    act('scoreboardUp', () => { this.showScoreboard = false; });
    act('zoomIn', () => this.cam.zoom(-2));
    act('zoomOut', () => this.cam.zoom(2));
    act('lockchange', (locked) => { if (!locked && !this.paused && this.running) this.hud.setHint('Click to resume control'); else this.hud.setHint(''); });
    this.audio.init();
    this.tutorial = this.info.opts && this.info.opts.training ? new Tutorial(this) : null;
  }


  /** Load the sky, scanned models and texture sets for this map, then build the scene. */
  async build() {
    const app = this.app;
    this.view.clearScene();
    const quality = app.settings.quality === 'low' ? 0.3 : app.settings.quality === 'medium' ? 0.6 : 1;
    const [hdri] = await Promise.all([
      Assets.hdri(skyFor(this.map)),
      Assets.models([...TANK_MODELS, ...propModelIds(this.map)]),
      Assets.preloadSets(TEXTURE_SETS),
    ]);
    if (this.destroyed) return;
    this.sky = buildSky(this.map.theme, this.scene, this.view.renderer, hdri);
    this.sky.setShadowQuality(app.settings.shadows);
    this.terrain = buildTerrain(this.map);
    this.scene.add(this.terrain);
    this.props = buildProps(this.map);
    this.scene.add(this.props);
    this.clutter = buildClutter(this.map);
    this.scene.add(this.clutter);
    this.foliage = buildFoliage(this.map, quality);
    this.scene.add(this.foliage);
    this.ballMesh = null;
    if (this.mode === 'RGB') { this.ballMesh = buildBall(); this.ballMesh.visible = false; this.scene.add(this.ballMesh); }
    const occluders = this.terrain.children.filter((m) => m.name === 'terrain');
    this.props.traverse((o) => { if (o.isMesh && o.userData.prop && o.userData.prop.kind !== 'ramp' && o.userData.prop.kind !== 'tree') occluders.push(o); });
    this.cam.setOccluders(occluders);
    this.cam.setBounds(this.map.halfW - 1.1, this.map.halfL - 1.1);
    this.effects = new Effects(this.scene);
    this.objective = new THREE.Group();
    this.scene.add(this.objective);
    this.flags = {};
    this.points = [];
    if (this.mode === 'CTF') {
      for (const [color, team] of [['red', 1], ['blue', 2]]) {
        this.objective.add(buildFlagBase(this.map.flags[color], team));
        const f = buildFlag(team);
        f.position.set(...this.map.flags[color]);
        this.objective.add(f);
        this.flags[color] = f;
      }
    } else if (this.mode === 'CP' || this.mode === 'SGE') {
      for (const p of this.info.points) {
        const g = buildControlPoint(p.pos, p.id);
        this.objective.add(g);
        this.points.push({ id: p.id, g, owner: 0, capTeam: 0, cap: 0 });
      }
    }
    this.cam.initialized = false;
    this.cam.distance = 11;
    await Assets.ready();
    if (this.destroyed) return;
    this.ready = true;
    if (this.pendingRoster) { const list = this.pendingRoster; this.pendingRoster = null; this.applyRoster(list); }
  }

  // ---- roster / tanks ---------------------------------------------------------------
  applyRoster(list) {
    if (!this.ready) { this.pendingRoster = list; return; }
    const seen = new Set();
    for (const r of list) {
      seen.add(r.id);
      const prev = this.roster.get(r.id);
      this.roster.set(r.id, r);
      this.scores.set(r.id, { score: r.score, kills: r.kills, deaths: r.deaths });
      let t = this.tanks.get(r.id);
      const changed = !t || t.hull !== r.hull || t.turret !== r.turret || t.paint !== r.paint;
      if (changed) {
        if (t) { this.scene.remove(t.mesh.group); t.mesh.dispose(); this.scene.remove(t.label); }
        const mesh = buildTank({ hull: r.hull, turret: r.turret, paint: r.paint, team: r.team });
        mesh.group.visible = false;
        this.scene.add(mesh.group);
        const label = makeNameplate(r, r.id === this.myId);
        label.visible = false;
        this.scene.add(label);
        const aura = new THREE.Mesh(new THREE.SphereGeometry(Math.max(...mesh.size) * 0.75, 18, 12), new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
        aura.visible = false;
        mesh.group.add(aura);
        t = { id: r.id, mesh, label, aura, hull: r.hull, turret: r.turret, paint: r.paint, team: r.team, name: r.name, rank: r.rank, clan: r.clan || null, drone: null, droneObj: null, state: null, prev: null, visible: false, lastHp: -1, pos: new THREE.Vector3(), yaw: 0, turretYaw: 0, speed: 0, up: [0, 1, 0], tsize: mesh.size };
        if (r.drone) this.attachDrone(t, r.drone);
        this.tanks.set(r.id, t);
      } else if (t.team !== r.team || t.name !== r.name || t.rank !== r.rank || t.clan !== (r.clan || null) || t.drone !== (r.drone || null)) {
        t.team = r.team; t.name = r.name; t.rank = r.rank; t.clan = r.clan || null;
        t.mesh.setTeam(r.team);
        if (t.drone !== (r.drone || null)) this.attachDrone(t, r.drone || null);
        refreshNameplate(t.label, r, r.id === this.myId, Math.max(0, t.lastHp), !!t.jugger);
      }
      t.maxHp = r.maxHp;
      if (r.id === this.myId) { this.me.team = r.team; this.me.maxHp = r.maxHp; }
    }
    for (const [id, t] of this.tanks) {
      if (!seen.has(id)) { this.scene.remove(t.mesh.group); t.mesh.dispose(); this.scene.remove(t.label); this.tanks.delete(id); this.roster.delete(id); this.scores.delete(id); }
    }
  }

  /** Attach (or remove, with null) the hovering drone of a tank. */
  attachDrone(t, droneId) {
    if (t.droneObj) { t.mesh.group.remove(t.droneObj); t.droneObj = null; }
    t.drone = droneId || null;
    const d = getDrone(droneId);
    if (!d) return;
    const obj = buildDroneMesh(d.color);
    obj.position.set(-t.tsize[0] / 2 - 0.55, t.tsize[1] / 2 + 1.25, -t.tsize[2] * 0.25);
    obj.userData.baseY = obj.position.y;
    t.mesh.group.add(obj);
    t.droneObj = obj;
  }

  // ---- snapshots ----------------------------------------------------------------------
  onSnapshot(m) {
    const tanks = new Map();
    for (const a of m.tanks) { const u = unpackTank(a); tanks.set(u.id, u); }
    const snap = { time: m.time, tanks, pr: m.pr, dr: m.dr, mn: m.mn, fl: m.fl, cp: m.cp, ts: m.ts, sc: m.sc, left: m.left, st: m.st, bl: m.bl, sg: m.sg };
    this.snaps.push(snap);
    while (this.snaps.length > 12) this.snaps.shift();
    if (this.snaps.length === 1) this.renderTime = m.time - INTERP;
    this.lastSnapAt = performance.now();
    this.timeLeft = m.left;
    this.running = m.st === 1;
    this.teamScore = m.ts;
    for (const [id, score, kills, deaths] of m.sc) this.scores.set(id, { score, kills, deaths });
    // projectiles / drops / mines bookkeeping
    const seenP = new Set();
    for (const a of m.pr) { seenP.add(a[PS.ID]); if (!this.projectiles.has(a[PS.ID])) this.addProjectile(a); }
    for (const [id, p] of this.projectiles) if (!seenP.has(id)) { this.scene.remove(p.mesh); this.projectiles.delete(id); }
    const seenD = new Set();
    for (const a of m.dr) { seenD.add(a[DS.ID]); if (!this.drops.has(a[DS.ID])) this.addDrop(a); }
    for (const [id, d] of this.drops) if (!seenD.has(id)) { this.scene.remove(d.group); this.drops.delete(id); }
    const seenM = new Set();
    for (const a of m.mn) { seenM.add(a[MS.ID]); const mm = this.mines.get(a[MS.ID]); if (!mm) this.addMine(a); else mm.armed = a[MS.ARMED] === 1; }
    for (const [id, mm] of this.mines) if (!seenM.has(id)) { this.scene.remove(mm.mesh); this.mines.delete(id); }
    if (m.cp) for (let i = 0; i < m.cp.length; i++) { const p = this.points[i]; if (!p) continue; [p.owner, p.capTeam] = m.cp[i]; p.cap = m.cp[i][2] / 100; setControlPointState(p.g, p.owner, p.capTeam, p.cap); }
    const mine = tanks.get(this.myId);
    if (mine && !this.me.alive) { this.me.alive = true; this.cam.snapTo(qToYaw(mine.quat)); this.cam.initialized = false; }
    if (!mine && this.me.alive) { this.me.alive = false; this.me.deadAt = this.now; }
  }

  addProjectile(a) {
    const kind = a[PS.KIND];
    let mesh;
    const color = TURRET_COLORS[kind] || 0xffffff;
    if (kind === 'thunder') {
      mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.4, 4, 8), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.4 }));
      mesh.geometry.rotateX(Math.PI / 2);
    } else if (kind === 'striker') {
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.6, roughness: 0.4 }));
      body.geometry.rotateX(Math.PI / 2);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0xff5252 }));
      tip.geometry.rotateX(Math.PI / 2); tip.position.z = 0.4;
      mesh.add(body, tip);
    } else if (kind === 'ricochet') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshBasicMaterial({ color }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.get('particle'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.4, 1.4, 1); mesh.add(glow);
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: Textures.get('particle'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(0.9, 0.9, 1); mesh.add(glow);
    }
    mesh.position.set(a[PS.X], a[PS.Y], a[PS.Z]);
    this.scene.add(mesh);
    this.projectiles.set(a[PS.ID], { mesh, kind, pos: new THREE.Vector3(a[PS.X], a[PS.Y], a[PS.Z]), vel: new THREE.Vector3(a[PS.VX], a[PS.VY], a[PS.VZ]), team: a[PS.TEAM] });
  }

  addDrop(a) {
    const type = DROP_TYPES[a[DS.TYPE]] || 'repair';
    const g = new THREE.Group();
    const gold = type === 'gold';
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.2), new THREE.MeshStandardMaterial({ color: gold ? 0xf0c330 : 0xe8e8e8, metalness: gold ? 0.8 : 0.3, roughness: 0.35, emissive: gold ? 0x6a4a00 : 0x000000 }));
    box.castShadow = true; box.position.y = 0.5; g.add(box);
    if (!gold) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.34, 1.24), new THREE.MeshStandardMaterial({ color: DROP_COLORS[type], emissive: DROP_COLORS[type], emissiveIntensity: 0.5 }));
      band.position.y = 0.5; g.add(band);
    }
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: Textures.get('parachute'), side: THREE.DoubleSide, roughness: 0.9 }));
    canopy.position.y = 3.6; chute.add(canopy);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x333333 });
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 1, z), new THREE.Vector3(x * 2.5, 3.6, z * 2.5)]);
      chute.add(new THREE.Line(geo, lineMat));
    }
    g.add(chute);
    const light = new THREE.PointLight(DROP_COLORS[type], gold ? 2.5 : 1.2, 10);
    light.position.y = 1.2; g.add(light);
    g.position.set(a[DS.X], a[DS.Y], a[DS.Z]);
    this.scene.add(g);
    this.drops.set(a[DS.ID], { group: g, chute, type, landed: a[DS.STATE] === 1, pos: new THREE.Vector3(a[DS.X], a[DS.Y], a[DS.Z]) });
  }

  addMine(a) {
    const team = a[MS.TEAM], owner = a[MS.OWNER];
    const mine = (owner === this.myId) || (this.teams && team === this.me.team);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.18, 14), new THREE.MeshStandardMaterial({ color: 0x3a3f3a, metalness: 0.6, roughness: 0.5 }));
    body.position.y = 0.09; g.add(body);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: mine ? 0x7dff7d : 0xff4040 }));
    led.position.y = 0.2; g.add(led);
    g.position.set(a[MS.X], a[MS.Y], a[MS.Z]);
    this.scene.add(g);
    this.mines.set(a[MS.ID], { mesh: g, led, armed: a[MS.ARMED] === 1, friendly: mine });
  }

  onRestart(m) {
    this.running = true;
    this.snaps.length = 0;
    if (!this.ready) { this.applyRoster(m.players || []); return; }
    this.effects.clear();
    for (const p of this.projectiles.values()) this.scene.remove(p.mesh);
    this.projectiles.clear();
    for (const d of this.drops.values()) this.scene.remove(d.group);
    this.drops.clear();
    for (const mm of this.mines.values()) this.scene.remove(mm.mesh);
    this.mines.clear();
    this.applyRoster(m.players || []);
    this.hud.notify('New battle started!', 'good');
  }

  // ---- events ------------------------------------------------------------------------
  tankPos(id) { const t = this.tanks.get(id); return t && t.visible ? [t.pos.x, t.pos.y, t.pos.z] : null; }
  nameOf(id) { const r = this.roster.get(id); return r ? r.name : (id === -1 ? '' : '?'); }
  teamOf(id) { const r = this.roster.get(id); return r ? r.team : 0; }
  isMe(id) { return id === this.myId; }
  nameHtml(id) { const r = this.roster.get(id); if (!r) return '?'; return `<span class="${this.isMe(id) ? 'me' : teamCls(r.team)}">${esc(r.name)}</span>`; }

  onEvent(e) {
    if (!this.ready) return;
    const fx = this.effects, au = this.audio, hud = this.hud;
    if (this.tutorial) this.tutorial.onEvent(e);
    switch (e.e) {
      case 'mission': {
        if (this.isMe(e.p)) { hud.notify(`Mission complete: ${e.text} (+${e.reward} crystals)`, 'gold'); au.play('rankup'); }
        break;
      }
      case 'jugger': {
        hud.notify(this.isMe(e.p) ? 'You are the Juggernaut!' : `${this.nameOf(e.p)} is the Juggernaut!`, 'gold');
        au.play('countdown');
        const t = this.tanks.get(e.p);
        if (t) refreshNameplate(t.label, this.roster.get(t.id) || t, t.id === this.myId, Math.max(0, t.lastHp), true);
        break;
      }
      case 'shot': {
        const t = this.tanks.get(e.p);
        if (t) t.mesh.kick();
        let hitTank = false;
        for (const s of e.s) {
          const dir = [s.t[0] - s.f[0], s.t[1] - s.f[1], s.t[2] - s.f[2]];
          const l = Math.hypot(...dir) || 1;
          const nd = dir.map((v) => v / l);
          if (e.k === 'railgun') fx.railBeam(s.f, s.t);
          else { fx.tracer(s.f, s.t, e.k); }
          if (s.h) { fx.impact(s.t, s.h.n, e.k, s.h.k === 'tank'); if (s.h.k === 'tank') hitTank = true; }
          if (s === e.s[0]) fx.muzzleFlash(s.f, nd, e.k);
        }
        au.play(e.k, e.s[0].f, e.k === 'vulcan' ? 0.7 : 1);
        if (this.isMe(e.p)) { if (hitTank) hud.hitMarker(); this.cam.addShake(e.k === 'railgun' || e.k === 'shaft' ? 0.5 : e.k === 'vulcan' ? 0.05 : 0.2); }
        break;
      }
      case 'fire': {
        const t = this.tanks.get(e.p);
        if (t) t.mesh.kick();
        fx.muzzleFlash(e.f, e.d, e.k);
        au.play(e.k, e.f);
        if (this.isMe(e.p)) this.cam.addShake(e.k === 'thunder' ? 0.45 : 0.15);
        break;
      }
      case 'hit': {
        if (this.isMe(e.v)) { hud.damageFlash(); au.play('hitme'); this.cam.addShake(Math.min(0.6, e.d / 60)); fx.number(e.p, '-' + e.d, '#ff5252', 0.9); }
        else if (this.isMe(e.a)) { hud.hitMarker(); fx.number(e.p, String(e.d), e.c ? '#ff8a65' : '#ffd27a', e.c ? 1.3 : 1); au.play('hit', e.p, 0.8); }
        break;
      }
      case 'heal': {
        if (this.isMe(e.v) || this.isMe(e.a)) fx.number(e.p, '+' + e.d, '#7ee57e', 0.9);
        if (this.isMe(e.v)) au.play('heal', null, 0.6);
        break;
      }
      case 'kill': {
        fx.tankExplosion(e.p);
        au.play('explosion', e.p);
        const t = this.tanks.get(e.v);
        if (t) { t.visible = false; t.mesh.group.visible = false; t.label.visible = false; }
        const turret = e.k === 'self' ? 'self-destruct' : e.k === 'void' ? 'the void' : e.k === 'mine' ? 'mine' : (getTurret(e.k)?.name || e.k);
        if (e.a >= 0 && e.a !== e.v) hud.killfeed(`${this.nameHtml(e.a)} <span class="muted">[${esc(turret)}]</span> ${this.nameHtml(e.v)}`);
        else hud.killfeed(`${this.nameHtml(e.v)} <span class="muted">${e.k === 'self' ? 'self-destructed' : 'was destroyed'}</span>`);
        if (this.isMe(e.v)) { this.me.deadAt = this.now; this.me.killer = e.a >= 0 && e.a !== e.v ? this.nameOf(e.a) : null; this.me.alive = false; this.cam.addShake(1); this.stopLoops(); }
        if (this.isMe(e.a) && e.a !== e.v) hud.notify(`Destroyed ${this.nameOf(e.v)}`, 'good');
        break;
      }
      case 'spawn': {
        fx.spawnFlash(e.pos);
        au.play('spawn', e.pos, 0.6);
        if (this.isMe(e.p)) { this.me.killer = null; this.cooldowns = {}; }
        break;
      }
      case 'boom': {
        fx.explosion(e.p, e.r, e.k);
        au.play(e.k === 'mine' ? 'mine' : 'boom', e.p);
        const d = this.me.alive ? Math.hypot(e.p[0] - this.me.pos[0], e.p[2] - this.me.pos[2]) : 99;
        if (d < 25) this.cam.addShake((1 - d / 25) * 0.8);
        break;
      }
      case 'impact': fx.impact(e.p, e.n, e.k, e.t === 1); au.play('impact', e.p, 0.4); break;
      case 'bounce': fx.bounce(e.p, e.n); au.play('bounce', e.p, 0.6); break;
      case 'charge': au.play('charge', this.tankPos(e.p)); break;
      case 'pickup': {
        fx.pickupBurst(e.pos, DROP_COLORS[e.type] || 0xffffff);
        if (this.isMe(e.p)) { au.play(e.type === 'gold' ? 'gold' : 'pickup'); hud.notify(`${DROP_NAMES[e.type] || e.type}${e.type === 'gold' ? ' +1000 crystals!' : ''}`, e.type === 'gold' ? 'gold' : 'good'); }
        break;
      }
      case 'gold': {
        if (e.ph === 'warn') { hud.notify('Gold box will be dropped soon!', 'gold'); au.play('countdown'); }
        else if (e.ph === 'drop') { hud.notify('Gold box dropped!', 'gold'); }
        else if (e.ph === 'taken') { hud.notify(`${e.n} took the gold box!`, 'gold'); hud.killfeed(`${this.nameHtml(e.p)} <span class="muted">took the</span> <span class="k">gold box</span>`); }
        break;
      }
      case 'flag': {
        const col = e.c === 'red' ? 'Red' : 'Blue';
        const mine = (e.c === 'red' && this.me.team === 1) || (e.c === 'blue' && this.me.team === 2);
        const name = this.nameOf(e.p);
        const txt = e.a === 'taken' ? `${name} took the ${col} flag` : e.a === 'dropped' ? `${col} flag dropped` : e.a === 'returned' ? `${col} flag returned` : `${name} captured the ${col} flag!`;
        hud.notify(txt, e.a === 'captured' ? (mine ? 'bad' : 'good') : (mine ? (e.a === 'returned' ? 'good' : 'bad') : 'good'));
        if (e.a === 'captured') hud.killfeed(`${this.nameHtml(e.p)} <span class="k">captured the ${col} flag</span>`);
        au.play(e.a === 'captured' || e.a === 'returned' ? 'flag' : 'flagbad');
        break;
      }
      case 'cp': {
        hud.notify(e.o ? `Point ${e.id} captured by ${TEAM_NAMES[e.o]} team` : `Point ${e.id} neutralised by ${TEAM_NAMES[e.by]} team`, e.o === this.me.team ? 'good' : 'bad');
        au.play('cp');
        break;
      }
      case 'supply': {
        if (this.isMe(e.p)) {
          const cd = e.s === 'mine' ? MINE_COOLDOWN : SUPPLY_COOLDOWN;
          this.cooldowns[e.s] = this.now + cd; this.cooldowns[e.s + '_total'] = cd;
          au.play('supply');
        }
        break;
      }
      case 'score': if (this.isMe(e.p) && e.n >= 5 && e.w !== 'kill') hud.notify(`+${e.n} ${e.w}`, 'good'); break;
      case 'rankup': {
        if (this.isMe(e.p)) { hud.notify(`Rank up: ${RANKS[e.r]?.name} (+${e.c} crystals)`, 'gold'); au.play('rankup'); }
        else hud.killfeed(`${this.nameHtml(e.p)} <span class="muted">was promoted to</span> ${esc(RANKS[e.r]?.name || '')}`);
        break;
      }
      case 'ball': {
        if (e.a === 'goal') {
          hud.notify(`GOAL! ${this.nameOf(e.p)} scored for the ${TEAM_NAMES[e.team]} team`, e.team === this.me.team ? 'good' : 'bad');
          hud.killfeed(`${this.nameHtml(e.p)} <span class="k">scored a goal</span>`);
          au.play('flag');
          if (this.ballMesh) fx.pickupBurst([this.ballMesh.position.x, this.ballMesh.position.y, this.ballMesh.position.z], 0xffd080);
        } else if (e.a === 'taken') {
          hud.notify(this.isMe(e.p) ? 'You have the ball! Drive it into the enemy goal (fire to throw)' : `${this.nameOf(e.p)} took the ball`, this.isMe(e.p) || this.teamOf(e.p) === this.me.team ? 'good' : 'bad');
          au.play(this.isMe(e.p) ? 'pickup' : 'cp', null, 0.6);
        } else if (e.a === 'thrown') au.play('bounce', null, 0.6);
        else if (e.a === 'dropped') hud.notify('The ball is loose', '');
        else if (e.a === 'reset') hud.notify('Ball reset to the centre', '');
        break;
      }
      case 'siege': {
        const att = TEAM_NAMES[e.team];
        if (e.a === 'start') hud.notify(`Round ${e.round}: ${att} team attacks${e.team === this.me.team ? ' — capture the point!' : ' — hold the point!'}`, 'gold');
        else if (e.a === 'captured') hud.notify(`${att} team captured the point!`, e.team === this.me.team ? 'good' : 'bad');
        else if (e.a === 'held') hud.notify(`${att} team held the point!`, e.team === this.me.team ? 'good' : 'bad');
        au.play(e.a === 'start' ? 'countdown' : 'cp');
        break;
      }
      case 'drone': {
        const pos = this.tankPos(e.p);
        if (pos) fx.healSparks(pos);
        if (this.isMe(e.p)) { hud.notify(`${(getDrone(e.id) || { name: 'Drone' }).name} drone activated`, 'good'); au.play('heal', null, 0.7); }
        break;
      }
      case 'container': {
        if (this.isMe(e.p)) { hud.notify(`You earned a container (${e.why}) — open it in the garage`, 'gold'); au.play('gold'); }
        break;
      }
      case 'sys': hud.chat({ sys: true, msg: e.m }); break;
      case 'chat': hud.chat({ name: e.n, team: e.tm, msg: e.m, teamOnly: e.to === 'team', me: this.isMe(e.p) }); if (!this.isMe(e.p)) au.play('chat'); break;
      case 'sd': if (this.isMe(e.p)) { hud.notify('Self-destruct!', 'bad'); au.play('sd'); } break;
      default: break;
    }
  }

  // ---- input ---------------------------------------------------------------------------
  useSupply(id) { this.net.send({ t: C2S.SUPPLY, id }); }
  openChat(team) { this.hud.openChat(team); this.input.textFocus = true; }
  toggleMouseAim() {
    this.mouseAim = !this.mouseAim;
    this.app.setSettings({ mouseAim: this.mouseAim });
    this.cam.snapTo(this.me.yaw + (this.me.state ? this.me.state.turretYaw : 0));
    this.hud.notify(this.mouseAim ? 'Mouse aiming' : 'Keyboard aiming', 'good');
    this.hud.setHint(this.mouseAim ? 'WASD drive · Mouse aim · LMB fire · 1-5 supplies · F keyboard mode · Tab scores · Enter chat · Esc menu' : 'WASD drive · Z/X turret · Space fire · C center · 1-5 supplies · F mouse mode · Tab scores · Enter chat · Esc menu');
  }
  setPaused(p) {
    this.paused = p;
    this.input.enabled = !p;
    if (p) { this.input.releaseLock(); this.input.keys.clear(); this.sendInput(true); }
  }

  sendInput(zero = false) {
    const c = zero || this.paused || !this.running || this.input.textFocus ? { f: 0, t: 0, tt: 0, fire: false } : this.input.getControls();
    let yaw = null;
    if (!zero && this.me.alive) {
      if (this.mouseAim) yaw = this.cam.orbitYaw;
      else if (this.now < this.centerUntil) { yaw = this.me.yaw; if (this.me.state && Math.abs(this.me.state.turretYaw) < 0.04) this.centerUntil = 0; }
    }
    this.net.send({ t: C2S.INPUT, f: c.f, r: c.t, tt: c.tt, fire: c.fire, yaw, seq: ++this.seq });
  }

  stopLoops() {
    for (const key of this.loops) this.audio.loop(key, null, null, false);
    this.loops.clear();
  }

  // ---- frame ---------------------------------------------------------------------------
  update(dt) {
    if (!this.ready) return;
    this.now += dt;
    const snaps = this.snaps;
    if (!snaps.length) return;
    const latest = snaps[snaps.length - 1];
    const target = latest.time - INTERP;
    this.renderTime += dt;
    this.renderTime += (target - this.renderTime) * Math.min(1, dt * 3);
    if (this.renderTime > latest.time) this.renderTime = latest.time;
    if (this.renderTime < snaps[0].time) this.renderTime = snaps[0].time;
    let a = snaps[0], b = snaps[0];
    for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].time <= this.renderTime && snaps[i + 1].time >= this.renderTime) { a = snaps[i]; b = snaps[i + 1]; break; }
    if (snaps.length > 1 && this.renderTime >= latest.time) { a = snaps[snaps.length - 2]; b = latest; }
    const span = b.time - a.time;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (this.renderTime - a.time) / span)) : 1;

    // tanks
    for (const t of this.tanks.values()) {
      const sa = a.tanks.get(t.id), sb = b.tanks.get(t.id);
      const s = sb || sa;
      if (!s) {
        if (t.visible) { t.visible = false; t.mesh.group.visible = false; t.label.visible = false; }
        t.state = null;
        continue;
      }
      let pos, quat, ty;
      if (sa && sb && sa !== sb) {
        pos = [sa.pos[0] + (sb.pos[0] - sa.pos[0]) * alpha, sa.pos[1] + (sb.pos[1] - sa.pos[1]) * alpha, sa.pos[2] + (sb.pos[2] - sa.pos[2]) * alpha];
        tmpQ.set(...sa.quat); tmpQ2.set(...sb.quat); tmpQ.slerp(tmpQ2, alpha); quat = tmpQ;
        ty = sa.turretYaw + angleDiff(sa.turretYaw, sb.turretYaw) * alpha;
      } else { pos = s.pos; quat = tmpQ.set(...s.quat); ty = s.turretYaw; }
      const g = t.mesh.group;
      g.position.set(pos[0], pos[1], pos[2]);
      g.quaternion.copy(quat);
      t.mesh.turretGroup.rotation.y = ty;
      t.pos.set(pos[0], pos[1], pos[2]);
      t.yaw = qToYaw([quat.x, quat.y, quat.z, quat.w]);
      t.turretYaw = ty;
      t.speed = s.speed;
      t.state = s;
      const up = tmpV.set(0, 1, 0).applyQuaternion(quat);
      t.up = [up.x, up.y, up.z];
      if (!t.visible) { t.visible = true; g.visible = true; t.label.visible = true; }
      const firing = !!(s.flags & TF.FIRING);
      t.mesh.animate(dt, s.speed, firing && t.turret === 'vulcan');
      // label
      t.label.position.set(pos[0], pos[1] + t.tsize[1] / 2 + 1.25, pos[2]);
      const hpFrac = t.maxHp ? s.hp / t.maxHp : 1;
      if (Math.abs(hpFrac - t.lastHp) > 0.01) {
        t.lastHp = hpFrac;
        const bar = t.label.userData.hp;
        if (bar) { bar.style.width = Math.round(Math.max(0, Math.min(1, hpFrac)) * 100) + '%'; bar.classList.toggle('low', hpFrac < 0.3); }
      }
      t.label.visible = t.id !== this.myId || !this.cam.sniper;
      // status visuals
      const da = s.flags & TF.DA, prot = s.flags & TF.PROTECTED, dd = s.flags & TF.DD, jug = s.flags & TF.JUGGER;
      if (da || prot || dd || jug) {
        t.aura.visible = true;
        const pulse = 0.5 + 0.5 * Math.sin(this.now * (prot ? 14 : 4));
        if (prot) { t.aura.material.color.setHex(0xdfe9ff); t.aura.material.opacity = 0.02 + 0.05 * pulse; }
        else if (jug) { t.aura.material.color.setHex(0xffc040); t.aura.material.opacity = 0.07 + 0.05 * pulse; }
        else if (da) { t.aura.material.color.setHex(0x4da6ff); t.aura.material.opacity = 0.05 + 0.04 * pulse; }
        else { t.aura.material.color.setHex(0xff8040); t.aura.material.opacity = 0.04 + 0.03 * pulse; }
        if (dd && da) t.aura.material.color.setHex(0xc080ff);
      } else t.aura.visible = false;
      if (!!jug !== !!t.jugger) { t.jugger = !!jug; refreshNameplate(t.label, this.roster.get(t.id) || t, t.id === this.myId, hpFrac, t.jugger); }
      if (jug && Math.random() < dt * 20) this.effects.sparks.emit({ pos: [pos[0] + (Math.random() - 0.5) * 2.4, pos[1] + Math.random() * 1.2, pos[2] + (Math.random() - 0.5) * 2.4], vel: [0, 1.5, 0], color: 0xffc040, size: 0.3, life: 0.8 });
      if (s.flags & TF.BURNING) this.effects.burnEmit(pos, dt);
      if (s.flags & TF.FROZEN) this.effects.frostEmit(pos, dt);
      const back = [-Math.sin(t.yaw) * (t.tsize[2] / 2 + 0.3), 0, -Math.cos(t.yaw) * (t.tsize[2] / 2 + 0.3)];
      if (s.flags & TF.NITRO) this.effects.nitroEmit(pos, back, dt);
      else if (Math.abs(s.speed) > 0.5) this.effects.exhaust([pos[0], pos[1] + 0.3, pos[2]], back, dt, s.speed);
      if (Math.abs(s.speed) > 4 && this.map.theme.ground !== 'asphalt') this.effects.dust(pos, dt, s.speed, this.map.theme.ground === 'snow' ? 0xdde6ee : this.map.theme.ground === 'grass' ? 0x6f8a56 : 0xb9a37a);
      // weapon continuous effects
      const turret = getTurret(t.turret);
      const loopKey = 'w' + t.id;
      t.mesh.muzzle.getWorldPosition(tmpV);
      const mpos = [tmpV.x, tmpV.y, tmpV.z];
      tmpV2.set(0, 0, 1).applyQuaternion(t.mesh.turretGroup.getWorldQuaternion(tmpQ2));
      const mdir = [tmpV2.x, tmpV2.y, tmpV2.z];
      if (firing && turret.kind === 'stream') { this.effects.streamEmit(t.turret, mpos, mdir, dt, turret.range); this.audio.loop(loopKey, t.turret, pos, true); this.loops.add(loopKey); }
      else if (firing && turret.kind === 'beam' && s.target != null) {
        const tgt = this.tanks.get(s.target);
        if (tgt && tgt.visible) { const enemy = !this.teams || tgt.team !== t.team; this.effects.isidaBeam(loopKey, mpos, [tgt.pos.x, tgt.pos.y + 0.4, tgt.pos.z], enemy); if (enemy) this.effects.healSparks([t.pos.x, t.pos.y, t.pos.z]); else this.effects.healSparks([tgt.pos.x, tgt.pos.y, tgt.pos.z]); }
        this.audio.loop(loopKey, 'isida', pos, true); this.loops.add(loopKey);
      } else if (firing && t.turret === 'vulcan') { this.audio.loop(loopKey, 'vulcan', pos, true); this.loops.add(loopKey); }
      else if (this.loops.has(loopKey)) { this.audio.loop(loopKey, null, null, false); this.loops.delete(loopKey); }
      if ((s.flags & TF.CHARGING) && (turret.kind === 'rail' || t.turret === 'shaft')) this.effects.chargeGlow(mpos, s.charge, t.turret);
      if (t.id === this.myId) {
        this.me.pos = pos; this.me.yaw = t.yaw; this.me.state = s; this.me.hp = s.hp; this.me.up = t.up; this.me.muzzle = tmpV.clone(); this.me.muzzleDir = tmpV2.clone();
      }
    }

    // projectiles
    for (const [id, p] of this.projectiles) {
      const ea = a.pr.find((x) => x[PS.ID] === id), eb = b.pr.find((x) => x[PS.ID] === id);
      if (ea && eb && ea !== eb) p.pos.set(ea[PS.X] + (eb[PS.X] - ea[PS.X]) * alpha, ea[PS.Y] + (eb[PS.Y] - ea[PS.Y]) * alpha, ea[PS.Z] + (eb[PS.Z] - ea[PS.Z]) * alpha);
      else if (eb || ea) { const e = eb || ea; const dtp = this.renderTime - (eb ? b.time : a.time); p.pos.set(e[PS.X] + e[PS.VX] * dtp, e[PS.Y] + e[PS.VY] * dtp, e[PS.Z] + e[PS.VZ] * dtp); p.vel.set(e[PS.VX], e[PS.VY], e[PS.VZ]); }
      p.mesh.position.copy(p.pos);
      if (p.vel.lengthSq() > 0.01) { tmpV.copy(p.pos).add(p.vel); p.mesh.lookAt(tmpV); }
      if (p.kind === 'striker') this.effects.fire.emit({ pos: [p.pos.x, p.pos.y, p.pos.z], vel: [-p.vel.x * 0.1, 0.5, -p.vel.z * 0.1], color: 0xffa040, size: 0.6, life: 0.3, grow: 2 });
      else if (p.kind === 'thunder' && Math.random() < dt * 40) this.effects.smoke.emit({ pos: [p.pos.x, p.pos.y, p.pos.z], vel: [0, 0.5, 0], color: 0x777777, size: 0.5, life: 0.6, grow: 2, alpha: 0.4 });
      else if (p.kind === 'ricochet' && Math.random() < dt * 30) this.effects.sparks.emit({ pos: [p.pos.x, p.pos.y, p.pos.z], vel: [0, 0, 0], color: 0x4dd0e1, size: 0.35, life: 0.3 });
    }
    // drops
    for (const [id, d] of this.drops) {
      const ea = a.dr.find((x) => x[DS.ID] === id), eb = b.dr.find((x) => x[DS.ID] === id);
      const e = eb || ea;
      if (ea && eb && ea !== eb) d.group.position.set(ea[DS.X], ea[DS.Y] + (eb[DS.Y] - ea[DS.Y]) * alpha, ea[DS.Z]);
      else if (e) d.group.position.set(e[DS.X], e[DS.Y], e[DS.Z]);
      d.landed = e ? e[DS.STATE] === 1 : d.landed;
      d.chute.visible = !d.landed;
      if (!d.landed) d.group.rotation.y += dt * 0.3;
      else { d.group.rotation.y += dt * 1.2; d.group.children[0].position.y = 0.5 + Math.sin(this.now * 2) * 0.1; }
    }
    // mines
    for (const mm of this.mines.values()) mm.led.material.color.setHex(mm.armed ? (Math.sin(this.now * 6) > 0 ? (mm.friendly ? 0x7dff7d : 0xff4040) : 0x202020) : 0xffff40);
    // flags
    if (this.mode === 'CTF' && b.fl) {
      for (const [color, key] of [['red', 'r'], ['blue', 'b']]) {
        const f = this.flags[color];
        const fa = a.fl ? a.fl[key] : b.fl[key], fb = b.fl[key];
        if (fb[0] === 1) {
          const carrier = this.tanks.get(fb[4]);
          if (carrier && carrier.visible) f.position.set(carrier.pos.x, carrier.pos.y + carrier.tsize[1] / 2 + 0.2, carrier.pos.z);
          else f.position.set(fb[1], fb[2], fb[3]);
        } else f.position.set(fa[1] + (fb[1] - fa[1]) * alpha, fa[2] + (fb[2] - fa[2]) * alpha, fa[3] + (fb[3] - fa[3]) * alpha);
        animateFlag(f, this.now);
      }
    }

    // rugby ball: carried above its carrier, otherwise interpolated between snapshots
    if (this.ballMesh) {
      const bl = latest.bl;
      if (!bl) this.ballMesh.visible = false;
      else {
        this.ballMesh.visible = true;
        const ct = bl[3] >= 0 ? this.tanks.get(bl[3]) : null;
        if (ct && ct.visible) this.ballMesh.position.set(ct.pos.x, ct.pos.y + ct.tsize[1] / 2 + 1.0 + Math.sin(this.now * 4) * 0.1, ct.pos.z);
        else { const ba = a.bl || bl, bb = b.bl || bl; this.ballMesh.position.set(ba[0] + (bb[0] - ba[0]) * alpha, ba[1] + (bb[1] - ba[1]) * alpha, ba[2] + (bb[2] - ba[2]) * alpha); }
        this.ballMesh.userData.ball.rotation.y += dt * 2;
      }
    }
    // siege point moves between rounds
    if (this.mode === 'SGE' && latest.sg && this.points[0]) this.points[0].g.position.set(latest.sg[3], latest.sg[4], latest.sg[5]);
    // drones hover beside their tanks
    for (const t of this.tanks.values()) if (t.droneObj && t.visible) { t.droneObj.position.y = t.droneObj.userData.baseY + Math.sin(this.now * 3 + t.id) * 0.12; t.droneObj.userData.rotors.rotation.y += dt * 25; }

    // local player / camera
    const me = this.me;
    const meTank = this.tanks.get(this.myId);
    const sniper = !!(me.state && (me.state.flags & TF.SNIPER));
    if (this.mouseAim && !this.paused && !this.input.textFocus) {
      const m = this.input.consumeMouse();
      const sens = (this.app.settings.sensitivity || 1) * (sniper ? 0.3 : 1);
      this.cam.addOrbit(m.dx * sens, m.dy * sens * (this.app.settings.invertY ? -1 : 1));
      if (m.wheel) this.cam.zoom(m.wheel * 1.5);
    } else {
      const m = this.input.consumeMouse();
      if (m.wheel) this.cam.zoom(m.wheel * 1.5);
    }
    if (me.alive && meTank && meTank.visible) {
      this.cam.update(dt, { pos: [meTank.pos.x, meTank.pos.y, meTank.pos.z], yaw: meTank.yaw, turretYaw: meTank.turretYaw, up: meTank.up }, this.map, { mouseAim: this.mouseAim, sniper, muzzle: me.muzzle, muzzleDir: me.muzzleDir });
    } else {
      // dead: slow orbit around last position
      this.cam.orbitYaw += dt * 0.25;
      this.cam.update(dt, { pos: me.pos, yaw: this.cam.orbitYaw, turretYaw: 0, up: [0, 1, 0] }, this.map, { mouseAim: true, sniper: false });
    }
    this.sky.update(this.view.camera, meTank && meTank.visible ? meTank.pos : new THREE.Vector3(...me.pos));
    this.audio.setListener([this.view.camera.position.x, this.view.camera.position.y, this.view.camera.position.z], Math.atan2(-this.view.camera.matrixWorld.elements[8], -this.view.camera.matrixWorld.elements[10]));
    this.audio.updateEngine(dt, me.state ? Math.min(1, Math.abs(me.state.speed) / 12) : 0, me.alive && !this.paused);
    if (this.foliage && this.foliage.userData.update) this.foliage.userData.update(dt, this.view.camera.position, meTank && meTank.visible ? meTank.pos : null);
    this.effects.ambient(dt, this.view.camera.position, this.map.theme.ground);
    this.effects.update(dt);

    // input send
    this.inputTimer += dt;
    if (this.inputTimer >= 1 / 30) { this.inputTimer = 0; this.sendInput(); }

    // HUD
    const turret = meTank ? getTurret(meTank.turret) : null;
    let energyKind = null, energy = 100, charge = 0;
    if (me.state && turret) {
      if (turret.kind === 'stream' || turret.kind === 'beam') { energyKind = 'energy'; energy = me.state.energy; }
      else if (meTank.turret === 'vulcan') { energyKind = 'heat'; energy = 100 - me.state.energy; }
      else if (turret.clip) { energyKind = 'clip'; energy = me.state.charge * 100; }
      else if (turret.kind === 'rail' || meTank.turret === 'shaft') { energyKind = me.state.flags & TF.CHARGING ? 'charge' : null; charge = me.state.flags & TF.CHARGING ? (meTank.turret === 'shaft' ? me.state.charge / turret.chargeTime : me.state.charge / turret.charge) : 0; if (meTank.turret === 'shaft') charge = Math.min(1, me.state.charge); }
    }
    this.hud.setLocal({ hp: me.alive ? me.hp : 0, maxHp: me.maxHp, energy, energyKind, charge, sniper, alive: me.alive });
    const supplies = this.app.profile?.supplies || {};
    const f = me.state ? me.state.flags : 0;
    this.hud.setSupplies(supplies, this.cooldowns, this.now, { repair: f & TF.REPAIR, da: f & TF.DA, dd: f & TF.DD, nitro: f & TF.NITRO });
    this.hud.setTimer(this.timeLeft, this.running);
    let leader = null;
    if (!this.teams) for (const [id, sc] of this.scores) { if (!leader || sc.kills > leader.kills) leader = { name: this.nameOf(id), kills: sc.kills }; }
    this.hud.setScores(this.mode, this.teamScore, this.info.scoreLimit, leader);
    if (this.mode === 'JGR') {
      const jr = [...this.roster.values()].find((r) => r.jugger);
      const jt = jr ? this.tanks.get(jr.id) : null;
      this.hud.setObjectives('JGR', null, null, me.team, this.roster, jr ? { name: jr.name, hp: jt && jt.state ? jt.state.hp : 0, maxHp: jr.maxHp, me: jr.id === this.myId } : null);
    } else if (this.mode === 'RGB') {
      const bl = latest.bl;
      const carrier = bl && bl[3] >= 0 ? this.roster.get(bl[3]) : null;
      this.hud.setObjectives('RGB', null, null, me.team, this.roster, { carrierName: carrier ? carrier.name : null, carrierTeam: carrier ? carrier.team : 0, loose: !!bl && !carrier, me: !!carrier && carrier.id === this.myId });
    } else if (this.mode === 'SGE') {
      const sg = latest.sg;
      this.hud.setObjectives('SGE', null, this.points, me.team, this.roster, sg ? { attacker: sg[0], round: sg[1], left: sg[2], myTeam: me.team } : null);
    } else this.hud.setObjectives(this.mode, b.fl, this.points, me.team, this.roster);
    if (this.tutorial) this.tutorial.update(dt);
    const status = [];
    if (f & TF.DA) status.push({ cls: 'da', text: 'Double armor' });
    if (f & TF.DD) status.push({ cls: 'dd', text: 'Double damage' });
    if (f & TF.NITRO) status.push({ cls: 'nitro', text: 'Nitro' });
    if (f & TF.FLAG) status.push({ cls: 'flag', text: 'Carrying the flag — bring it home!' });
    if (this.mode === 'RGB' && latest.bl && latest.bl[3] === this.myId) status.push({ cls: 'flag', text: 'You have the ball — drive it into the enemy goal! Fire to throw' });
    if (f & TF.PROTECTED) status.push({ cls: '', text: 'Spawn protection' });
    if (f & TF.FROZEN) status.push({ cls: 'da', text: 'Frozen' });
    if (f & TF.BURNING) status.push({ cls: 'dd', text: 'Burning' });
    this.hud.setStatus(status);
    if (!me.alive && this.running) this.hud.setRespawn(RESPAWN_DELAY - (this.now - me.deadAt), me.killer);
    else this.hud.setRespawn(null);
    this.hud.setScoreboard(this.showScoreboard || !this.running, this.roster, this.scores, this.myId, this.mode, this.teamScore);
    this.fps.frames++; this.fps.t += dt;
    if (this.fps.t >= 1) { this.fps.value = Math.round(this.fps.frames / this.fps.t); this.fps.frames = 0; this.fps.t = 0; this.hud.setFps(this.app.settings.showFps ? this.fps.value : 0); }
  }

  destroy() {
    this.destroyed = true;
    for (const u of this.unsubs) u();
    if (this.tutorial) { this.tutorial.destroy(); this.tutorial = null; }
    this.stopLoops();
    this.audio.updateEngine(0.1, 0, false);
    this.input.enabled = false;
    this.input.wantLock = false;
    this.input.textFocus = false;
    this.input.releaseLock();
    this.hud.hide();
    if (this.effects) this.effects.clear();
    if (this.foliage && this.foliage.userData.dispose) this.foliage.userData.dispose();
    for (const t of this.tanks.values()) { t.mesh.dispose(); }
    this.tanks.clear();
    this.cam.setOccluders([]);
    this.cam.setBounds(null, null);
    if (this.sky && this.sky.dispose) this.sky.dispose();
    this.view.clearScene();
  }
}
