#!/usr/bin/env python3
"""Render dist/projects/<page>/ to a single PDF.

Chrome cannot print this page in one pass — it hangs indefinitely past roughly
twenty A4 pages of this content, while either half prints in under a minute. So
the document is printed in chunks and merged. Each chunk hides the sections it
does not own, which also gives every chunk a clean page break for free.

    python3 make-pdf.py [--page sila] [--lang ar] [--out FILE]
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
    js = (
        "<script>document.documentElement.setAttribute('data-lang','%s');"
        "document.documentElement.setAttribute('dir','%s');"
        "document.documentElement.setAttribute('data-theme','light');</script>"
        % (lang, "rtl" if lang == "ar" else "ltr")
    )
    return src.replace("</head>", css + js + "</head>", 1)


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
    return len(re.findall(rb"/Type\s*/Page[^s]", open(path, "rb").read()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default="sila")
    ap.add_argument("--lang", default="ar", choices=["ar", "en"])
    ap.add_argument("--out", default=None)
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
