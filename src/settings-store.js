const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Default POS address. Stores can be switched to a custom domain from Settings,
// or testers can start with:  "Tidely POS.exe" --url=https://...
const DEFAULTS = {
  url: 'https://tidely-pos-system.lovable.app',
  silentPrint: false,      // when true, window.print() goes straight to the chosen printer
  printerName: '',         // empty = system default printer
  paperWidthMm: 0,         // 0 = let the printer driver decide; 58 or 80 for thermal rolls
  kiosk: false,            // full screen, no window frame
  autoStart: false,        // start with Windows
  customerDisplay: {       // optional second window for dual-screen terminals
    enabled: false,
    path: '/customer-display',
  },
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (_) {
    /* first run or unreadable file: use defaults */
  }
  cache = {
    ...DEFAULTS,
    ...saved,
    customerDisplay: { ...DEFAULTS.customerDisplay, ...(saved.customerDisplay || {}) },
  };
  return cache;
}

function validUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || (p.protocol === 'http:' && p.hostname === 'localhost');
  } catch (_) {
    return false;
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  if (patch && patch.customerDisplay) {
    next.customerDisplay = { ...load().customerDisplay, ...patch.customerDisplay };
  }
  if (!validUrl(next.url)) next.url = DEFAULTS.url;
  next.paperWidthMm = Math.max(0, Math.min(120, Number(next.paperWidthMm) || 0));
  next.silentPrint = !!next.silentPrint;
  next.kiosk = !!next.kiosk;
  next.autoStart = !!next.autoStart;
  next.printerName = String(next.printerName || '');
  cache = next;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch (e) {
    console.error('Could not save settings', e);
  }
  return cache;
}

// The address actually used this run: --url= flag, then TIDELY_URL env var, then saved setting.
function effectiveUrl() {
  const arg = process.argv.find((a) => a.startsWith('--url='));
  const candidate = (arg && arg.slice(6)) || process.env.TIDELY_URL || load().url;
  return validUrl(candidate) ? candidate : DEFAULTS.url;
}

module.exports = { load, save, effectiveUrl, validUrl, DEFAULTS };
