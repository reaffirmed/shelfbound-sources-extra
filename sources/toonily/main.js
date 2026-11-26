// Toonily (toonily.com): manhwa on a customised WordPress Madara theme ("wp-manga").
//
//   search     /search/?s=…&genre[]=…&status[]=…&m_orderby=…   /search/page/N/?… after page 1
//   series     /serie/<slug>/                                    .summary_content, every chapter inline
//   chapter    /serie/<slug>/<chapter-slug>/                     .reading-content img
//
// The series slug is the work ID and the chapter slug ("chapter-12") is the chapter ID.
// Covers and pages come from *.tnlycdn.com.
//
// Most of Toonily's catalog is adult. The site hides adult series from search and lists
// until a visitor sets its "toonily-mature" cookie, so this source only sends that cookie
// when the person allows explicit sources (Settings > Show sources rated up to Explicit).
// Without it, search and Discover only show the site's general audience series.

const BASE = "https://toonily.com";
const REFERER = BASE + "/";

const SORTS = [
  ["", "Best match"],
  ["latest", "Latest updates"],
  ["trending", "Trending"],
  ["views", "Most views"],
  ["rating", "Rating"],
  ["new-manga", "Newly added"],
  ["alphabet", "A to Z"],
];
const STATUSES = [["on-going", "Ongoing"], ["end", "Completed"], ["on-hold", "Hiatus"], ["canceled", "Canceled"]];
// The genre list from the site's search form, by slug.
const GENRES = [
  ["action", "Action"], ["adventure", "Adventure"], ["comedy", "Comedy"], ["crime", "Crime"], ["drama", "Drama"],
  ["fantasy", "Fantasy"], ["gossip", "Gossip"], ["historical", "Historical"], ["horror", "Horror"],
  ["isekai", "Isekai"], ["josei", "Josei"], ["magic", "Magic"], ["mature", "Mature"], ["mystery", "Mystery"],
  ["psychological", "Psychological"], ["romance", "Romance"], ["school-life", "School Life"],
  ["scifi-webtoon", "Sci-Fi"], ["seinen", "Seinen"], ["shoujo", "Shoujo"], ["shounen", "Shounen"],
  ["slice-of-life", "Slice of Life"], ["sports", "Sports"], ["supernatural", "Supernatural"],
  ["thriller", "Thriller"], ["tragedy", "Tragedy"], ["villainess", "Villainess"], ["wuxia", "Wuxia"],
  ["yaoi", "Yaoi"], ["yuri", "Yuri"],
];
const ADULT_GENRES = new Set(["mature", "adult", "smut", "hentai", "ecchi"]);

// The genre list read from the site's own search form, so genres the list above misses
// (like Martial Arts) can still be picked. Falls back to the list above if the form can't be read.
let siteGenres = null;

async function genreList() {
  if (siteGenres) return siteGenres;
  try {
    const html = await get(`${BASE}/?s=&post_type=wp-manga`);
    const found = [];
    for (const box of host.select(html, ".checkbox")) {
      const input = host.select(box.outerHTML, "input")[0];
      if (!input || input.attrs.name !== "genre[]" || !input.attrs.value) continue;
      const label = decode(box.text);
      if (label && !found.some(([slug]) => slug === input.attrs.value)) found.push([input.attrs.value, label]);
    }
    if (found.length >= 10) siteGenres = found;
  } catch (_) {
    // Use the built-in list.
  }
  return siteGenres || GENRES;
}

const slugify = (name) => String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const LISTINGS = [
  { id: "latest", title: "Freshly updated", subtitle: "Newest chapters first", sort: "latest" },
  { id: "trending", title: "Trending", subtitle: "Popular right now", sort: "trending" },
  { id: "views", title: "Best of all time", subtitle: "Most views ever", sort: "views" },
  { id: "new", title: "Recently added", subtitle: "New to Toonily", sort: "new-manga" },
  { id: "completed", title: "Completed", subtitle: "Finished series, most views first", sort: "views", status: "end" },
];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const opts = (pairs) => pairs.map(([id, label]) => ({ id, label }));
const pad = (n) => (n < 10 ? "0" + n : String(n));

const decode = (s) =>
  String(s ?? "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&#8217;/g, "’").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

function adultAllowed() {
  return host.settings.get("maxRating") === "explicit";
}

function headers() {
  const h = { Referer: REFERER };
  if (adultAllowed()) h.Cookie = "toonily-mature=1";
  return h;
}

function fullFilters() {
  const kinds = host.filterTypes || [];
  return ["text", "tags"].every((k) => kinds.includes(k));
}

async function get(url) {
  const res = await host.fetch({ url, headers: headers() });
  if (res.status === 404) throw new Error("Toonily doesn't have that page any more.");
  if (res.status === 429) throw new Error("Toonily asked us to slow down. Try again in a minute.");
  if (res.status < 200 || res.status >= 300) throw new Error(`Toonily answered ${res.status}.`);
  return res.body;
}

function slugFrom(href) {
  const m = String(href ?? "").match(/\/serie\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** The image's own URL: lazy-load attributes first, and the full size instead of a "-175x238" thumbnail. */
function imageURL(img, fullSize) {
  if (!img) return undefined;
  const a = img.attrs;
  const src = [a["data-src"], a["data-lazy-src"], a.src].map((s) => String(s || "").trim()).find((s) => /^https?:\/\//.test(s));
  if (!src) return undefined;
  return fullSize ? src.replace(/-\d+x\d+(\.(?:jpe?g|png|webp|gif))$/i, "$1") : src;
}

/** "Mar 6, 26" or "March 6, 2026" to an ISO date. "2 hours ago" and the like are left out. */
function date(text) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})/.exec(String(text || ""));
  if (!m || !MONTHS[m[1].toLowerCase()]) return undefined;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}T00:00:00Z`;
}

function card(item) {
  const html = item.outerHTML;
  const link = host.select(html, ".post-title a")[0] || host.select(html, "a").find((a) => slugFrom(a.attrs.href));
  const id = link && slugFrom(link.attrs.href);
  if (!id) return null;
  return {
    id,
    title: decode(link.text || link.attrs.title),
    authors: [],
    coverURL: imageURL(host.select(html, ".item-thumb img, img")[0], true),
    format: "manhwa",
  };
}

function searchURL(query, pageNumber, filters) {
  const f = filters || {};
  const one = (id) => (f[id] && f[id][0]) || "";
  const known = (siteGenres || []).concat(GENRES);
  const genreSlug = Object.fromEntries(known.map(([slug, name]) => [name.toLowerCase(), slug]));
  const params = [["s", String(query ?? "").trim()], ["post_type", "wp-manga"]];
  for (const g of f.genres || []) {
    // A typed name that isn't in the list goes as the site would spell its slug.
    const slug = genreSlug[String(g).toLowerCase()] || (known.some(([s]) => s === g) ? g : slugify(g));
    if (slug) params.push(["genre[]", slug]);
  }
  if ((f.genres || []).length) params.push(["op", one("genreMatch") === "any" ? "" : "1"]);
  for (const s of f.status || []) params.push(["status[]", s]);
  if (one("author")) params.push(["author", one("author")]);
  if (one("artist")) params.push(["artist", one("artist")]);
  if (adultAllowed() && one("adult")) params.push(["adult", one("adult")]);
  if (one("sort")) params.push(["m_orderby", one("sort")]);
  const path = (pageNumber || 1) > 1 ? `/search/page/${pageNumber}/` : "/search/";
  return BASE + path + "?" + params.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
}

/**
 * Whether the results go on past this page. Filtered searches don't always draw the
 * numbered page links: some pages load more with a button instead, so the result count
 * in the heading ("354 results") is checked too.
 */
function morePages(html, page, perPage) {
  if (host.select(html, "a.nextpostslink, .nav-previous a, .wp-pagenavi a.next, a.next.page-numbers").length) return true;
  if (host.select(html, ".navigation-ajax, #navigation-ajax, .load-ajax").length) return true;
  const heading = host.select(html, ".c-blog__heading h1, .c-blog__heading .h4, h1.h4, .search-wrap .h4")[0];
  const m = heading && /([\d,.]+)\s+results?/i.exec(heading.text);
  if (m) return Number(m[1].replace(/[,.]/g, "")) > page * perPage;
  return false;
}

/** Text of a .post-content_item row by its heading, e.g. "Status" -> "Completed". */
function row(html, heading) {
  const item = host.select(html, ".post-content_item").find((r) => {
    const h = host.select(r.outerHTML, ".summary-heading")[0];
    return h && h.text.toLowerCase().startsWith(heading.toLowerCase());
  });
  return item ? host.select(item.outerHTML, ".summary-content")[0] : null;
}

globalThis.source = {
  async getListings() {
    return LISTINGS.map(({ id, title, subtitle }) => ({ id, title, subtitle }));
  },

  async getListing(id, pageNumber) {
    const listing = LISTINGS.find((l) => l.id === id);
    if (!listing) throw new Error("Unknown list: " + id);
    const filters = { sort: [listing.sort] };
    if (listing.status) filters.status = [listing.status];
    return globalThis.source.search("", pageNumber, filters);
  },

  async getFilters() {
    const sort = { id: "sort", label: "Sort by", type: "select", default: [""], options: opts(SORTS) };
    const status = { id: "status", label: "Status", type: "multi", options: opts(STATUSES) };
    const all = await genreList();
    const genres = all.filter(([slug, name]) => adultAllowed() || GENRES.some(([s]) => s === slug) || !ADULT_GENRES.has(slug) && !ADULT_GENRES.has(name.toLowerCase()));
    if (!fullFilters()) {
      // Apps before 0.4 only show select, multi and toggle.
      return [sort, status, { id: "genres", label: "Genres", type: "multi", options: opts(genres) }];
    }
    const filters = [
      { ...sort, group: "Sort" },
      { ...status, group: "Series" },
      {
        id: "genres", label: "Genres", type: "tags", group: "Genres", workField: "tags",
        placeholder: "Start typing a genre", options: genres.map(([, name]) => ({ id: name, label: name })),
      },
      {
        id: "genreMatch", label: "Genres to match", type: "select", default: ["all"], group: "Genres",
        options: [{ id: "all", label: "All of them" }, { id: "any", label: "Any of them" }],
      },
      { id: "author", label: "Writer", type: "text", group: "People", placeholder: "Writer's name" },
      { id: "artist", label: "Artist", type: "text", group: "People", placeholder: "Artist's name" },
    ];
    if (adultAllowed()) {
      filters.splice(2, 0, {
        id: "adult", label: "Adult series", type: "select", default: [""], group: "Series",
        options: [{ id: "", label: "Include" }, { id: "0", label: "Leave out" }, { id: "1", label: "Only adult" }],
      });
    }
    return filters;
  },

  async search(query, pageNumber, filters) {
    const page = Math.max(1, Number(pageNumber) || 1);
    let html;
    try {
      html = await get(searchURL(query, page, filters));
    } catch (e) {
      // Past the last page the site answers 404. That's the end of the results, not an error.
      if (page > 1 && /doesn't have that page/.test(e.message)) return { results: [], hasMore: false };
      throw e;
    }
    const seen = new Set();
    const cards = host.select(html, ".page-item-detail, .c-tabs-item__content");
    const results = cards.map(card).filter((r) => r && !seen.has(r.id) && seen.add(r.id));
    return { results, hasMore: results.length > 0 && morePages(html, page, cards.length) };
  },

  async getWork(id) {
    const html = await get(`${BASE}/serie/${encodeURIComponent(id)}/`);
    const h1 = host.select(html, ".post-title h1")[0];
    if (!h1) throw new Error("Couldn't read that series' page on Toonily.");
    const title = decode(h1.html.replace(/<span[^>]*manga-title-badges[\s\S]*?<\/span>/gi, "").replace(/<[^>]+>/g, ""));
    const people = host.select(html, ".author-content a, .artist-content a").map((a) => decode(a.text)).filter(Boolean);
    const genres = host.select(html, ".genres-content a").map((a) => decode(a.text)).filter(Boolean);
    const tags = host.select(html, ".wp-manga-tags-list a").map((a) => decode(a.text).replace(/^#/, "")).filter(Boolean);
    // Toonily appends a few paragraphs of search-engine text after the real summary.
    const paragraphs = host.select(html, ".summary__content p, .description-summary p")
      .filter((p) => !/also known as|commonly searched|Whether you search|read .* online in English/i.test(p.text) && p.text.trim());
    const status = row(html, "Status");
    const body = (host.select(html, "body")[0] || { attrs: {} }).attrs.class || "";
    const adult = /\badult-content\b/.test(body) || genres.some((g) => ADULT_GENRES.has(g.toLowerCase()));
    return {
      id,
      title,
      authors: [...new Set(people)],
      coverURL: imageURL(host.select(html, ".summary_image img")[0], true),
      summaryHTML: paragraphs.length ? paragraphs.map((p) => `<p>${p.html.trim()}</p>`).join("") : undefined,
      url: `${BASE}/serie/${id}/`,
      format: "manhwa",
      rating: adult ? "Mature" : "General Audiences",
      tags: [...new Set(genres.concat(tags))],
      status: status ? decode(status.text) : undefined,
      originalLanguage: "Korean",
      language: "English",
    };
  },

  async getChapters(id) {
    const seriesURL = `${BASE}/serie/${encodeURIComponent(id)}/`;
    let html = await get(seriesURL);
    let items = host.select(html, "li.wp-manga-chapter");
    if (!items.length) {
      // Stock Madara loads the list separately; Toonily inlines it, but fall back if that changes.
      const res = await host.fetch({ url: seriesURL + "ajax/chapters/", method: "POST", headers: { ...headers(), "X-Requested-With": "XMLHttpRequest" } });
      if (res.status >= 200 && res.status < 300) items = host.select(res.body, "li.wp-manga-chapter");
    }
    const chapters = [];
    const seen = new Set();
    for (const li of items) {
      const a = host.select(li.outerHTML, "a")[0];
      const m = a && String(a.attrs.href || "").match(/\/serie\/[^/]+\/([^/?#]+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const name = decode(a.text);
      // "Chapter 12.5", or the slug "chapter-12-5" when the name has no number.
      const named = name.match(/(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
      const slug = m[1].match(/chapter-(\d+)(?:-(\d+))?/i);
      const number = named ? Number(named[1]) : slug ? Number(slug[1] + (slug[2] ? "." + slug[2] : "")) : undefined;
      const when = host.select(li.outerHTML, ".chapter-release-date")[0];
      chapters.push({ id: m[1], title: name, number, publishedAt: date(when && when.text) });
    }
    return chapters.reverse(); // the site lists newest first
  },

  async getChapterContent(id, chapterId) {
    const html = await get(`${BASE}/serie/${encodeURIComponent(id)}/${encodeURIComponent(chapterId)}/`);
    const pages = host.select(html, ".reading-content img")
      .map((img) => imageURL(img, false))
      .filter(Boolean)
      .map((url) => ({ url, headers: { Referer: REFERER } }));
    if (!pages.length) throw new Error("This chapter has no pages on Toonily.");
    return { type: "images", pages };
  },

  idFromURL(url) {
    if (!/^https?:\/\/(www\.)?toonily\.com\//.test(url)) return null;
    return slugFrom(url);
  },
};
