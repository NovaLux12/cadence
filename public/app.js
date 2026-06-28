// Cadence — frontend SPA
// Vanilla JS, no framework. ~400 lines, mobile-first.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const state = {
  activeTab: 'dashboard',
  subscriptions: [],
  reminders: [],
  watchlist: [],
  vehicleEntries: [],
  vehicleSummary: null,
  vehicleInsights: null,
  vehicleLimit: 30,
  vehicleFilters: { type: '', q: '', showIgnored: false },
  vehicleSelectMode: false,
  vehicleSelectedIds: new Set(),
  authToken: localStorage.getItem('cadence.auth') || '',
  modal: null,
};

// =========================================================
// API client
// =========================================================

async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (state.authToken) headers['authorization'] = `Bearer ${state.authToken}`;
  const r = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t}`);
  }
  return r.status === 204 ? null : r.json();
}

function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// =========================================================
// Formatting helpers
// =========================================================

function fmtGBP(pence) {
  if (pence == null) return '';
  return '£' + (pence / 100).toFixed(2);
}

/**
 * pence → pounds string for input pre-fill (e.g. 899 → "8.99").
 */
function penceToPoundsInput(pence) {
  if (pence == null) return '';
  return (pence / 100).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '';
  // Parse YYYY-MM-DD as a *local* date (no UTC shift).
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Days between *today* (in the user's local timezone) and the given ISO date.
 * Uses date-only arithmetic to avoid UTC-shift off-by-one.
 * Returns positive integer if target is in the future, 0 if today, negative if past.
 */
function daysFromNow(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const targetUtc = Date.UTC(y, m - 1, d);
  // Start of today in user's local timezone, expressed as UTC midnight.
  const now = new Date();
  const localY = now.getFullYear();
  const localM = now.getMonth();
  const localD = now.getDate();
  const todayUtc = Date.UTC(localY, localM, localD);
  return Math.round((targetUtc - todayUtc) / 86400000);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dueLabel(days) {
  if (days == null) return '';
  if (days < 0) return `Overdue by ${-days}d`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 30) return `In ${Math.round(days / 7)}w`;
  return `In ${Math.round(days / 30)}mo`;
}

function urgencyClass(days) {
  if (days == null) return 'upcoming';
  if (days <= 3) return 'overdue';
  if (days <= 14) return 'soon';
  return 'upcoming';
}

// =========================================================
// Tabs
// =========================================================

function setTab(name) {
  state.activeTab = name;
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  // Lazy load per tab
  if (name === 'subscriptions') loadSubscriptions();
  if (name === 'reminders') loadReminders();
  if (name === 'watchlist') loadWatchlist();
  if (name === 'vehicle') loadVehicle();
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) setTab(tab.dataset.tab);
});

// =========================================================
// Dashboard
// =========================================================

async function loadDashboard() {
  const { rows } = await api('GET', '/api/dashboard?days=60');
  const list = $('#dashboard-list');
  const empty = $('#dashboard-empty');
  // Override server-computed days_until with local-TZ computation, so the
  // grouping and urgency pills match the user's wall-clock. Server's UTC
  // `date('now')` lags ~1h behind London midnight, which made "due
  // today" items appear as "due tomorrow" right after midnight BST.
  for (const r of rows) {
    if (r.due_date) r.days_until = daysFromNow(r.due_date);
  }
  $('#due-count').textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
  list.innerHTML = '';
  if (rows.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  // Group by urgency bucket. Today first, then this week, this month, later.
  const today = rows.filter((r) => r.days_until != null && r.days_until <= 0);
  const thisWeek = rows.filter((r) => r.days_until != null && r.days_until >= 1 && r.days_until <= 7);
  const thisMonth = rows.filter((r) => r.days_until != null && r.days_until >= 8 && r.days_until <= 30);
  const later = rows.filter((r) => r.days_until != null && r.days_until >= 31);
  // Items without a due_date go at the end.
  const unscheduled = rows.filter((r) => r.days_until == null);

  let frag = document.createDocumentFragment();
  if (today.length) {
    frag.appendChild(sectionHeader('🔥 Today', today.length, 'today'));
    for (const r of today) frag.appendChild(renderDashboardRow(r, { inlineDone: true }));
  }
  if (thisWeek.length) {
    frag.appendChild(sectionHeader('📅 This Week', thisWeek.length, 'this-week'));
    for (const r of thisWeek) frag.appendChild(renderDashboardRow(r));
  }
  if (thisMonth.length) {
    frag.appendChild(sectionHeader('📆 This Month', thisMonth.length, 'this-month'));
    for (const r of thisMonth) frag.appendChild(renderDashboardRow(r));
  }
  if (later.length) {
    frag.appendChild(sectionHeader('🗓 Later', later.length, 'later'));
    for (const r of later) frag.appendChild(renderDashboardRow(r));
  }
  if (unscheduled.length) {
    frag.appendChild(sectionHeader('📌 No date', unscheduled.length, 'unscheduled'));
    for (const r of unscheduled) frag.appendChild(renderDashboardRow(r));
  }
  list.appendChild(frag);
}

function sectionHeader(label, count, cls) {
  const h = document.createElement('div');
  h.className = `section-header section-${cls}`;
  h.innerHTML = `<span class="section-label">${escapeHtml(label)}</span><span class="section-count">${count}</span>`;
  return h;
}

function renderDashboardRow(r, opts = {}) {
  const card = document.createElement('div');
  card.className = `card ${urgencyClass(r.days_until)}`;
  const u = r.days_until != null ? dueLabel(r.days_until) : '';
  const urgent = r.days_until != null && r.days_until <= 3;

  // Build compact meta line: "28 Jun 2026 · Tomorrow · £10.99 / monthly · Gaming"
  const metaBits = [];
  if (r.due_date) metaBits.push(`<span class="meta-value">${fmtDate(r.due_date)}</span><span class="sep">·</span><span class="${urgent ? 'meta-value urgent' : 'meta-value'}">${u}</span>`);
  if (r.cost_pence != null) metaBits.push(`<span class="meta-cost">${fmtGBP(r.cost_pence)}${r.billing_cycle ? ' / ' + r.billing_cycle : ''}</span>`);
  if (r.category) metaBits.push(`<span>${escapeHtml(r.category)}</span>`);
  if (r.next_action_label) metaBits.push(`<span class="meta-value">${escapeHtml(r.next_action_label)}</span>`);

  // Inline quick-action for reminder items (one-tap "✓ Mark done" in TODAY).
  let quickAction = '';
  if (opts.inlineDone && r.kind === 'reminder') {
    quickAction = `<button class="btn btn-small btn-primary quick-done" data-kind="reminder" data-id="${r.id}" title="Mark done — advances next due by cadence">✓ Done</button>`;
  }

  card.innerHTML = `
    <div class="card-row1">
      ${vendorAvatar(r)}
      <div class="card-title">${escapeHtml(r.title)}</div>
      ${r.days_until != null ? `<div class="urgency-pill ${urgencyClass(r.days_until)}">${u}</div>` : ''}
    </div>
    ${metaBits.length ? `<div class="card-row2">${metaBits.join('<span class="sep">·</span>')}</div>` : ''}
    ${r.notes ? `<div class="card-notes">${escapeHtml(r.notes)}</div>` : ''}
    ${quickAction ? `<div class="card-row3">${quickAction}</div>` : ''}
  `;
  // Tap card to edit (but not buttons)
  card.addEventListener('click', async (ev) => {
    if (ev.target.closest('button')) return;
    const item = await fetchItem(r.kind, r.id);
    if (item) openModal(r.kind, item);
  });
  return card;
}

function vendorAvatar(r) {
  // First-letter avatar: pull from vendor or fall back to title.
  const seed = (r._vendor || '') || r.title || r.kind;
  const ch = (seed.trim()[0] || '?').toUpperCase();
  const cls = r.entry_type || r.kind;
  return `<span class="vendor-avatar ${cls}">${escapeHtml(ch)}</span>`;
}

async function fetchItem(kind, id) {
  if (kind === 'subscription') return (await api('GET', `/api/subscriptions/${id}`));
  if (kind === 'reminder')     return (await api('GET', `/api/reminders/${id}`));
  if (kind === 'watchlist')    return (await api('GET', `/api/watchlist/${id}`));
  return null;
}

// =========================================================
// Subscriptions
// =========================================================

async function loadSubscriptions() {
  const { items } = await api('GET', '/api/subscriptions');
  state.subscriptions = items;
  renderSubscriptions();
}

function renderSubscriptions() {
  const list = $('#subscription-list');
  const empty = $('#subscription-empty');
  list.innerHTML = '';
  if (state.subscriptions.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const s of state.subscriptions) {
    const card = document.createElement('div');
    card.className = 'card';
    const days = s.next_due_date ? daysFromNow(s.next_due_date) : null;
    card.classList.add(urgencyClass(days));
    const metaBits = [];
    if (s.vendor) metaBits.push(`<span>${escapeHtml(s.vendor)}</span>`);
    if (s.cost_pence != null) metaBits.push(`<span class="meta-cost">${fmtGBP(s.cost_pence)}${s.currency ? ' ' + s.currency : ''}</span>`);
    if (s.next_due_date) metaBits.push(`<span class="meta-value">${fmtDate(s.next_due_date)}</span><span class="sep">·</span><span class="meta-value">${dueLabel(days)}</span>`);
    if (s.status !== 'active') metaBits.push(`<span class="kind-chip subscription">${s.status}</span>`);
    if (!s.auto_renew) metaBits.push(`<span>manual</span>`);
    card.innerHTML = `
      <div class="card-row1">
        ${vendorAvatar({ ...s, kind: 'subscription', title: s.name })}
        <div class="card-title">${escapeHtml(s.name)}</div>
        ${s.next_due_date ? `<div class="urgency-pill ${urgencyClass(days)}">${dueLabel(days)}</div>` : ''}
      </div>
      ${metaBits.length ? `<div class="card-row2">${metaBits.join('<span class="sep">·</span>')}</div>` : ''}
      ${s.notes ? `<div class="card-notes">${escapeHtml(s.notes)}</div>` : ''}
    `;
    // Tap card to edit
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      openModal('subscription', s);
    });
    list.appendChild(card);
  }
}

// =========================================================
// Reminders
// =========================================================

async function loadReminders() {
  const { items } = await api('GET', '/api/reminders');
  state.reminders = items;
  renderReminders();
}

function renderReminders() {
  const list = $('#reminder-list');
  const empty = $('#reminder-empty');
  list.innerHTML = '';
  if (state.reminders.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const r of state.reminders) {
    const card = document.createElement('div');
    card.className = 'card';
    const days = r.next_due ? daysFromNow(r.next_due) : null;
    card.classList.add(urgencyClass(days));
    const metaBits = [];
    if (r.category) metaBits.push(`<span>${escapeHtml(r.category)}</span>`);
    if (r.cadence_value) metaBits.push(`<span>every ${r.cadence_value} ${r.cadence_unit}</span>`);
    if (r.next_due) metaBits.push(`<span class="meta-value">${fmtDate(r.next_due)}</span><span class="sep">·</span><span class="meta-value">${dueLabel(days)}</span>`);
    if (r.last_done) metaBits.push(`<span>last: ${fmtDate(r.last_done)}</span>`);
    const isOverdue = days != null && days < 0;
    card.innerHTML = `
      <div class="card-row1">
        ${vendorAvatar({ ...r, kind: 'reminder' })}
        <div class="card-title">${escapeHtml(r.title)}</div>
        ${r.next_due ? `<div class="urgency-pill ${urgencyClass(days)}">${dueLabel(days)}</div>` : ''}
      </div>
      ${metaBits.length ? `<div class="card-row2">${metaBits.join('<span class="sep">·</span>')}</div>` : ''}
      ${r.notes ? `<div class="card-notes">${escapeHtml(r.notes)}</div>` : ''}
      ${(isOverdue || days === 0 || (days != null && days <= 14)) ? `<div class="card-row3"><button class="btn btn-small btn-primary" data-action="done" data-id="${r.id}">✓ Mark done</button></div>` : ''}
    `;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      openModal('reminder', r);
    });
    list.appendChild(card);
  }
}

// Delegate Done buttons on reminder cards (used by both Subscriptions tab and Dashboard)
function bindDoneButtons(container, onDone) {
  container?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action="done"]');
    if (!btn) return;
    ev.stopPropagation();
    const id = btn.dataset.id;
    btn.disabled = true;
    try {
      await api('POST', `/api/reminders/${id}/done`, {});
      toast('Done · next due updated');
      onDone?.();
    } catch (e) {
      toast(`Error: ${e.message}`);
      btn.disabled = false;
    }
  });
}

bindDoneButtons($('#reminder-list'), () => {
  loadReminders();
  loadDashboard();
});
bindDoneButtons($('#dashboard-list'), () => {
  loadDashboard();
});

// =========================================================
// Watchlist
// =========================================================

async function loadWatchlist() {
  const { items } = await api('GET', '/api/watchlist');
  state.watchlist = items;
  renderWatchlist();
}

function renderWatchlist() {
  const list = $('#watchlist-list');
  const empty = $('#watchlist-empty');
  list.innerHTML = '';
  if (state.watchlist.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const w of state.watchlist) {
    const card = document.createElement('div');
    card.className = 'card';
    const days = w.next_action_date ? daysFromNow(w.next_action_date) : null;
    card.classList.add(urgencyClass(days));
    const metaBits = [];
    if (w.category) metaBits.push(`<span>${escapeHtml(w.category)}</span>`);
    if (w.parties) metaBits.push(`<span>${escapeHtml(w.parties)}</span>`);
    if (w.next_action_date) metaBits.push(`<span class="meta-value">${fmtDate(w.next_action_date)}</span><span class="sep">·</span><span class="meta-value">${w.next_action_label || dueLabel(days)}</span>`);
    if (w.status !== 'open' && w.status !== 'waiting') metaBits.push(`<span class="kind-chip watchlist">${w.status}</span>`);
    card.innerHTML = `
      <div class="card-row1">
        ${vendorAvatar({ ...w, kind: 'watchlist' })}
        <div class="card-title">${escapeHtml(w.title)}</div>
        ${w.next_action_date ? `<div class="urgency-pill ${urgencyClass(days)}">${w.next_action_label || dueLabel(days)}</div>` : `<div class="kind-chip watchlist">${w.status}</div>`}
      </div>
      ${metaBits.length ? `<div class="card-row2">${metaBits.join('<span class="sep">·</span>')}</div>` : ''}
      ${w.notes ? `<div class="card-notes">${escapeHtml(w.notes)}</div>` : ''}
    `;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      openModal('watchlist', w);
    });
    list.appendChild(card);
  }
}

// =========================================================
// Vehicle
async function loadVehicle() {
  // Build query string from current filters
  const qs = new URLSearchParams({ vehicle: 'mycar' });
  if (state.vehicleFilters.type) qs.set('type', state.vehicleFilters.type);
  if (state.vehicleFilters.q) qs.set('q', state.vehicleFilters.q);
  if (state.vehicleFilters.showIgnored) qs.set('includeIgnored', '1');
  qs.set('limit', String(state.vehicleLimit));
  const [entries, summary, insights, easee, live] = await Promise.all([
    api('GET', `/api/vehicle/entries?${qs.toString()}`),
    api('GET', '/api/vehicle/summary?vehicle=mycar'),
    api('GET', '/api/vehicle/insights?vehicle=mycar'),
    api('GET', '/api/easee/status'),
    api('GET', '/api/easee/live').catch(() => ({ charger: null, session: null, configured: false })),
  ]);
  state.vehicleEntries = entries.items;
  state.vehicleSummary = summary;
  state.vehicleInsights = insights;
  renderVehicleSummary(summary);
  renderVehicleInsights(insights);
  renderVehicleFilterChips();
  renderVehicleEntries();
  bindSparkChartHovers();
  renderEasee(easee, live);
}

/**
 * Refetch only the entries list (not summary / easee / live). Used when
 * the change (e.g. search query) doesn't affect any aggregate state.
 * Cheaper and avoids spurious UI re-renders on the summary tiles.
 */
async function reloadVehicleEntriesOnly() {
  const qs = new URLSearchParams({ vehicle: 'mycar' });
  if (state.vehicleFilters.type) qs.set('type', state.vehicleFilters.type);
  if (state.vehicleFilters.q) qs.set('q', state.vehicleFilters.q);
  if (state.vehicleFilters.showIgnored) qs.set('includeIgnored', '1');
  qs.set('limit', String(state.vehicleLimit));
  const r = await api('GET', `/api/vehicle/entries?${qs.toString()}`);
  state.vehicleEntries = r.items;
  renderVehicleEntries();
}

// Debounce helper — trailing-edge, single timer per key.
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function renderVehicleFilterChips() {
  const el = $('#vehicle-filter-chips');
  if (!el) return;
  const f = state.vehicleFilters;
  el.innerHTML = `
    <button class="filter-chip${!f.type && !f.showIgnored ? ' active' : ''}" data-filter="all" aria-pressed="${!f.type && !f.showIgnored}">All</button>
    <button class="filter-chip${f.type === 'fuel' ? ' active' : ''}" data-filter="fuel" aria-pressed="${f.type === 'fuel'}">⛽ Fuel</button>
    <button class="filter-chip${f.type === 'charge' ? ' active' : ''}" data-filter="charge" aria-pressed="${f.type === 'charge'}">⚡ Charge</button>
    <button class="filter-chip${f.showIgnored ? ' active' : ''}" data-filter="ignored" aria-pressed="${f.showIgnored}">Hidden</button>
    <button class="filter-chip select-toggle${state.vehicleSelectMode ? ' active' : ''}" data-filter="select" aria-pressed="${state.vehicleSelectMode}" aria-label="Toggle selection mode">${state.vehicleSelectMode ? '✓ Selecting' : 'Select'}</button>
  `;
  // Keep the search input value in sync if the filter was reset programmatically.
  const search = $('#vehicle-search');
  if (search && search.value !== f.q) search.value = f.q;
  // Also keep the X clear button visibility in sync.
  const clearBtn = $('#vehicle-search-clear');
  if (clearBtn) clearBtn.hidden = !f.q;
}

// Debounced search reload — 250ms after the last keystroke.
// Only the entries list changes when q changes (summary / easee / live
// don't depend on the query), so use the lighter refetch path.
const debouncedSearchReload = debounce(() => {
  state.vehicleLimit = 30;
  // Clear selection — selected ids may not be visible under the new filter.
  state.vehicleSelectedIds.clear();
  reloadVehicleEntriesOnly();
  renderBulkBar();
  renderVehicleFilterChips();
}, 250);

$('#vehicle-search')?.addEventListener('input', (ev) => {
  state.vehicleFilters.q = ev.target.value;
  // Toggle the X button visibility based on input length.
  const clearBtn = $('#vehicle-search-clear');
  if (clearBtn) clearBtn.hidden = !ev.target.value;
  debouncedSearchReload();
});

$('#vehicle-search-clear')?.addEventListener('click', () => {
  const input = $('#vehicle-search');
  if (!input) return;
  input.value = '';
  state.vehicleFilters.q = '';
  const clearBtn = $('#vehicle-search-clear');
  if (clearBtn) clearBtn.hidden = true;
  state.vehicleSelectedIds.clear();
  state.vehicleLimit = 30;
  reloadVehicleEntriesOnly();
  renderBulkBar();
  renderVehicleFilterChips();
  input.focus();
});

document.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.filter-chip');
  if (!chip) return;
  const f = state.vehicleFilters;
  const v = chip.dataset.filter;
  if (v === 'select') {
    state.vehicleSelectMode = !state.vehicleSelectMode;
    state.vehicleSelectedIds.clear();
    renderBulkBar();
    renderVehicleFilterChips();
    renderVehicleEntries();
    return;
  }
  // Any filter change invalidates the current selection — selected ids
  // may have dropped out of view, leaving the bulk bar pointing at
  // rows the user can no longer see.
  state.vehicleSelectedIds.clear();
  if (v === 'all') { f.type = ''; f.showIgnored = false; }
  else if (v === 'fuel' || v === 'charge') { f.type = v; }
  else if (v === 'ignored') { f.showIgnored = !f.showIgnored; }
  state.vehicleLimit = 30;
  loadVehicle();
});

function renderVehicleSummary(s) {
  const a = s.last_30d;
  const all = s.all_time;
  const el = $('#vehicle-summary');
  if (!s) {
    el.textContent = '—';
    return;
  }
  // Build HTML for summary tiles + sparkline + EV/petrol breakdown + last fill/charge
  el.innerHTML = `
    <div class="summary-tile highlight">
      <h4>30d £/mile</h4>
      <div class="v">${a.pence_per_mile != null ? (a.pence_per_mile / 100).toFixed(2) : '—'}</div>
      <div class="s">${a.total_miles != null ? a.total_miles + ' miles' : 'no odo'}</div>
    </div>
    <div class="summary-tile">
      <h4>30d spend</h4>
      <div class="v">${fmtGBP(a.total_pence)}</div>
      <div class="s">${fmtGBP(a.fuel_pence)} fuel · ${fmtGBP(a.charge_pence)} charge</div>
    </div>
    <div class="summary-tile">
      <h4>30d fuel</h4>
      <div class="v small">${a.fuel_litres.toFixed(1)} L</div>
      <div class="s">${a.fuel_mpg ? a.fuel_mpg.toFixed(1) + ' MPG' : '—'}</div>
    </div>
    <div class="summary-tile">
      <h4>30d charge</h4>
      <div class="v small">${a.charge_kwh.toFixed(1)} kWh</div>
      <div class="s">${fmtGBP(a.home_charge_pence)} home${a.charge_kwh > 0 ? ' · ' + (a.charge_pence / a.charge_kwh / 100).toFixed(0) + 'p/kWh' : ''}</div>
    </div>
    ${s.trend && s.trend.length >= 2 ? renderSparkChart(s.trend) : ''}
    ${all.total_miles > 0 ? `
      <div class="summary-tile" style="grid-column: span 2;">
        <h4>All-time miles split</h4>
        <div class="breakdown-bar">
          <div class="electric" style="width: ${(all.ev_pct * 100).toFixed(1)}%"></div>
          <div class="petrol" style="width: ${((1 - all.ev_pct) * 100).toFixed(1)}%"></div>
        </div>
        <div class="breakdown-labels">
          <span class="electric">⚡ ${Math.round(all.ev_miles)} mi (${(all.ev_pct * 100).toFixed(0)}%)</span>
          <span class="petrol">⛽ ${Math.round(all.petrol_miles)} mi (${((1 - all.ev_pct) * 100).toFixed(0)}%)</span>
        </div>
      </div>
    ` : ''}
  `;

  // Append last fill / charge summary if there's space
  if (s.last_fuel || s.last_charge) {
    const lastFillDiv = document.createElement('div');
    lastFillDiv.className = 'analytics-row';
    lastFillDiv.innerHTML = `
      ${s.last_fuel ? `
        <div class="analytics-tile">
          <div class="label">Last fill</div>
          <div class="v">${fmtGBP(s.last_fuel.cost_pence)}</div>
          <div class="label" style="margin-top:4px">${s.last_fuel.litres ? s.last_fuel.litres.toFixed(1) + ' L' : ''} · ${fmtDate(s.last_fuel.entry_date)}</div>
        </div>
      ` : ''}
      ${s.last_charge ? `
        <div class="analytics-tile">
          <div class="label">Last charge</div>
          <div class="v electric">${fmtGBP(s.last_charge.cost_pence)}</div>
          <div class="label" style="margin-top:4px">${s.last_charge.kwh ? s.last_charge.kwh.toFixed(1) + ' kWh' : ''} · ${fmtDate(s.last_charge.entry_date)}</div>
        </div>
      ` : ''}
      <div class="analytics-tile">
        <div class="label">90d £/mile</div>
        <div class="v">${s.last_90d.pence_per_mile != null ? (s.last_90d.pence_per_mile / 100).toFixed(2) : '—'}</div>
        <div class="label" style="margin-top:4px">${fmtGBP(s.last_90d.total_pence)}</div>
      </div>
    `;
    el.appendChild(lastFillDiv);
  }
}

function renderVehicleInsights(i) {
  const el = $('#vehicle-insights');
  if (!el) return;
  if (!i) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const fmtDays = (n) => n == null ? '—' : (n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`);
  const fmtMiles = (n) => n == null ? '—' : `${n.toLocaleString()} mi`;
  const fmtAvg = (n) => n == null ? '—' : `${n.toFixed(1)} mi/day`;
  const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
  el.innerHTML = `
    <div class="insights-row">
      <div class="insight-tile">
        <div class="insight-label">Last fill</div>
        <div class="insight-v">${fmtDays(i.days_since_last_fuel)}</div>
        <div class="insight-sub">${fmtMiles(i.miles_since_last_fuel)} since</div>
      </div>
      <div class="insight-tile">
        <div class="insight-label">Last charge</div>
        <div class="insight-v electric">${fmtDays(i.days_since_last_charge)}</div>
        <div class="insight-sub">${fmtMiles(i.miles_since_last_charge)} since</div>
      </div>
      <div class="insight-tile">
        <div class="insight-label">Daily avg (30d)</div>
        <div class="insight-v">${fmtAvg(i.avg_daily_miles_30d)}</div>
        <div class="insight-sub">est. from odo deltas</div>
      </div>
      <div class="insight-tile">
        <div class="insight-label">Next fill ~</div>
        <div class="insight-v">${fmtDate(i.projected_next_fuel_date)}</div>
        <div class="insight-sub">at 380 mi range</div>
      </div>
    </div>
  `;
}

function renderSparkChart(trend) {
  // trend is [{month, fuel_pence, charge_pence, total_pence, miles}, ...]
  const w = 320, h = 70, pad = 4;
  const maxY = Math.max(1, ...trend.map((d) => d.fuel_pence + d.charge_pence));
  const xStep = (w - pad * 2) / Math.max(1, trend.length - 1);
  const project = (val, i) => {
    const x = pad + i * xStep;
    const y = h - pad - (val / maxY) * (h - pad * 2);
    return { x, y };
  };
  // Build paths for fuel (accent) and electricity (green)
  const fuelPoints = trend.map((d, i) => project(d.fuel_pence, i));
  const elecPoints = trend.map((d, i) => project(d.charge_pence, i));
  const fuelPath = fuelPoints.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const elecPath = elecPoints.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const totalPence = trend.reduce((a, d) => a + d.fuel_pence + d.charge_pence, 0);
  const totalMiles = trend.reduce((a, d) => a + (d.miles ?? 0), 0);
  const ppm = totalMiles > 0 ? totalPence / totalMiles / 100 : null;
  // JSON-encode trend for the hover handler. Escape for HTML attribute (double-quote safe).
  const trendJson = JSON.stringify(trend).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `
    <div class="summary-tile" style="grid-column: span 2;">
      <h4>6-month spend · fuel vs electric</h4>
      <div class="spark-wrap" data-trend="${trendJson}">
        <svg class="spark-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <line class="spark-guide" x1="0" y1="0" x2="0" y2="${h}" />
          <path class="spark-line-elec" d="${elecPath}" />
          <path class="spark-line-fuel" d="${fuelPath}" />
          ${elecPoints.map((p) => `<circle class="spark-dot-elec" cx="${p.x}" cy="${p.y}" r="2.5"/>`).join('')}
          ${fuelPoints.map((p) => `<circle class="spark-dot-fuel" cx="${p.x}" cy="${p.y}" r="2.5"/>`).join('')}
          ${elecPoints.map((p) => `<circle class="spark-hover-dot spark-hover-dot-elec" cx="${p.x}" cy="${p.y}" r="4"/>`).join('')}
          ${fuelPoints.map((p) => `<circle class="spark-hover-dot spark-hover-dot-fuel" cx="${p.x}" cy="${p.y}" r="4"/>`).join('')}
          ${trend.map((_, i) => {
            // One full-height invisible hover target per month column.
            const rx = pad + i * xStep - xStep / 2;
            return `<rect class="spark-hit" data-i="${i}" x="${rx}" y="0" width="${xStep}" height="${h}"/>`;
          }).join('')}
        </svg>
        <div class="spark-tooltip" hidden></div>
      </div>
      <div class="spark-labels">
        <span>${trend[0]?.month ?? ''}</span>
        <span class="spark-legend"><span class="dot-fuel"></span>fuel <span class="dot-elec"></span>electric</span>
        <span>${trend[trend.length - 1]?.month ?? ''}</span>
      </div>
      <div class="s">total ${fmtGBP(totalPence)} · ${totalMiles ? totalMiles + ' mi · ' + (ppm).toFixed(2) + ' £/mi' : 'no odo'}</div>
    </div>
  `;
}

// Format "2026-01" as "Mar 2026".
function fmtMonth(yyyymm) {
  if (!yyyymm) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${month} ${m[1]}`;
}

// Wire up hover tooltips on the spark chart. Called once per renderVehicleSummary.
function bindSparkChartHovers() {
  document.querySelectorAll('.spark-wrap').forEach((wrap) => {
    if (wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    let trend;
    try { trend = JSON.parse(wrap.dataset.trend || '[]'); } catch { return; }
    const svg = wrap.querySelector('svg.spark-chart');
    const tooltip = wrap.querySelector('.spark-tooltip');
    const guide = svg.querySelector('.spark-guide');
    const hits = svg.querySelectorAll('.spark-hit');
    const hoverDots = svg.querySelectorAll('.spark-hover-dot');
    // SVG order: elec hover-dots first, then fuel hover-dots.
    const n = trend.length;
    const elecHover = Array.from(hoverDots).slice(0, n);
    const fuelHover = Array.from(hoverDots).slice(n);

    function show(i) {
      const d = trend[i];
      if (!d) return;
      const hit = hits[i];
      const x = parseFloat(hit.getAttribute('x')) + parseFloat(hit.getAttribute('width')) / 2;
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.classList.add('on');
      elecHover.forEach((c, idx) => c.classList.toggle('on', idx === i));
      fuelHover.forEach((c, idx) => c.classList.toggle('on', idx === i));
      const miles = d.miles ?? 0;
      const monthPpm = miles > 0 ? (d.total_pence / miles / 100) : null;
      tooltip.innerHTML = `
        <div class="t-month">${escapeHtml(fmtMonth(d.month))}</div>
        <div class="t-rows">
          <div class="t-row"><span class="t-dot dot-fuel"></span>Fuel <span class="t-val">${fmtGBP(d.fuel_pence)}</span></div>
          <div class="t-row"><span class="t-dot dot-elec"></span>Elec <span class="t-val">${fmtGBP(d.charge_pence)}</span></div>
        </div>
        <div class="t-foot">${fmtGBP(d.total_pence)}${miles ? ' · ' + miles + ' mi' : ''}${monthPpm != null ? ' · ' + monthPpm.toFixed(2) + ' £/mi' : ''}</div>
      `;
      tooltip.hidden = false;
      // Position tooltip. Convert viewBox x (320 wide) → pixel x in the wrap.
      const svgRect = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const px = svgRect.left - wrapRect.left + (x / 320) * svgRect.width;
      const tw = tooltip.offsetWidth || 140;
      const th = tooltip.offsetHeight || 60;
      let left = px - tw / 2;
      const margin = 4;
      left = Math.max(margin, Math.min(left, wrapRect.width - tw - margin));
      // Place above the chart; if not enough room inside the tile, place below.
      // The tooltip is allowed to overflow the tile bounds (position: absolute escapes flow).
      let top = svgRect.top - wrapRect.top - th - 6;
      if (top < 2) top = svgRect.bottom - wrapRect.top + 6;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
    function hide() {
      guide.classList.remove('on');
      elecHover.forEach((c) => c.classList.remove('on'));
      fuelHover.forEach((c) => c.classList.remove('on'));
      tooltip.hidden = true;
    }
    hits.forEach((hit) => {
      hit.addEventListener('mouseenter', () => show(Number(hit.dataset.i)));
    });
    wrap.addEventListener('mouseleave', hide);
    // Touch / a11y: clicking a column toggles its tooltip.
    hits.forEach((hit) => {
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const i = Number(hit.dataset.i);
        if (tooltip.hidden === false && wrap.dataset.lastI === String(i)) {
          hide();
        } else {
          wrap.dataset.lastI = String(i);
          show(i);
        }
      });
    });
  });
  // Tap outside dismisses any open tooltip.
  if (!document.body.dataset.sparkOutsideBound) {
    document.body.dataset.sparkOutsideBound = '1';
    document.addEventListener('click', () => {
      document.querySelectorAll('.spark-tooltip').forEach((t) => { if (!t.hidden) t.hidden = true; });
    });
  }
}

function renderEasee(status, live) {
  const el = $('#easee-status');
  const btn = $('#easee-sync');
  const banner = $('#live-charge-banner');
  if (!el || !btn) return;
  if (status?.configured) {
    el.textContent = 'connected';
    el.className = 'easee-status ok';
    btn.hidden = false;
  } else {
    el.textContent = 'not connected — add EASEE_USERNAME + EASEE_PASSWORD secrets';
    el.className = 'easee-status err';
    btn.hidden = true;
  }
  // Live charging banner
  if (banner) {
    if (live && live.session && live.session.sessionEnergy != null) {
      banner.hidden = false;
      const cost = live.session.costIncludingVat ?? live.session.costExcludingVat;
      const pencePerKwh = live.session.pricePrKwhIncludingVat ?? live.session.pricePerKwhExcludingVat;
      const duration = live.session.chargeDurationInSeconds;
      const durText = duration ? formatDuration(duration) : '';
      banner.innerHTML = `
        <div class="live-charge-pulse"></div>
        <div class="live-charge-body">
          <div class="live-charge-title">⚡ Charging now — ${escapeHtml(live.charger?.name ?? 'Easee')}</div>
          <div class="live-charge-sub">
            ${live.session.sessionEnergy.toFixed(2)} kWh delivered
            ${durText ? ' · ' + durText : ''}
            ${pencePerKwh != null ? ' · ' + (pencePerKwh * 100).toFixed(0) + 'p/kWh' : ''}
          </div>
        </div>
        <div class="live-charge-stat">
          ${cost != null ? '£' + cost.toFixed(2) : '£–'}
          <div style="font-size:10px;font-weight:400;opacity:0.7;text-align:right">running cost</div>
        </div>
      `;
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }
}

function formatDuration(s) {
  if (s == null) return '';
  // Always show in human-friendly units — never raw seconds under a minute.
  if (s < 60) return '<1 min';
  if (s < 3600) {
    const mins = Math.round(s / 60);
    return mins + ' min';
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (m === 0) return h + ' h';
  return h + 'h ' + m + 'm';
}

$('#easee-sync')?.addEventListener('click', async () => {
  const btn = $('#easee-sync');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    const r = await api('POST', '/api/easee/sync?vehicle=mycar');
    toast(`Easee: ${r.inserted} new, ${r.skipped} skipped`);
    loadVehicle();
  } catch (e) {
    toast(`Error: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync';
  }
});

$('#easee-backfill')?.addEventListener('click', async () => {
  if (!confirm('Backfill historical Easee sessions (last 6 months)?')) return;
  const btn = $('#easee-backfill');
  btn.disabled = true;
  btn.textContent = 'Backfilling…';
  try {
    const r = await api('POST', '/api/easee/backfill?vehicle=mycar');
    toast(`Backfill: fetched ${r.fetched}, ${r.inserted} new, ${r.skipped} already had`);
    loadVehicle();
  } catch (e) {
    toast(`Error: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Backfill';
  }
});

function renderVehicleEntries() {
  const list = $('#vehicle-list');
  const more = $('#vehicle-load-more');
  list.innerHTML = '';
  const items = state.vehicleEntries;
  const selectMode = state.vehicleSelectMode;
  for (const e of items) {
    const card = document.createElement('div');
    card.className = 'card';
    if (e.ignored) card.classList.add('ignored');
    const checked = state.vehicleSelectedIds.has(e.id);
    if (selectMode && checked) card.classList.add('selected');
    const icon = e.entry_type === 'fuel' ? '⛽' : '⚡';
    const metaBits = [];
    metaBits.push(`<span class="meta-cost">${fmtGBP(e.cost_pence)}</span>`);
    if (e.litres) metaBits.push(`<span>${e.litres.toFixed(2)} L</span>`);
    if (e.kwh) metaBits.push(`<span>${e.kwh.toFixed(2)} kWh</span>`);
    if (e.odometer_miles) metaBits.push(`<span>${e.odometer_miles} mi</span>`);
    if (e.miles) metaBits.push(`<span>+${Math.round(e.miles)} mi</span>`);
    if (e.location) metaBits.push(`<span>${escapeHtml(e.location)}</span>`);
    if (e.is_home_charge) metaBits.push(`<span class="kind-chip charge">home</span>`);
    if (e.ignored) metaBits.push(`<span class="kind-chip ignored-badge">ignored</span>`);
    const checkbox = selectMode
      ? `<input type="checkbox" class="card-checkbox" data-id="${e.id}" ${checked ? 'checked' : ''} aria-label="Select entry">`
      : '';
    card.innerHTML = `
      ${checkbox}
      <div class="card-row1">
        <span class="vendor-avatar ${e.entry_type}">${icon}</span>
        <div class="card-title">${e.entry_type === 'fuel' ? 'Fuel' : 'Charge'}${e.location ? ` · ${escapeHtml(e.location)}` : ''}</div>
        <div class="kind-chip ${e.entry_type}">${fmtDate(e.entry_date)}</div>
      </div>
      <div class="card-row2">${metaBits.join('<span class="sep">·</span>')}</div>
      ${e.notes ? `<div class="card-notes">${escapeHtml(e.notes)}</div>` : ''}
    `;
    if (selectMode) {
      card.addEventListener('click', (ev) => {
        ev.preventDefault();
        toggleSelection(e.id);
      });
    } else {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return;
        openVehicleEntryView(e);
      });
    }
    list.appendChild(card);
  }
  // Show "Load more" if we returned a full page (means there's likely more)
  if (more) more.hidden = items.length < state.vehicleLimit;
}

function toggleSelection(id) {
  if (state.vehicleSelectedIds.has(id)) state.vehicleSelectedIds.delete(id);
  else state.vehicleSelectedIds.add(id);
  // Update the affected card in-place + the count badge.
  const card = document.querySelector(`#vehicle-list .card input[data-id="${id}"]`)?.closest('.card');
  if (card) {
    const cb = card.querySelector('.card-checkbox');
    if (cb) cb.checked = state.vehicleSelectedIds.has(id);
    card.classList.toggle('selected', state.vehicleSelectedIds.has(id));
  }
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $('#vehicle-bulk-bar');
  const count = $('#vehicle-bulk-count');
  if (!bar) return;
  const n = state.vehicleSelectedIds.size;
  if (count) count.textContent = String(n);
  const show = state.vehicleSelectMode && n > 0;
  bar.classList.toggle('hidden', !show);
}

async function bulkAction(action) {
  const ids = Array.from(state.vehicleSelectedIds);
  if (ids.length === 0) return;
  const ignoreBtn = $('#vehicle-bulk-ignore');
  const restoreBtn = $('#vehicle-bulk-restore');
  const cancelBtn = $('#vehicle-bulk-cancel');
  if (ignoreBtn) ignoreBtn.disabled = true;
  if (restoreBtn) restoreBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  try {
    const res = await api('POST', '/api/vehicle/bulk-action', { action, ids });
    const verb = action === 'ignore' ? 'Ignored' : 'Restored';
    if (res.errors && res.errors.length) {
      toast(`${verb} ${res.updated} · ${res.errors.length} error(s)`);
    } else {
      toast(`${verb} ${res.updated}`);
    }
    // Exit select mode + refresh.
    state.vehicleSelectMode = false;
    state.vehicleSelectedIds.clear();
    renderBulkBar();
    loadVehicle();
  } catch (err) {
    toast(`Bulk ${action} failed: ${err.message}`);
  } finally {
    if (ignoreBtn) ignoreBtn.disabled = false;
    if (restoreBtn) restoreBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

$('#vehicle-bulk-ignore')?.addEventListener('click', () => bulkAction('ignore'));
$('#vehicle-bulk-restore')?.addEventListener('click', () => bulkAction('restore'));
$('#vehicle-bulk-cancel')?.addEventListener('click', () => {
  state.vehicleSelectMode = false;
  state.vehicleSelectedIds.clear();
  renderBulkBar();
  renderVehicleFilterChips();
  renderVehicleEntries();
  bindSparkChartHovers();
});

function loadMoreEntries() {
  state.vehicleLimit += 30;
  loadVehicle();
}

$('#vehicle-load-more')?.addEventListener('click', loadMoreEntries);

/**
 * Read-only info modal for a vehicle entry. Shows all fields; has
 * Edit + Delete actions. Edit closes the view and opens the edit
 * modal for the same entry; Delete confirms then removes.
 */
function openVehicleEntryView(entry) {
  const e = entry;
  // Start clean — the previous modal may have been Edit (with Save)
  // or another view (with custom buttons).
  resetModalActions();
  const icon = e.entry_type === 'fuel' ? '⛽' : '⚡';
  const isFuel = e.entry_type === 'fuel';
  const rows = [];
  rows.push({ label: 'Date', value: fmtDate(e.entry_date) });
  if (isFuel && e.litres) {
    const pencePerL = e.cost_pence / e.litres;
    rows.push({ label: 'Litres', value: `${e.litres.toFixed(2)} L` });
    rows.push({ label: 'Cost / litre', value: `${(pencePerL / 100).toFixed(3)} £/L` });
  }
  if (!isFuel && e.kwh) {
    const pencePerK = e.cost_pence / e.kwh;
    rows.push({ label: 'Energy', value: `${e.kwh.toFixed(2)} kWh` });
    rows.push({ label: 'Cost / kWh', value: `${(pencePerK / 100).toFixed(2)} £/kWh` });
  }
  rows.push({ label: 'Total cost', value: fmtGBP(e.cost_pence) });
  if (e.odometer_miles) rows.push({ label: 'Odometer', value: `${e.odometer_miles} mi` });
  if (e.miles) rows.push({ label: 'Miles since last', value: `+${Math.round(e.miles)} mi` });
  if (e.location) rows.push({ label: 'Location', value: e.location });
  if (e.is_home_charge) rows.push({ label: 'Charge type', value: 'home' });
  if (e.unit) rows.push({ label: 'Unit price', value: e.unit });
  if (e.notes) rows.push({ label: 'Notes', value: e.notes });
  if (e.ignored) {
    rows.push({ label: 'Status', value: '🚫 Ignored (excluded from stats)' });
  }

  const html = `
    <div class="entry-view-head">
      <span class="vendor-avatar ${e.entry_type} large">${icon}</span>
      <div>
        <div class="entry-view-title">${isFuel ? 'Fuel' : 'Charge'} entry</div>
        <div class="entry-view-sub">${fmtDate(e.entry_date)}${e.location ? ' · ' + escapeHtml(e.location) : ''}</div>
      </div>
    </div>
    <div class="entry-view-grid">
      ${rows.map((r) => `
        <div class="entry-view-row">
          <span class="entry-view-label">${r.label}</span>
          <span class="entry-view-value">${escapeHtml(String(r.value))}</span>
        </div>
      `).join('')}
    </div>
  `;

  const form = $('#modal-form');
  form.innerHTML = html;
  $('#modal-title').textContent = `${isFuel ? '⛽ Fuel' : '⚡ Charge'} · ${fmtDate(e.entry_date)}`;
  $('#modal-save').hidden = true;
  $('#modal-cancel').textContent = 'Close';

  const actions = $('.modal-actions');
  actions.innerHTML = '';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-secondary';
  editBtn.textContent = 'Edit';
  editBtn.onclick = () => openModal('vehicle-entry', e);
  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'btn btn-secondary';
  ignoreBtn.textContent = e.ignored ? 'Un-ignore' : 'Ignore';
  ignoreBtn.title = e.ignored ? 'Re-include this entry in stats' : 'Exclude from stats (keeps the row, hides from aggregates)';
  ignoreBtn.onclick = async () => {
    const updated = await api('POST', `/api/vehicle/entries/${e.id}/toggle-ignored`, {});
    toast(updated.ignored ? 'Ignored — excluded from stats' : 'Re-included in stats');
    closeModal();
    loadVehicle();
  };
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.onclick = async () => {
    if (!confirm(`Delete this ${e.entry_type} entry?`)) return;
    await api('DELETE', `/api/vehicle/entries/${e.id}`);
    toast('Deleted');
    closeModal();
    loadVehicle();
  };
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-primary';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = closeModal;
  actions.appendChild(editBtn);
  actions.appendChild(ignoreBtn);
  actions.appendChild(deleteBtn);
  actions.appendChild(closeBtn);

  state.modal = { kind: 'vehicle-entry-view', item: e };
  $('#modal-backdrop').classList.remove('hidden');
}

// =========================================================
// Modal — add/edit
// =========================================================

const SCHEMAS = {
  subscription: {
    title: (item) => (item ? 'Edit subscription' : 'Add subscription'),
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'category', label: 'Category', type: 'text', placeholder: 'cloud / utilities / etc' },
      { key: 'cost_pounds', label: 'Cost', type: 'number', step: '0.01', placeholder: '8.99' },
      { key: 'currency', label: 'Currency', type: 'text', default: 'GBP' },
      { key: 'billing_cycle', label: 'Cycle', type: 'select', options: ['monthly', 'yearly', 'weekly', 'one-off'] },
      { key: 'next_due_date', label: 'Next due', type: 'date' },
      { key: 'auto_renew', label: 'Auto-renew', type: 'checkbox' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'cancelled'] },
      { key: 'alert_windows', label: 'Alert windows (days, CSV)', type: 'text', default: '30,14,7,1' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  reminder: {
    title: (item) => (item ? 'Edit reminder' : 'Add reminder'),
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text', placeholder: 'health / vehicle / admin' },
      { key: 'cadence_value', label: 'Cadence value', type: 'number', default: 1, required: true },
      { key: 'cadence_unit', label: 'Cadence unit', type: 'select', options: ['days', 'weeks', 'months', 'years'], required: true },
      { key: 'last_done', label: 'Last done', type: 'date' },
      { key: 'alert_windows', label: 'Alert windows (days, CSV)', type: 'text', default: '30,14,7,1' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'done', 'snoozed'] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  watchlist: {
    title: (item) => (item ? 'Edit watchlist item' : 'Add watchlist item'),
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['case', 'contract', 'decision', 'other'] },
      { key: 'status', label: 'Status', type: 'select', options: ['open', 'waiting', 'closed'] },
      { key: 'next_action_date', label: 'Next action date', type: 'date' },
      { key: 'next_action_label', label: 'Next action', type: 'text', placeholder: 'e.g. follow-up email' },
      { key: 'parties', label: 'Parties', type: 'text', placeholder: 'e.g. counterparty / solicitor' },
      { key: 'alert_windows', label: 'Alert windows (days, CSV)', type: 'text', default: '30,14,7,1' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  'vehicle-entry': {
    title: () => 'Log vehicle entry',
    fields: [
      { key: 'entry_type', label: 'Type', type: 'select', options: ['fuel', 'charge'], required: true },
      { key: 'entry_date', label: 'Date', type: 'date', required: true, default: () => todayISO() },
      { key: 'odometer_miles', label: 'Odometer (mi)', type: 'number' },
      { key: 'cost_pounds', label: 'Total cost', type: 'number', step: '0.01', required: true, placeholder: '59.99' },
      { key: 'litres', label: 'Litres (fuel)', type: 'number', step: '0.01' },
      { key: 'kwh', label: 'kWh (charge)', type: 'number', step: '0.01' },
      { key: 'unit_price', label: 'Unit price (per L / kWh)', type: 'number', step: '0.001', placeholder: '1.499' },
      { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Shell Maidstone' },
      { key: 'is_home_charge', label: 'Home charge', type: 'checkbox' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};

async function openModal(kind, item) {
  const schema = SCHEMAS[kind];
  if (!schema) return;
  // Always reset modal-actions to defaults first — view modal leaves
  // custom buttons in there, and we need Cancel/Save to work for forms.
  resetModalActions();
  state.modal = { kind, item };
  $('#modal-title').textContent = schema.title(item);
  const form = $('#modal-form');
  form.innerHTML = '';
  for (const f of schema.fields) {
    const div = document.createElement('div');
    div.className = 'field';
    const id = `field-${f.key}`;
    // Pre-fill: cost_pounds takes precedence over cost_pence; date defaults to today.
    let val;
    if (item) {
      val = item[f.key];
      if (f.key === 'cost_pounds' && item.cost_pence != null) val = penceToPoundsInput(item.cost_pence);
    } else {
      val = typeof f.default === 'function' ? f.default() : (f.default ?? '');
    }
    let inputHtml = '';
    if (f.type === 'select') {
      inputHtml = `<select id="${id}" name="${f.key}">
        ${(f.options || []).map((o) => `<option value="${o}" ${String(val) === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>`;
    } else if (f.type === 'textarea') {
      inputHtml = `<textarea id="${id}" name="${f.key}" ${f.required ? 'required' : ''} placeholder="${f.placeholder || ''}">${val || ''}</textarea>`;
    } else if (f.type === 'checkbox') {
      inputHtml = `<label><input type="checkbox" id="${id}" name="${f.key}" ${val ? 'checked' : ''}/> ${f.label}</label>`;
      div.classList.add('field-checkbox');
    } else {
      const t = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
      const step = f.step ? `step="${f.step}"` : '';
      inputHtml = `<input type="${t}" id="${id}" name="${f.key}" value="${val ?? ''}" ${step} ${f.required ? 'required' : ''} placeholder="${f.placeholder || ''}"/>`;
    }
    if (f.type !== 'checkbox') {
      div.innerHTML = `<label for="${id}">${f.label}</label>${inputHtml}`;
    } else {
      div.innerHTML = inputHtml;
    }
    form.appendChild(div);
  }
  $('#modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  state.modal = null;
  resetModalActions();
}

/**
 * Restore the modal-actions to its default Save/Cancel state.
 * openVehicleEntryView wipes innerHTML and adds custom buttons; we
 * need to put the defaults back so the next openModal (add/edit)
 * has a working Save button. Without this, the second time you open
 * any modal after viewing an entry, you get `Cannot set property
 * textContent of null` because #modal-cancel was removed.
 */
function resetModalActions() {
  const actions = $('.modal-actions');
  if (!actions) return;
  actions.innerHTML =
    '<button class="btn btn-secondary" id="modal-cancel" type="button">Cancel</button>' +
    '<button class="btn btn-primary" id="modal-save" type="submit" form="modal-form">Save</button>';
  $('#modal-cancel')?.addEventListener('click', closeModal);
  // The form's submit listener is on the form element itself (set up at
  // module load), so it persists across Save button replacement.
}

$('#modal-close')?.addEventListener('click', closeModal);
// modal-cancel listener is bound by resetModalActions() each time the
// modal is opened — don't double-bind here (the original button is
// replaced by resetModalActions' innerHTML assignment, so a module-load
// listener wouldn't survive anyway).
$('#modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-add]');
  if (a) {
    const kind = a.dataset.add;
    openModal(kind, null);
  }
});

$('#modal-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { kind, item } = state.modal || {};
  if (!kind) return;
  const schema = SCHEMAS[kind];
  const body = {};
  for (const f of schema.fields) {
    const el = $(`#field-${f.key}`);
    if (!el) continue;
    let v;
    if (f.type === 'checkbox') v = el.checked ? 1 : 0;
    else if (f.type === 'number') v = el.value === '' ? null : Number(el.value);
    else v = el.value;
    body[f.key] = v;
  }
  // For vehicle entries: if cost_pounds not given but unit_price × litres/kWh is, compute it.
  if (kind === 'vehicle-entry') {
    if (!body.cost_pounds && body.unit_price) {
      const qty = body.litres || body.kwh;
      if (qty) body.cost_pounds = Math.round(body.unit_price * qty * 100) / 100;
    }
    // Derive `unit` text (e.g. "p/litre @ 155.2") for storage as a hint.
    if (body.unit_price) {
      const pencePerUnit = Math.round(body.unit_price * 100);
      body.unit = body.litres ? `p/litre @ ${pencePerUnit}` : body.kwh ? `p/kWh @ ${pencePerUnit}` : null;
    }
  }
  // Translate vehicle-entry kind to POST /api/vehicle/entries
  const path = (() => {
    if (kind === 'subscription')  return item ? `/api/subscriptions/${item.id}` : '/api/subscriptions';
    if (kind === 'reminder')      return item ? `/api/reminders/${item.id}` : '/api/reminders';
    if (kind === 'watchlist')     return item ? `/api/watchlist/${item.id}` : '/api/watchlist';
    if (kind === 'vehicle-entry') return '/api/vehicle/entries';
    return '/';
  })();
  const method = (item && kind !== 'vehicle-entry') ? 'PATCH' : 'POST';
  try {
    await api(method, path, body);
    toast(item ? 'Updated' : 'Added');
    closeModal();
    // Refresh
    if (state.activeTab === 'dashboard') loadDashboard();
    if (state.activeTab === 'subscriptions') loadSubscriptions();
    if (state.activeTab === 'reminders') loadReminders();
    if (state.activeTab === 'watchlist') loadWatchlist();
    if (state.activeTab === 'vehicle' || kind === 'vehicle-entry') loadVehicle();
  } catch (err) {
    toast(`Error: ${err.message}`);
  }
});

// =========================================================
// Misc helpers
// =========================================================

function makeBtn(label, cls, onclick) {
  const b = document.createElement('button');
  b.className = `btn btn-small ${cls || ''}`;
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// =========================================================
// Boot
// =========================================================

(async function boot() {
  // Auth prompt if needed
  if (!state.authToken) {
    state.authToken = prompt('Cadence auth token (stored locally):') || '';
    if (state.authToken) localStorage.setItem('cadence.auth', state.authToken);
  }
  // Meta
  try {
    const meta = await api('GET', '/api/meta');
    $('#meta').textContent = `${meta.env}${meta.telegram ? ' · tg ✓' : ' · tg ✗'}`;
  } catch (e) {
    $('#meta').textContent = 'offline';
  }
  loadDashboard();
  // Preload the rest in the background
  loadSubscriptions();
  loadReminders();
  loadWatchlist();
  loadVehicle();
})();
