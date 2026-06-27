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
  $('#due-count').textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
  list.innerHTML = '';
  if (rows.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const r of rows) {
    list.appendChild(renderDashboardRow(r));
  }
}

function renderDashboardRow(r) {
  const card = document.createElement('div');
  card.className = `card ${urgencyClass(r.days_until)}`;
  const u = r.days_until != null ? dueLabel(r.days_until) : '';
  const urgent = r.days_until != null && r.days_until <= 3;
  const fields = [];
  if (r.due_date) fields.push(`<div><span class="label">When</span><span class="value${urgent ? ' urgent' : ''}">${fmtDate(r.due_date)} · ${u}</span></div>`);
  if (r.cost_pence != null) fields.push(`<div><span class="label">Cost</span><span class="value">${fmtGBP(r.cost_pence)}${r.billing_cycle ? ' / ' + r.billing_cycle : ''}</span></div>`);
  if (r.next_action_label) fields.push(`<div><span class="label">Next</span><span class="value">${escapeHtml(r.next_action_label)}</span></div>`);
  if (r.category) fields.push(`<div><span class="label">Cat</span><span class="value">${escapeHtml(r.category)}</span></div>`);
  card.innerHTML = `
    <div class="card-head">
      <div class="card-title">
        ${vendorAvatar(r)}
        <span class="card-title-text">${escapeHtml(r.title)}</span>
      </div>
      <span class="card-kind ${r.kind}">${r.kind}</span>
    </div>
    ${fields.length ? `<div class="card-grid">${fields.join('')}</div>` : ''}
    ${r.notes ? `<div class="card-notes">${escapeHtml(r.notes)}</div>` : ''}
    <div class="card-actions"></div>
  `;
  const actions = card.querySelector('.card-actions');
  // Quick actions per kind
  if (r.kind === 'reminder') {
    const done = document.createElement('button');
    done.className = 'btn btn-small btn-primary';
    done.textContent = '✓ Mark done';
    done.onclick = async () => {
      try {
        await api('POST', `/api/reminders/${r.id}/done`, {});
        toast('Marked done · next due computed');
        loadDashboard();
        if (state.activeTab === 'reminders') loadReminders();
      } catch (e) {
        toast(`Error: ${e.message}`);
      }
    };
    actions.appendChild(done);
  }
  // Edit for all
  const edit = document.createElement('button');
  edit.className = 'btn btn-small btn-secondary';
  edit.textContent = 'Edit';
  edit.onclick = async () => {
    const item = await fetchItem(r.kind, r.id);
    if (item) openModal(r.kind, item);
  };
  actions.appendChild(edit);
  return card;
}

function vendorAvatar(r) {
  // First-letter avatar: pull from vendor or fall back to title.
  const seed = (r.kind === 'vehicle-entry' ? '' : '') || (r._vendor || '') || r.title || r.kind;
  const ch = (seed.trim()[0] || '?').toUpperCase();
  const cls = r.kind === 'subscription' || r.kind === 'reminder' || r.kind === 'watchlist' ? r.kind : (r.entry_type || r.kind);
  return `<span class="vendor-avatar ${cls}">${escapeHtml(ch)}</span>`;
}

async function fetchItem(kind, id) {
  if (r.kind === 'subscription') return (await api('GET', `/api/subscriptions/${r.id}`));
  if (r.kind === 'reminder')     return (await api('GET', `/api/reminders/${r.id}`));
  if (r.kind === 'watchlist')    return (await api('GET', `/api/watchlist/${r.id}`));
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
    const fields = [];
    if (s.vendor) fields.push(`<div><span class="label">Vendor</span><span class="value">${escapeHtml(s.vendor)}</span></div>`);
    if (s.cost_pence != null) fields.push(`<div><span class="label">Cost</span><span class="value">${fmtGBP(s.cost_pence)}${s.currency ? ' ' + s.currency : ''}</span></div>`);
    if (s.next_due_date) fields.push(`<div><span class="label">Next</span><span class="value">${fmtDate(s.next_due_date)} · ${dueLabel(days)}</span></div>`);
    if (s.billing_cycle) fields.push(`<div><span class="label">Cycle</span><span class="value">${s.billing_cycle}</span></div>`);
    if (s.status !== 'active') fields.push(`<div><span class="label">Status</span><span class="value">${s.status}</span></div>`);
    if (!s.auto_renew) fields.push(`<div><span class="label">Renew</span><span class="value">manual</span></div>`);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          ${vendorAvatar({ ...s, kind: 'subscription' })}
          <span class="card-title-text">${escapeHtml(s.name)}</span>
        </div>
        <span class="card-kind subscription">${s.billing_cycle}</span>
      </div>
      ${fields.length ? `<div class="card-grid">${fields.join('')}</div>` : ''}
      ${s.notes ? `<div class="card-notes">${escapeHtml(s.notes)}</div>` : ''}
      <div class="card-actions"></div>
    `;
    const actions = card.querySelector('.card-actions');
    actions.appendChild(makeBtn('Edit', 'btn-secondary', () => openModal('subscription', s)));
    if (s.status === 'active') {
      actions.appendChild(makeBtn('Pause', 'btn-secondary', async () => {
        await api('PATCH', `/api/subscriptions/${s.id}`, { status: 'paused' });
        toast('Paused');
        loadSubscriptions();
      }));
    } else {
      actions.appendChild(makeBtn('Resume', 'btn-secondary', async () => {
        await api('PATCH', `/api/subscriptions/${s.id}`, { status: 'active' });
        toast('Resumed');
        loadSubscriptions();
      }));
    }
    actions.appendChild(makeBtn('Delete', 'btn-danger', async () => {
      if (!confirm(`Delete "${s.name}"?`)) return;
      await api('DELETE', `/api/subscriptions/${s.id}`);
      toast('Deleted');
      loadSubscriptions();
    }));
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
    const fields = [];
    if (r.category) fields.push(`<div><span class="label">Cat</span><span class="value">${escapeHtml(r.category)}</span></div>`);
    if (r.next_due) fields.push(`<div><span class="label">Next</span><span class="value">${fmtDate(r.next_due)} · ${dueLabel(days)}</span></div>`);
    if (r.last_done) fields.push(`<div><span class="label">Last</span><span class="value">${fmtDate(r.last_done)}</span></div>`);
    if (r.status !== 'active') fields.push(`<div><span class="label">Status</span><span class="value">${r.status}</span></div>`);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          ${vendorAvatar({ ...r, kind: 'reminder' })}
          <span class="card-title-text">${escapeHtml(r.title)}</span>
        </div>
        <span class="card-kind reminder">${r.cadence_value} ${r.cadence_unit}</span>
      </div>
      ${fields.length ? `<div class="card-grid">${fields.join('')}</div>` : ''}
      ${r.notes ? `<div class="card-notes">${escapeHtml(r.notes)}</div>` : ''}
      <div class="card-actions"></div>
    `;
    const actions = card.querySelector('.card-actions');
    actions.appendChild(makeBtn('✓ Done', 'btn-primary', async () => {
      await api('POST', `/api/reminders/${r.id}/done`, {});
      toast('Done · next due updated');
      loadReminders();
      loadDashboard();
    }));
    actions.appendChild(makeBtn('Edit', 'btn-secondary', () => openModal('reminder', r)));
    actions.appendChild(makeBtn('Delete', 'btn-danger', async () => {
      if (!confirm(`Delete "${r.title}"?`)) return;
      await api('DELETE', `/api/reminders/${r.id}`);
      toast('Deleted');
      loadReminders();
    }));
    list.appendChild(card);
  }
}

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
    const fields = [];
    if (w.category) fields.push(`<div><span class="label">Cat</span><span class="value">${escapeHtml(w.category)}</span></div>`);
    if (w.parties) fields.push(`<div><span class="label">Parties</span><span class="value">${escapeHtml(w.parties)}</span></div>`);
    if (w.next_action_date) fields.push(`<div><span class="label">Next</span><span class="value">${fmtDate(w.next_action_date)} · ${w.next_action_label || dueLabel(days)}</span></div>`);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          ${vendorAvatar({ ...w, kind: 'watchlist' })}
          <span class="card-title-text">${escapeHtml(w.title)}</span>
        </div>
        <span class="card-kind watchlist">${w.status}</span>
      </div>
      ${fields.length ? `<div class="card-grid">${fields.join('')}</div>` : ''}
      ${w.notes ? `<div class="card-notes">${escapeHtml(w.notes)}</div>` : ''}
      <div class="card-actions"></div>
    `;
    const actions = card.querySelector('.card-actions');
    if (w.status !== 'closed') {
      actions.appendChild(makeBtn('Close', 'btn-secondary', async () => {
        await api('PATCH', `/api/watchlist/${w.id}`, { status: 'closed' });
        toast('Closed');
        loadWatchlist();
      }));
    }
    actions.appendChild(makeBtn('Edit', 'btn-secondary', () => openModal('watchlist', w)));
    actions.appendChild(makeBtn('Delete', 'btn-danger', async () => {
      if (!confirm(`Delete "${w.title}"?`)) return;
      await api('DELETE', `/api/watchlist/${w.id}`);
      toast('Deleted');
      loadWatchlist();
    }));
    list.appendChild(card);
  }
}

// =========================================================
// Vehicle
// =========================================================

async function loadVehicle() {
  const [{ items }, summary, easee] = await Promise.all([
    api('GET', '/api/vehicle/entries?vehicle=mycar'),
    api('GET', '/api/vehicle/summary?vehicle=mycar'),
    api('GET', '/api/easee/status'),
  ]);
  state.vehicleEntries = items;
  state.vehicleSummary = summary;
  renderVehicleSummary();
  renderVehicleEntries();
  renderEasee(easee);
}

function renderEasee(status) {
  const el = $('#easee-status');
  const btn = $('#easee-sync');
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
    btn.textContent = 'Sync now';
  }
});

function renderVehicleSummary() {
  const s = state.vehicleSummary;
  const el = $('#vehicle-summary');
  if (!s) {
    el.textContent = '—';
    return;
  }
  const a = s.last_30d;
  const b = s.last_90d;
  el.innerHTML = `
    <div class="summary-tile">
      <h4>30d spend</h4>
      <div class="v">${fmtGBP(a.total_pence)}</div>
      <div class="s">${a.total_miles != null ? `${a.total_miles} miles` : 'no odo data'}</div>
    </div>
    <div class="summary-tile">
      <h4>30d £/mile</h4>
      <div class="v">${a.pence_per_mile != null ? (a.pence_per_mile / 100).toFixed(2) : '—'}</div>
      <div class="s">all costs (fuel + charge)</div>
    </div>
    <div class="summary-tile">
      <h4>30d fuel</h4>
      <div class="v">${fmtGBP(a.fuel_pence)}</div>
      <div class="s">${a.fuel_litres.toFixed(1)} L · ${a.fuel_mpg ? a.fuel_mpg.toFixed(1) + ' MPG' : '—'}</div>
    </div>
    <div class="summary-tile">
      <h4>30d charge</h4>
      <div class="v">${fmtGBP(a.charge_pence)}</div>
      <div class="s">${a.charge_kwh.toFixed(1)} kWh · ${fmtGBP(a.home_charge_pence)} home</div>
    </div>
    <div class="summary-tile">
      <h4>90d spend</h4>
      <div class="v">${fmtGBP(b.total_pence)}</div>
      <div class="s">${b.pence_per_mile != null ? (b.pence_per_mile / 100).toFixed(2) + ' £/mile' : '—'}</div>
    </div>
    <div class="summary-tile">
      <h4>Odometer</h4>
      <div class="v">${s.current_odo_miles != null ? s.current_odo_miles : '—'}</div>
      <div class="s">${s.reg_plate || 'mycar'}</div>
    </div>
  `;
}

function renderVehicleEntries() {
  const list = $('#vehicle-list');
  list.innerHTML = '';
  for (const e of state.vehicleEntries.slice(0, 30)) {
    const card = document.createElement('div');
    card.className = 'card';
    const fields = [];
    fields.push(`<div><span class="label">Cost</span><span class="value">${fmtGBP(e.cost_pence)}</span></div>`);
    if (e.litres) fields.push(`<div><span class="label">Litres</span><span class="value">${e.litres.toFixed(2)} L</span></div>`);
    if (e.kwh) fields.push(`<div><span class="label">kWh</span><span class="value">${e.kwh.toFixed(2)}</span></div>`);
    if (e.odometer_miles) fields.push(`<div><span class="label">Odo</span><span class="value">${e.odometer_miles} mi</span></div>`);
    if (e.unit) fields.push(`<div><span class="label">Unit</span><span class="value">${escapeHtml(e.unit)}</span></div>`);
    if (e.location) fields.push(`<div><span class="label">Where</span><span class="value">${escapeHtml(e.location)}</span></div>`);
    if (e.is_home_charge) fields.push(`<div><span class="label">Charge</span><span class="value">home</span></div>`);
    const icon = e.entry_type === 'fuel' ? '⛽' : '⚡';
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          <span class="vendor-avatar ${e.entry_type}">${icon}</span>
          <span class="card-title-text">${e.entry_type === 'fuel' ? 'Fuel' : 'Charge'}</span>
        </div>
        <span class="card-kind ${e.entry_type}">${fmtDate(e.entry_date)}</span>
      </div>
      ${fields.length ? `<div class="card-grid">${fields.join('')}</div>` : ''}
      ${e.notes ? `<div class="card-notes">${escapeHtml(e.notes)}</div>` : ''}
      <div class="card-actions"></div>
    `;
    const actions = card.querySelector('.card-actions');
    actions.appendChild(makeBtn('Delete', 'btn-danger', async () => {
      if (!confirm('Delete this entry?')) return;
      await api('DELETE', `/api/vehicle/entries/${e.id}`);
      toast('Deleted');
      loadVehicle();
    }));
    list.appendChild(card);
  }
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
}

$('#modal-close')?.addEventListener('click', closeModal);
$('#modal-cancel')?.addEventListener('click', closeModal);
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