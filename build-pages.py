#!/usr/bin/env python3
"""Build sub-pages: projects/<name>.html  ->  dist/projects/<name>/index.html

Each fragment is served at /projects/<name>. These are noindex by default —
they are private proposals shared by link, not part of the public site.
"""
import glob, html, os, re, sys

SITE = os.environ.get("SITE_URL", "https://qassem.online")

FAVICON = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='7' fill='%230A0A0B'/%3E"
    "%3Ccircle cx='16' cy='16' r='6' fill='%234D7CFF'/%3E%3C/svg%3E"
)

HEAD = """<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{title}</title>
<meta name="description" content="{desc}" />
<meta name="robots" content="noindex,nofollow" />
<meta name="theme-color" content="#0A0A0B" />
<meta name="color-scheme" content="dark" />
<link rel="icon" href="{favicon}" />
{links}
<style>:root{{color-scheme:dark}}body{{margin:0;padding:0;background:#0A0A0B;color:#F1EFE9}}img{{max-width:100%}}</style>
</head>
<body>
"""


def build(src):
    name = os.path.splitext(os.path.basename(src))[0]
    out_dir = os.path.join("dist", "projects", name)
    out = os.path.join(out_dir, "index.html")
    os.makedirs(out_dir, exist_ok=True)

    body = open(src, encoding="utf-8").read()

    m = re.search(r"<title>(.*?)</title>\s*", body, re.S)
    title = m.group(1).strip() if m else name
    if m:
        body = body[: m.start()] + body[m.end() :]

    m = re.search(r'<meta\s+name="description"\s+content="(.*?)"\s*/?>\s*', body, re.S)
    desc = m.group(1).strip() if m else ""
    if m:
        body = body[: m.start()] + body[m.end() :]

    # Lift font <link> tags into <head>, where the CSP and the loader expect them.
    links = "\n".join(
        m.group(0) for m in re.finditer(r'<link\s+rel="(?:preconnect|stylesheet)"[^>]*>', body)
    )
    body = re.sub(r'<link\s+rel="(?:preconnect|stylesheet)"[^>]*>\s*', "", body)

    head = HEAD.format(
        title=html.escape(title, quote=False),
        desc=html.escape(desc),
        favicon=FAVICON,
        links=links,
    )
    open(out, "w", encoding="utf-8").write(head + body.strip() + "\n</body>\n</html>\n")
    print(f"built {out}  (noindex)  /projects/{name}")


srcs = sorted(glob.glob("projects/*.html"))
if not srcs:
    sys.exit(0)
for s in srcs:
    build(s)
