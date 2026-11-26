#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildRepo, generateKeys } from "../lib/repo.mjs";
import { loadSource } from "../lib/runner.mjs";

const usage = `shelf-repo <command>

  keygen [dir]                     Create signing.key (keep it secret) and print the public key
  build [repoDir]                  Validate sources and write dist/ with a signed index.json
                                   Key from $SHELF_SIGNING_KEY or <repoDir>/signing.key
  run <sourceDir> <fn> [args...]   Call a source function and print the JSON result
                                   e.g. run sources/gutenberg search "pride" 1
                                   Arguments that look like JSON are parsed, so filters work:
                                   run sources/ao3 search "tea" 1 '{"sort":["kudos"]}'`;

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "keygen") {
    const dir = args[0] ?? ".";
    const file = path.join(dir, "signing.key");
    if (existsSync(file)) throw new Error(`${file} already exists`);
    const { privatePem, publicKey } = generateKeys();
    await writeFile(file, privatePem, { mode: 0o600 });
    console.log(`Wrote ${file}. Add it to .gitignore and your CI secrets.\nPublic key: ${publicKey}`);
  } else if (cmd === "build") {
    const repoDir = args[0] ?? ".";
    const privatePem = process.env.SHELF_SIGNING_KEY ?? (await readFile(path.join(repoDir, "signing.key"), "utf8"));
    const index = await buildRepo(repoDir, { privatePem });
    console.log(`Built ${index.sources.length} source(s) into ${path.join(repoDir, "dist")}`);
  } else if (cmd === "run") {
    const [sourceDir, fn, ...fnArgs] = args;
    if (!sourceDir || !fn) throw new Error(usage);
    const { call } = await loadSource(sourceDir);
    const parsed = fnArgs.map((a) => {
      if (/^-?\d+$/.test(a)) return Number(a);
      if (/^[[{]/.test(a)) { try { return JSON.parse(a); } catch { /* plain text */ } }
      return a;
    });
    console.log(JSON.stringify(await call(fn, ...parsed), null, 2));
  } else {
    console.log(usage);
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
