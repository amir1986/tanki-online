// Build a distributable Windows desktop app into dist/ using @electron/packager.
import { packager } from '@electron/packager';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
const platform = process.argv.includes('--mac') ? 'darwin' : process.argv.includes('--linux') ? 'linux' : 'win32';

const ignore = [
  /^\/(scratch|screenshots|data|tests|dist|docs|\.claude|\.git|\.github)(\/|$)/,
  /^\/tools\/(e2e|shot|package)\.mjs$/,
  /^\/node_modules\/(puppeteer-core|@electron|electron|@puppeteer|chromium-bidi|devtools-protocol|typed-query-selector|\.bin)(\/|$)/,
  /^\/node_modules\/three\/(src|examples\/(fonts|models|textures|screenshots)|build\/three\.webgpu.*|build\/three\.tsl\.js)(\/|$)/,
  /\.(log|png|md)$/,
];

console.log(`Packaging TankiOnline ${pkg.version} for ${platform}-${arch} ...`);
const out = await packager({
  dir: ROOT,
  out: path.join(ROOT, 'dist'),
  name: 'TankiOnline',
  executableName: 'TankiOnline',
  platform,
  arch,
  overwrite: true,
  asar: false,
  prune: true,
  appVersion: pkg.version,
  appCopyright: `Copyright (c) ${new Date().getFullYear()} ${pkg.author}`,
  ignore: (file) => ignore.some((re) => re.test(file.replace(/\\/g, '/'))),
  win32metadata: { CompanyName: pkg.author, FileDescription: 'Tanki Online desktop game', ProductName: 'Tanki Online', InternalName: 'TankiOnline' },
});
for (const dir of out) {
  console.log('Built:', dir);
  const exe = path.join(dir, platform === 'win32' ? 'TankiOnline.exe' : 'TankiOnline');
  if (fs.existsSync(exe)) console.log('Executable:', exe);
}
