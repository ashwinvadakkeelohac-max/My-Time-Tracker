# Deploy NEON Tracker to Vercel

This is a small HTML app with an optional Node.js function for Google Sheets.
There are no npm dependencies and no database subscription. The static build
publishes only `public/index.html`; script source, tests and setup instructions
are not served as pages.

## Deploy the website

Use a Vercel account on the **Hobby** plan for a personal project. Vercel describes
Hobby as free for personal, non-commercial use; plan usage limits still apply.

From this project directory, run:

```powershell
npx.cmd vercel login
npx.cmd vercel --prod
```

Select your personal account, create a new project, and accept the detected
project settings. `vercel.json` configures **Other** as the framework,
`npm run build` as the build command, and `public` as the output directory.

You can also push this directory to your own Git repository and import the
repository at [vercel.com/new](https://vercel.com/new). Use **Other** and the
build/output settings above if prompted.

The site works immediately with browser storage even without Google Sheets.
Use **Backup** on the old local tracker and **Restore** on the deployed site to
move existing entries. A new domain has separate browser storage.

## Enable automatic Google Sheets sync on Vercel

1. Open [Google Apps Script](https://script.google.com/) using the Google account
   that can edit [your spreadsheet](https://docs.google.com/spreadsheets/d/1wXUkmMr08thE6H77S1SPtjCx-aSrrgXTXSMdbyGA6jk/edit?gid=1741868527).
   Create a new standalone project named **Hermit Tracker Sync**, or reuse the
   tracker project you already created. The spreadsheet ID is included in the code.
2. Paste `google-sheets/Code.gs` into that project's `Code.gs` and save.
   The Vercel connection does **not** need an `Index.html` in Apps Script.
3. Generate a random connection secret locally:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. In Apps Script, open **Project Settings → Script properties**. Add
   **TRACKER_SYNC_SECRET** with the random value from step 3.
5. Run `setupTracker` once in the script editor and authorize it using the
   Google account that can edit the spreadsheet.
6. Deploy as a **Web app**, with **Execute as: Me** and
   **Who has access: Anyone**. This allows Vercel's server to reach the script.
   Every data request is checked against the secret; the public URL does not
   return tracker records without it. Copy the deployment URL ending in `/exec`.
7. In your Vercel project's **Settings → Environment Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `GOOGLE_SCRIPT_URL` | Apps Script web app URL ending in `/exec` |
   | `GOOGLE_SCRIPT_SECRET` | The same secret as `TRACKER_SYNC_SECRET` |
   | `TRACKER_PASSWORD` | Your tracker sign-in password; at least 12 characters |

   Set these for **Production**. Add them to **Preview** only if you want preview
   deployments to access the same spreadsheet. Keep them out of source files.
8. Redeploy the Vercel project after adding the variables.
9. Open the Vercel site, choose **Google Sheets**, and enter your tracker password.
   Existing Sheet entries load into the calendar. A successful edit shows
   **Saved to Google Sheets** at the top.
10. Use **Restore** to import an old backup if needed. It queues the imported
    dates for automatic sync after confirmation.

If an organization does not allow an Apps Script deployment accessible to
**Anyone**, use the private Apps Script hosting option in `google-sheets/SETUP.md`
or keep Vercel in device-storage mode.

The site signs you in with a signed, HttpOnly cookie. The Google connection
secret stays on Vercel's server. Without signing in, visitors can only use their
own browser's local tracker; your Sheet cannot be read or modified through the
Vercel API. Your password is not stored in browser local storage.

The spreadsheet uses a **Tracker Daily** tab and a hidden **Tracker Data** tab.
The existing linked tab is preserved. Each date updates its own row, including
working Sundays, learning and free time. Failed writes remain queued locally and
retry when connected. Editing the same date from two devices uses the last write.

## Download a complete month

On the website, choose **Download month**, select the month and year, and click
**Download Excel**. The workbook has five tabs: **Daily totals**, **Activities**,
**Summary**, **Learning topics**, and **Adjustments**. Activity details contain
every saved start/end time, exact minutes, topics and tasks, including retained
entries on leave and holidays. Totals exclude those inactive entries and apply
manual adjustments. An empty month still includes every calendar date.

Choose **Month backup** for a JSON file containing just the selected month's
complete saved records. It works offline and can be imported with **Restore**.
Downloads use the records loaded on this device; sign in to Google Sheets first
to load cloud records from another device. On Vercel and local preview, both
formats work offline after the page has loaded. The build includes the spreadsheet
library from `vendor/`; keep that folder when uploading files to GitHub.

## Local preview and checks

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:8765`. The preview uses device storage unless the three
environment variables are configured. You can also double-click `index.html`
for a local-only tracker.

```powershell
npm.cmd test
npm.cmd run build
```

The browser checks require Chrome on Windows and a running local preview:

```powershell
npm.cmd run test:browser
```

Sources: [Vercel Hobby plan](https://vercel.com/docs/plans/hobby),
[Vercel build settings](https://vercel.com/docs/builds/configure-a-build),
[Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js),
and [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web).
