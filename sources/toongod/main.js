// ToonGod (www.toongod.org): manhwa on the WordPress Madara theme ("wp-manga").
//
//   search     /?s=…&post_type=wp-manga&genre[]=…&status[]=…&m_orderby=…   /page/N/?… after page 1
//   series     /webtoons/<slug>/                     .summary_content, chapters inline or from ajax/chapters/
//   chapter    /webtoons/<slug>/<chapter-slug>/      .reading-content img
//
// The series slug is the work ID and the chapter slug ("chapter-12") is the chapter ID.
// Madara sites name the series folder themselves ("webtoons", "webtoon", "manga"), so the
// folder is read from the links the site gives and the others are tried if a page 404s.
//
// Much of ToonGod's catalog is adult. Madara's search takes adult=0 to leave adult series
// out, so this source sends that, hides adult genres and drops cards badged adult, unless
// the person allows explicit sources (Settings > Show sources rated up to Explicit).

const BASE = "https://www.toongod.org";
const REFERER = BASE + "/";
const FOLDERS = ["webtoons", "webtoon", "manga"];
let folder = FOLDERS[0];

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
// Used only when the site's own search form can't be read (see genreList). The live list
// comes from the site, so genres ToonGod adds later show up without an update.
const GENRES = [
  ["action", "Action"], ["adult", "Adult"], ["adventure", "Adventure"], ["bl", "BL"], ["comedy", "Comedy"],
  ["drama", "Drama"], ["ecchi", "Ecchi"], ["fantasy", "Fantasy"], ["gl", "GL"], ["harem", "Harem"],
  ["historical", "Historical"], ["horror", "Horror"], ["isekai", "Isekai"], ["josei", "Josei"],
  ["martial-arts", "Martial Arts"], ["mature", "Mature"], ["mystery", "Mystery"], ["psychological", "Psychological"],
  ["raw", "Raw"], ["romance", "Romance"], ["school-life", "School Life"], ["sci-fi", "Sci-fi"], ["seinen", "Seinen"],
  ["shoujo", "Shoujo"], ["shounen", "Shounen"], ["slice-of-life", "Slice of Life"], ["smut", "Smut"],
  ["sports", "Sports"], ["supernatural", "Supernatural"], ["thriller", "Thriller"], ["tragedy", "Tragedy"],
  ["uncensored", "Uncensored"], ["yaoi", "Yaoi"], ["yuri", "Yuri"],
];
const ADULT_GENRES = new Set(["adult", "mature", "smut", "hentai", "ecchi", "uncensored", "yaoi", "yuri", "bl", "gl", "18"]);
const isAdultGenre = (slug, name) => ADULT_GENRES.has(String(slug).toLowerCase()) || ADULT_GENRES.has(String(name).toLowerCase().replace(/\+$/, ""));

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
  { id: "new", title: "Recently added", subtitle: "New to ToonGod", sort: "new-manga" },
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

function fullFilters() {
  const kinds = host.filterTypes || [];
  return ["text", "tags"].every((k) => kinds.includes(k));
}

class NotFound extends Error {}

async function get(url) {
  const res = await host.fetch({ url, headers: { Referer: REFERER } });
  if (res.status === 404) throw new NotFound("ToonGod doesn't have that page any more.");
  if (res.status === 429) throw new Error("ToonGod asked us to slow down. Try again in a minute.");
  if (res.status < 200 || res.status >= 300) throw new Error(`ToonGod answered ${res.status}.`);
  return res.body;
}

const SERIES_LINK = /^https?:\/\/(?:www\.)?toongod\.org\/(webtoons?|manga)\/([^/?#]+)(?:\/([^/?#]+))?/;

/** The series slug in a link, and remembers which folder the site uses. */
function slugFrom(href) {
  const m = SERIES_LINK.exec(String(href ?? ""));
  if (!m) return null;
  folder = m[1];
  return m[2];
}

/** Fetches a series page (or a page under it), trying the other folder names if this one 404s. */
async function seriesPage(id, rest = "") {
  const tries = [folder, ...FOLDERS.filter((f) => f !== folder)];
  for (const f of tries) {
    try {
      const html = await get(`${BASE}/${f}/${encodeURIComponent(id)}/${rest}`);
      folder = f;
      return html;
    } catch (e) {
      if (!(e instanceof NotFound) || f === tries.at(-1)) throw e;
    }
  }
}

/** The image's own URL: lazy-load attributes first, and the full size instead of a "-175x238" thumbnail. */
function imageURL(img, fullSize) {
  if (!img) return undefined;
  const a = img.attrs;
  const srcset = String(a["data-srcset"] || a.srcset || "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
  const src = [a["data-src"], a["data-lazy-src"], a["data-cfsrc"], a.src, srcset]
    .map((s) => String(s || "").trim())
    .find((s) => /^https?:\/\//.test(s));
  if (!src) return undefined;
  return fullSize ? src.replace(/-\d+x\d+(\.(?:jpe?g|png|webp|gif))$/i, "$1") : src;
}

/** "Mar 6, 2026", "6 Mar 2026" or "March 6, 26" to an ISO date. "2 hours ago" and the like are left out. */
function date(text) {
  const t = String(text || "");
  let m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})/.exec(t);
  let month, day, year;
  if (m) [, month, day, year] = m;
  else if ((m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{2,4})/.exec(t))) [, day, month, year] = m;
  else return undefined;
  if (!MONTHS[month.toLowerCase()]) return undefined;
  const y = year.length === 2 ? 2000 + Number(year) : Number(year);
  return `${y}-${pad(MONTHS[month.toLowerCase()])}-${pad(Number(day))}T00:00:00Z`;
}

/** Madara marks adult series with a badge on the card ("18+", "Adult") or an "adult" class. */
function cardIsAdult(html) {
  return host.select(html, ".manga-title-badges, .adult, .badge-18").some(
    (b) => /\badult\b/i.test(b.attrs.class || "") || /^(18\+|adult|r-?18|mature)$/i.test(b.text),
  );
}

function card(item) {
  const html = item.outerHTML;
  const link = host.select(html, ".post-title a")[0] || host.select(html, "a").find((a) => slugFrom(a.attrs.href));
  const id = link && slugFrom(link.attrs.href);
  if (!id) return null;
  if (!adultAllowed() && cardIsAdult(html)) return null;
  return {
    id,
    title: decode(link.text || link.attrs.title),
    authors: [],
    coverURL: imageURL(host.select(html, ".item-thumb img, .tab-thumb img, img")[0], true),
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
  if (one("release")) params.push(["release", one("release")]);
  // Leave adult series out unless the person allows explicit sources.
  const adult = adultAllowed() ? one("adult") : "0";
  if (adult) params.push(["adult", adult]);
  if (one("sort")) params.push(["m_orderby", one("sort")]);
  const path = (pageNumber || 1) > 1 ? `/page/${pageNumber}/` : "/";
  return BASE + path + "?" + params.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
}

/**
 * Whether the results go on past this page: a next-page link, a load-more button, or
 * the result count in the heading ("354 results") when neither is drawn.
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

function chapterList(html) {
  return host.select(html, "li.wp-manga-chapter");
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
    const genres = all.filter(([slug, name]) => adultAllowed() || !isAdultGenre(slug, name));
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
      { id: "release", label: "Year released", type: "text", group: "Series", placeholder: "e.g. 2024" },
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
      if (page > 1 && e instanceof NotFound) return { results: [], hasMore: false };
      throw e;
    }
    const seen = new Set();
    const cards = host.select(html, ".page-item-detail, .c-tabs-item__content");
    const results = cards.map(card).filter((r) => r && !seen.has(r.id) && seen.add(r.id));
    // Count every card, adult ones dropped too, so the result count check stays right.
    return { results, hasMore: cards.length > 0 && morePages(html, page, cards.length) };
  },

  async getWork(id) {
    const html = await seriesPage(id);
    const h1 = host.select(html, ".post-title h1")[0];
    if (!h1) throw new Error("Couldn't read that series' page on ToonGod.");
    const title = decode(h1.html.replace(/<span[^>]*manga-title-badges[\s\S]*?<\/span>/gi, "").replace(/<[^>]+>/g, ""));
    const people = host.select(html, ".author-content a, .artist-content a").map((a) => decode(a.text)).filter(Boolean);
    const genres = host.select(html, ".genres-content a").map((a) => decode(a.text)).filter(Boolean);
    const tags = host.select(html, ".wp-manga-tags-list a, .tags-content a").map((a) => decode(a.text).replace(/^#/, "")).filter(Boolean);
    const paragraphs = host.select(html, ".summary__content p, .description-summary p").filter((p) => p.text.trim());
    const status = row(html, "Status");
    const type = row(html, "Type");
    const alt = row(html, "Alternative");
    const body = (host.select(html, "body")[0] || { attrs: {} }).attrs.class || "";
    const badge = host.select(html, ".post-title .manga-title-badges").some((b) => /adult|18/i.test(b.attrs.class + " " + b.text));
    const adult = badge || /\badult-content\b/.test(body) || genres.some((g) => isAdultGenre(slugify(g), g));
    const typeText = type ? decode(type.text).toLowerCase() : "";
    const format = /manhua|chinese/.test(typeText) ? "manhua" : /manga|japanese/.test(typeText) ? "manga" : "manhwa";
    return {
      id,
      title,
      altTitles: alt ? decode(alt.text).split(/\s*[,;/]\s*/).filter((t) => t && t !== title && !/^updating$/i.test(t)) : undefined,
      authors: [...new Set(people)],
      coverURL: imageURL(host.select(html, ".summary_image img")[0], true),
      summaryHTML: paragraphs.length ? paragraphs.map((p) => `<p>${p.html.trim()}</p>`).join("") : undefined,
      url: `${BASE}/${folder}/${id}/`,
      format,
      rating: adult ? "Mature" : "General Audiences",
      tags: [...new Set(genres.concat(tags))],
      status: status ? decode(status.text) : undefined,
      originalLanguage: { manga: "Japanese", manhua: "Chinese" }[format] || "Korean",
      language: "English",
    };
  },

  async getChapters(id) {
    const html = await seriesPage(id);
    let items = chapterList(html);
    const seriesURL = `${BASE}/${folder}/${encodeURIComponent(id)}/`;
    const post = async (url, body) => {
      const res = await host.fetch({
        url, method: "POST", body,
        headers: { Referer: seriesURL, "X-Requested-With": "XMLHttpRequest", ...(body ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}) },
      });
      return res.status >= 200 && res.status < 300 ? chapterList(res.body) : [];
    };
    // Madara loads the list after the page: first the newer per-series endpoint, then admin-ajax.
    if (!items.length) items = await post(seriesURL + "ajax/chapters/");
    if (!items.length) {
      const holder = host.select(html, "#manga-chapters-holder, .rating-post-id, #wp-manga-current-chap")[0];
      const postId = holder && (holder.attrs["data-id"] || holder.attrs.value || holder.attrs["data-post-id"]);
      if (postId) items = await post(`${BASE}/wp-admin/admin-ajax.php`, `action=manga_get_chapters&manga=${encodeURIComponent(postId)}`);
    }
    const chapters = [];
    const seen = new Set();
    for (const li of items) {
      const a = host.select(li.outerHTML, "a")[0];
      const m = a && SERIES_LINK.exec(String(a.attrs.href || ""));
      if (!m || !m[3] || seen.has(m[3])) continue;
      seen.add(m[3]);
      const name = decode(a.text);
      // "Chapter 12.5", or the slug "chapter-12-5" when the name has no number.
      const named = name.match(/(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
      const slug = m[3].match(/chapter-(\d+)(?:-(\d+))?/i);
      const number = named ? Number(named[1]) : slug ? Number(slug[1] + (slug[2] ? "." + slug[2] : "")) : undefined;
      const when = host.select(li.outerHTML, ".chapter-release-date")[0];
      chapters.push({ id: m[3], title: name, number, publishedAt: date(when && when.text) });
    }
    return chapters.reverse(); // the site lists newest first
  },

  async getChapterContent(id, chapterId) {
    const html = await seriesPage(id, `${encodeURIComponent(chapterId)}/`);
    const pages = host.select(html, ".reading-content img, .page-break img")
      .map((img) => imageURL(img, false))
      .filter((url, i, all) => url && all.indexOf(url) === i)
      .map((url) => ({ url, headers: { Referer: REFERER } }));
    if (!pages.length) throw new Error("This chapter has no pages on ToonGod.");
    return { type: "images", pages };
  },

  idFromURL(url) {
    const m = SERIES_LINK.exec(String(url ?? ""));
    return m ? m[2] : null;
  },
};
