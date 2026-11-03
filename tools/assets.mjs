// Downloads and prepares the external CC0 assets used by the client into client/assets:
//   - ambientCG PBR texture sets (1K JPG → resized/re-encoded color/normal/roughness/ao)
//   - Poly Haven HDRI skies (1k .hdr)
//   - Poly Haven glTF props (optimized to .glb with meshopt compression and WebP textures)
// Raw downloads are cached in scratch/dl (gitignored). Re-running skips finished outputs.
// Usage: node tools/assets.mjs [textures|hdri|models|all] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'assets');
const DL = path.join(ROOT, 'scratch', 'dl');
const args = process.argv.slice(2);
const what = args.find((a) => !a.startsWith('--')) || 'all';
const force = args.includes('--force');

// name → ambientCG asset id (all CC0, https://ambientcg.com)
export const TEXTURES = {
  grass: 'Grass004', grassDark: 'Grass001', dirt: 'Ground037', dirtDry: 'Ground109', sand: 'Ground054', sandLight: 'Ground093A',
  rock: 'Rock058', rockDark: 'Rock035', rockMoss: 'Rock064', gravel: 'Gravel023', snow: 'Snow010A', snowDirty: 'Snow011',
  asphalt: 'Asphalt031', asphaltDark: 'Asphalt033', concrete: 'Concrete034', concreteBunker: 'Concrete031', concreteDamaged: 'Concrete044D', concretePlain: 'Concrete046',
  metal: 'Metal032', metalDirty: 'Metal046B', metalAged: 'Metal063', metalRust: 'Metal041B', metalPlates: 'MetalPlates013', metalPainted: 'Metal027',
  corrugated: 'CorrugatedSteel009', corrugatedBlue: 'CorrugatedSteel007A', rubber: 'Rubber004', planks: 'Planks037A', bricks: 'Bricks105',
  moss: 'Moss002', bark: 'Bark012', leavesGround: 'Ground076', tiles: 'Tiles140', fabric: 'Fabric061', paintedWood: 'PaintedWood008C',
};
// Poly Haven HDRIs (CC0, https://polyhaven.com)
export const HDRIS = [
  'kloofendal_48d_partly_cloudy_puresky', 'farm_field_puresky', 'qwantani_noon_puresky', 'qwantani_sunset_puresky',
  'kloofendal_overcast_puresky', 'snow_field_puresky', 'industrial_sunset_puresky', 'belfast_sunset_puresky',
];
// Poly Haven models (CC0): id → { budget: target triangle count (simplify when above), tex: texture size }
export const MODELS = {
  Barrel_01: { budget: 4000 }, barrel_03: { budget: 4000 }, wooden_crate_02: { budget: 6000 }, old_military_crate: { budget: 8000 },
  ammo_box: { budget: 5000 }, metal_jerrycan_green: { budget: 6000 }, medical_box: { budget: 4000 }, plastic_crate_02: { budget: 6000 },
  propane_tank: { budget: 5000 }, old_tyre: { budget: 3000 }, oil_tin: { budget: 3000 }, cardboard_box_01: { budget: 5000 },
  concrete_road_barrier: { budget: 6000 }, concrete_road_barrier_02: { budget: 6000 }, boulder_01: { budget: 6000 }, namaqualand_boulder_04: { budget: 6000 },
  rock_moss_set_01: { budget: 12000 }, dead_tree_trunk: { budget: 8000 }, dry_branches_medium_01: { budget: 8000 },
  modular_chainlink_fence: { budget: 12000 }, modular_industrial_pipes_01: { budget: 8000 }, metal_trash_can: { budget: 6000 },
  power_box_01: { budget: 5000 }, ladder_sectioned_01: { budget: 5000 }, old_military_compressor: { budget: 10000 },
  industrial_pastic_container: { budget: 5000 }, quiver_tree_01: { budget: 25000 }, island_tree_02: { budget: 60000, tex: 1024 },
};

const ensure = (d) => fs.mkdirSync(d, { recursive: true });
async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  ensure(path.dirname(dest));
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'tanki-online-assets/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}
const log = (...a) => console.log('[assets]', ...a);

async function textures() {
  const outDir = path.join(OUT, 'textures');
  ensure(outDir);
  const index = {};
  for (const [name, id] of Object.entries(TEXTURES)) {
    const dir = path.join(outDir, name);
    const done = path.join(dir, 'color.jpg');
    const zip = path.join(DL, 'acg', `${id}.zip`);
    const raw = path.join(DL, 'acg', id);
    if (!force && fs.existsSync(done)) { index[name] = readTexIndex(dir, id); continue; }
    try {
      await download(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, zip);
      ensure(raw);
      execFileSync('unzip', ['-o', '-q', zip, '-d', raw]);
      const files = fs.readdirSync(raw);
      const pick = (suffix) => files.find((f) => f.toLowerCase().endsWith(`_${suffix}.jpg`.toLowerCase()));
      ensure(dir);
      const maps = {};
      const conv = async (suffix, out, size, quality) => {
        const f = pick(suffix);
        if (!f) return;
        await sharp(path.join(raw, f)).resize(size, size, { fit: 'fill' }).jpeg({ quality, mozjpeg: true }).toFile(path.join(dir, out));
        maps[out.replace('.jpg', '')] = true;
      };
      await conv('Color', 'color.jpg', 1024, 84);
      await conv('NormalGL', 'normal.jpg', 1024, 88);
      await conv('Roughness', 'rough.jpg', 512, 80);
      await conv('AmbientOcclusion', 'ao.jpg', 512, 80);
      await conv('Metalness', 'metal.jpg', 512, 80);
      fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify({ id, source: `https://ambientcg.com/view?id=${id}`, license: 'CC0 1.0' }));
      index[name] = { id, maps: Object.keys(maps) };
      log('texture', name, '←', id, Object.keys(maps).join(','));
    } catch (e) { log('texture FAILED', name, id, e.message); }
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
}
function readTexIndex(dir, id) {
  const maps = ['color', 'normal', 'rough', 'ao', 'metal'].filter((m) => fs.existsSync(path.join(dir, m + '.jpg')));
  return { id, maps };
}

async function hdris() {
  const outDir = path.join(OUT, 'hdri');
  ensure(outDir);
  for (const id of HDRIS) {
    const dest = path.join(outDir, `${id}.hdr`);
    if (!force && fs.existsSync(dest)) continue;
    try {
      await download(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`, dest);
      log('hdri', id, Math.round(fs.statSync(dest).size / 1024) + 'KB');
    } catch (e) { log('hdri FAILED', id, e.message); }
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ ids: HDRIS, source: 'https://polyhaven.com/hdris', license: 'CC0 1.0' }, null, 1));
}

async function models() {
  const outDir = path.join(OUT, 'models');
  ensure(outDir);
  const index = fs.existsSync(path.join(outDir, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'index.json'), 'utf8')) : {};
  for (const [id, opt] of Object.entries(MODELS)) {
    const dest = path.join(outDir, `${id}.glb`);
    if (!force && fs.existsSync(dest) && index[id]) continue;
    try {
      const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
      const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
      const g = files.gltf && files.gltf['1k'] && files.gltf['1k'].gltf;
      if (!g) throw new Error('no gltf');
      const raw = path.join(DL, 'ph', id);
      const gltfPath = path.join(raw, `${id}.gltf`);
      await download(g.url, gltfPath);
      for (const [rel, f] of Object.entries(g.include || {})) await download(f.url, path.join(raw, rel));
      const poly = info.polycount || 0;
      const ratio = poly > opt.budget ? Math.max(0.01, opt.budget / poly) : 1;
      const texSize = opt.tex || 512;
      const cli = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');
      const run = (a) => execFileSync(cli, a, { stdio: 'pipe', shell: process.platform === 'win32' });
      const tmp = path.join(raw, `${id}.tmp.glb`);
      run(['optimize', gltfPath, tmp, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(texSize), '--simplify-ratio', String(ratio), '--simplify-error', '0.001', '--no-join', '--no-flatten', '--no-instance']);
      fs.copyFileSync(tmp, dest);
      index[id] = { dims: (info.dimensions || []).map((v) => +(v / 1000).toFixed(3)), polycount: poly, ratio, authors: Object.keys(info.authors || {}), source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0' };
      fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
      log('model', id, 'poly', poly, 'ratio', ratio.toFixed(3), Math.round(fs.statSync(dest).size / 1024) + 'KB');
    } catch (e) { log('model FAILED', id, (e.stderr && e.stderr.toString().slice(-400)) || e.message); }
  }
}

if (what === 'textures' || what === 'all') await textures();
if (what === 'hdri' || what === 'all') await hdris();
if (what === 'models' || what === 'all') await models();
log('done');
