// Electron main process: starts the embedded game server and opens the game window.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const argv = process.argv.slice(1);
const has = (flag) => argv.includes(flag);
const smoke = has('--smoke') || has('--smoke-battle');
const dev = has('--dev') || process.env.TANKI_DEV === '1' || !app.isPackaged && !smoke && has('--dev');
let server = null;
let win = null;

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

async function startEmbeddedServer() {
  const url = pathToFileURL(path.join(__dirname, '..', 'server', 'index.mjs')).href;
  const { startServer } = await import(url);
  const dataDir = path.join(app.getPath('userData'), 'data');
  const port = +(process.env.TANKI_PORT || 0);
  const host = process.env.TANKI_HOST || '127.0.0.1';
  server = await startServer({ port, host, dataDir, dev, log: (...a) => console.log('[server]', ...a) });
  return server;
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1440, height: 860, minWidth: 960, minHeight: 600,
    backgroundColor: '#0b0f14', title: 'Tanki Online', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('console-message', (_e, level, message) => { if (smoke || dev) console.log('[renderer]', message); });
  let query = '';
  if (smoke) {
    const battle = has('--smoke-battle');
    const which = (argv.find((a) => a.startsWith('--battle=')) || '').slice(9);
    query = `?name=SmokeTester&auto=${battle ? 'battle' : 'menu'}${which ? '&battle=' + which : ''}`;
  }
  win.loadURL(`http://127.0.0.1:${port}/${query}`);
  if (smoke) {
    const delay = +(process.env.SMOKE_DELAY || (has('--smoke-battle') ? 16000 : 9000));
    setTimeout(async () => {
      try {
        const dir = path.join(process.cwd(), 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const img = await win.webContents.capturePage();
        const name = (argv.find((a) => a.startsWith('--out=')) || '').slice(6) || `smoke-${has('--smoke-battle') ? 'battle' : 'menu'}.png`;
        fs.writeFileSync(path.join(dir, name), img.toPNG());
        console.log('[smoke] screenshot saved', path.join(dir, name));
      } catch (e) { console.error('[smoke] capture failed', e); }
      app.quit();
    }, delay);
  }
}

app.whenReady().then(async () => {
  try {
    const s = await startEmbeddedServer();
    createWindow(s.port);
  } catch (e) {
    console.error('Failed to start', e);
    app.quit();
  }
});

ipcMain.on('quit', () => app.quit());
ipcMain.on('fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('server-info', () => ({ port: server ? server.port : 0, host: server ? server.host : '', dev }));

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
app.on('before-quit', () => { if (server) { try { server.close(); } catch (e) { /* ignore */ } server = null; } });
