const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, 'package.json');
const pkg = require(pkgPath);

// Parse the version
let [major, minor, patch] = pkg.version.split('.').map(Number);
patch += 1;
pkg.version = `${major}.${minor}.${patch}`;

// Save the updated package.json
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// Update version in index.html
const indexPath = path.join(__dirname, 'index.html');
if (fs.existsSync(indexPath)) {
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  indexHtml = indexHtml.replace(/<span>Version [0-9.]+<\/span>/g, `<span>Version ${pkg.version}</span>`);
  fs.writeFileSync(indexPath, indexHtml, 'utf8');
}

// Generate the release notes
const releaseNotes = `🚀 This is an auto-generated build of XCoreTech Cleaner (Version ${pkg.version}) created during the latest distribution process. Each time you run npm run dist, a new build version is generated to include the latest updates, improvements, and fixes. This ensures every release is uniquely identifiable and helps track changes across versions. We recommend using the latest build for the best performance, stability, and feature set. Thank you for using XCoreTech Cleaner and staying up to date with continuous improvements.`;

const releaseNotesPath = path.join(__dirname, 'release-notes.md');
fs.writeFileSync(releaseNotesPath, releaseNotes, 'utf8');

console.log(`\n✅ Version bumped to ${pkg.version}`);
console.log(`✅ Generated release-notes.md\n`);
