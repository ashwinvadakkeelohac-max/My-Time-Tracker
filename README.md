# NEON // Work & Learning Tracker

A cyberpunk personal tracker with editable Sundays, batch activities, learning
and free-time splits, Excel export, JSON backup/restore and optional Google Sheets
sync. The app uses the existing `tracker_YYYY_MM` browser storage format.

Run `npm run dev` and open `http://127.0.0.1:8765`, or open `index.html` directly.
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

- [Deploy on Vercel](DEPLOY.md)
- [Private Google Apps Script hosting](google-sheets/SETUP.md)

`npm run build` copies the site into `public`. Vercel also deploys `api/sheets.js`
for the optional authenticated Sheet connection. No package installation is
needed for local preview, building or the regression tests.

Run `npm test` for tracker and API checks. `npm run test:browser` runs desktop and
mobile checks in Chrome on Windows, with the preview already running.
