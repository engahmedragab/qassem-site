#!/usr/bin/env bash
# Wraps index.html (an artifact fragment: no doctype/head) into a servable
# standalone document at dist/index.html. The design is copied verbatim —
# this script only adds the HTML skeleton the artifact host used to supply.
set -euo pipefail
cd "$(dirname "$0")"

SRC="index.html"
OUT="dist/index.html"
SITE_URL="${SITE_URL:-https://qassem.online}"   # the real domain

mkdir -p dist

python3 - "$SRC" "$OUT" "$SITE_URL" <<'PY'
import re, sys, html
src, out, site = sys.argv[1], sys.argv[2], sys.argv[3]
body = open(src, encoding='utf-8').read()

# Lift <title> and <meta name="description"> out of the fragment into <head>.
m_title = re.search(r'<title>(.*?)</title>\s*', body, re.S)
title = m_title.group(1).strip() if m_title else 'Qassem'
if m_title:
    body = body[:m_title.start()] + body[m_title.end():]

m_desc = re.search(r'<meta\s+name="description"\s+content="(.*?)"\s*/?>\s*', body, re.S)
desc = m_desc.group(1).strip() if m_desc else ''
if m_desc:
    body = body[:m_desc.start()] + body[m_desc.end():]

# Inline favicon: the accent dot from the brand mark. No extra request, no 404.
favicon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
           "%3Crect width='32' height='32' rx='7' fill='%230A0A0B'/%3E"
           "%3Ccircle cx='16' cy='16' r='6' fill='%234D7CFF'/%3E%3C/svg%3E")

head = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{html.escape(title, quote=False)}</title>
<meta name="description" content="{html.escape(desc)}" />
<meta name="theme-color" content="#0A0A0B" />
<meta name="color-scheme" content="dark" />
<link rel="canonical" href="{site}/" />
<link rel="icon" href="{favicon}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Qassem" />
<meta property="og:title" content="{html.escape(title)}" />
<meta property="og:description" content="{html.escape(desc)}" />
<meta property="og:url" content="{site}/" />
<meta property="og:image" content="{site}/og.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Qassem — Developer, AI Consultant and Automation Engineer" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="{site}/og.jpg" />
<meta name="twitter:title" content="{html.escape(title)}" />
<meta name="twitter:description" content="{html.escape(desc)}" />
<style>:root{{color-scheme:dark}}body{{margin:0;padding:0;background:#0A0A0B;color:#F1EFE9}}img{{max-width:100%}}</style>
</head>
<body>
'''

open(out, 'w', encoding='utf-8').write(head + body.strip() + '\n</body>\n</html>\n')
print(f'built {out}  ({len(head)+len(body)} bytes)  canonical={site}')
PY

# Sub-pages: projects/*.html -> dist/projects/<name>/index.html (noindex, link-shared).
SITE_URL="$SITE_URL" python3 build-pages.py
