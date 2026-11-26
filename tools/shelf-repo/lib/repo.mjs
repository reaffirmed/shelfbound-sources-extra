import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const KINDS = ["text", "images"];
const RATINGS = ["safe", "mature", "explicit"];
const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const FORMATS = { text: ["fic", "novel"], images: ["manga", "manhwa", "manhua", "comic"] };
const CAPABILITIES = ["filters", "links", "discovery", "listings", "account"];

export function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: publicKeyString(publicKey),
  };
}

export function publicKeyString(keyObject) {
  const x = keyObject.export({ format: "jwk" }).x; // base64url raw key
  return "ed25519:" + Buffer.from(x, "base64url").toString("base64");
}

export function validateManifest(m, where) {
  const errors = [];
  const need = (k, ok, msg) => { if (!ok) errors.push(`${where}: ${k} ${msg}`); };
  need("id", typeof m.id === "string" && ID_RE.test(m.id), "must be reverse-DNS, like org.example.mysource");
  need("name", typeof m.name === "string" && m.name.length > 0, "is required");
  need("version", typeof m.version === "string" && /^\d+(\.\d+)*$/.test(m.version), "must look like 1.2.0");
  need("kind", KINDS.includes(m.kind), `must be one of ${KINDS.join(", ")}`);
  need("contentRating", RATINGS.includes(m.contentRating), `must be one of ${RATINGS.join(", ")}`);
  need("languages", Array.isArray(m.languages) && m.languages.length > 0, "must list at least one language");
  need("domains", Array.isArray(m.domains) && m.domains.length > 0 && m.domains.every((d) => typeof d === "string" && !d.includes("/")),
    "must list host names the source contacts, like example.org or *.example.org");
  if (m.format !== undefined) {
    const allowed = FORMATS[m.kind] ?? [];
    need("format", allowed.includes(m.format), `must be one of ${allowed.join(", ")} for ${m.kind} sources`);
  }
  if (m.rateLimit !== undefined) {
    const ms = m.rateLimit?.minIntervalMs;
    need("rateLimit.minIntervalMs", Number.isInteger(ms) && ms >= 0 && ms <= 60000, "must be a whole number of milliseconds up to 60000");
  }
  if (m.capabilities !== undefined) {
    need("capabilities", Array.isArray(m.capabilities) && m.capabilities.every((c) => CAPABILITIES.includes(c)),
      `may only contain ${CAPABILITIES.join(", ")}`);
  }
  if ((m.capabilities ?? []).includes("account")) {
    const login = m.account?.loginURL;
    let host = null;
    try { host = new URL(login).hostname; } catch { /* not a URL */ }
    need("account.loginURL", typeof login === "string" && login.startsWith("https://") && host &&
      (m.domains ?? []).some((d) => (d.startsWith("*.") ? host === d.slice(2) || host.endsWith("." + d.slice(2)) : host === d)),
      "must be an https sign-in page on one of the source's domains");
  }
  return errors;
}

/** Reads sources/<name>/{manifest.json, main.js, icon.png?} */
export async function readSources(repoDir) {
  const dir = path.join(repoDir, "sources");
  const out = [];
  for (const name of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const srcDir = path.join(dir, name);
    const manifest = JSON.parse(await readFile(path.join(srcDir, "manifest.json"), "utf8"));
    const script = await readFile(path.join(srcDir, "main.js"), "utf8");
    const iconPath = path.join(srcDir, "icon.png");
    const icon = existsSync(iconPath) ? (await readFile(iconPath)).toString("base64") : undefined;
    out.push({ dir: srcDir, manifest, script, icon });
  }
  return out;
}

/** Builds dist/: one .srcpkg.json per source plus a signed index.json. */
export async function buildRepo(repoDir, { privatePem, outDir = path.join(repoDir, "dist") }) {
  const repo = JSON.parse(await readFile(path.join(repoDir, "repo.json"), "utf8"));
  const key = createPrivateKey(privatePem);
  const publicKey = publicKeyString(createPublicKey(key));
  const sources = await readSources(repoDir);

  const errors = sources.flatMap((s) => validateManifest(s.manifest, path.relative(repoDir, s.dir)));
  const ids = sources.map((s) => s.manifest.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`duplicate source id ${id}`));
  if (errors.length) throw new Error("Invalid sources:\n  " + errors.join("\n  "));

  await mkdir(path.join(outDir, "packages"), { recursive: true });
  const entries = [];
  for (const s of sources) {
    const pkg = { format: 1, manifest: s.manifest, script: s.script, ...(s.icon ? { icon: s.icon } : {}) };
    const bytes = Buffer.from(JSON.stringify(pkg));
    const digest = createHash("sha256").update(bytes).digest();
    const rel = `packages/${s.manifest.id}-${s.manifest.version}.srcpkg.json`;
    await writeFile(path.join(outDir, rel), bytes);
    entries.push({
      id: s.manifest.id,
      name: s.manifest.name,
      version: s.manifest.version,
      kind: s.manifest.kind,
      contentRating: s.manifest.contentRating,
      languages: s.manifest.languages,
      ...(s.manifest.format ? { format: s.manifest.format } : {}),
      ...(s.manifest.minAppVersion ? { minAppVersion: s.manifest.minAppVersion } : {}),
      package: rel,
      sha256: digest.toString("hex"),
      signature: sign(null, digest, key).toString("base64"),
    });
  }
  const index = { format: 1, name: repo.name, maintainer: repo.maintainer, homepage: repo.homepage, publicKey, sources: entries };
  await writeFile(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}
