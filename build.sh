#!/bin/sh
# Build the Base extension (docs/index.html) and the standalone print page (docs/print.html).
set -e
npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=docs/app.js
npx esbuild src/print.js --bundle --minify --format=iife --target=es2019 --outfile=docs/print.js
# Cache-busting: phones keep old scripts otherwise.
V=$(date +%s)
sed "s#\./app\.js#./app.js?v=$V#" src/index.html > docs/index.html
sed "s#\./print\.js#./print.js?v=$V#" src/print.html > docs/print.html
