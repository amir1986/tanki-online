// Garage: buy / upgrade / equip hulls, turrets, paints and supplies, with a live 3D preview.
import * as THREE from 'three';
import { HULLS, TURRETS, PAINTS, SUPPLIES, hullStats, turretStats, upgradePrice, upgradeRank, rankForXp, RANKS, MAX_MOD, getHull, getTurret, getPaint } from '/shared/items.mjs';
import { buildTank } from '../render/tankmesh.mjs';
import { buildSky } from '../render/sky.mjs';
import { Textures } from '../render/textures.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const SHOWROOM_THEME = {
  ground: 'sand',
  sky: { top: 0x1d2d4a, horizon: 0xf2b677, ground: 0x4a3a30 },
  fog: { color: 0xd9a070, near: 60, far: 220 }, fogDensity: 0.0015,
  sun: [-60, 22, 80], sunColor: 0xffd2a0, sunIntensity: 2.6,
  hemi: [0x9fb8e8, 0x6a5040], hemiIntensity: 0.8,
  turbidity: 8, rayleigh: 2.5, mie: 0.012, envIntensity: 0.7,
};

export class Showroom {
  constructor(view) {
    this.view = view;
    this.scene = view.scene;
    this.tank = null;
    this.t = 0;
    this.built = false;
    this.equip = null;
  }

  build(equip) {
    this.view.clearScene();
    this.sky = buildSky(SHOWROOM_THEME, this.scene, this.view.renderer);
    const sand = Textures.ground('sand');
    const tex = sand.map.clone(); tex.repeat.set(30, 30); tex.needsUpdate = true;
    const ntex = sand.normal.clone(); ntex.repeat.set(30, 30); ntex.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({ map: tex, normalMap: ntex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const metal = Textures.prop('metal');
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.3, 40), new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normal, roughness: 0.5, metalness: 0.6 }));
    pad.position.y = 0.15;
    pad.receiveShadow = true; pad.castShadow = true;
    this.scene.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.7, 5.0, 48), new THREE.MeshBasicMaterial({ color: 0x8fe03a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    this.scene.add(ring);
    // a few props for scenery
    const crateTex = Textures.prop('crate');
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTex.map, normalMap: crateTex.normal, roughness: 0.85 });
    for (const [x, z, s] of [[9, -6, 2], [11, -4, 2], [10, -5, 2], [-10, 5, 1.6], [-12, 8, 2.2]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(x, s / 2, z); c.castShadow = true; c.receiveShadow = true; c.rotation.y = x * 0.3;
      this.scene.add(c);
    }
    const contTex = Textures.prop('container');
    const contMat = new THREE.MeshStandardMaterial({ map: contTex.map, normalMap: contTex.normal, color: 0x2f5f94, roughness: 0.55, metalness: 0.55 });
    const cont = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.7, 6.2), contMat);
    cont.position.set(-9, 1.35, -9); cont.rotation.y = 0.6; cont.castShadow = true; cont.receiveShadow = true;
    this.scene.add(cont);
    this.tank = null;
    this.setTank(equip);
    this.built = true;
    this.view.camera.position.set(0, 3.2, 9.5);
    this.view.camera.lookAt(0, 0.8, 0);
  }

  setTank(equip) {
    if (!equip) return;
    if (this.tank && this.equip && this.equip.hull === equip.hull && this.equip.turret === equip.turret && this.equip.paint === equip.paint) return;
    if (this.tank) { this.scene.remove(this.tank.group); this.tank.dispose(); }
    this.tank = buildTank({ hull: equip.hull, turret: equip.turret, paint: equip.paint, team: 0 });
    this.tank.group.position.y = 0.3 + this.tank.size[1] / 2 + 0.45;
    this.scene.add(this.tank.group);
    this.equip = { ...equip };
  }

  update(dt) {
    this.t += dt;
    if (this.tank) this.tank.group.rotation.y = this.t * 0.4;
    const cam = this.view.camera;
    cam.position.set(Math.sin(this.t * 0.05) * 0.8, 3.2 + Math.sin(this.t * 0.3) * 0.1, 9.5);
    cam.lookAt(0, 0.9, 0);
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    this.sky.update(cam, new THREE.Vector3(0, 0, 0));
  }
}

export class Garage {
  constructor(app) {
    this.app = app;
    this.tab = 'hull';
    this.selected = null;
    this.fromBattle = false;
    this.$ = (id) => document.getElementById(id);
  }

  open(fromBattle) {
    this.fromBattle = fromBattle;
    const e = this.app.profile.equipped;
    this.selected = this.tab === 'hull' ? e.hull : this.tab === 'turret' ? e.turret : this.tab === 'paint' ? e.paint : 'repair';
    if (!fromBattle && !this.app.showroom.built) this.app.showroom.build(this.app.equip());
    this.render();
  }

  previewEquip() {
    const e = { ...this.app.equip() };
    if (this.tab === 'hull' && this.selected) e.hull = this.selected;
    if (this.tab === 'turret' && this.selected) e.turret = this.selected;
    if (this.tab === 'paint' && this.selected) e.paint = this.selected;
    return e;
  }

  render() {
    const app = this.app, p = app.profile;
    const rank = rankForXp(p.xp).index;
    const owned = (kind, id) => kind === 'hull' ? p.hulls[id] != null : kind === 'turret' ? p.turrets[id] != null : kind === 'paint' ? p.paints.includes(id) : true;
    const modOf = (kind, id) => kind === 'hull' ? p.hulls[id] | 0 : p.turrets[id] | 0;
    const tabs = [['hull', 'Hulls'], ['turret', 'Turrets'], ['paint', 'Paints'], ['supply', 'Supplies']];
    const list = this.tab === 'hull' ? HULLS : this.tab === 'turret' ? TURRETS : this.tab === 'paint' ? PAINTS : SUPPLIES;
    const item = (it) => {
      const kind = this.tab;
      const own = owned(kind, it.id);
      const eq = kind === 'hull' ? p.equipped.hull === it.id : kind === 'turret' ? p.equipped.turret === it.id : kind === 'paint' ? p.equipped.paint === it.id : false;
      const locked = !own && rank < (it.rank || 0);
      const sw = kind === 'paint' ? `background:${hex(it.color)}` : kind === 'supply' ? `background:${hex(it.color)}` : `background:linear-gradient(135deg, ${hex((it.color || 0x6b8e3a))}, #223)`;
      const tag = kind === 'supply' ? `<span class="tag">${p.supplies[it.id] | 0}</span>` : eq ? '<span class="tag equipped">Equipped</span>' : own ? (kind !== 'paint' ? `<span class="tag">M${modOf(kind, it.id)}</span>` : '<span class="tag">Owned</span>') : locked ? `<span class="tag">Rank ${it.rank}</span>` : `<span class="tag price">${it.price}</span>`;
      return `<div class="item-card ${this.selected === it.id ? 'selected' : ''} ${locked ? 'locked' : ''}" data-id="${it.id}"><div class="swatch" style="${sw}"></div><div><div class="title">${esc(it.name)}</div><div class="sub">${kind === 'turret' ? esc(it.kind) : kind === 'hull' ? `${it.hp} armor · ${it.speed} m/s` : kind === 'paint' ? esc(Object.keys(it.resist).length ? 'Resists: ' + Object.entries(it.resist).map(([k, v]) => `${getTurret(k).name} ${Math.round(v * 100)}%`).join(', ') : 'No resistances') : `${it.price} crystals each`}</div></div>${tag}</div>`;
    };
    this.$('screen-garage').innerHTML = `${app.screens.topbar()}
      <div class="garage-body">
        <div class="garage-left">
          <div class="garage-tabs">${tabs.map(([id, name]) => `<button class="${this.tab === id ? 'active' : ''}" data-tab="${id}">${name}</button>`).join('')}</div>
          <div class="item-list" id="garage-list">${list.map(item).join('')}</div>
          <div style="padding:10px;display:flex;gap:8px"><button class="btn secondary wide" id="garage-back">${this.fromBattle ? 'Back to battle' : 'Back'}</button></div>
        </div>
        <div class="garage-center"><div class="hint">${this.fromBattle ? 'Changes apply when you respawn' : 'Your tank'}</div></div>
        <div class="garage-right" id="garage-details"></div>
      </div>`;
    for (const b of this.$('screen-garage').querySelectorAll('.garage-tabs button')) b.onclick = () => { this.tab = b.dataset.tab; const e = p.equipped; this.selected = this.tab === 'hull' ? e.hull : this.tab === 'turret' ? e.turret : this.tab === 'paint' ? e.paint : 'repair'; app.audio.play('click'); this.render(); };
    for (const el of this.$('garage-list').querySelectorAll('.item-card')) el.onclick = () => { this.selected = el.dataset.id; app.audio.play('click'); this.render(); };
    this.$('garage-back').onclick = () => { app.audio.play('click'); if (this.fromBattle) app.showScreen('pause'); else app.showScreen('menu'); };
    this.renderDetails();
    if (!this.fromBattle) app.showroom.setTank(this.previewEquip());
  }

  renderDetails() {
    const app = this.app, p = app.profile, d = this.$('garage-details');
    const rank = rankForXp(p.xp).index;
    const kind = this.tab, id = this.selected;
    const btn = (label, cls, disabled, onclick, idAttr) => `<button class="btn ${cls} wide" ${disabled ? 'disabled' : ''} id="${idAttr}">${label}</button>`;
    const stat = (k, v, v2) => `<div class="stat"><span>${k}</span><span><b>${v}</b>${v2 != null && v2 !== v ? ` <span class="muted">→ ${v2}</span>` : ''}</span></div>`;
    let html = '', wire = () => {};
    if (kind === 'hull' || kind === 'turret') {
      const it = kind === 'hull' ? getHull(id) : getTurret(id);
      const own = kind === 'hull' ? p.hulls[id] != null : p.turrets[id] != null;
      const m = (kind === 'hull' ? p.hulls[id] : p.turrets[id]) | 0;
      const equipped = p.equipped[kind] === id;
      const next = own && m < MAX_MOD ? m + 1 : null;
      const sNow = kind === 'hull' ? hullStats(id, own ? m : 0) : turretStats(id, own ? m : 0);
      const sNext = next != null ? (kind === 'hull' ? hullStats(id, next) : turretStats(id, next)) : null;
      html += `<h2>${esc(it.name)} ${own ? `<span class="muted">M${m}</span>` : ''}</h2><p class="muted small">${esc(it.desc)}</p>`;
      html += `<div class="mod-pips">${[0, 1, 2, 3].map((i) => `<span class="${own && i <= m ? 'on' : ''}"></span>`).join('')}</div>`;
      if (kind === 'hull') {
        html += stat('Armor', sNow.hp, sNext?.hp) + stat('Speed', sNow.speed + ' m/s', sNext && sNext.speed + ' m/s') + stat('Acceleration', sNow.accel, sNext?.accel) + stat('Turn rate', sNow.turn.toFixed(2), sNext && sNext.turn.toFixed(2)) + stat('Mass', sNow.mass + ' kg');
      } else {
        if (sNow.damage != null) html += stat(it.pellets ? 'Damage per pellet' : 'Damage', sNow.damage, sNext?.damage);
        if (sNow.chargedDamage != null) html += stat('Charged damage', sNow.chargedDamage, sNext?.chargedDamage);
        if (sNow.dps != null) html += stat('Damage / sec', sNow.dps, sNext?.dps);
        if (sNow.heal != null) html += stat('Heal / sec', sNow.heal, sNext?.heal);
        if (sNow.cooldown != null && it.kind !== 'stream') html += stat('Reload', sNow.cooldown + ' s', sNext && sNext.cooldown + ' s');
        if (sNow.charge != null) html += stat('Charge time', sNow.charge + ' s', sNext && sNext.charge + ' s');
        if (sNow.clip) html += stat('Clip', sNow.clip + ' rounds');
        if (sNow.reload) html += stat('Clip reload', sNow.reload + ' s', sNext && sNext.reload + ' s');
        if (sNow.range != null) html += stat('Range', sNow.range + ' m', sNext && sNext.range + ' m');
        if (it.splash) html += stat('Splash radius', it.splash + ' m');
        if (it.bounces) html += stat('Bounces', it.bounces);
        if (it.crit) html += stat('Critical chance', Math.round(it.crit * 100) + '%');
        if (it.burnDps) html += stat('Burn', it.burnDps + ' dps for ' + it.burnTime + ' s');
        if (it.slow) html += stat('Slow', Math.round(it.slow * 100) + '%');
        if (it.pellets) html += stat('Pellets', it.pellets);
        if (it.homing) html += stat('Homing', 'yes');
      }
      html += `<div class="stat"><span>Rank required</span><span><b>${RANKS[it.rank].name}</b></span></div>`;
      if (!own) {
        const can = rank >= it.rank && p.crystals >= it.price;
        html += `<div class="stat"><span>Price</span><span class="crystals">${it.price}</span></div>`;
        html += btn(rank < it.rank ? `Requires ${RANKS[it.rank].name}` : p.crystals < it.price ? 'Not enough crystals' : 'Buy', '', !can, null, 'g-buy');
      } else {
        if (!equipped) html += btn('Equip', '', false, null, 'g-equip'); else html += btn('Equipped', 'secondary', true, null, 'g-eq-disabled');
        if (next != null) {
          const price = upgradePrice(it, next), rreq = upgradeRank(it, next);
          const can = rank >= rreq && p.crystals >= price;
          html += `<div class="stat" style="margin-top:8px"><span>Upgrade to M${next}</span><span class="crystals">${price}</span></div>`;
          html += btn(rank < rreq ? `M${next} needs ${RANKS[rreq].name}` : p.crystals < price ? 'Not enough crystals' : `Upgrade to M${next}`, 'secondary', !can, null, 'g-upgrade');
        } else html += `<div class="stat"><span>Modification</span><span><b>MAX</b></span></div>`;
      }
      wire = () => {
        this.$('g-buy')?.addEventListener('click', () => app.garageOp('buy', kind, id));
        this.$('g-equip')?.addEventListener('click', () => app.garageOp('equip', kind, id));
        this.$('g-upgrade')?.addEventListener('click', () => app.garageOp('upgrade', kind, id));
      };
    } else if (kind === 'paint') {
      const it = getPaint(id);
      const own = p.paints.includes(id), equipped = p.equipped.paint === id;
      html += `<h2>${esc(it.name)}</h2><div class="swatch" style="width:100%;height:50px;border-radius:8px;background:${hex(it.color)};border:1px solid rgba(255,255,255,0.15)"></div>`;
      const res = Object.entries(it.resist);
      html += `<h3 style="margin-top:12px">Resistances</h3>` + (res.length ? res.map(([k, v]) => stat(getTurret(k).name, Math.round(v * 100) + '%')).join('') : '<div class="muted small">None. Just looks good.</div>');
      html += `<div class="stat"><span>Rank required</span><span><b>${RANKS[it.rank].name}</b></span></div>`;
      if (!own) {
        const can = rank >= it.rank && p.crystals >= it.price;
        html += `<div class="stat"><span>Price</span><span class="crystals">${it.price}</span></div>` + btn(rank < it.rank ? `Requires ${RANKS[it.rank].name}` : p.crystals < it.price ? 'Not enough crystals' : 'Buy', '', !can, null, 'g-buy');
      } else if (!equipped) html += btn('Equip', '', false, null, 'g-equip'); else html += btn('Equipped', 'secondary', true, null, 'x');
      wire = () => {
        this.$('g-buy')?.addEventListener('click', () => app.garageOp('buy', 'paint', id));
        this.$('g-equip')?.addEventListener('click', () => app.garageOp('equip', 'paint', id));
      };
    } else {
      const it = SUPPLIES.find((s) => s.id === id) || SUPPLIES[0];
      html += `<h2>${esc(it.name)}</h2><p class="muted small">${esc(it.desc)}</p>`;
      html += stat('In stock', p.supplies[it.id] | 0) + stat('Price', it.price + ' each') + stat('Hotkey', it.key);
      html += `<div class="row" style="margin-top:10px"><button class="btn grow" id="g-buy1" ${p.crystals < it.price ? 'disabled' : ''}>Buy 1</button><button class="btn secondary grow" id="g-buy10" ${p.crystals < it.price * 10 ? 'disabled' : ''}>Buy 10 (${it.price * 10})</button></div>`;
      wire = () => {
        this.$('g-buy1')?.addEventListener('click', () => app.garageOp('buySupply', 'supply', it.id, 1));
        this.$('g-buy10')?.addEventListener('click', () => app.garageOp('buySupply', 'supply', it.id, 10));
      };
    }
    d.innerHTML = html;
    wire();
  }
}
