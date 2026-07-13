/* Build: inline engine.js into app.html →
   - hp12c.html      (fragment for the hosted Artifact page)
   - standalone.html (complete document for self-hosting / local preview) */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const engine = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.html'), 'utf8');

const fragment = app.replace('/*__ENGINE__*/', () => engine);
fs.writeFileSync(path.join(dir, 'hp12c.html'), fragment);

// hoist <title>/<meta>/<style> into a real <head> for the standalone build
const cut = fragment.indexOf('</style>') + '</style>'.length;
const headPart = fragment.slice(0, cut);
const bodyPart = fragment.slice(cut);
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${headPart}
</head>
<body>
${bodyPart}
</body>
</html>
`;
fs.writeFileSync(path.join(dir, 'standalone.html'), standalone);
console.log('built hp12c.html (' + fragment.length + ' bytes) and standalone.html');
