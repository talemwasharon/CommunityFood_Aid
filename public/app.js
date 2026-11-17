// Shared helpers used by the dashboards
const token = () => localStorage.getItem('token');
const me = () => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } };

function logout() { localStorage.clear(); location.href = 'login.html'; }

function guard(role) {
    const u = me();
    if (!token() || !u || u.role !== role) { logout(); }
    document.getElementById('who').textContent = u ? u.name : '';
}

async function api(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) logout();
    if (!res.ok) throw new Error(data.message || 'Request failed.');
    return data;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtDate = d => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const isoDate = d => new Date(d).toISOString().slice(0, 10);

function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = isErr ? 'err' : ''; t.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3000);
}

// run an action and report success/failure
async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, true); }
}

/* ---------- food item rows (used by both dashboards) ---------- */
const CATEGORIES = ['Cereals & grains', 'Legumes & pulses', 'Vegetables', 'Fruits', 'Oils & fats', 'Dairy & eggs', 'Meat & fish', 'Water & drinks', 'Other'];
const UNITS = ['kg', 'g', 'litres', 'packs', 'bags', 'sacks', 'tins', 'pieces', 'boxes'];
const opts = (list, sel) => list.map(o => `<option${o === sel ? ' selected' : ''}>${o}</option>`).join('');

function addItemRow(box, it = {}) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <label>Food item <input class="i-name" required placeholder="e.g. Maize flour" value="${esc(it.name || '')}"></label>
      <label>Category <select class="i-cat">${opts(CATEGORIES, it.category)}</select></label>
      <label>Unit <select class="i-unit">${opts(UNITS, it.unit)}</select></label>
      <label>Initial stock <input type="number" class="i-init" min="0" step="any" required value="${it.initialStock ?? ''}"></label>
      <label>Distributed <input type="number" class="i-dist" min="0" step="any" required value="${it.distributedStock ?? ''}"></label>
      <label>Current stock <input class="i-cur" readonly tabindex="-1"></label>
      <button type="button" class="danger sm i-del">Remove</button>`;
    box.appendChild(row);

    const calc = () => {
        const left = (+row.querySelector('.i-init').value) - (+row.querySelector('.i-dist').value);
        const cur = row.querySelector('.i-cur');
        cur.value = isNaN(left) ? '' : left;
        cur.style.color = left < 0 ? 'var(--danger)' : '';
    };
    row.addEventListener('input', calc);
    calc();
    row.querySelector('.i-del').onclick = () => {
        if (box.children.length > 1) row.remove(); else toast('Add at least one food item.', true);
    };
}

function fillItems(box, items) {
    box.innerHTML = '';
    (items && items.length ? items : [{}]).forEach(i => addItemRow(box, i));
}

function readItems(box) {
    return [...box.querySelectorAll('.item-row')].map(r => ({
        name: r.querySelector('.i-name').value,
        category: r.querySelector('.i-cat').value,
        unit: r.querySelector('.i-unit').value,
        initialStock: +r.querySelector('.i-init').value,
        distributedStock: +r.querySelector('.i-dist').value
    }));
}

// compact, expandable table of items for use inside a records table
function itemsDetails(items) {
    if (!items || !items.length) return '<span style="color:var(--muted)">No items</span>';
    const rows = items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td>${esc(i.unit)}</td>
      <td class="num">${i.initialStock}</td><td class="num">${i.distributedStock}</td><td class="num">${i.currentStock}</td></tr>`).join('');
    return `<details><summary>${items.length} item${items.length > 1 ? 's' : ''}</summary>
      <table class="mini"><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Initial</th><th>Distributed</th><th>Current</th></tr></thead>
      <tbody>${rows}</tbody></table></details>`;
}