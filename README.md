# GIK Production Label (Lark Base extension)

Sidebar extension for the Lark Base "GIK Production Report Matchaman". It reads the selected
record in the **Production Batches** table and prints 50 x 30 mm thermal labels with a QR code of the batch number.

- Source: `src/` · built site (GitHub Pages): `docs/`
- Build: `npm install && npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=docs/app.js && cp src/index.html docs/`
