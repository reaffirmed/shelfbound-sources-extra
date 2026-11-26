import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtemp, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepo, generateKeys, validateManifest } from "../lib/repo.mjs";
import { loadSource } from "../lib/runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, "../../../examples/repo-template");

test("build writes a signed index that verifies", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "shelf-"));
  await cp(template, dir, { recursive: true });
  const { privatePem, publicKey } = generateKeys();
  const index = await buildRepo(dir, { privatePem });
  assert.equal(index.publicKey, publicKey);
  assert.equal(index.sources.length, 1);
  const entry = index.sources[0];
  const bytes = await readFile(path.join(dir, "dist", entry.package));
  const digest = createHash("sha256").update(bytes).digest();
  assert.equal(digest.toString("hex"), entry.sha256);
  const raw = Buffer.from(publicKey.slice("ed25519:".length), "base64");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
  assert.ok(verify(null, digest, key, Buffer.from(entry.signature, "base64")));
});

test("manifest validation catches bad fields", () => {
  const errors = validateManifest({ id: "Bad", name: "", version: "x", kind: "video", contentRating: "pg", languages: [], domains: ["https://x/"] }, "m");
  assert.equal(errors.length, 7);
});

test("runner calls a source with a mocked fetch", async () => {
  const fakeFetch = async (url) => ({ status: 200, url, headers: [], text: async () => JSON.stringify({ results: [], next: null }) });
  const { call } = await loadSource(path.join(template, "sources/gutenberg"), { fetchImpl: fakeFetch });
  assert.deepEqual(await call("search", "x", 1), { results: [], hasMore: false });
});

test("runner reports bot checks instead of handing the page to the source", async () => {
  const { BrowserVerificationNeeded } = await import("../lib/runner.mjs");
  const challenge = async (url) => ({
    status: 403, url, headers: [["server", "cloudflare"], ["cf-mitigated", "challenge"]],
    text: async () => "<title>Just a moment...</title>",
  });
  const { call } = await loadSource(path.join(template, "sources/gutenberg"), { fetchImpl: challenge });
  await assert.rejects(call("search", "x", 1), (e) => e instanceof BrowserVerificationNeeded || /bot check/.test(e.message));
});
