/* OurWork Pipeline Console — front end.
 *
 * Screens: Employment, Freelance, Workflow.
 *
 * The payload is genuinely encrypted, not merely hidden. A static host serves
 * whatever it is given, so a password that toggles a CSS class protects nothing
 * — view-source defeats it. data.enc.json is AES-256-GCM ciphertext with a
 * PBKDF2-SHA256 key, so the published file is inert without the passphrase.
 *
 * Actions are the other honest constraint. This page cannot write to the Mac
 * that owns data/applications.json, so a button that claimed to "mark applied"
 * would be lying. Instead every action is recorded locally, shown immediately,
 * and turned into the exact mark.mjs commands to paste back. Triage on the
 * phone, sync in one paste.
 */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const gate = $('#gate'), app = $('#app'), errEl = $('#err');
  const K_PASS = 'ourwork.pass', K_ACTS = 'ourwork.actions', K_THEME = 'ourwork.theme';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------- theme: system / light / dark ----------
  function applyTheme(mode) {
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    store.set(K_THEME, mode);
  }
  applyTheme(store.get(K_THEME, 'system'));

  // ---------- crypto ----------
  async function decrypt(p, pass) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(p.salt), iterations: p.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    // A wrong passphrase fails the GCM tag check and throws. That IS the check.
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(p.iv) }, key, b64(p.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- model ----------
  const STAGES = {
    drafted: { label: 'Built', tone: 'crit' }, queued: { label: 'Queued', tone: 'crit' },
    applied: { label: 'Applied', tone: 'live' }, replied: { label: 'Replied', tone: 'good' },
    in_discussion: { label: 'In talks', tone: 'good' }, won: { label: 'Won', tone: 'good' },
    lost: { label: 'Rejected', tone: 'muted' }, no_reply: { label: 'No reply', tone: 'muted' },
    skipped: { label: 'Skipped', tone: 'muted' },
  };
  const stage = s => STAGES[s] || { label: s, tone: 'muted' };
  const LIVE = ['applied', 'replied', 'in_discussion'];
  const OPEN = ['drafted', 'queued'];
  const CLOSED = ['lost', 'no_reply', 'skipped'];
  const UNKNOWN_ROLE = '(role not stated in the receipt)';

  const days = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : null;
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const plusDays = n => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let DATA = null;
  let ACTIONS = store.get(K_ACTS, {});         // key → {kind, at, note, snoozeUntil}

  /** Payload row merged with anything done locally since the last sync. */
  function view(a) {
    const act = ACTIONS[a.key];
    if (!act) return a;
    if (act.kind === 'applied') return { ...a, status: 'applied', appliedAt: act.at, _local: act };
    if (act.kind === 'ignore') return { ...a, status: 'skipped', _local: act };
    if (act.kind === 'snooze') return { ...a, nextFollowUp: act.snoozeUntil, _local: act };
    return a;
  }
  const rows = () => DATA.applications.map(view);

  const isOverdue = a => a.nextFollowUp && a.nextFollowUp <= todayISO() && LIVE.includes(a.status);

  /**
   * A row must always be openable. Email-derived rows carry no URL — LinkedIn's
   * receipt names the company and nothing else — so fall back to a search that
   * lands on the right place rather than rendering a dead button.
   */
  function linkFor(a) {
    if (a.url) return { href: a.url, label: 'Open posting' };
    const q = encodeURIComponent([a.company, a.title === UNKNOWN_ROLE ? '' : a.title].filter(Boolean).join(' '));
    if (a.via === 'LinkedIn' || a.source === 'linkedin')
      return { href: `https://www.linkedin.com/jobs/search/?keywords=${q}`, label: 'Find on LinkedIn' };
    return { href: `https://www.google.com/search?q=${q}+careers`, label: 'Search' };
  }

  // ---------- actions ----------
  function act(key, kind, extra = {}) {
    if (ACTIONS[key] && ACTIONS[key].kind === kind && kind !== 'snooze') delete ACTIONS[key];
    else ACTIONS[key] = { kind, at: todayISO(), ...extra };
    store.set(K_ACTS, ACTIONS);
    paint();
  }

  /** The exact commands that reconcile this device's triage with the engine. */
  function syncCommands() {
    return Object.entries(ACTIONS).map(([key, a]) => {
      if (a.kind === 'applied') return `node engine/mark.mjs applied ${key}`;
      if (a.kind === 'ignore') return `node engine/mark.mjs skip ${key} "ignored from the console"`;
      if (a.kind === 'snooze') return `# snoozed ${key} until ${a.snoozeUntil} — no command; re-runs pick it up`;
      return '';
    }).filter(Boolean);
  }

  // ---------- render ----------
  function rowHtml(a) {
    const st = stage(a.status);
    const overdue = isOverdue(a);
    const age = days(a.appliedAt || a.createdAt);
    const link = linkFor(a);
    const unknown = a.title === UNKNOWN_ROLE;
    const local = a._local;
    const isApplied = local?.kind === 'applied';
    const isIgnored = local?.kind === 'ignore';

    return `<article class="row${overdue ? ' row--flag' : ''}" data-done="${!!isIgnored}">
      <span class="row__stripe tone-${st.tone}" aria-hidden="true"></span>
      <div class="row__main">
        <p class="row__co" dir="auto">${esc(a.company || a.source || '—')}</p>
        <h4 class="row__title${unknown ? ' row__title--unknown' : ''}" dir="auto">
          <a href="${esc(link.href)}" target="_blank" rel="noopener">${esc(a.title)}</a></h4>
        ${a.status === 'lost' && a.notes ? `<p class="row__note" dir="auto">${esc(a.notes.split('\n')[0]).slice(0, 130)}</p>` : ''}
        ${overdue ? `<p class="row__channel"><span class="chip">Follow up via</span>${esc(a.followUpChannel || 'email reply')}</p>` : ''}
        <div class="row__actions">
          <button class="btn-ghost" data-kind="open" data-href="${esc(link.href)}">${esc(link.label)} ↗</button>
          <button class="btn-ghost" data-kind="applied" data-key="${esc(a.key)}"
            aria-pressed="${isApplied}">${isApplied ? '✓ Marked applied' : 'Mark applied'}</button>
          <button class="btn-ghost" data-kind="ignore" data-key="${esc(a.key)}"
            aria-pressed="${isIgnored}">${isIgnored ? '✓ Ignored' : 'Ignore'}</button>
          ${LIVE.includes(a.status) ? `<button class="btn-ghost" data-kind="snooze" data-key="${esc(a.key)}">Snooze 3d</button>` : ''}
        </div>
      </div>
      <div class="row__meta">
        <span class="pill tone-${st.tone}">${esc(st.label)}</span>
        <span class="row__age">${age == null ? '—' : age + 'd'}</span>
        <span class="row__via">${esc(a.via || (a.score ? 'score ' + a.score : ''))}</span>
      </div>
    </article>`;
  }

  const group = (title, sub, list) => list.length ? `<section class="group">
      <header class="group__head"><h3>${esc(title)}</h3><p>${esc(sub)}</p>
        <span class="group__count">${list.length}</span></header>
      ${list.map(rowHtml).join('')}</section>` : '';

  const kpiBlock = items => `<div class="kpis">${items.map(k => `<div class="kpi" data-tone="${k.tone}">
      <p class="kpi__n">${k.n}</p><p class="kpi__l">${esc(k.label)}</p>
      ${k.sub ? `<p class="kpi__s">${esc(k.sub)}</p>` : ''}</div>`).join('')}</div>`;

  function pipeline(list) {
    const counts = Object.keys(STAGES).map(id => ({ id, ...STAGES[id], n: list.filter(r => r.status === id).length }))
      .filter(s => s.n);
    if (!counts.length) return '';
    return `<div class="pipe"><h2 class="sect">Pipeline</h2>
      <div class="pipe__bar">${counts.map(s => `<div class="pipe__seg tone-${s.tone}" style="flex:${s.n}" title="${esc(s.label)}: ${s.n}"></div>`).join('')}</div>
      <div class="pipe__key">${counts.map(s => `<span><i class="tone-${s.tone}"></i>${esc(s.label)} <b>${s.n}</b></span>`).join('')}</div></div>`;
  }

  function laneScreen(list, L) {
    const live = list.filter(a => LIVE.includes(a.status));
    const open = list.filter(a => OPEN.includes(a.status));
    const closed = list.filter(a => CLOSED.includes(a.status));
    const due = list.filter(isOverdue);
    const responded = list.filter(a => ['replied', 'in_discussion', 'won', 'lost'].includes(a.status));
    const out = list.filter(a => !OPEN.includes(a.status)).length;
    const recent = (a, b) => String(b.appliedAt || b.createdAt).localeCompare(String(a.appliedAt || a.createdAt));
    const action = [...due, ...open];

    return kpiBlock([
      { n: out, label: 'Applications out', tone: 'live' },
      { n: live.length, label: 'Awaiting reply', tone: 'accent' },
      { n: responded.length, label: 'Responded', sub: out ? Math.round(responded.length / out * 100) + '% response' : '', tone: 'good' },
      { n: open.length, label: 'Built, not sent', tone: open.length ? 'crit' : 'muted' },
      { n: due.length, label: 'Follow-ups overdue', tone: due.length ? 'warn' : 'muted' },
      { n: closed.length, label: 'Closed out', tone: 'muted' },
    ]) + pipeline(list)
    + `<section class="band${action.length ? '' : ' band--calm'}">
        <div class="band__head"><h2>Needs you now</h2><p>${action.length
          ? 'Overdue follow-ups and finished work that never went out.'
          : 'Nothing overdue and nothing sitting unsent.'}</p></div>
        ${action.length ? action.map(rowHtml).join('') : '<p class="empty">Clear.</p>'}</section>`
    + (list.length
        ? group(L.live, L.liveSub, live.sort(recent))
          + group(L.open, L.openSub, open.sort(recent))
          + group(L.closed, L.closedSub, closed.sort(recent))
        : '<p class="empty">Nothing tracked in this lane yet.</p>');
  }

  // ---------- workflow screen ----------
  function workflowScreen() {
    const t = store.get(K_THEME, 'system');
    const cfg = DATA.workflow || {};
    const toggle = (id, on, h4, p, cmd) => `<div class="setting">
      <div class="setting__txt"><h4>${esc(h4)}</h4><p>${esc(p)}</p>
        ${cmd ? `<code class="cmd">${esc(cmd)}</code>` : ''}</div>
      <button class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(h4)}"
        data-cfg="${esc(id)}"></button></div>`;

    return `<section class="group">
      <header class="group__head"><h3>Engine settings</h3>
        <p>These live in engine/config.json on the Mac. This page shows the state and the command to change it.</p></header>
      ${toggle('autoSend', cfg.autoSend, 'Send email applications automatically',
        cfg.autoSend ? 'On — email applications are sent unattended.'
                     : 'Off — email applications become Gmail drafts and wait for you.',
        `engine/config.json → "autoSend": ${!cfg.autoSend}`)}
      ${toggle('riyadhOnly', cfg.locationMode === 'riyadh', 'Riyadh on-site only',
        `Currently "${cfg.locationMode || 'both'}" — both Riyadh on-site and remote.`,
        `engine/config.json → jobFilters.locationMode: "${cfg.locationMode === 'riyadh' ? 'both' : 'riyadh'}"`)}
    </section>

    <section class="group">
      <header class="group__head"><h3>Sources</h3>
        <p>${(cfg.sources || []).filter(s => s.enabled).length} of ${(cfg.sources || []).length} enabled · ${cfg.postings || 0} postings last run</p></header>
      ${(cfg.sources || []).map(s => `<div class="setting">
        <div class="setting__txt"><h4>${esc(s.name)}</h4>
          <p>${esc(s.lane)} · ${s.enabled ? 'enabled' : 'disabled'}${s.note ? ' — ' + esc(s.note) : ''}</p></div>
        <button class="switch" role="switch" aria-checked="${!!s.enabled}" aria-label="${esc(s.name)}"
          data-src="${esc(s.name)}"></button></div>`).join('')}
    </section>

    <section class="group">
      <header class="group__head"><h3>Appearance</h3><p>Stored on this device.</p></header>
      <div class="setting"><div class="setting__txt"><h4>Theme</h4>
        <p>System follows your phone or laptop setting.</p></div>
        <div class="seg">${['system', 'light', 'dark'].map(m =>
          `<button data-theme-set="${m}" aria-pressed="${t === m}">${m}</button>`).join('')}</div></div>
    </section>

    <h2 class="sect" style="margin-top:30px">Waiting on something</h2>
    <div class="blocks">${DATA.blockers.map(b => `<div class="block" data-sev="${esc(b.sev)}">
      <h4>${esc(b.title)}</h4><p>${esc(b.detail)}</p>
      ${b.action ? `<code class="cmd">${esc(b.action)}</code>` : ''}</div>`).join('')}</div>`;
  }

  const SCREENS = {
    employment: { label: 'Employment', of: () => rows().filter(a => (a.lane || 'job') === 'job'),
      render: l => laneScreen(l, { live: 'Awaiting a reply', liveSub: 'Applied, no response yet',
        open: 'Written, not sent', openSub: 'Finished applications waiting on you to press send',
        closed: 'Closed', closedSub: 'Rejected, timed out or ignored' }) },
    freelance: { label: 'Freelance', of: () => rows().filter(a => a.lane === 'freelance'),
      render: l => laneScreen(l, { live: 'Bids submitted', liveSub: 'Waiting on the client',
        open: 'Bids drafted, not submitted', openSub: 'Proposal written and priced — submit on the platform',
        closed: 'Closed', closedSub: 'Lost, expired or ignored' }) },
    workflow: { label: 'Workflow', of: () => [], render: () => workflowScreen() },
  };

  const screenId = () => {
    const id = (location.hash.replace(/^#\/?/, '') || 'employment').toLowerCase();
    return SCREENS[id] ? id : 'employment';
  };

  function paint() {
    const id = screenId();
    const pending = syncCommands();

    app.innerHTML = `
      <header class="mast">
        <h1>Pipeline Console <span>· ${esc(DATA.meta.owner)}</span></h1>
        <div class="mast__side">
          <span class="mast__meta">Built ${esc(DATA.meta.generatedAt)}</span>
          <div class="seg">${['system', 'light', 'dark'].map(m =>
            `<button data-theme-set="${m}" aria-pressed="${store.get(K_THEME, 'system') === m}">${m}</button>`).join('')}</div>
          <button class="btn-ghost" id="lock">Lock</button>
        </div>
      </header>
      <nav class="tabs">${Object.entries(SCREENS).map(([k, s]) => {
        const n = k === 'workflow' ? null : s.of().length;
        return `<button class="tab" data-go="${k}"${k === id ? ' aria-current="page"' : ''}>${esc(s.label)}${n == null ? '' : ` <b>${n}</b>`}</button>`;
      }).join('')}</nav>
      ${SCREENS[id].render(SCREENS[id].of())}
      <footer>
        Rebuilt by <b>node engine/run.mjs</b> · this page decrypts in your browser and never phones home.<br>
        Actions taken here are stored on this device — paste the sync commands on the Mac to make them real.
      </footer>
      ${pending.length ? `<div class="sync"><div class="sync__in">
        <span class="sync__n">${pending.length} change${pending.length === 1 ? '' : 's'} not synced</span>
        <span class="sync__hint">This page can't write to the Mac. Run these there to make them real.</span>
        <button class="btn-ghost" id="copyCmds">Copy commands</button>
        <button class="btn-ghost" id="clearActs">Discard</button>
      </div><pre class="sync__cmds" id="cmds">${esc(pending.join('\n'))}</pre></div>` : ''}`;

    wire();
    document.title = `${SCREENS[id].label} · Pipeline Console`;
  }

  function wire() {
    app.querySelectorAll('[data-go]').forEach(b =>
      b.addEventListener('click', () => { location.hash = '#/' + b.dataset.go; }));
    app.querySelectorAll('[data-theme-set]').forEach(b =>
      b.addEventListener('click', () => { applyTheme(b.dataset.themeSet); paint(); }));
    app.querySelectorAll('[data-kind=open]').forEach(b =>
      b.addEventListener('click', () => window.open(b.dataset.href, '_blank', 'noopener')));
    app.querySelectorAll('[data-kind=applied]').forEach(b =>
      b.addEventListener('click', () => act(b.dataset.key, 'applied')));
    app.querySelectorAll('[data-kind=ignore]').forEach(b =>
      b.addEventListener('click', () => act(b.dataset.key, 'ignore')));
    app.querySelectorAll('[data-kind=snooze]').forEach(b =>
      b.addEventListener('click', () => act(b.dataset.key, 'snooze', { snoozeUntil: plusDays(3) })));

    // Engine settings are read-only here by necessity: the page cannot edit a
    // file on the Mac, so the switch reveals the command rather than pretending.
    app.querySelectorAll('[data-cfg],[data-src]').forEach(b =>
      b.addEventListener('click', () => {
        const cmd = b.closest('.setting').querySelector('.cmd');
        if (cmd) { cmd.scrollIntoView({ block: 'nearest' }); cmd.style.outline = '2px solid var(--accent)';
          setTimeout(() => { cmd.style.outline = ''; }, 1200); }
        else alert('Toggle sources in engine/config.json → sources.' + (b.dataset.src || '') + '.enabled');
      }));

    const copy = $('#copyCmds');
    if (copy) copy.addEventListener('click', async () => {
      const text = syncCommands().join('\n');
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { const r = document.createRange(); r.selectNode($('#cmds')); getSelection().removeAllRanges();
              getSelection().addRange(r); copy.textContent = 'Selected — press ⌘C'; }
      setTimeout(() => { copy.textContent = 'Copy commands'; }, 2000);
    });
    const clear = $('#clearActs');
    if (clear) clear.addEventListener('click', () => {
      if (confirm('Discard local changes that have not been synced?')) { ACTIONS = {}; store.set(K_ACTS, ACTIONS); paint(); }
    });
    const lock = $('#lock');
    if (lock) lock.addEventListener('click', () => { sessionStorage.removeItem(K_PASS); location.reload(); });
  }

  window.addEventListener('hashchange', () => { if (DATA) paint(); });

  // ---------- boot ----------
  async function unlock(pass) {
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`data.enc.json is missing (HTTP ${res.status}) — run: node engine/publish-web.mjs`);
    DATA = await decrypt(await res.json(), pass);
    try { sessionStorage.setItem(K_PASS, pass); } catch { /* private mode */ }
    gate.hidden = true; app.hidden = false;
    paint();
  }

  $('#gateForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#unlock');
    errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Unlocking…';
    try { await unlock($('#pass').value); }
    catch (err) {
      // "Wrong passphrase" and "file missing" have completely different fixes.
      errEl.textContent = /missing|HTTP/.test(err.message) ? err.message
        : 'That passphrase does not decrypt this file.';
      $('#pass').select();
    } finally { btn.disabled = false; btn.textContent = 'Unlock'; }
  });

  (async () => {
    let saved = null;
    try { saved = sessionStorage.getItem(K_PASS); } catch { /* ignore */ }
    if (!saved) return;
    try { await unlock(saved); } catch { try { sessionStorage.removeItem(K_PASS); } catch { /* ignore */ } }
  })();
})();
