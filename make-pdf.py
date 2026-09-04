#!/usr/bin/env python3
"""Render dist/projects/<page>/ to a single PDF.

Rendered with WeasyPrint by default, because Chrome writes Arabic into a PDF as
presentation-form glyphs: nothing in the document is findable. Same test set of
eight Arabic terms, Chrome finds 0 of 8, WeasyPrint finds 8 of 8.

Neither engine manages this page in one pass, so it is rendered in chunks and
merged. Each chunk hides the sections it does not own, which also gives every
chunk a clean page break for free.

WeasyPrint needs pango (brew install pango) and its own virtualenv; run it as

    DYLD_FALLBACK_LIBRARY_PATH=$(brew --prefix)/lib \
      /path/to/venv/bin/python make-pdf.py --lang ar

    python3 make-pdf.py [--page sila] [--lang ar] [--engine weasy|chrome] [--out FILE]
"""

import argparse, http.server, os, re, shutil, socketserver, subprocess, tempfile, threading

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 8901

# Ordered chunks. Keep each under ~12 A4 pages or Chrome starts to hang.
CHUNKS = [
    ("01-intro",   ["#s-top", "#s-have", "#s-brand"],              False),
    ("02-screens", ["#app"],                                       False),
    ("03-build",   ["#s-flow", "#s-systems"],                      False),
    ("04-market",  ["#s-dash", "#s-rivals", "#s-market"],          False),
    ("05-close",   ["#fails", ".band"],                            False),
]


def serve(root):
    os.chdir(root)
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def chunk_html(src, keep, footer, lang):
    """A copy of the page showing only `keep`, with the language pinned."""
    # `.band` is a wrapper holding its own <section>s, so showing the wrapper is
    # not enough — its children have to be shown again or the chunk comes out empty.
    shown = ",".join([s for sel in keep for s in (sel, f"{sel} section")])
    hide_footer = "" if footer else "footer{display:none!important}"
    css = (
        f"<style id='chunk'>section,.band{{display:none!important}}"
        f"{shown}{{display:block!important}}"
        f"{hide_footer}</style>"
    )
    # Pin the language and theme so a stored preference cannot change the output.
    # WeasyPrint runs no JavaScript, so what the script would set has to be
    # written into the markup itself.
    js = (
        "<script>document.documentElement.setAttribute('data-lang','%s');"
        "document.documentElement.setAttribute('dir','%s');"
        "document.documentElement.setAttribute('data-theme','light');</script>"
        % (lang, "rtl" if lang == "ar" else "ltr")
    )
    src = src.replace('<html lang="ar" dir="rtl">',
                      '<html lang="ar" data-lang="%s" data-theme="light" dir="%s">'
                      % (lang, "rtl" if lang == "ar" else "ltr"), 1)
    return src.replace("</head>", css + js + "</head>", 1)


def weasy_pdf(path, out):
    """WeasyPrint lays Arabic out properly, so the text layer is searchable —
    Chrome writes presentation-form glyphs that no reader can find."""
    from weasyprint import HTML
    HTML(filename=path, base_url=os.path.dirname(path) + "/").write_pdf(out)


def print_pdf(url, out, timeout=240):
    proc = subprocess.Popen(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={out}", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise SystemExit(f"Chrome hung printing {url} — split that chunk further.")
    if not os.path.exists(out) or os.path.getsize(out) == 0:
        raise SystemExit(f"No output for {url}")


def pages(path):
    # not a regex over the raw bytes: WeasyPrint packs pages into compressed
    # object streams, where that pattern never appears and every count reads 0.
    from pypdf import PdfReader
    return len(PdfReader(path).pages)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default="sila")
    ap.add_argument("--lang", default="ar", choices=["ar", "en"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--engine", default="weasy", choices=["weasy", "chrome"],
                    help="weasy gives searchable Arabic (default); chrome matches the site pixel for pixel")
    a = ap.parse_args()

    root = os.path.abspath("dist")
    page_dir = os.path.join(root, "projects", a.page)
    index = os.path.join(page_dir, "index.html")
    if not os.path.exists(index):
        raise SystemExit(f"{index} not found — run ./build.sh first")

    out = a.out or f"{a.page}-proposal-{a.lang}.pdf"
    out = os.path.abspath(out)
    src = open(index, encoding="utf-8").read()
    tmp = tempfile.mkdtemp(prefix="pdf-")
    written = []

    httpd = serve(root)
    try:
        for name, keep, footer in CHUNKS:
            fn = f"_pdf-{name}.html"
            open(os.path.join(page_dir, fn), "w", encoding="utf-8").write(
                chunk_html(src, keep, footer, a.lang))
            dst = os.path.join(tmp, f"{name}.pdf")
            print(f"  {name} …", end="", flush=True)
            if a.engine == "weasy":
                weasy_pdf(os.path.join(page_dir, fn), dst)
            else:
                print_pdf(f"http://127.0.0.1:{PORT}/projects/{a.page}/{fn}", dst)
            print(f" {pages(dst)} pages")
            written.append(dst)
            os.remove(os.path.join(page_dir, fn))
    finally:
        httpd.shutdown()

    from pypdf import PdfWriter
    w = PdfWriter()
    for f in written:
        w.append(f)
    with open(out, "wb") as fh:
        w.write(fh)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n  {out}\n  {pages(out)} pages · {os.path.getsize(out)//1024} KB")


if __name__ == "__main__":
    main()
