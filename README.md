# Shelfbound Sources Extra

A second source repo for Shelfbound, next to [shelfbound-sources](https://github.com/reaffirmed/shelfbound-sources). Add it in the app under **Browse → Add repository** with:

```
https://reaffirmed.github.io/shelfbound-sources-extra/
```

| Source | Kind | Rating | Notes |
| --- | --- | --- | --- |
| Toonily | Manhwa | Mature | Webtoon reader. Search by genre, status, writer, artist and sort. Most of Toonily's catalog is adult: it only shows in search and Discover when Settings → Show sources rated up to is Explicit |

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
