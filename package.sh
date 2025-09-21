#/usr/bin/env bash

set -e

ncc build src/index.ts
cp action.yml README.md dist/
sed -i 's/dist\/index.js/index.js/g' dist/action.yml
