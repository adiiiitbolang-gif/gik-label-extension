#!/bin/sh
# Build the Base extension (docs/index.html) and the standalone print page (docs/print.html).
set -e
npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=docs/app.js
npx esbuild src/print.js --bundle --minify --format=iife --target=es2019 --outfile=docs/print.js
cp src/index.html src/print.html docs/
