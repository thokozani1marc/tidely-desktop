const { app, dialog, Menu, MenuItem, Notification } = require('electron');

let autoUpdater = null;
let manualCheck = false;

function log(...args) {
  console.log('[updater]', ...args);
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (_) { /* ignore */ }
}

function checkNow(manual) {
  if (!autoUpdater) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Tidely POS',
        message: 'Updates only work in the installed app.',
      }).catch(() => {});
    }
    return;
  }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch((err) => {
    log('check failed', err && err.message);
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Tidely POS',
        message: 'Could not check for updates.',
        detail: 'Check the internet connection and try again.',
      }).catch(() => {});
    }
  });
}

function start() {
  if (!app.isPackaged) return; // no updates when running from source
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // installs quietly the next time the app is closed

  autoUpdater.on('update-available', (info) => {
    log('update available', info && info.version);
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Tidely POS',
        message: `Version ${info.version} is downloading.`,
        detail: 'You will be asked to restart when it is ready.',
      }).catch(() => {});
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Tidely POS',
        message: 'You have the latest version.',
        detail: `Version ${app.getVersion()}`,
      }).catch(() => {});
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log('update downloaded', info && info.version);
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'question',
        title: 'Tidely POS',
        message: `Version ${info.version} is ready.`,
        detail: 'Restart now to install it?',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
    } else {
      notify('Tidely POS update ready', 'It will install when you next close Tidely POS.');
    }
  });

  autoUpdater.on('error', (err) => log('error', err && err.message));

  setTimeout(() => checkNow(false), 15 * 1000);
  setInterval(() => checkNow(false), 4 * 60 * 60 * 1000);
}

function install() {
  // Add "Check for updates" to the Tidely menu without touching main.js.
  const original = Menu.setApplicationMenu.bind(Menu);
  Menu.setApplicationMenu = (menu) => {
    try {
      const sub = menu && menu.items[0] && menu.items[0].submenu;
      if (sub) {
        sub.insert(2, new MenuItem({ label: 'Check for updates…', click: () => checkNow(true) }));
      }
    } catch (e) {
      log('menu hook failed', e && e.message);
    }
    return original(menu);
  };
  app.whenReady().then(start);
}

module.exports = { install };
