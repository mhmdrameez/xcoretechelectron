"use strict";
// Developer tool caches: uv, npm, pnpm, pip, conda, old temp files and
// Playwright browsers that no project uses. Where a tool has its own clean
// command we use it, because only the tool knows what is still in use.

// original-fs treats .asar archives as plain files (see scanner.js)
const fs   = (() => { try { return require("original-fs"); } catch (_) { return require("fs"); } })();
const os   = require("os");
const path = require("path");
const { execFile } = require("child_process");

const DAY_MS = 24 * 60 * 60 * 1000;
const TEMP_MIN_AGE_DAYS = 7;

const TARGETS = [
  { id: "uv",         name: "uv cache",                            badge: "uv",  color: "#6b4fd8",
    desc: "Packages uv downloaded. Only entries nothing uses are removed." },
  { id: "npm",        name: "npm package cache",                   badge: "npm", color: "#c53635",
    desc: "Copies of downloaded npm packages. npm fetches them again when needed." },
  { id: "pnpm",       name: "pnpm store (unused packages)",        badge: "pn",  color: "#e07b12",
    desc: "Only packages that no project on this PC uses are removed." },
  { id: "pip",        name: "pip cache",                           badge: "py",  color: "#3572a5",
    desc: "Python packages pip downloaded. pip fetches them again when needed." },
  { id: "conda",      name: "conda package cache",                 badge: "C",   color: "#3a9a3f",
    desc: "Package files that no conda environment needs." },
  { id: "temp",       name: "Temp files untouched 7+ days",        badge: "T",   color: "#6b7280",
    desc: "Files in your Temp folder that haven't changed for a week." },
  { id: "playwright", name: "Playwright browsers no project uses", badge: "PW",  color: "#2d8a31",
    desc: "Test browsers left behind by older Playwright versions." },
];

// ─── command helpers ─────────────────────────────────────────────────────────
function defaultRun(cmdline, timeoutMs) {
  return new Promise((resolve) => {
    try {
      execFile("cmd.exe", ["/d", "/s", "/c", `"${cmdline}"`], {
        windowsHide: true, windowsVerbatimArguments: true,
        timeout: timeoutMs || 15000, maxBuffer: 4 * 1024 * 1024,
      }, (err, stdout, stderr) => resolve({
        ok: !err, stdout: String(stdout || ""), stderr: String(stderr || ""),
        error: err ? String(err.message || err) : "",
      }));
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: "", error: String(e && e.message ? e.message : e) });
    }
  });
}

// Finds a real executable on PATH. App-execution-alias stubs in WindowsApps
// (e.g. the "python" that opens the Microsoft Store) are ignored.
async function defaultWhich(tool, run) {
  const r = await run(`where ${tool}`, 5000);
  if (!r.ok) return null;
  const hit = r.stdout.split(/\r?\n/).map((l) => l.trim())
    .find((l) => l && !/\\WindowsApps\\/i.test(l));
  return hit || null;
}

function quote(p) { return `"${String(p).replace(/"/g, "")}"`; }

// ─── filesystem helpers ──────────────────────────────────────────────────────
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

async function dirStats(root, { fileFilter } = {}) {
  let files = 0;
  let bytes = 0;
  const matched = [];
  const queue = [root];
  while (queue.length) {
    const dir = queue.pop();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { queue.push(full); continue; }
      if (!ent.isFile()) continue;
      let st;
      try { st = await fs.promises.stat(full); } catch (_) { continue; }
      if (fileFilter && !fileFilter(st)) continue;
      files++;
      bytes += st.size;
      if (fileFilter) matched.push(full);
    }
  }
  return { files, bytes, matched };
}

async function removeContents(dir) {
  let failed = 0;
  let entries = [];
  try { entries = await fs.promises.readdir(dir); } catch (_) { return { failed: 0 }; }
  for (const name of entries) {
    try { await fs.promises.rm(path.join(dir, name), { recursive: true, force: true, maxRetries: 2 }); }
    catch (_) { failed++; }
  }
  return { failed };
}

// ─── playwright ──────────────────────────────────────────────────────────────
// Mirrors Playwright's own clean-up: every installed copy of playwright-core
// leaves a file in <browsers>/.links pointing at itself; a browser folder is
// still needed if any of those copies lists its revision in browsers.json.
function playwrightBrowsersPath(env, localAppData) {
  const custom = env.PLAYWRIGHT_BROWSERS_PATH;
  if (custom && custom !== "0") return custom;
  return path.join(localAppData, "ms-playwright");
}

function stalePlaywrightDirs(browsersPath) {
  const linksDir = path.join(browsersPath, ".links");
  if (!isDir(linksDir)) return null; // can't tell what's in use — touch nothing

  const needed = new Set();
  for (const link of fs.readdirSync(linksDir)) {
    let pkgDir = "";
    try { pkgDir = fs.readFileSync(path.join(linksDir, link), "utf8").trim(); } catch (_) { continue; }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "browsers.json"), "utf8")); }
    catch (_) { continue; } // that project is gone
    for (const b of (manifest.browsers || [])) {
      const prefix = String(b.name || "").replace(/-/g, "_");
      if (!prefix) continue;
      needed.add(`${prefix}-${b.revision}`.toLowerCase());
      for (const rev of Object.values(b.revisionOverrides || {})) needed.add(`${prefix}-${rev}`.toLowerCase());
    }
  }

  return fs.readdirSync(browsersPath, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z_]+-\d+$/i.test(e.name) && !needed.has(e.name.toLowerCase()))
    .map((e) => path.join(browsersPath, e.name));
}

// ─── conda ───────────────────────────────────────────────────────────────────
function condaLocations(env, userProfile, localAppData) {
  const pkgs = [];
  const exes = [];
  if (env.CONDA_PKGS_DIRS) pkgs.push(...env.CONDA_PKGS_DIRS.split(";").filter(Boolean));
  for (const base of ["anaconda3", "miniconda3", "miniforge3", "mambaforge"]) {
    const root = path.join(userProfile, base);
    pkgs.push(path.join(root, "pkgs"));
    exes.push(path.join(root, "Scripts", "conda.exe"), path.join(root, "condabin", "conda.bat"));
  }
  pkgs.push(path.join(userProfile, ".conda", "pkgs"), path.join(localAppData, "conda", "conda", "pkgs"));
  const seen = new Set();
  return {
    pkgDirs: pkgs.filter((p) => { const k = p.toLowerCase(); if (seen.has(k) || !isDir(p)) return false; seen.add(k); return true; }),
    exes: exes.filter((p) => fs.existsSync(p)),
  };
}

// ─── main API ────────────────────────────────────────────────────────────────
function createDevCaches(options = {}) {
  const env          = options.env || process.env;
  const localAppData = options.localAppData || env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const userProfile  = options.userProfile || env.USERPROFILE || os.homedir();
  const tempDir      = options.tempDir || env.TEMP || env.TMP || os.tmpdir();
  const now          = options.now || Date.now;
  const run          = options.run || defaultRun;
  const which        = options.which || ((tool) => defaultWhich(tool, run));

  // what detect() found, used by clean() so it only touches detected places
  let plan = new Map();

  // known: the earlier result for this target; when given, re-measure the same
  // folders with the same tool instead of asking the tools again
  async function detectOne(t, known) {
    const base = { ...t, status: "nothing", path: "", paths: [], items: null, bytes: 0, cleanable: false, note: "" };

    if (t.id === "npm") {
      const npm = known ? known.tool : await which("npm");
      let cache = known && known.path ? path.dirname(known.path) : (env.npm_config_cache || "");
      if (!cache && npm) {
        const r = await run("npm config get cache", 15000);
        if (r.ok && r.stdout.trim()) cache = r.stdout.trim().split(/\r?\n/).pop().trim();
      }
      if (!cache) cache = path.join(localAppData, "npm-cache");
      const dir = path.join(cache, "_cacache");
      if (!isDir(dir)) return base;
      const s = await dirStats(dir);
      return { ...base, path: dir, paths: [dir], items: s.files, bytes: s.bytes, cleanable: s.bytes > 0, tool: npm,
        status: s.bytes > 0 ? "found" : "nothing" };
    }

    if (t.id === "uv") {
      const uv = known ? known.tool : await which("uv");
      let dir = known && known.path ? known.path : (env.UV_CACHE_DIR || "");
      if (!dir && uv) {
        const r = await run("uv cache dir", 15000);
        if (r.ok && r.stdout.trim()) dir = r.stdout.trim().split(/\r?\n/).pop().trim();
      }
      if (!dir) dir = path.join(localAppData, "uv", "cache");
      if (!isDir(dir)) return base;
      const s = await dirStats(dir);
      return { ...base, path: dir, paths: [dir], items: s.files, bytes: s.bytes, cleanable: s.bytes > 0, tool: uv,
        status: s.bytes > 0 ? "found" : "nothing" };
    }

    if (t.id === "pnpm") {
      const pnpm = known ? known.tool : await which("pnpm");
      let dir = known && known.path ? known.path : "";
      if (!dir && pnpm) {
        const r = await run("pnpm store path", 15000);
        if (r.ok && r.stdout.trim()) dir = r.stdout.trim().split(/\r?\n/).pop().trim();
      }
      if (!dir) dir = path.join(localAppData, "pnpm", "store");
      if (!isDir(dir)) return base;
      const s = await dirStats(dir);
      if (!pnpm) {
        return { ...base, path: dir, paths: [dir], items: s.files, bytes: s.bytes, status: "needs-tool",
          note: "Install pnpm to remove only unused packages." };
      }
      return { ...base, path: dir, paths: [dir], items: s.files, bytes: s.bytes, cleanable: s.bytes > 0, tool: pnpm,
        status: s.bytes > 0 ? "found" : "nothing", note: "Only unused packages are removed." };
    }

    if (t.id === "pip") {
      const dir = env.PIP_CACHE_DIR || path.join(localAppData, "pip", "Cache");
      if (!isDir(dir)) return base;
      const s = await dirStats(dir);
      return { ...base, path: dir, paths: [dir], items: s.files, bytes: s.bytes, cleanable: s.bytes > 0,
        status: s.bytes > 0 ? "found" : "nothing" };
    }

    if (t.id === "conda") {
      const loc = condaLocations(env, userProfile, localAppData);
      if (!loc.pkgDirs.length) return base;
      let files = 0, bytes = 0;
      for (const d of loc.pkgDirs) { const s = await dirStats(d); files += s.files; bytes += s.bytes; }
      const conda = known ? known.tool : ((await which("conda")) || loc.exes[0] || null);
      if (!conda) {
        return { ...base, path: loc.pkgDirs[0], paths: loc.pkgDirs, items: files, bytes, status: "needs-tool",
          note: "conda wasn't found, so unused packages can't be told apart." };
      }
      return { ...base, path: loc.pkgDirs[0], paths: loc.pkgDirs, items: files, bytes, cleanable: bytes > 0, tool: conda,
        status: bytes > 0 ? "found" : "nothing", note: "Only packages no environment uses are removed." };
    }

    if (t.id === "temp") {
      if (!isDir(tempDir)) return base;
      const cutoff = now() - TEMP_MIN_AGE_DAYS * DAY_MS;
      const s = await dirStats(tempDir, { fileFilter: (st) => st.mtimeMs < cutoff });
      return { ...base, path: tempDir, paths: [tempDir], items: s.files, bytes: s.bytes, files: s.matched,
        cleanable: s.files > 0, status: s.files > 0 ? "found" : "nothing" };
    }

    if (t.id === "playwright") {
      const dir = playwrightBrowsersPath(env, localAppData);
      if (!isDir(dir)) return base;
      const stale = stalePlaywrightDirs(dir);
      if (!stale) return { ...base, path: dir, note: "Couldn't tell which browsers are in use." };
      let bytes = 0;
      for (const d of stale) bytes += (await dirStats(d)).bytes;
      return { ...base, path: dir, paths: stale, items: stale.length, bytes, cleanable: stale.length > 0,
        status: stale.length ? "found" : "nothing" };
    }

    return base;
  }

  async function detect() {
    const results = await Promise.all(TARGETS.map((t) => detectOne(t).catch(() =>
      ({ ...t, status: "error", path: "", paths: [], items: null, bytes: 0, cleanable: false, note: "Couldn't check." }))));
    plan = new Map(results.map((r) => [r.id, r]));
    // the renderer doesn't need internal file lists
    return results.map(({ files, tool, paths, ...pub }) => pub);
  }

  async function cleanOne(id) {
    const t = plan.get(id);
    if (!t || !t.cleanable) return { id, ok: false, freedBytes: 0, error: "Nothing to clean." };
    let error = "";

    if (id === "npm") {
      if (t.tool) {
        const r = await run("npm cache clean --force", 10 * 60 * 1000);
        if (!r.ok) error = r.stderr.trim() || r.error;
      } else {
        await removeContents(t.path);
      }
    } else if (id === "uv") {
      if (t.tool) {
        const r = await run("uv cache prune", 10 * 60 * 1000);
        if (!r.ok) error = r.stderr.trim() || r.error;
      } else {
        await removeContents(t.path);
      }
    } else if (id === "pnpm") {
      const r = await run("pnpm store prune", 10 * 60 * 1000);
      if (!r.ok) error = r.stderr.trim() || r.error;
    } else if (id === "conda") {
      const r = await run(`${quote(t.tool)} clean --packages --tarballs --yes`, 10 * 60 * 1000);
      if (!r.ok) error = r.stderr.trim() || r.error;
    } else if (id === "pip") {
      await removeContents(t.path);
    } else if (id === "temp") {
      for (const f of t.files || []) {
        try { await fs.promises.unlink(f); } catch (_) { /* in use — leave it */ }
      }
    } else if (id === "playwright") {
      for (const d of t.paths) {
        try { await fs.promises.rm(d, { recursive: true, force: true, maxRetries: 2 }); } catch (_) {}
      }
    }

    // measure again to report what was really freed
    const after = await detectOne(TARGETS.find((x) => x.id === id), t);
    const freedBytes = Math.max(0, t.bytes - after.bytes);
    plan.set(id, after);
    const { files, tool, paths, ...pub } = after;
    return { id, ok: !error, freedBytes, error: error ? error.split(/\r?\n/)[0].slice(0, 200) : "", target: pub };
  }

  async function clean(ids, onProgress) {
    const list = Array.from(new Set(Array.isArray(ids) ? ids : [])).filter((id) => plan.has(id));
    const results = [];
    for (const id of list) {
      try { onProgress && onProgress({ id, phase: "cleaning" }); } catch (_) {}
      const r = await cleanOne(id).catch((e) => ({ id, ok: false, freedBytes: 0, error: String(e.message || e) }));
      results.push(r);
      try { onProgress && onProgress({ id, phase: "done", result: r }); } catch (_) {}
    }
    return results;
  }

  function planned(id) { return plan.get(id) || null; }

  return { detect, clean, planned };
}

function getDevFixturePath() {
  return path.join(os.tmpdir(), "xcoretech-playwright-devcache-fixture");
}

module.exports = {
  TARGETS,
  createDevCaches,
  stalePlaywrightDirs,
  getDevFixturePath,
  TEMP_MIN_AGE_DAYS,
};
