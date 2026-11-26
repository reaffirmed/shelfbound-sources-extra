import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../tools/shelf-repo/lib/runner.mjs";

// Offline tests against pages written in the stock Madara theme's markup, which ToonGod uses.
// toongod.org refused the machine these were written on, so the fixtures are not saved copies
// of the live site: when you can reach it, save real pages into fixtures/toongod/ and fix
// the selectors in sources/toongod/main.js until these pass again.

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../sources/toongod");
const fixture = (name) => readFile(path.join(here, "fixtures", "toongod", name), "utf8");
const SERIES = "the-last-swordsman";
const EXPLICIT = { maxRating: "explicit" };

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers ?? {}, body: init?.body });
    for (const [pattern, body, method] of routes) {
      if (pattern.test(url) && (!method || method === (init?.method ?? "GET"))) return { status: 200, url, headers: [], text: async () => body };
    }
    return { status: 404, url, headers: [], text: async () => "" };
  };
  impl.calls = calls;
  return impl;
}

test("search reads cards and full-size covers, and leaves adult series out by default", async () => {
  const fetchImpl = fakeFetch([[/\?s=/, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const page = await call("search", "sword", 1, {});

  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.origin + url.pathname, "https://www.toongod.org/");
  assert.equal(url.searchParams.get("s"), "sword");
  assert.equal(url.searchParams.get("post_type"), "wp-manga");
  assert.equal(url.searchParams.get("adult"), "0");
  assert.equal(fetchImpl.calls[0].headers.Referer, "https://www.toongod.org/");
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.results.map((r) => r.id), ["the-last-swordsman", "garden-of-the-moon-king"]);
  assert.equal(page.results[0].title, "The Last Swordsman");
  assert.equal(page.results[0].coverURL, "https://www.toongod.org/wp-content/uploads/2026/01/the-last-swordsman.jpg");
  assert.equal(page.results[1].title, "Garden of the Moon King & Co");
  assert.equal(page.results[1].coverURL, "https://www.toongod.org/wp-content/uploads/2024/05/garden-of-the-moon-king.png");
  assert.equal(page.results[0].format, "manhwa");
});

test("with explicit sources allowed, adult series show and the adult filter is passed through", async () => {
  const fetchImpl = fakeFetch([[/\?s=/, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl, settings: EXPLICIT });
  const page = await call("search", "", 1, {});
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get("adult"), null);
  assert.deepEqual(page.results.map((r) => r.id), ["the-last-swordsman", "after-hours-lessons", "garden-of-the-moon-king"]);

  await call("search", "", 1, { adult: ["1"] });
  assert.equal(new URL(fetchImpl.calls[1].url).searchParams.get("adult"), "1");
});

test("filters map to the Madara search form, and later pages use /page/N/", async () => {
  const fetchImpl = fakeFetch([[/\?s=/, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  await call("search", "", 3, {
    sort: ["views"], status: ["end", "on-going"], genres: ["Action", "Martial Arts"], genreMatch: ["any"],
    author: ["Han Seo"], artist: ["Studio Rill"], release: ["2026"], adult: ["1"],
  });
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/page/3/");
  assert.deepEqual(url.searchParams.getAll("genre[]"), ["action", "martial-arts"]);
  assert.equal(url.searchParams.get("op"), "");
  assert.deepEqual(url.searchParams.getAll("status[]"), ["end", "on-going"]);
  assert.equal(url.searchParams.get("m_orderby"), "views");
  assert.equal(url.searchParams.get("author"), "Han Seo");
  assert.equal(url.searchParams.get("artist"), "Studio Rill");
  assert.equal(url.searchParams.get("release"), "2026");
  assert.equal(url.searchParams.get("adult"), "0", "the adult filter is ignored unless explicit sources are allowed");
});

test("genres come from the site's search form, adult ones only when explicit sources are allowed", async () => {
  const routes = [[/\/\?s=&post_type=wp-manga$/, await fixture("form.html")], [/\?s=/, await fixture("search.html")]];
  const fetchImpl = fakeFetch(routes);
  const { call } = await loadSource(dir, { fetchImpl });
  const labels = (await call("getFilters")).find((f) => f.id === "genres").options.map((o) => o.label);
  assert.deepEqual(labels, ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Harem", "Martial Arts", "Office Workers", "Reincarnation", "Romance"]);

  await call("search", "", 1, { genres: ["Office Workers", "Reincarnation", "Cooking Show"] });
  assert.deepEqual(new URL(fetchImpl.calls.at(-1).url).searchParams.getAll("genre[]"), ["office-workers", "reincarnation", "cooking-show"]);
  assert.equal(new URL(fetchImpl.calls.at(-1).url).searchParams.get("op"), "1");

  const explicit = await loadSource(dir, { fetchImpl: fakeFetch(routes), settings: EXPLICIT });
  const all = (await explicit.call("getFilters")).find((f) => f.id === "genres").options.map((o) => o.label);
  assert.ok(all.includes("Adult") && all.includes("Smut"));
});

test("the built-in genre list is used when the search form can't be read", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  const labels = (await call("getFilters")).find((f) => f.id === "genres").options.map((o) => o.label);
  assert.ok(labels.length > 20);
  assert.ok(labels.includes("Martial Arts"));
  assert.ok(!labels.includes("Smut") && !labels.includes("Adult"));
});

test("filter sets for new and old apps", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  assert.deepEqual((await call("getFilters")).map((f) => f.id), ["sort", "status", "genres", "genreMatch", "author", "artist", "release"]);
  const explicit = await loadSource(dir, { fetchImpl: fakeFetch([]), settings: EXPLICIT });
  assert.deepEqual((await explicit.call("getFilters")).map((f) => f.id), ["sort", "status", "adult", "genres", "genreMatch", "author", "artist", "release"]);
  const old = await loadSource(dir, { fetchImpl: fakeFetch([]), filterTypes: null });
  assert.deepEqual((await old.call("getFilters")).map((f) => [f.id, f.type]), [["sort", "select"], ["status", "multi"], ["genres", "multi"]]);
});

test("genre results keep paging: next link, load-more button, or the result count", async () => {
  const base = await fixture("search.html");
  const noLinks = base.replace(/<div class="wp-pagenavi"[\s\S]*?<\/div>/, "");
  const loadMore = noLinks.replace("</body>", '<div class="navigation-ajax"><a class="load-ajax" href="#">Load more</a></div></body>');
  const run = async (html, page) => (await (await loadSource(dir, { fetchImpl: fakeFetch([[/\?s=/, html]]) })).call("search", "", page, { genres: ["Action"] })).hasMore;
  assert.equal(await run(loadMore, 1), true);
  // 128 results, 3 cards a page (one dropped as adult still counts): page 42 has more, 43 is the last.
  assert.equal(await run(noLinks, 42), true);
  assert.equal(await run(noLinks, 43), false);
});

test("a page past the end ends the results instead of showing an error", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  assert.deepEqual(await call("search", "", 9, { genres: ["Action"] }), { results: [], hasMore: false });
  await assert.rejects(call("search", "", 1, {}), /doesn't have that page/);
});

test("browse lists use the search sorted, with no query", async () => {
  const fetchImpl = fakeFetch([[/\?s=/, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  assert.deepEqual((await call("getListings")).map((l) => l.id), ["latest", "trending", "views", "new", "completed"]);
  const page = await call("getListing", "completed", 2);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/page/2/");
  assert.equal(url.searchParams.get("m_orderby"), "views");
  assert.deepEqual(url.searchParams.getAll("status[]"), ["end"]);
  assert.equal(page.results.length, 2);
  await assert.rejects(call("getListing", "nope", 1), /Unknown list/);
});

test("getWork reads the series page", async () => {
  const fetchImpl = fakeFetch([[new RegExp(`/webtoons/${SERIES}/$`), await fixture("series.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const work = await call("getWork", SERIES);
  assert.equal(work.title, "The Last Swordsman");
  assert.deepEqual(work.altTitles, ["마지막 검사", "Saigo no Kenshi"]);
  assert.deepEqual(work.authors, ["Han Seo", "Studio Rill"]);
  assert.equal(work.coverURL, "https://www.toongod.org/wp-content/uploads/2026/01/the-last-swordsman.jpg");
  assert.equal(work.summaryHTML, "<p>The last student of a fallen school walks out of the mountains <em>with one sword</em>.</p><p>Now every sect wants it back.</p>");
  assert.deepEqual(work.tags, ["Action", "Martial Arts", "Drama", "Revenge"]);
  assert.equal(work.status, "OnGoing");
  assert.equal(work.rating, "General Audiences");
  assert.equal(work.format, "manhwa");
  assert.equal(work.originalLanguage, "Korean");
  assert.equal(work.url, `https://www.toongod.org/webtoons/${SERIES}/`);
});

test("a series in an adult genre, or badged 18+, is rated Mature", async () => {
  const series = await fixture("series.html");
  const genre = series.replace(">Drama</a></div>", '>Drama</a>, <a href="https://www.toongod.org/webtoon-genre/smut/">Smut</a></div>');
  const badge = series.replace('<span class="manga-title-badges new">New</span>', '<span class="manga-title-badges custom adult">18+</span>');
  for (const html of [genre, badge]) {
    const { call } = await loadSource(dir, { fetchImpl: fakeFetch([[/\/webtoons\//, html]]) });
    const work = await call("getWork", SERIES);
    assert.equal(work.rating, "Mature");
    assert.equal(work.title, "The Last Swordsman");
  }
});

test("series links under another folder name still open", async () => {
  const fetchImpl = fakeFetch([[new RegExp(`/manga/${SERIES}/$`), await fixture("series.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const work = await call("getWork", SERIES);
  assert.equal(work.url, `https://www.toongod.org/manga/${SERIES}/`);
  assert.deepEqual(fetchImpl.calls.map((c) => new URL(c.url).pathname.split("/")[1]), ["webtoons", "webtoon", "manga"]);
});

test("getChapters loads the list from ajax/chapters/, oldest first, with numbers and dates", async () => {
  const fetchImpl = fakeFetch([
    [new RegExp(`/webtoons/${SERIES}/ajax/chapters/$`), await fixture("chapters.html"), "POST"],
    [new RegExp(`/webtoons/${SERIES}/$`), await fixture("series.html")],
  ]);
  const { call } = await loadSource(dir, { fetchImpl });
  const chapters = await call("getChapters", SERIES);
  assert.equal(fetchImpl.calls[1].method, "POST");
  assert.equal(fetchImpl.calls[1].headers["X-Requested-With"], "XMLHttpRequest");
  assert.deepEqual(chapters.map((c) => c.id), ["chapter-1", "chapter-40", "chapter-40-5", "chapter-41"]);
  assert.deepEqual(chapters.map((c) => c.number), [1, 40, 40.5, 41]);
  assert.equal(chapters[3].title, "Chapter 41 - Spring Rain");
  assert.equal(chapters[0].publishedAt, "2026-01-02T00:00:00Z");
  assert.equal(chapters[1].publishedAt, "2026-11-10T00:00:00Z");
  assert.equal(chapters[2].publishedAt, undefined, "relative dates are left out");
  assert.equal(chapters[3].publishedAt, "2026-11-24T00:00:00Z");
});

test("getChapters reads an inline list, and falls back to admin-ajax with the post id", async () => {
  const series = await fixture("series.html");
  const list = await fixture("chapters.html");
  const inline = series.replace('<div class="c-blog__heading"></div>', list);
  const one = fakeFetch([[/\/webtoons\//, inline]]);
  assert.equal((await (await loadSource(dir, { fetchImpl: one })).call("getChapters", SERIES)).length, 4);
  assert.equal(one.calls.length, 1);

  const old = fakeFetch([[/\/wp-admin\/admin-ajax\.php$/, list, "POST"], [new RegExp(`/webtoons/${SERIES}/$`), series, "GET"]]);
  const chapters = await (await loadSource(dir, { fetchImpl: old })).call("getChapters", SERIES);
  assert.equal(chapters.length, 4);
  const last = old.calls.at(-1);
  assert.equal(last.body, "action=manga_get_chapters&manga=48211");
});

test("getChapterContent returns every page, lazy ones too, with a referer", async () => {
  const fetchImpl = fakeFetch([[new RegExp(`/webtoons/${SERIES}/chapter-1/$`), await fixture("chapter.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const content = await call("getChapterContent", SERIES, "chapter-1");
  assert.equal(content.type, "images");
  assert.deepEqual(content.pages.map((p) => p.url.split("/").pop()), ["01.jpg", "02.jpg", "03.jpg"]);
  assert.equal(content.pages[0].url, "https://www.toongod.org/wp-content/uploads/WP-manga/data/manga_6a1/c1/01.jpg");
  assert.equal(content.pages[0].headers.Referer, "https://www.toongod.org/");
});

test("idFromURL reads series and chapter links", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  assert.equal(await call("idFromURL", `https://www.toongod.org/webtoons/${SERIES}/chapter-12/`), SERIES);
  assert.equal(await call("idFromURL", `https://toongod.org/webtoon/${SERIES}/`), SERIES);
  assert.equal(await call("idFromURL", `https://example.com/webtoons/${SERIES}/`), null);
});
