import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../tools/shelf-repo/lib/runner.mjs";

// Offline tests against trimmed copies of Toonily pages saved in November 2026.
// When the site changes its markup, save fresh copies into fixtures/ and fix the
// selectors in sources/toonily/main.js until these pass again.

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../sources/toonily");
const fixture = (name) => readFile(path.join(here, "fixtures", "toonily", name), "utf8");
const SERIES = "dungeon-reset-f6fe1207";

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers ?? {} });
    for (const [pattern, body] of routes) {
      if (pattern.test(url)) return { status: 200, url, headers: [], text: async () => body };
    }
    return { status: 404, url, headers: [], text: async () => "" };
  };
  impl.calls = calls;
  return impl;
}

test("search reads cards, full-size covers and the next-page link", async () => {
  const fetchImpl = fakeFetch([[/\/search\//, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const page = await call("search", "solo", 1, {});

  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/search/");
  assert.equal(url.searchParams.get("s"), "solo");
  assert.equal(page.hasMore, true);
  assert.equal(page.results.length, 2);
  const [first, second] = page.results;
  assert.equal(first.id, "the-beginning-after-the-end-54f5cb7c");
  assert.equal(first.title, "The Beginning After the End");
  assert.equal(first.coverURL, "https://static.tnlycdn.com/2020/06/The-Beginning-After-the-End-manhwa.jpg");
  assert.equal(first.format, "manhwa");
  assert.equal(second.title, "Solo Leveling");
});

test("filters map to the Madara search form, and later pages use /search/page/N/", async () => {
  const fetchImpl = fakeFetch([[/\/search\//, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  await call("search", "", 3, {
    sort: ["views"], status: ["end", "on-going"], genres: ["Action", "Sci-Fi"], author: ["Daul"], adult: ["1"],
  });
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/search/page/3/");
  assert.equal(url.searchParams.get("s"), "");
  assert.equal(url.searchParams.get("post_type"), "wp-manga");
  assert.deepEqual(url.searchParams.getAll("genre[]"), ["action", "scifi-webtoon"]);
  assert.equal(url.searchParams.get("op"), "1");
  assert.deepEqual(url.searchParams.getAll("status[]"), ["end", "on-going"]);
  assert.equal(url.searchParams.get("m_orderby"), "views");
  assert.equal(url.searchParams.get("author"), "Daul");
  assert.equal(url.searchParams.get("adult"), null, "the adult filter is ignored unless explicit sources are allowed");
});

test("the mature cookie is only sent when explicit sources are allowed", async () => {
  const route = [[/\/search\//, await fixture("search.html")]];
  const plain = fakeFetch(route);
  await (await loadSource(dir, { fetchImpl: plain })).call("search", "a", 1, {});
  assert.equal(plain.calls[0].headers.Cookie, undefined);
  assert.equal(plain.calls[0].headers.Referer, "https://toonily.com/");

  const explicit = fakeFetch(route);
  const { call } = await loadSource(dir, { fetchImpl: explicit, settings: { maxRating: "explicit" } });
  await call("search", "a", 1, { adult: ["0"] });
  assert.equal(explicit.calls[0].headers.Cookie, "toonily-mature=1");
  assert.equal(new URL(explicit.calls[0].url).searchParams.get("adult"), "0");
});

test("getWork reads the series page without the search-engine filler", async () => {
  const fetchImpl = fakeFetch([[new RegExp(`/serie/${SERIES}/$`), await fixture("series.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const work = await call("getWork", SERIES);
  assert.equal(work.title, "Dungeon Reset");
  assert.deepEqual(work.authors, ["Daul", "Ant Studio"]);
  assert.equal(work.coverURL, "https://static.tnlycdn.com/2026/03/Dungeon-Reset-manhwa.jpg");
  assert.deepEqual(work.tags, ["Action", "Adventure", "Fantasy", "Shounen", "Exploration", "System"]);
  assert.equal(work.status, "Completed");
  assert.equal(work.rating, "General Audiences");
  assert.equal(work.format, "manhwa");
  assert.match(work.summaryHTML, /^<p>\[The Dungeon is resetting\.\]/);
  assert.doesNotMatch(work.summaryHTML, /also known as|commonly searched|Whether you search/);
  assert.equal(work.url, `https://toonily.com/serie/${SERIES}/`);
});

test("a series in the Mature genre is rated Mature", async () => {
  const html = (await fixture("series.html")).replace(">Shounen</a></div>", ">Shounen</a>, <a href=\"https://toonily.com/genre/mature/\">Mature</a></div>");
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([[/\/serie\//, html]]) });
  assert.equal((await call("getWork", SERIES)).rating, "Mature");
});

test("getChapters lists chapters oldest first with numbers and dates", async () => {
  const fetchImpl = fakeFetch([[new RegExp(`/serie/${SERIES}/$`), await fixture("series.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const chapters = await call("getChapters", SERIES);
  assert.deepEqual(chapters.map((c) => c.id), ["chapter-1", "chapter-265", "chapter-265-5", "chapter-266"]);
  assert.deepEqual(chapters.map((c) => c.number), [1, 265, 265.5, 266]);
  assert.equal(chapters[3].title, "Chapter 266 - The End");
  assert.equal(chapters[0].publishedAt, "2019-11-12T00:00:00Z");
  assert.equal(chapters[1].publishedAt, undefined, "relative dates are left out");
  assert.equal(chapters[3].publishedAt, "2026-03-06T00:00:00Z");
});

test("getChapters falls back to the Madara chapter endpoint", async () => {
  const series = (await fixture("series.html")).replace(/<div id="manga-chapters-holder">[\s\S]*<\/div><\/div>/, '<div id="manga-chapters-holder"></div>');
  const list = (await fixture("series.html")).match(/<ul class="main[\s\S]*?<\/ul>/)[0];
  const fetchImpl = fakeFetch([[/\/ajax\/chapters\/$/, list], [/\/serie\/[^/]+\/$/, series]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const chapters = await call("getChapters", SERIES);
  assert.equal(chapters.length, 4);
  assert.equal(fetchImpl.calls[1].method, "POST");
});

test("getChapterContent returns every page, lazy ones too, with a referer", async () => {
  const fetchImpl = fakeFetch([[new RegExp(`/serie/${SERIES}/chapter-2/$`), await fixture("chapter.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const content = await call("getChapterContent", SERIES, "chapter-2");
  assert.equal(content.type, "images");
  assert.deepEqual(
    content.pages.map((p) => p.url.split("/").pop()),
    ["Dungeon-Reset_00.jpg", "Dungeon-Reset_01.jpg", "Dungeon-Reset_02.jpg"],
  );
  assert.equal(content.pages[0].headers.Referer, "https://toonily.com/");
});

test("browse lists use the search sorted, with no query", async () => {
  const fetchImpl = fakeFetch([[/\/search\//, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const listings = await call("getListings");
  assert.deepEqual(listings.map((l) => l.id), ["latest", "trending", "views", "new", "completed"]);
  const page = await call("getListing", "completed", 2);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/search/page/2/");
  assert.equal(url.searchParams.get("m_orderby"), "views");
  assert.deepEqual(url.searchParams.getAll("status[]"), ["end"]);
  assert.equal(page.results.length, 2);
  await assert.rejects(call("getListing", "nope", 1), /Unknown list/);
});

test("filters: full set on new apps, the adult filter only when explicit sources are allowed", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  const filters = await call("getFilters");
  assert.deepEqual(filters.map((f) => f.id), ["sort", "status", "genres", "genreMatch", "author", "artist"]);
  assert.equal(filters.find((f) => f.id === "genres").type, "tags");

  const explicit = await loadSource(dir, { fetchImpl: fakeFetch([]), settings: { maxRating: "explicit" } });
  const all = await explicit.call("getFilters");
  assert.deepEqual(all.map((f) => f.id), ["sort", "status", "adult", "genres", "genreMatch", "author", "artist"]);

  const old = await loadSource(dir, { fetchImpl: fakeFetch([]), filterTypes: null });
  assert.deepEqual((await old.call("getFilters")).map((f) => [f.id, f.type]), [["sort", "select"], ["status", "multi"], ["genres", "multi"]]);
});

test("idFromURL reads series and chapter links", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  assert.equal(await call("idFromURL", `https://toonily.com/serie/${SERIES}/chapter-12/`), SERIES);
  assert.equal(await call("idFromURL", `https://example.com/serie/${SERIES}/`), null);
});

test("genres come from the site's search form, and typed names the list lacks still go as slugs", async () => {
  const form = `<form class="search-advanced-form"><div class="checkbox-group">` +
    ["action:Action", "reincarnation:Reincarnation", "martial-arts:Martial Arts", "romance:Romance", "drama:Drama", "comedy:Comedy",
      "fantasy:Fantasy", "isekai:Isekai", "horror:Horror", "mystery:Mystery", "adult:Adult"]
      .map((pair) => { const [slug, name] = pair.split(":"); return `<div class="checkbox"><input id="${slug}" value="${slug}" name="genre[]" type="checkbox"><label for="${slug}"> ${name}</label></div>`; })
      .join("") + `</div></form>`;
  const fetchImpl = fakeFetch([[/\?s=&post_type=wp-manga/, form], [/\/search\//, await fixture("search.html")]]);
  const { call } = await loadSource(dir, { fetchImpl });
  const genres = (await call("getFilters")).find((f) => f.id === "genres").options.map((o) => o.label);
  assert.ok(genres.includes("Reincarnation"));
  assert.ok(genres.includes("Martial Arts"));
  assert.ok(!genres.includes("Adult"), "adult genres stay hidden unless allowed");

  await call("search", "", 1, { genres: ["Reincarnation", "Martial Arts", "Office Workers"] });
  const url = new URL(fetchImpl.calls.at(-1).url);
  assert.deepEqual(url.searchParams.getAll("genre[]"), ["reincarnation", "martial-arts", "office-workers"]);
});

test("genre results keep paging when the page has a load-more button instead of page links", async () => {
  const html = (await fixture("search.html"))
    .replace(/<div class="wp-pagenavi"[\s\S]*?<\/div>/, '<div class="navigation-ajax"><a class="load-ajax" href="#">Load more</a></div>');
  assert.ok(!html.includes("nextpostslink"));
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([[/\/search\//, html]]) });
  assert.equal((await call("search", "", 1, { genres: ["Action"] })).hasMore, true);
});

test("genre results keep paging from the result count when there are no page links", async () => {
  const html = (await fixture("search.html")).replace(/<div class="wp-pagenavi"[\s\S]*?<\/div>/, "");
  assert.ok(!html.includes("nextpostslink"));
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([[/\/search\//, html]]) });
  // 354 results, 2 on each page here: page 3 has more, page 177 is the last.
  assert.equal((await call("search", "", 3, { genres: ["Action"] })).hasMore, true);
  assert.equal((await call("search", "", 177, { genres: ["Action"] })).hasMore, false);
});

test("a page past the end ends the results instead of showing an error", async () => {
  const { call } = await loadSource(dir, { fetchImpl: fakeFetch([]) });
  assert.deepEqual(await call("search", "", 9, { genres: ["Action"] }), { results: [], hasMore: false });
  await assert.rejects(call("search", "", 1, {}), /doesn't have that page/);
});
