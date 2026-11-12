# Tidely POS desktop (Windows)

A thin Electron shell around the live Tidely POS. It loads the POS website, so every Lovable publish reaches the desktop app automatically. The PWA is unaffected.

What the desktop app adds:
- A normal Windows installer and desktop icon
- Slips and receipts print straight to the chosen printer, with no print window
- "No internet" retry page instead of a blank window
- Optional: start with Windows, full-screen till mode, customer display on a second screen

## Build the installer (on your Windows PC)

1. Install Node.js 20 or newer from nodejs.org.
2. Open a terminal in this folder and run:
   ```
   npm install
   npm run dist
   ```
3. The installer is created at `dist\Tidely POS Setup 1.0.0.exe`.

Windows will show "unknown publisher" until the installer is code-signed. Click "More info", then "Run anyway".

## Try it without installing

```
npm start          # live POS (tidely-pos-system.lovable.app)
npm run start:test # Lovable preview build
```

Warning: the preview and the live POS share the same Supabase database. Test only with the Shamase Laundry account.

## First-run setup on a till PC

1. Press **Ctrl + ,** (or press Alt, then Tidely, then "Printer and app settings").
2. Choose the receipt printer and the paper width (58 mm or 80 mm).
3. Tick "Print slips straight to this printer".
4. Click **Print test slip**.
5. Save.

Settings are stored per Windows user in `%APPDATA%\Tidely POS\settings.json`.

## How silent printing works

The POS prints slips by writing HTML into a hidden iframe or blank popup and calling `print()`. When silent printing is on, the desktop app intercepts `print()` on those windows only, sends the slip HTML to a hidden window, measures its height, and prints it to the chosen printer. The POS's own page (reports, Ctrl+P) keeps the normal print window.

The cash drawer pulse is already part of the slip HTML (ESC/POS bytes), so it is sent to the printer the same way, provided the printer driver passes it through.

## Status: what has and has not been tested

Tested here (headless, no printer):
- App starts, loads a page, exposes the bridge only to the POS origin and local pages
- `print()` inside a hidden iframe and inside a blank popup is intercepted and the slip reaches the print step
- `afterprint` fires so the POS closes its hidden windows
- `print()` on the main page is left alone

NOT tested yet (needs a Windows PC with a thermal printer):
- The installer build (`npm run dist`) and install/uninstall
- Real printing: slip width, margins, slip length, logo, cash drawer pulse
- Settings window, kiosk mode, start with Windows
- Customer display on a dual-screen terminal (the POS page `/customer-display` does not exist yet)

## Known limits

- The first launch needs internet. After that it behaves like the current PWA.
- Staff sign in once again inside the desktop app.
- Links to other sites (payment pages, WhatsApp) open in the normal browser.
- If the printer is off or missing, the app shows an error message instead of printing.

## Not built yet (Phase 3)

- Auto-update (electron-updater with GitHub Releases)
- Code signing certificate
- Download page and a "Get the desktop app" button in POS Settings
