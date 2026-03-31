#!/usr/bin/env node
/* global process, console, Buffer */
// Post-build minification: shrinks dist/*.js files, preserves .d.ts and non-JS assets.
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "terser";

async function* walkJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJs(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

const distDir = join(process.cwd(), "dist");
const exists = await stat(distDir).catch(() => null);
if (!exists) {
  console.error("dist/ not found, skipping minification");
  process.exit(0);
}

let count = 0;
let savedBytes = 0;

for await (const file of walkJs(distDir)) {
  const code = await readFile(file, "utf8");
  const original = Buffer.byteLength(code);
  const result = await minify(code, {
    compress: { dead_code: true, drop_console: false, passes: 2 },
    mangle: { toplevel: false },
    format: { comments: false },
    sourceMap: false,
  });
  if (result.code) {
    await writeFile(file, result.code);
    savedBytes += original - Buffer.byteLength(result.code);
    count++;
  }
}

const kb = (savedBytes / 1024).toFixed(1);
console.log(`Minified ${count} files (saved ${kb} KB)`);
