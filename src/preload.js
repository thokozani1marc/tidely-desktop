const { contextBridge, ipcRenderer } = require('electron');

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

// Only expose the bridge to our own local pages and the POS site itself.
const allowedOrigin = arg('tidely-origin');
const isLocalPage = window.location.protocol === 'file:';
const isPosPage = !!allowedOrigin && window.location.origin === allowedOrigin;

if (isLocalPage || isPosPage) {
  const api = {
    isDesktop: true,
    info: () => ipcRenderer.invoke('tidely:info'),
    getPrinters: () => ipcRenderer.invoke('tidely:get-printers'),
    silentPrintEnabled: () => ipcRenderer.sendSync('tidely:silent-enabled'),
    printHtml: (html) => ipcRenderer.invoke('tidely:print-html', String(html)),
    openSettings: () => ipcRenderer.invoke('tidely:open-settings'),
    reload: () => ipcRenderer.invoke('tidely:reload'),
    settings: {
      get: () => ipcRenderer.invoke('tidely:get-settings'),
      set: (patch) => ipcRenderer.invoke('tidely:set-settings', patch),
      testPrint: () => ipcRenderer.invoke('tidely:test-print'),
      restart: () => ipcRenderer.invoke('tidely:restart'),
    },
  };
  contextBridge.exposeInMainWorld('tidelyDesktop', api);
}

// Slip printing hook (POS pages only).
//
// The POS prints slips by writing HTML into a hidden iframe or a blank popup and calling
// print() on it. When silent printing is on, we make print() on those script-created
// windows send the slip to the chosen printer instead of opening the print dialog.
// The POS's own page (reports, Ctrl+P) is left alone and keeps the normal print dialog.
if (isPosPage) {
  contextBridge.executeInMainWorld({
    func: () => {
      function patchWindow(w) {
        try {
          if (!w || w.__tidelyPrintPatched) return;
          Object.defineProperty(w, '__tidelyPrintPatched', { value: true });
          const original = w.print.bind(w);
          w.print = function () {
            try {
              const bridge = window.tidelyDesktop;
              if (bridge && bridge.silentPrintEnabled()) {
                const html = '<!DOCTYPE html>' + w.document.documentElement.outerHTML;
                bridge.printHtml(html)
                  .catch(function () { /* the app already showed the error */ })
                  .then(function () {
                    // The POS closes its hidden iframe/popup on 'afterprint'.
                    try { w.dispatchEvent(new w.Event('afterprint')); } catch (e) { /* ignore */ }
                  });
                return;
              }
            } catch (e) { /* fall through to the normal dialog */ }
            return original();
          };
        } catch (e) { /* cross-origin or closed window: leave it alone */ }
      }

      // Hidden iframes: patch the first time the POS asks for the iframe's window.
      const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      if (desc && desc.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () {
            const w = desc.get.call(this);
            patchWindow(w);
            return w;
          },
        });
      }

      // Blank popups opened with window.open('') for slips.
      const originalOpen = window.open;
      window.open = function (url) {
        const w = originalOpen.apply(window, arguments);
        if (url === undefined || url === '' || url === 'about:blank') patchWindow(w);
        return w;
      };
    },
  });
}
