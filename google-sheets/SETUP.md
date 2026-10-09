# Automatic Google Sheets sync

For a Vercel-hosted tracker, use [DEPLOY.md](../DEPLOY.md). The instructions below
are the alternative private Apps Script hosting option. Keep the
`TRACKER_SYNC_SECRET` script property unset for this private option; setting it
switches the script into the authenticated Vercel bridge mode.

The updated tracker can run as a private Google Apps Script web app. Every edit
saves on the device immediately, then updates Google Sheets after a short delay.
The status at the top confirms when Google has acknowledged the write. Offline
changes are kept across reloads and retried when the connection returns.

## One-time setup

1. Open [your spreadsheet](https://docs.google.com/spreadsheets/d/1wXUkmMr08thE6H77S1SPtjCx-aSrrgXTXSMdbyGA6jk/edit?gid=1741868527).
2. Choose **Extensions → Apps Script**.
3. Replace the default `Code.gs` with the contents of this folder's `Code.gs`.
4. In the script editor, choose **+ → HTML** and name the file **Index**.
   Paste the entire contents of the project's `index.html` into `Index.html`.
5. Select the `setupTracker` function and click **Run**. Authorize access with
   the Google account that can edit this spreadsheet.
6. Choose **Deploy → New deployment → Web app**.
   Set **Execute as: Me** and **Who has access: Only myself**, then deploy.
7. Open the deployment's web app URL. The tracker should show
   **Connected · saved to Google Sheets**.
8. To move existing entries: open your local tracker, click **Backup**, then
   use **Restore** in the deployed tracker. Matching months are replaced locally
   after confirmation; changed dates are sent to the spreadsheet.
9. Use the deployed tracker for daily edits. Bookmark its URL.

Your Google account must have edit access. Some Workspace organizations restrict
Apps Script deployment; use the account permitted by your organization.

## What appears in the spreadsheet

The script creates two tabs in the **same spreadsheet**:

- **Tracker Daily:** one row per date, including Sundays. It contains day type,
  time ranges and topics, batch, learning, miscellaneous, breaks, free time,
  work hours, logged hours, important task, and the last update time.
- **Tracker Data:** a hidden tab containing exact day records. The web app reads
  it to recover split activities, tasks and adjustments on another device.

The existing linked tab (`gid=1741868527`) is preserved. Its layout could not be
inspected during implementation. Filling an existing formatted tab requires
mapping its date rows and column headers first; this script deliberately checks
its own tab headers before writing.

All dates in an edited month get a visible row. Untouched weekdays say
**Not logged** and untouched Sundays say **holiday**. A Sunday marked **working**
is included in totals. Hours are numeric decimal values so spreadsheet formulas
can sum them. For example, 90 minutes becomes `1.5`.

**Work hours = batch + learning + miscellaneous.**
**Logged hours = work + breaks + free time.**

Editing a date updates its existing row. Clearing a date resets that row and
removes the raw day record. Retries do not append duplicates. Only changed dates
are merged, so another device's edits to other dates are retained. Concurrent
edits to the same date use the last successful write.

## Local use and verification

Opening `index.html` locally still works and retains the original
`tracker_YYYY_MM` browser storage keys. The local page saves on the device;
it does **not** sync directly to Google. Automatic sync requires using the
deployed web app. A backup is the transfer path between the local and hosted
tracker because their browser storage belongs to different origins.

After deployment, verify one Sunday and one weekday:

1. Mark Sunday **Working**; add learning from 10:00 to 11:00 and free time
   from 11:00 to 12:00. Wait for **Saved to Google Sheets**.
2. In **Tracker Daily**, check Sunday's date, learning hours and free hours.
3. Edit a weekday's batch slot to **No batch**, with 60 learning minutes and
   the rest as free time. Confirm that its row updates instead of duplicating.
4. Reload the deployed tracker; your entries should load from Google Sheets.

Excel export downloads the same categories, Sunday entries and numeric hours.
Export needs internet to load the existing SheetJS library. Backup and local
tracking continue to work without it.

If you change the source later, update both `Code.gs` and `Index.html`, then use
**Deploy → Manage deployments → Edit → New version → Deploy** to keep the URL.

References: [Google's web app deployment guide](https://developers.google.com/apps-script/guides/web)
and [HTML service server communication](https://developers.google.com/apps-script/guides/html/communication).
