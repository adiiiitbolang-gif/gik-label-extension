set -e
npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=docs/app.js
npx esbuild src/print.js --bundle --minify --format=iife --target=es2019 --outfile=docs/print.js
V=$(date +%s)
sed "s#\./app\.js#./app.js?v=$V#" src/index.html > docs/index.html
sed "s#\./print\.js#./print.js?v=$V#" src/print.html > docs/print.html
# Lark web app (Cloudflare Worker assets)
mkdir -p worker/public
npx esbuild src/webapp.js --bundle --minify --format=iife --target=es2019 --outfile=worker/public/webapp.js
cp docs/print.js worker/public/print.js
sed "s#\./webapp\.js#./webapp.js?v=$V#" src/webapp.html > worker/public/index.html
cp docs/print.html worker/public/print.html
