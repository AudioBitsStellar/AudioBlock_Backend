#!/usr/bin/env node
// #760: Verify every router file in src/routes/ is imported and mounted in src/app.ts.
// Exit 1 if any router file is not referenced, so CI catches forgotten mounts.

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../src/routes');
const appFile = path.join(__dirname, '../src/app.ts');

const appContent = fs.readFileSync(appFile, 'utf8');

const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));

let failed = false;
for (const file of routeFiles) {
  const base = path.basename(file, path.extname(file));
  // The file must appear in an import statement in app.ts.
  if (!appContent.includes(`./routes/${base}`) && !appContent.includes(`/routes/${base}`)) {
    console.error(`UNMOUNTED ROUTE: src/routes/${file} is not imported in src/app.ts`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log(`All ${routeFiles.length} route files are mounted in app.ts.`);
}
