// Training battle overlay: guided steps with a one-time crystal reward.
import { TUTORIAL_REWARD } from '/shared/constants.mjs';

const STEPS = [
  { id: 'drive', text: 'Drive around with W A S D (or the arrow keys)' },
  { id: 'aim', text: 'Aim the turret: move the mouse (or press Z / X)' },
  { id: 'fire', text: 'Fire with the left mouse button or Space' },
  { id: 'supply', text: 'Use a supply with keys 1 to 5' },
  { id: 'kill', text: 'Destroy one of the training bots' },
  { id: 'scoreboard', text: 'Hold Tab to check the scoreboard' },
];

export class Tutorial {
  constructor(battle) {
    this.battle = battle;
    this.done = new Set();
    this.rewarded = !!battle.app.profile?.tutorialDone;
    this.startPos = null;
    this.startYaw = null;
    this.finished = false;
    this.el = document.createElement('div');
    this.el.className = 'tutorial';
    battle.hud.root.appendChild(this.el);
    this.render();
  }

  render() {
    const allDone = this.done.size === STEPS.length;
    this.el.innerHTML = `<h3>Training</h3>${STEPS.map((s) => `<div class="step ${this.done.has(s.id) ? 'done' : ''}"><span class="box">${this.done.has(s.id) ? '✓' : ''}</span>${s.text}</div>`).join('')}
      <div class="small muted" style="margin-top:8px">${allDone ? (this.rewarded ? 'Training complete. Leave when you are ready.' : `Training complete! +${TUTORIAL_REWARD} crystals`) : `Complete all steps for ${TUTORIAL_REWARD} crystals`}</div>`;
  }

  complete(id) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.battle.audio.play('pickup');
    this.render();
    if (this.done.size === STEPS.length && !this.finished) {
      this.finished = true;
      this.battle.hud.notify('Training complete!', 'gold');
      if (!this.rewarded) { this.battle.app.garageOp('tutorialDone'); this.rewarded = true; }
      this.render();
    }
  }

  onEvent(e) {
    const me = this.battle.myId;
    if (e.e === 'shot' || e.e === 'fire') { if (e.p === me) this.complete('fire'); }
    else if (e.e === 'supply') { if (e.p === me) this.complete('supply'); }
    else if (e.e === 'kill') { if (e.a === me && e.v !== me) this.complete('kill'); }
  }

  update() {
    const b = this.battle;
    if (!b.me.alive) return;
    const pos = b.me.pos;
    if (!this.startPos) { this.startPos = [...pos]; this.startYaw = b.me.state ? b.me.state.turretYaw : 0; this.startOrbit = b.cam.orbitYaw; return; }
    if (!this.done.has('drive') && Math.hypot(pos[0] - this.startPos[0], pos[2] - this.startPos[2]) > 12) this.complete('drive');
    if (!this.done.has('aim') && b.me.state) {
      const turned = Math.abs(((b.me.state.turretYaw - this.startYaw + Math.PI) % (2 * Math.PI)) - Math.PI);
      const orbited = Math.abs(b.cam.orbitYaw - this.startOrbit);
      if (turned > 0.5 || (b.mouseAim && orbited > 0.8)) this.complete('aim');
    }
    if (!this.done.has('scoreboard') && b.showScoreboard) this.complete('scoreboard');
  }

  destroy() { this.el.remove(); }
}
