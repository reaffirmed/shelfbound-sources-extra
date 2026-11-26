import vm from "node:vm";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Runs a source in a Node vm context with the same `host` API the app provides,
 * so authors can test without a phone. This is a development tool, not a security
 * boundary; the app's sandbox is JavaScriptCore.
 */
/** Same rule as the app's `BrowserChallenge.isChallenge`. Header keys are lowercased. */
export function isChallenge(status, headers, body) {
  if ((headers["cf-mitigated"] || "").toLowerCase() === "challenge") return true;
  if (![403, 503, 429].includes(status)) return false;
  if (!(headers.server || "").toLowerCase().includes("cloudflare") && !headers["cf-ray"]) return false;
  const head = String(body).slice(0, 20000).toLowerCase();
  return ["/cdn-cgi/challenge-platform/", "cf-chl-", "<title>just a moment", "cf_chl_opt", "cf-turnstile"].some((s) => head.includes(s));
}

export class BrowserVerificationNeeded extends Error {
  constructor(url) {
    super(`${url} shows a bot check. In the app, the person verifies in the browser and the source is retried. ` +
      "To test from here, open the page in a browser first, or use saved pages.");
    this.name = "BrowserVerificationNeeded";
    this.url = url;
  }
}

// Filter kinds the current app shows ("date" since 0.5.6). Pass `filterTypes: null` to
// act like an app before 0.4, which had only select, multi and toggle and no
// host.filterTypes, or a shorter list to act like another older app.
export const FILTER_TYPES = Object.freeze(["select", "multi", "toggle", "text", "range", "tags", "date"]);

export async function loadSource(sourceDir, { settings = {}, fetchImpl = globalThis.fetch, log = console.error, throttle, filterTypes = FILTER_TYPES } = {}) {
  const manifest = JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8"));
  const script = await readFile(path.join(sourceDir, "main.js"), "utf8");
  const allowed = (url) => {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return manifest.domains.some((d) => (d.startsWith("*.") ? host === d.slice(2) || host.endsWith("." + d.slice(2)) : host === d));
  };

  // Like the app: one request a second per source unless the manifest asks for more.
  const gap = (throttle ?? fetchImpl === globalThis.fetch) ? (manifest.rateLimit?.minIntervalMs ?? 1000) : 0;
  let nextAt = 0;
  const wait = async () => {
    const now = Date.now();
    const at = Math.max(now, nextAt);
    nextAt = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };

  let cheerio = null;
  const host = Object.freeze({
    async fetch(req) {
      if (typeof req === "string") req = { url: req };
      let url = req.url;
      let method = req.method ?? "GET";
      let body = req.body;
      // Redirects are followed by hand so each target is checked against manifest.domains,
      // and `redirect: "manual"` returns the 3xx response itself (read headers.location).
      for (let hop = 0; ; hop++) {
        if (!allowed(url)) throw new Error(`The source tried to reach ${new URL(url).hostname}, which it didn't declare.`);
        await wait();
        const res = await fetchImpl(url, { method, headers: { "User-Agent": "Shelfbound/0.2 (shelf-repo)", ...(req.headers ?? {}) }, body, redirect: "manual" });
        const headers = Object.fromEntries([...(res.headers ?? [])].map(([k, v]) => [k.toLowerCase(), v]));
        const location = headers.location;
        if (res.status >= 300 && res.status < 400 && location && req.redirect !== "manual") {
          if (hop >= 5) throw new Error("Too many redirects from " + req.url);
          url = new URL(location, url).href;
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
          continue;
        }
        const text = await res.text();
        if (isChallenge(res.status, headers, text)) {
          // The app shows "Verify in browser" here; the person passes the check themselves.
          throw new BrowserVerificationNeeded(req.url);
        }
        return { status: res.status, url: res.url || url, headers, body: text };
      }
    },
    async fetchJSON(req) {
      const res = await host.fetch(req);
      if (res.status < 200 || res.status >= 300) throw new Error("HTTP " + res.status + " for " + res.url);
      return JSON.parse(res.body);
    },
    select(html, selector) {
      if (!cheerio) throw new Error("host.select needs the optional 'cheerio' package: npm install cheerio");
      const $ = cheerio.load(String(html));
      return $(selector).toArray().map((el) => ({ text: $(el).text().trim().replace(/\s+/g, " "), html: $(el).html() ?? "", outerHTML: $.html(el), attrs: { ...el.attribs } }));
    },
    needsBrowserVerification(url) {
      throw new BrowserVerificationNeeded(String(url));
    },
    log: (...p) => log(`[${manifest.id}]`, ...p),
    settings: Object.freeze({ get: (k) => settings[k] ?? null }),
    ...(filterTypes ? { filterTypes: Object.freeze([...filterTypes]) } : {}),
  });
  try { cheerio = await import("cheerio"); } catch { /* optional */ }

  const context = vm.createContext({ host, console: { log: host.log, warn: host.log, error: host.log } });
  vm.runInContext(script, context, { filename: path.join(sourceDir, "main.js"), timeout: 1000 });
  const source = context.source;
  for (const fn of ["search", "getWork", "getChapters", "getChapterContent"]) {
    if (typeof source?.[fn] !== "function") throw new Error(`Source must define source.${fn}`);
  }
  const caps = manifest.capabilities ?? [];
  if (caps.includes("filters") && typeof source.getFilters !== "function") throw new Error("The filters capability needs source.getFilters");
  if (caps.includes("links") && typeof source.resolveLink !== "function") throw new Error("The links capability needs source.resolveLink");
  if (caps.includes("account")) {
    for (const fn of ["getAccount", "getAccountLists", "getAccountList"]) {
      if (typeof source[fn] !== "function") throw new Error(`The account capability needs source.${fn}`);
    }
  }
  if (caps.includes("listings") && (typeof source.getListings !== "function" || typeof source.getListing !== "function")) {
    throw new Error("The listings capability needs source.getListings and source.getListing");
  }
  // Round-trip through JSON so results look exactly like what the app receives.
  const call = async (fn, ...args) => {
    if (typeof source[fn] !== "function") throw new Error(`The source has no ${fn} function`);
    return JSON.parse(JSON.stringify(await source[fn](...args)));
  };
  return { manifest, call, implements: (fn) => typeof source[fn] === "function" };
}
