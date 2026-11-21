#!/usr/bin/env python3
"""Build sub-pages: projects/<name>.html  ->  dist/projects/<name>/index.html

Each fragment is served at /projects/<name>. These are noindex by default —
they are private proposals shared by link, not part of the public site.
"""
import glob, html, json, os, re, shutil, sys

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
<meta name="theme-color" content="#F4F2EC" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0A0A0B" media="(prefers-color-scheme: dark)" />
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="{favicon}" />
{links}
<style>:root{{color-scheme:light dark;background:#F4F2EC;color:#14140F}}@media(prefers-color-scheme:dark){{:root:not([data-theme="light"]){{background:#0A0A0B;color:#F1EFE9}}}}:root[data-theme="dark"]{{background:#0A0A0B;color:#F1EFE9}}:root[data-theme="light"]{{background:#F4F2EC;color:#14140F}}body{{margin:0;padding:0;background:inherit;color:inherit}}img{{max-width:100%}}</style>
</head>
<body>
"""


# ---------------------------------------------------------------- locked pages
# projects/.locked      committed. One page name per line: these pages are only
#                       ever published encrypted.
# projects/.locks.json  NOT committed. {"<name>": {"user": "...", "pass": "..."}}
#
# A locked page is AES-256-GCM ciphertext with a PBKDF2-SHA256 key made from the
# username and password, decrypted in the browser. The published file holds no
# readable proposal text. On a machine without the credentials file (a fresh
# clone, deploy-skills.sh) a locked page is left exactly as it was published,
# never rebuilt in the clear.
LOCK_ITER = 310000

GATE = """<style>
.lk{{min-height:100vh;display:grid;place-items:center;background:#0D0C0C;color:#F1EFE9;font-family:'IBM Plex Sans Arabic','Cairo',-apple-system,Arial,sans-serif;padding:24px}}
.lk form{{width:min(380px,100%);background:#161414;border:1px solid rgba(241,239,233,.12);border-radius:18px;padding:28px;display:grid;gap:14px}}
.lk h1{{font:800 22px 'Cairo',sans-serif;margin:0}}.lk p{{margin:0;color:#9A978E;font-size:14.5px;line-height:1.7}}
.lk label{{display:grid;gap:6px;font-size:13.5px;color:#9A978E}}
.lk input{{font:inherit;font-size:16px;padding:12px 14px;border-radius:10px;border:1px solid rgba(241,239,233,.16);background:#0D0C0C;color:#F1EFE9;direction:ltr;text-align:left}}
.lk input:focus{{outline:2px solid #E5292F;outline-offset:1px}}
.lk button{{font:700 16px 'Cairo',sans-serif;padding:13px;border:0;border-radius:10px;background:#AC0C11;color:#fff;cursor:pointer}}
.lk button[disabled]{{opacity:.6;cursor:wait}}.lk .er{{color:#EDA83B;font-size:14px;min-height:20px}}
</style>
<div class="lk" id="lk"><form id="lk-f" autocomplete="off">
<h1>هذا العرض خاص</h1><p>أدخل اسم المستخدم وكلمة المرور اللذين وصلاك مع الرابط.</p>
<label>اسم المستخدم<input id="lk-u" name="username" autocapitalize="none" spellcheck="false" required /></label>
<label>كلمة المرور<input id="lk-p" name="password" type="password" required /></label>
<button id="lk-b">دخول</button><div class="er" id="lk-e" role="alert"></div>
</form></div>
<script>(function(){{
var P={payload},K="lk:{name}";
function b(s){{var r=atob(s),a=new Uint8Array(r.length);for(var i=0;i<r.length;i++)a[i]=r.charCodeAt(i);return a}}
async function open_(u,p){{
  var e=new TextEncoder(),base=await crypto.subtle.importKey("raw",e.encode(u.trim().toLowerCase()+":"+p),"PBKDF2",false,["deriveKey"]);
  var key=await crypto.subtle.deriveKey({{name:"PBKDF2",salt:b(P.salt),iterations:P.it,hash:"SHA-256"}},base,{{name:"AES-GCM",length:256}},false,["decrypt"]);
  var plain=await crypto.subtle.decrypt({{name:"AES-GCM",iv:b(P.iv)}},key,b(P.ct));
  var html=new TextDecoder().decode(plain);
  document.getElementById("lk").remove();
  document.body.appendChild(document.createRange().createContextualFragment(html));
  try{{sessionStorage.setItem(K,JSON.stringify([u,p]))}}catch(_){{}}
  if(location.hash){{var t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView()}}
}}
var f=document.getElementById("lk-f"),er=document.getElementById("lk-e"),bt=document.getElementById("lk-b");
f.addEventListener("submit",async function(ev){{ev.preventDefault();er.textContent="";bt.disabled=true;
  try{{await open_(document.getElementById("lk-u").value,document.getElementById("lk-p").value)}}
  catch(_){{bt.disabled=false;er.textContent="اسم المستخدم أو كلمة المرور غير صحيحة."}}}});
try{{var s=JSON.parse(sessionStorage.getItem(K)||"null");if(s)open_(s[0],s[1]).catch(function(){{sessionStorage.removeItem(K)}})}}catch(_){{}}
}})();</script>"""


def locked_names():
    f = os.path.join("projects", ".locked")
    if not os.path.exists(f):
        return set()
    return {l.strip() for l in open(f, encoding="utf-8") if l.strip() and not l.startswith("#")}


def lock_creds():
    f = os.path.join("projects", ".locks.json")
    return json.load(open(f, encoding="utf-8")) if os.path.exists(f) else {}


def encrypt_body(name, body, user, password):
    import base64, hashlib
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    secret = (user.strip().lower() + ":" + password).encode()
    plain = body.encode()
    # Salt and nonce are derived, not random, so an unchanged page builds to the
    # same bytes. The nonce depends on the plaintext, so it never repeats for
    # different content under the same key.
    salt = hashlib.sha256(b"salt|" + name.encode() + b"|" + secret).digest()[:16]
    key = hashlib.pbkdf2_hmac("sha256", secret, salt, LOCK_ITER, 32)
    iv = hashlib.sha256(b"iv|" + key + plain).digest()[:12]
    ct = AESGCM(key).encrypt(iv, plain, None)
    e = lambda b: base64.b64encode(b).decode()
    return json.dumps({"it": LOCK_ITER, "salt": e(salt), "iv": e(iv), "ct": e(ct)})


def copy_assets(name):
    """projects/assets/<name>/ ships alongside the page as dist/projects/<name>/assets/."""
    src = os.path.join("projects", "assets", name)
    if not os.path.isdir(src):
        return 0
    dst = os.path.join("dist", "projects", name, "assets")
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return len(os.listdir(dst))


def build(src):
    name = os.path.splitext(os.path.basename(src))[0]
    out_dir = os.path.join("dist", "projects", name)
    out = os.path.join(out_dir, "index.html")
    os.makedirs(out_dir, exist_ok=True)

    locked = name in LOCKED
    if locked and name not in CREDS:
        if not os.path.exists(out):
            sys.exit(f"{name} is locked but has never been published and projects/.locks.json has no credentials for it")
        print(f"kept  {out}  (locked, no credentials on this machine)")
        return

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
    body = body.strip()
    if locked:
        c = CREDS[name]
        body = GATE.format(name=name, payload=encrypt_body(name, body, c["user"], c["pass"]))
    open(out, "w", encoding="utf-8").write(head + body + "\n</body>\n</html>\n")
    n = copy_assets(name)
    print(f"built {out}  ({'LOCKED' if locked else 'noindex'})  /projects/{name}" + (f"  +{n} assets" if n else ""))


LOCKED, CREDS = locked_names(), lock_creds()
for s in sorted(glob.glob("projects/*.html")):
    build(s)

# Link-preview cards and og: tags for every page under dist/skill and dist/projects.
import subprocess
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "make-og.py"), "dist"], check=False)
