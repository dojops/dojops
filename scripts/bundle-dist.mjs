#!/usr/bin/env node
/* global process, console */
// Bundles each package into a single dist/index.js + .d.ts declarations.
// Replaces tsc + minify-dist: all internal modules collapse into one file.
import { build } from "esbuild";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
const distDir = join(cwd, "dist");

// Clean dist/
if (existsSync(distDir)) rmSync(distDir, { recursive: true });

// Step 1: generate .d.ts files only (preserves type info for consumers)
execFileSync("npx", ["tsc", "--emitDeclarationOnly"], {
  stdio: "inherit",
  cwd,
});

// Step 2: collect entry points (main + bin + CLI --entry args)
const entries = [{ src: join(cwd, "src/index.ts"), out: "index" }];

// Auto-detect bin entry points
if (pkg.bin && typeof pkg.bin === "object") {
  for (const binPath of Object.values(pkg.bin)) {
    const name = binPath.replace("dist/", "").replace(".js", "");
    if (name !== "index") {
      const src = join(cwd, "src", `${name}.ts`);
      if (existsSync(src)) entries.push({ src, out: name });
    }
  }
}

// Extra entries via --entry src/file.ts:name
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--entry" && process.argv[i + 1]) {
    const [srcRel, name] = process.argv[i + 1].split(":");
    entries.push({ src: join(cwd, srcRel), out: name });
  }
}

// Step 3: bundle each entry into a single file
for (const entry of entries) {
  // Check if source already has a shebang (avoid duplicates)
  const src = readFileSync(entry.src, "utf8");
  const hasShebang = src.startsWith("#!");
  const isBin = pkg.bin && Object.values(pkg.bin).includes(`dist/${entry.out}.js`);
  const needsBanner = isBin && !hasShebang;

  await build({
    entryPoints: [entry.src],
    bundle: true,
    platform: "node",
    target: "es2022",
    format: "cjs",
    minify: true,
    treeShaking: true,
    outfile: join(distDir, `${entry.out}.js`),
    packages: "external",
    banner: needsBanner ? { js: "#!/usr/bin/env node" } : {},
    logLevel: "warning",
  });
}

const names = entries.map((e) => `dist/${e.out}.js`).join(", ");
console.log(`Bundled ${entries.length} entry point(s): ${names}`);
