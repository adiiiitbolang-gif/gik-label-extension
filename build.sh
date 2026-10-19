set -e
npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=docs/app.js
npx esbuild src/print.js --bundle --minify --format=iife --target=es2019 --outfile=docs/print.js
V=$(date +%s)
sed "s#\./app\.js#./app.js?v=$V#" src/index.html > docs/index.html
sed "s#\./print\.js#./print.js?v=$V#" src/print.html > docs/print.html
# Lark web app (Cloudflare Worker assets): hub "/" -> viewer.html?app=<id> -> app.html?tab=<tab>
mkdir -p worker/public
for f in webapp hub viewer; do
  npx esbuild src/$f.js --bundle --minify --format=iife --target=es2019 --outfile=worker/public/$f.js
done
cp docs/print.js worker/public/print.js
cp src/hub.css src/apps.json worker/public/
sed "s#\./webapp\.js#./webapp.js?v=$V#" src/webapp.html > worker/public/app.html
sed -e "s#\./hub\.js#./hub.js?v=$V#" -e "s#\./hub\.css#./hub.css?v=$V#" src/hub.html > worker/public/index.html
sed -e "s#\./viewer\.js#./viewer.js?v=$V#" -e "s#\./hub\.css#./hub.css?v=$V#" src/viewer.html > worker/public/viewer.html
cp docs/print.html worker/public/print.html
