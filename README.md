# NEON // Work & Learning Tracker

A cyberpunk personal tracker with editable Sundays, batch activities, learning
and free-time splits, Excel export, JSON backup/restore and optional Google Sheets
sync. The app uses the existing `tracker_YYYY_MM` browser storage format.

Run `npm run dev` and open `http://127.0.0.1:8765`, or open `index.html` directly.
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

- [Deploy on Vercel](DEPLOY.md)
- [Private Google Apps Script hosting](google-sheets/SETUP.md)

`npm run build` copies the site and spreadsheet library into `public`. Vercel also deploys `api/sheets.js`
for the optional authenticated Sheet connection. No package installation is
needed for local preview, building or the regression tests.

Use **Download month** to select any month and year. The Excel workbook includes
Daily totals, Activities with exact start/end times and minutes, Summary,
Learning topics, and Adjustments. Retained activities on leave and holidays are
included in the activity details and excluded from totals. Numeric hours remain
usable in spreadsheet calculations. A month JSON backup preserves all saved
records for that month and can be restored with **Restore**. Both download formats
work offline after the page has loaded. The existing SheetJS 0.18.5 library is
bundled in `vendor/` with its Apache 2.0 license so Vercel exports do not depend
on a third-party CDN. Keep the `vendor/` folder when uploading the project.

Run `npm test` for tracker and API checks. `npm run test:browser` runs desktop and
mobile checks in Chrome on Windows, with the preview already running.
