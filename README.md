# Shelfbound Sources Extra

A second source repo for Shelfbound, next to [shelfbound-sources](https://github.com/reaffirmed/shelfbound-sources). Add it in the app under **Browse → Add repository** with:

```
https://reaffirmed.github.io/shelfbound-sources-extra/
```

| Source | Kind | Rating | Notes |
| --- | --- | --- | --- |
| Toonily | Manhwa | Mature | Webtoon reader. Search by genre, status, writer, artist and sort. Most of Toonily's catalog is adult: it only shows in search and Discover when Settings → Show sources rated up to is Explicit |
| ToonGod | Manhwa | Mature | Webtoon reader. Search by genre (the site's own list), status, writer, artist, year and sort. Adult series only show in search and Discover when Settings → Show sources rated up to is Explicit |

## How publishing works

Every push to `main` runs `.github/workflows/publish.yml`: it runs the offline tests, builds and signs
`dist/` with the key in the `SHELF_SIGNING_KEY` secret, and publishes it to GitHub Pages. The app
checks the repo when you open Browse and offers **Update** for any source whose version went up.

To change a source: edit `sources/<name>/main.js`, bump `version` in its `manifest.json`, push.

To add a source: add `sources/<name>/manifest.json` and `main.js` (see
`examples/repo-template/README.md` in the app repo for the API), plus tests in `test/`.

## Local commands

```sh
npm install
npm test                                                     # offline, against test/fixtures/
npm run run-source -- sources/toonily search "dungeon" 1   # live
npm run build                                                # needs signing.key or $SHELF_SIGNING_KEY
```

`tools/shelf-repo` is a copy of the app repo's `sdk/shelf-repo`.

## The signing key

The app pins the repo's public key the first time you add it. Keep `signing.key` out of git
(it's in `.gitignore`) and only in the `SHELF_SIGNING_KEY` secret. If the key changes, the app
refuses the repo until you remove it and add it again.

## Toonily notes

WordPress with a customised Madara theme. Search is `/search/?s=…&genre[]=…&status[]=…&m_orderby=…`
(`/search/page/N/?…` after page 1), series pages list every chapter inline, and chapter
pages hold the images in `.reading-content`. Covers and pages come from `*.tnlycdn.com`.
Adult series are hidden from search and lists unless the request carries the cookie
`toonily-mature=1`, which the source only sends when the person allows explicit sources.

## ToonGod notes

WordPress with the stock Madara theme. Search is `/?s=…&post_type=wp-manga&genre[]=…&status[]=…&m_orderby=…`
(`/page/N/?…` after page 1), series live under `/webtoons/<slug>/` (the source also tries `/webtoon/`
and `/manga/`), and the chapter list comes from a POST to `<series>/ajax/chapters/`, falling back to
`/wp-admin/admin-ajax.php`. The genre filter reads the site's search form, with a built-in list as backup.
Adult series are left out with Madara's `adult=0` search parameter, dropped when a card carries an
adult badge, and adult genres are hidden, unless the person allows explicit sources.

The test fixtures are written in stock Madara markup, not saved from the site: toongod.org blocks
the cloud machine they were written on. Save real pages into `test/fixtures/toongod/` when you can.
