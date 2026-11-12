const { app, BrowserWindow, Menu, ipcMain, shell, screen, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require('./settings-store');

app.setAppUserModelId('za.co.tidely.pos');

let mainWindow = null;
let settingsWindow = null;
let customerWindow = null;

// ---------- helpers ----------

function originOf(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

function posOrigin() { return originOf(store.effectiveUrl()); }

function isInternalUrl(url) {
  if (url === 'about:blank') return true;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true;
    return u.origin === posOrigin();
  } catch (_) { return false; }
}

function safeExternal(url) {
  try {
    const u = new URL(url);
    if (['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) shell.openExternal(url);
  } catch (_) { /* ignore malformed links */ }
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    additionalArguments: [`--tidely-origin=${posOrigin()}`],
  };
}

function secondaryDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id !== primary.id) || null;
}

// A sender is trusted if it is one of our own local pages or the POS site itself.
function senderAllowed(event, { localOnly = false } = {}) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  if (url.startsWith('file://')) {
    const here = path.resolve(__dirname).replace(/\\/g, '/').toLowerCase();
    return decodeURI(url).replace(/^file:\/+/, '').toLowerCase().includes(here.replace(/^\/+/, ''));
  }
  if (localOnly) return false;
  return originOf(url) === posOrigin();
}

// ---------- silent printing ----------

function mmToMicrons(mm) { return Math.round(mm * 1000); }
const PX_TO_MICRONS = 264.583; // 1 CSS px at 96 dpi

async function printHtmlSilently(html) {
  const s = store.load();
  const tmp = path.join(os.tmpdir(), `tidely-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(tmp);
    // Wait for logo/images, then measure the slip height (thermal rolls have no fixed length).
    const heightPx = await win.webContents.executeJavaScript(`
      Promise.race([
        Promise.all(Array.from(document.images).map(function (i) {
          return i.complete ? null : new Promise(function (r) { i.onload = i.onerror = r; });
        })),
        new Promise(function (r) { setTimeout(r, 5000); })
      ]).then(function () { return document.documentElement.scrollHeight; })
    `);
    const options = {
      silent: true,
      printBackground: true,
      margins: { marginType: 'none' },
    };
    if (s.printerName) options.deviceName = s.printerName;
    if (s.paperWidthMm > 0) {
      options.pageSize = {
        width: mmToMicrons(s.paperWidthMm),
        height: Math.max(60000, Math.round((Number(heightPx) + 16) * PX_TO_MICRONS)),
      };
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Printing timed out')), 60000);
      win.webContents.print(options, (success, reason) => {
        clearTimeout(timer);
        success ? resolve() : reject(new Error(reason || 'Print failed'));
      });
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.unlink(tmp, () => {});
  }
}

function reportPrintFailure(err) {
  const printer = store.load().printerName || 'the default printer';
  dialog.showMessageBox(mainWindow || undefined, {
    type: 'error',
    title: 'Tidely POS',
    message: 'The slip could not be printed.',
    detail: `Check that ${printer} is switched on, connected and has paper.\n\n(${err && err.message ? err.message : err})`,
  }).catch(() => {});
}

function testReceiptHtml() {
  const s = store.load();
  const width = s.paperWidthMm > 0 ? `${s.paperWidthMm - 8}mm` : '70mm';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test</title>
    <style>body{font-family:'Courier New',monospace;font-size:12px;width:${width};margin:0 auto;padding:4mm 0;color:#000}
    h2{text-align:center;margin:0 0 6px}.l{border-top:1px dashed #000;margin:6px 0}</style></head><body>
    <h2>TIDELY POS</h2><div class="l"></div>
    <div>Test slip</div><div>${new Date().toLocaleString()}</div>
    <div>Printer: ${s.printerName || 'System default'}</div>
    <div>Paper: ${s.paperWidthMm > 0 ? s.paperWidthMm + ' mm' : 'driver default'}</div>
    <div class="l"></div><div style="text-align:center">If you can read this,<br>printing works.</div></body></html>`;
}

// ---------- windows ----------

function createMainWindow() {
  const s = store.load();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    title: 'Tidely POS',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: webPreferences(),
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    if (s.kiosk) mainWindow.setKiosk(true);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(store.effectiveUrl());
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    title: 'Tidely POS settings',
    webPreferences: webPreferences(),
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function openCustomerDisplay() {
  const s = store.load();
  if (customerWindow && !customerWindow.isDestroyed()) { customerWindow.focus(); return; }
  const display = secondaryDisplay();
  if (!display) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info', title: 'Tidely POS', message: 'No second screen found.',
      detail: 'Connect the customer-facing screen and try again.',
    }).catch(() => {});
    return;
  }
  const target = new URL(s.customerDisplay.path || '/customer-display', store.effectiveUrl()).toString();
  customerWindow = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    fullscreen: true, frame: false, autoHideMenuBar: true,
    title: 'Tidely customer display',
    webPreferences: webPreferences(),
  });
  customerWindow.on('closed', () => { customerWindow = null; });
  customerWindow.loadURL(target);
}

function closeCustomerDisplay() {
  if (customerWindow && !customerWindow.isDestroyed()) customerWindow.close();
}

function buildMenu() {
  const template = [
    {
      label: 'Tidely',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.webContents.reload() },
        { label: 'Reload (clear cache)', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow && mainWindow.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Printer and app settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'Open customer display', click: openCustomerDisplay },
        { label: 'Close customer display', click: closeCustomerDisplay },
        { type: 'separator' },
        { label: 'Full screen', accelerator: 'F11', click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Tidely POS' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: `Tidely POS desktop v${app.getVersion()}`, enabled: false },
        { role: 'toggleDevTools', label: 'Developer tools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

ipcMain.on('tidely:silent-enabled', (event) => {
  event.returnValue = senderAllowed(event) && !!store.load().silentPrint;
});

ipcMain.handle('tidely:print-html', async (event, html) => {
  if (!senderAllowed(event)) return { ok: false, error: 'not allowed' };
  if (!store.load().silentPrint) return { ok: false, error: 'silent printing is off' };
  if (typeof html !== 'string' || html.length === 0 || html.length > 8 * 1024 * 1024) {
    return { ok: false, error: 'invalid slip' };
  }
  try {
    await printHtmlSilently(html);
    return { ok: true };
  } catch (err) {
    reportPrintFailure(err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('tidely:get-printers', async (event) => {
  if (!senderAllowed(event)) return [];
  const wc = (mainWindow && mainWindow.webContents) || event.sender;
  const list = await wc.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: !!p.isDefault }));
});

ipcMain.handle('tidely:info', (event) => {
  if (!senderAllowed(event)) return null;
  return { version: app.getVersion(), platform: process.platform, url: store.effectiveUrl(), secondScreen: !!secondaryDisplay() };
});

ipcMain.handle('tidely:get-settings', (event) => (senderAllowed(event, { localOnly: true }) ? store.load() : null));

ipcMain.handle('tidely:set-settings', (event, patch) => {
  if (!senderAllowed(event, { localOnly: true })) return null;
  const before = store.load();
  const next = store.save(patch || {});
  app.setLoginItemSettings({ openAtLogin: next.autoStart });
  if (mainWindow && next.kiosk !== before.kiosk) mainWindow.setKiosk(next.kiosk);
  return { settings: next, needsRestart: next.url !== before.url };
});

ipcMain.handle('tidely:test-print', async (event) => {
  if (!senderAllowed(event, { localOnly: true })) return { ok: false };
  try {
    await printHtmlSilently(testReceiptHtml());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('tidely:reload', (event) => {
  if (!senderAllowed(event)) return false;
  if (mainWindow) mainWindow.loadURL(store.effectiveUrl());
  return true;
});

ipcMain.handle('tidely:open-settings', (event) => {
  if (!senderAllowed(event)) return false;
  openSettings();
  return true;
});

ipcMain.handle('tidely:restart', (event) => {
  if (!senderAllowed(event, { localOnly: true })) return false;
  app.relaunch();
  app.quit();
  return true;
});

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Only grant the permissions the POS actually needs (Electron allows everything by default).
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      const allowed = ['notifications', 'fullscreen', 'clipboard-sanitized-write', 'media', 'geolocation'];
      callback(allowed.includes(permission));
    });

    app.on('web-contents-created', (_e, contents) => {
      contents.on('will-navigate', (event, url) => {
        if (!isInternalUrl(url)) { event.preventDefault(); safeExternal(url); }
      });

      contents.setWindowOpenHandler(({ url, frameName }) => {
        // Receipt/slip popups: blank windows the POS writes into and prints.
        if (url === '' || url === 'about:blank') {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: { show: !store.load().silentPrint, autoHideMenuBar: true },
          };
        }
        // Customer display opened from the POS: put it full screen on the second monitor.
        if (frameName === 'tidely-customer-display' && isInternalUrl(url)) {
          const display = secondaryDisplay();
          if (display) {
            return {
              action: 'allow',
              overrideBrowserWindowOptions: {
                x: display.bounds.x, y: display.bounds.y,
                width: display.bounds.width, height: display.bounds.height,
                fullscreen: true, frame: false, autoHideMenuBar: true,
              },
            };
          }
        }
        if (isInternalUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
        safeExternal(url);
        return { action: 'deny' };
      });

      // No internet at launch or mid-session: show the local retry page instead of a blank window.
      contents.on('did-fail-load', (_event, code, _desc, _validatedURL, isMainFrame) => {
        if (!isMainFrame || code === -3) return; // -3 = aborted by a newer navigation
        if (mainWindow && contents === mainWindow.webContents) {
          mainWindow.loadFile(path.join(__dirname, 'offline.html'));
        }
      });
    });

    buildMenu();
    createMainWindow();

    const s = store.load();
    if (s.customerDisplay.enabled && secondaryDisplay()) {
      mainWindow.webContents.once('did-finish-load', () => openCustomerDisplay());
    }
  });

  app.on('window-all-closed', () => app.quit());
}
