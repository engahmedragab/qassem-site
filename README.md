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
./build.sh && git add -A && git commit -m "update" && git push
doctl apps create-deployment 0bdd9c58-1840-446e-86d0-e91a2c0cfbb3
```

**Deploys are manual.** This app uses a `git.repo_clone_url` source, which does not
auto-deploy on push — `deploy_on_push` requires the `github:` source type and a
DigitalOcean<->GitHub OAuth link. A `git push` alone changes nothing on the live
site until `create-deployment` is run.

Live: <https://qassem-site-d4esl.ondigitalocean.app>  ·  App ID `0bdd9c58-1840-446e-86d0-e91a2c0cfbb3`

> The canonical URL currently points at `qassem.site`, which is **not registered**.
> Rebuild with `SITE_URL=` set to the real URL before sharing the site publicly.
