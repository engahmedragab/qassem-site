/* OurWork Pipeline Console — front end.
 *
 * Two screens, Employment and Freelance, over one encrypted payload.
 *
 * The payload is genuinely encrypted, not merely hidden: a static host serves
 * whatever it is given, so a password that only toggles a CSS class protects
 * nothing at all — view-source defeats it. data.enc.json is AES-256-GCM
 * ciphertext with a PBKDF2-SHA256 key, so the file is inert without the
 * passphrase, and hosting it publicly is safe.
 */
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const gate = $('#gate'), app = $('#app'), errEl = $('#err');
  const SESSION_KEY = 'ourwork.pass';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  // ---------- crypto ----------
  async function decrypt(payload, passphrase) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(payload.salt), iterations: payload.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    // A wrong passphrase fails the GCM tag check and throws — that IS the check.
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(payload.iv) }, key, b64(payload.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- model ----------
  const STAGES = {
    drafted:       { label: 'Built',    tone: 'crit'  },
    queued:        { label: 'Queued',   tone: 'crit'  },
    applied:       { label: 'Applied',  tone: 'live'  },
    replied:       { label: 'Replied',  tone: 'good'  },
    in_discussion: { label: 'In talks', tone: 'good'  },
    won:           { label: 'Won',      tone: 'good'  },
    lost:          { label: 'Rejected', tone: 'muted' },
    no_reply:      { label: 'No reply', tone: 'muted' },
    skipped:       { label: 'Skipped',  tone: 'muted' },
  };
  const stage = s => STAGES[s] || { label: s, tone: 'muted' };
  const LIVE = ['applied', 'replied', 'in_discussion'];
  const OPEN = ['drafted', 'queued'];
  const CLOSED = ['lost', 'no_reply', 'skipped'];

  const days = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : null;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const isOverdue = a => a.nextFollowUp && a.nextFollowUp <= todayISO() && LIVE.includes(a.status);

  const UNKNOWN_ROLE = '(role not stated in the receipt)';

  // ---------- render helpers ----------
  function row(a) {
    const st = stage(a.status);
    const overdue = isOverdue(a);
    const age = days(a.appliedAt || a.createdAt);
    const href = a.applyUrl || a.url || '';
    const unknown = a.title === UNKNOWN_ROLE;
    const titleHtml = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(a.title)}</a>`
      : esc(a.title);

    return `<article class="row${overdue ? ' row--flag' : ''}">
      <span class="row__stripe tone-${st.tone}" aria-hidden="true"></span>
      <div class="row__main">
        <p class="row__co" dir="auto">${esc(a.company || a.source || '—')}</p>
        <h4 class="row__title${unknown ? ' row__title--unknown' : ''}" dir="auto">${titleHtml}</h4>
        ${a.status === 'lost' && a.notes ? `<p class="row__note" dir="auto">${esc(a.notes.split('\n')[0]).slice(0, 130)}</p>` : ''}
        ${overdue ? `<p class="row__channel"><span class="chip">Follow up via</span>${esc(a.followUpChannel || 'email reply')}</p>` : ''}
      </div>
      <div class="row__meta">
        <span class="pill tone-${st.tone}">${esc(st.label)}</span>
        <span class="row__age">${age == null ? '—' : age + 'd'}</span>
        <span class="row__via">${esc(a.via || (a.score ? 'score ' + a.score : ''))}</span>
      </div>
    </article>`;
  }

  function group(title, sub, rows) {
    if (!rows.length) return '';
    return `<section class="group">
      <header class="group__head">
        <h3>${esc(title)}</h3><p>${esc(sub)}</p>
        <span class="group__count">${rows.length}</span>
      </header>
      ${rows.map(row).join('')}
    </section>`;
  }

  function kpiBlock(items) {
    return `<div class="kpis">${items.map(k => `<div class="kpi" data-tone="${k.tone}">
      <p class="kpi__n">${k.n}</p><p class="kpi__l">${esc(k.label)}</p>
      ${k.sub ? `<p class="kpi__s">${esc(k.sub)}</p>` : ''}
    </div>`).join('')}</div>`;
  }

  function pipeline(rows) {
    const counts = Object.keys(STAGES)
      .map(id => ({ id, ...STAGES[id], n: rows.filter(r => r.status === id).length }))
      .filter(s => s.n);
    if (!counts.length) return '';
    const swatch = { live: 'var(--live)', good: 'var(--accent)', crit: 'var(--bad)', muted: '#38363A' };
    return `<div class="pipe">
      <h2 class="sect">Pipeline</h2>
      <div class="pipe__bar">${counts.map(s =>
        `<div class="pipe__seg tone-${s.tone}" style="flex:${s.n}" title="${esc(s.label)}: ${s.n}"></div>`).join('')}</div>
      <div class="pipe__key">${counts.map(s =>
        `<span><i style="background:${swatch[s.tone]}"></i>${esc(s.label)} <b>${s.n}</b></span>`).join('')}</div>
    </div>`;
  }

  // ---------- screens ----------
  const SCREENS = {
    employment: {
      label: 'Employment',
      of: d => d.applications.filter(a => (a.lane || 'job') === 'job'),
      render: rows => screenBody(rows, {
        liveTitle: 'Awaiting a reply',
        liveSub: 'Applied, no response yet',
        openTitle: 'Written, not sent',
        openSub: 'Finished applications waiting on you to press send',
        closedTitle: 'Closed',
        closedSub: 'Rejected, timed out or skipped',
      }),
    },
    freelance: {
      label: 'Freelance',
      of: d => d.applications.filter(a => a.lane === 'freelance'),
      render: rows => screenBody(rows, {
        liveTitle: 'Bids submitted',
        liveSub: 'Waiting on the client',
        openTitle: 'Bids drafted, not submitted',
        openSub: 'Proposal written and priced — submit on the platform',
        closedTitle: 'Closed',
        closedSub: 'Lost, expired or deliberately skipped',
      }),
    },
  };

  function screenBody(rows, L) {
    const live = rows.filter(a => LIVE.includes(a.status));
    const open = rows.filter(a => OPEN.includes(a.status));
    const closed = rows.filter(a => CLOSED.includes(a.status));
    const due = rows.filter(isOverdue);
    const responded = rows.filter(a => ['replied', 'in_discussion', 'won', 'lost'].includes(a.status));
    const out = rows.filter(a => !OPEN.includes(a.status)).length;

    const byRecency = (a, b) =>
      String(b.appliedAt || b.createdAt).localeCompare(String(a.appliedAt || a.createdAt));

    const action = [...due, ...open];

    return kpiBlock([
      { n: out, label: 'Applications out', tone: 'live' },
      { n: live.length, label: 'Awaiting reply', tone: 'accent' },
      { n: responded.length, label: 'Responded', sub: out ? Math.round(responded.length / out * 100) + '% response' : '', tone: 'good' },
      { n: open.length, label: 'Built, not sent', tone: open.length ? 'crit' : 'muted' },
      { n: due.length, label: 'Follow-ups overdue', tone: due.length ? 'warn' : 'muted' },
      { n: closed.length, label: 'Closed out', tone: 'muted' },
    ])
    + pipeline(rows)
    + `<section class="band${action.length ? '' : ' band--calm'}">
        <div class="band__head"><h2>Needs you now</h2><p>${action.length
          ? 'Overdue follow-ups and finished work that never went out. Everything else can wait.'
          : 'Nothing overdue and nothing sitting unsent.'}</p></div>
        ${action.length ? action.map(row).join('') : '<p class="empty">Clear.</p>'}
      </section>`
    + (rows.length
        ? group(L.liveTitle, L.liveSub, live.sort(byRecency))
          + group(L.openTitle, L.openSub, open.sort(byRecency))
          + group(L.closedTitle, L.closedSub, closed.sort(byRecency))
        : '<p class="empty">Nothing tracked in this lane yet.</p>');
  }

  // ---------- shell ----------
  let DATA = null;

  function currentScreen() {
    const id = (location.hash.replace(/^#\/?/, '') || 'employment').toLowerCase();
    return SCREENS[id] ? id : 'employment';
  }

  function paint() {
    const id = currentScreen();
    const rows = SCREENS[id].of(DATA);

    app.innerHTML = `
      <header class="mast">
        <h1>Pipeline Console <span>· ${esc(DATA.meta.owner)}</span></h1>
        <p class="mast__meta">Built ${esc(DATA.meta.generatedAt)} · ${DATA.applications.length} tracked
          <button type="button" id="lock">Lock</button></p>
      </header>
      <nav class="tabs">${Object.entries(SCREENS).map(([key, s]) => {
        const n = s.of(DATA).length;
        return `<button class="tab" data-go="${key}"${key === id ? ' aria-current="page"' : ''}>${esc(s.label)} <b>${n}</b></button>`;
      }).join('')}</nav>
      ${SCREENS[id].render(rows)}
      <h2 class="sect" style="margin-top:34px">Waiting on something</h2>
      <div class="blocks">${DATA.blockers.map(b => `<div class="block" data-sev="${esc(b.sev)}">
        <h4>${esc(b.title)}</h4><p>${esc(b.detail)}</p>
        ${b.action ? `<code>${esc(b.action)}</code>` : ''}</div>`).join('')}</div>
      <footer>
        Rebuilt by <b>node engine/run.mjs</b> · statuses set with <b>node engine/mark.mjs</b><br>
        Applications reconciled from Gmail receipts — LinkedIn, Workable, Jobgether and SuccessFactors confirm by email.<br>
        Private. Encrypted at rest; decrypted only in this browser.
      </footer>`;

    app.querySelectorAll('[data-go]').forEach(b =>
      b.addEventListener('click', () => { location.hash = '#/' + b.dataset.go; }));
    $('#lock').addEventListener('click', () => {
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    });
    document.title = `${SCREENS[id].label} · Pipeline Console`;
  }

  function open(data) {
    DATA = data;
    gate.hidden = true;
    app.hidden = false;
    paint();
  }

  window.addEventListener('hashchange', () => { if (DATA) paint(); });

  // ---------- boot ----------
  async function unlock(passphrase, { quiet = false } = {}) {
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`data.enc.json is missing (HTTP ${res.status}) — run: node engine/publish-web.mjs`);
    const data = await decrypt(await res.json(), passphrase);
    try { sessionStorage.setItem(SESSION_KEY, passphrase); } catch { /* private mode */ }
    open(data);
  }

  $('#gateForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#unlock'), pass = $('#pass').value;
    errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      await unlock(pass);
    } catch (err) {
      // Distinguish "wrong passphrase" from "the file is not there", because the
      // fixes are completely different.
      errEl.textContent = /missing|HTTP/.test(err.message)
        ? err.message
        : 'That passphrase does not decrypt this file.';
      $('#pass').select();
    } finally {
      btn.disabled = false; btn.textContent = 'Unlock';
    }
  });

  // Re-open silently within a session so a refresh does not ask again.
  (async () => {
    let saved = null;
    try { saved = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
    if (!saved) return;
    try { await unlock(saved, { quiet: true }); }
    catch { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
  })();
})();
