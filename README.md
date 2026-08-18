# qassem-site

Portfolio site for Qassem. Self-contained — no dependencies, no external requests.

## Structure

| Path | Role |
|---|---|
| `index.html` | **Source fragment** — the artifact body, no doctype/head |
| `build.sh` | Wraps the fragment into a standalone document |
| `dist/index.html` | **Built output — this is what gets served** |

`dist/` is committed on purpose: App Platform serves it directly with no build
step, so what is deployed is exactly what was built and verified locally.

## Build

```bash
./build.sh                                  # -> dist/index.html
SITE_URL=https://example.com ./build.sh     # set the canonical URL
```

## Deploy

```bash
doctl apps create --spec .do/app.yaml   # first time
git push                                 # thereafter (auto-redeploys)
```

> The canonical URL currently points at `qassem.site`, which is **not registered**.
> Rebuild with `SITE_URL=` set to the real URL before sharing the site publicly.
