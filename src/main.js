const { app, BrowserWindow, session } = require('electron');
const electronLocalshortcut = require('electron-localshortcut');
const findProcess = require('find-process');
const fs = require('fs');
const path = require('path');
const { DiscordRPC } = require('./resources/rpc.js');
const { switchFullscreenState } = require('./resources/windowManager.js');

const homePage = 'https://play.geforcenow.com';
const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36 Edg/130.0.6723.152';

const configPath = path.join(app.getPath('userData'), 'config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : { crashCount: 0 };

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-hang-monitor');
app.commandLine.appendSwitch('disable-ipc-flooding-protection');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-resource-loading-hinting');
app.commandLine.appendSwitch('enable-early-resource-prioritization');
app.commandLine.appendSwitch('disable-features', 'TimerThrottling,RenderTaskThrottling,LegacyTLSSessionResumption');
app.commandLine.appendSwitch('disable-infobars');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns');
app.commandLine.appendSwitch('enable-webrtc-stun-origin');
app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('userData'), 'Cache'));
app.commandLine.appendSwitch('disk-cache-size', (100 * 1024 * 1024).toString());
app.commandLine.appendSwitch('socket-receive-buffer-size', '262144');
app.commandLine.appendSwitch('socket-send-buffer-size', '262144');
app.commandLine.appendSwitch('gpu-launcher-interval', '1');
app.commandLine.appendSwitch('enable-low-end-device-mode');
app.commandLine.appendSwitch('dns-prefetch-disable', 'false');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('enable-tcp-fastopen');
app.commandLine.appendSwitch('enable-http2');
app.commandLine.appendSwitch('enable-websockets');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('tcp-quickack', 'true');
app.commandLine.appendSwitch('max-connections-per-host', '255');

switch (config.crashCount) {
  case 0:
    app.commandLine.appendSwitch('use-gl', 'angle');
    break;
  case 1:
    app.commandLine.appendSwitch('use-gl', 'egl');
    break;
  default:
    app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch(
  'enable-features',
  [
    'VaapiVideoDecoder',
    'Accelerated2dCanvas',
    'CanvasOopRasterization',
    'CanvasAsync',
    'LowLatencyCanvas2d',
    'SkiaRenderer',
    'UseAV1Decoder',
    'UseSkiaRenderer',
    'GpuScheduler',
    'WebAssemblySimd',
    'PlatformHEVCDecoderSupport',
  ].join(',')
);

let discordIsRunning = false;

function getMainWindow() {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) return wins[0];
  return null;
}

async function createWindow() {
  const mainWindow = new BrowserWindow({
    fullscreenable: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      enableRemoteModule: false,
      webgl: true,
      experimentalFeatures: true,
      offscreen: false,
      disableBlinkFeatures: 'PaintHolding',
      userAgent: userAgent,
      backgroundThrottling: false,
    },
  });

  if (process.argv.includes('--direct-start')) {
    const idx = process.argv.indexOf('--direct-start');
    mainWindow.loadURL(
      `https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=${process.argv[idx + 1]}`
    );
  } else {
    mainWindow.loadURL(homePage);
  }
}

app.whenReady().then(async () => {
  await createWindow();

  discordIsRunning = await isDiscordRunning();

  electronLocalshortcut.register('Super+F', () => switchFullscreenState());

  electronLocalshortcut.register('F11', () => switchFullscreenState());

  electronLocalshortcut.register('Alt+F4', () => app.quit());

  electronLocalshortcut.register('Alt+Home', () => {
    const win = getMainWindow();
    if (win) win.loadURL(homePage);
  });

  electronLocalshortcut.register('Control+Shift+I', () => {
    const win = getMainWindow();
    if (win && win.webContents) win.webContents.toggleDevTools();
  });

  if (discordIsRunning) DiscordRPC('GeForce NOW');
});

app.on('browser-window-created', (e, window) => {
  if (!window) return; 

  if (typeof window.setBackgroundColor === 'function') window.setBackgroundColor('#1A1D1F');
  if (typeof window.setMenu === 'function') window.setMenu(null);

  if (window.webContents) {
    window.webContents.setUserAgent(userAgent);

    window.webContents.on('new-window', (event, url) => {
      event.preventDefault();
      const win = getMainWindow();
      if (win) win.loadURL(url);
    });
  }

  if (discordIsRunning && typeof window.on === 'function') {
    window.on('page-title-updated', (e, title) => DiscordRPC(title));
  }
});

app.on('child-process-gone', (event, details) => {
  if (details.type === 'GPU' && details.reason === 'crashed') {
    config.crashCount++;
    fs.writeFileSync(configPath, JSON.stringify(config));
    app.relaunch();
    app.exit(0);
  }
});

app.on('will-quit', () => {
  const win = getMainWindow();
  if (win) {
    electronLocalshortcut.unregisterAll(win);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in main process:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in main process:', reason);
});

app.on('renderer-process-crashed', (event, webContents, killed) => {
  const url = webContents.getURL();
  console.error(`Renderer process crashed for URL: ${url}, killed: ${killed}`);
});

function isDiscordRunning() {
  return findProcess('name', 'Discord')
    .then(list => list.length > 0)
    .catch(() => false);
}
