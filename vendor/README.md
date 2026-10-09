# Spreadsheet export library

`xlsx.full.min.js` is the SheetJS Community Edition 0.18.5 browser build already
used by this tracker. It is bundled locally so Vercel and local downloads work
without an external CDN after the page loads.

Source: https://github.com/SheetJS/sheetjs/blob/v0.18.5/dist/xlsx.full.min.js

License: Apache 2.0. See `SheetJS-LICENSE.txt`.

Keep this folder when uploading the project. `npm run build` copies the library
and its license into `public/vendor`.
