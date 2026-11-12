#!/usr/bin/env python3
"""Link-preview cards for every sub-page under dist/.

For each dist/skill/<slug>/index.html and dist/projects/<slug>/index.html:
  1. render a 1200x630 card from the page's own title and description
     -> dist/og/<kind>-<slug>-<hash>.jpg   (hash of the text, so an edited
        title gets a new URL and chat apps drop their cached preview)
  2. write the og: / twitter: tags into the page's <head>

dist/og/ is not touched by any other build step, so cards are rendered once
and reused. Cards no page points at any more are removed.

Runs at the end of build-pages.py. Needs Google Chrome and Pillow; without
them it prints a warning and leaves the pages as they are.
"""
import glob, hashlib, html, os, re, subprocess, sys, tempfile

SITE = os.environ.get("SITE_URL", "https://qassem.online")
DIST = sys.argv[1] if len(sys.argv) > 1 else "dist"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
KINDS = {"skill": ("SERVICE", "خدمة"), "projects": ("PROPOSAL", "عرض مشروع"), "investor": ("INVESTOR BRIEF", "ملف المستثمر")}
VERSION = "2"  # bump to re-render every card after a design change

CARD = """<!doctype html><html lang="{lang}" dir="{dir}"><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&family=IBM+Plex+Sans+Arabic:wght@400;500&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
*{{box-sizing:border-box;margin:0}}
html,body{{width:1200px;height:630px;overflow:hidden;background:#0A0A0B}}
body{{font-family:'IBM Plex Sans Arabic',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#F1EFE9;
  padding:64px 72px;display:flex;flex-direction:column;position:relative}}
body::before{{content:"";position:absolute;inset:0;background:
  radial-gradient(700px 420px at {gx} 0%,rgba(77,124,255,.28),transparent 70%),
  linear-gradient(rgba(241,239,233,.045) 1px,transparent 1px) 0 0/100% 70px}}
body>*{{position:relative}}
.top{{display:flex;align-items:center;gap:18px}}
.kind{{font:500 20px 'IBM Plex Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#7FA0FF;
  border:1px solid rgba(127,160,255,.45);border-radius:99px;padding:8px 20px}}
[dir=rtl] .kind{{font:600 24px 'Cairo',sans-serif;letter-spacing:0;padding:6px 22px}}
.logo{{height:58px;max-width:260px;object-fit:contain;margin-inline-start:auto}}
h1{{font:800 {fs}px/1.22 'Cairo',-apple-system,'Helvetica Neue',Arial,sans-serif;letter-spacing:-.01em;
  margin-top:44px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}}
p{{font-size:30px;line-height:1.5;color:#9A978E;margin-top:22px;max-width:980px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}
.foot{{margin-top:auto;display:flex;align-items:center;gap:14px;direction:ltr;
  font:500 23px 'IBM Plex Mono',ui-monospace,Menlo,monospace;color:#F1EFE9}}
.dot{{width:22px;height:22px;border-radius:50%;background:#4D7CFF;box-shadow:0 0 0 7px rgba(77,124,255,.18)}}
.foot span{{color:#5E5C56}}
</style>
<div class="top"><span class="kind">{kind}</span>{logo}</div>
<h1>{title}</h1>
<p>{desc}</p>
<div class="foot"><i class="dot"></i>qassem.online<span>{path}</span></div>
"""


def meta(page, pattern):
    m = re.search(pattern, page, re.S)
    return html.unescape(m.group(1).strip()) if m else ""


def render(card_html, out):
    from PIL import Image
    with tempfile.TemporaryDirectory() as tmp:
        src, png = os.path.join(tmp, "card.html"), os.path.join(tmp, "card.png")
        open(src, "w", encoding="utf-8").write(card_html)
        subprocess.run(
            [CHROME, "--headless=new", "--hide-scrollbars", "--window-size=1200,630",
             "--virtual-time-budget=8000", "--allow-file-access-from-files",
             f"--screenshot={png}", f"file://{src}"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
        img = Image.open(png).convert("RGB")
        if img.size != (1200, 630):
            img = img.resize((1200, 630))
        img.save(out, "JPEG", quality=86, optimize=True)


def tags(title, desc, url, image):
    e = html.escape
    return "\n".join([
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Qassem" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(desc)}" />',
        f'<meta property="og:url" content="{url}" />',
        f'<meta property="og:image" content="{image}" />',
        f'<meta property="og:image:secure_url" content="{image}" />',
        '<meta property="og:image:type" content="image/jpeg" />',
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        f'<meta property="og:image:alt" content="{e(title)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{e(title)}" />',
        f'<meta name="twitter:description" content="{e(desc)}" />',
        f'<meta name="twitter:image" content="{image}" />',
    ])


def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("make-og: Pillow not installed, previews skipped"); return
    can_render = os.path.exists(CHROME)
    og_dir = os.path.join(DIST, "og")
    os.makedirs(og_dir, exist_ok=True)
    keep, made, reused = set(), 0, 0

    for kind in ("skill", "projects"):
        for path in sorted(glob.glob(os.path.join(DIST, kind, "*", "index.html"))):
            slug = os.path.basename(os.path.dirname(path))
            page = open(path, encoding="utf-8").read()
            title = meta(page, r"<title>(.*?)</title>")
            desc = meta(page, r'<meta\s+name="description"\s+content="(.*?)"\s*/?>')
            if not title:
                continue
            # Under /projects/, a page with a source fragment is a client proposal;
            # the rest are the investor pages staged by deploy-skills.sh.
            label = kind
            if kind == "projects" and not os.path.exists(os.path.join(DIST, "..", "projects", slug + ".html")):
                label = "investor"
            arabic = bool(re.search(r"[؀-ۿ]", title))
            logo = ""
            for cand in ("logo-dark.webp", "logo-dark.png", "logo.webp", "logo.png", "logo.svg"):
                f = os.path.join(os.path.dirname(path), "assets", cand)
                if os.path.exists(f):
                    logo = f'<img class="logo" src="file://{os.path.abspath(f)}">'
                    break
            digest = hashlib.sha1("|".join([VERSION, label, title, desc, logo and cand]).encode()).hexdigest()[:10]
            name = f"{kind}-{slug}-{digest}.jpg"
            out = os.path.join(og_dir, name)
            if not os.path.exists(out):
                if not can_render:
                    print(f"make-og: Chrome not found, no preview for /{kind}/{slug}"); continue
                render(CARD.format(
                    lang="ar" if arabic else "en", dir="rtl" if arabic else "ltr",
                    gx="12%" if arabic else "88%",
                    fs=62 if len(title) > 52 else 76,
                    kind=KINDS[label][1 if arabic else 0], logo=logo,
                    title=html.escape(title), desc=html.escape(desc),
                    path=f"/{kind}/{slug}"), out)
                made += 1
            else:
                reused += 1
            keep.add(name)

            page = re.sub(r'[ \t]*<meta\s+(?:property="og:|name="twitter:)[^>]*>\n?', "", page)
            block = tags(title, desc, f"{SITE}/{kind}/{slug}", f"{SITE}/og/{name}")
            page = page.replace("</head>", block + "\n</head>", 1)
            open(path, "w", encoding="utf-8").write(page)

    if can_render:
        for f in os.listdir(og_dir):
            if f.endswith(".jpg") and f not in keep:
                os.remove(os.path.join(og_dir, f))
    print(f"make-og: {len(keep)} page(s) with a preview card  ({made} rendered, {reused} reused)")


main()
