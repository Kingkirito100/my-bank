/* ============================================================
   МОЙ СЕЙФ — личный бизнес-ассистент
   Вся логика на чистом JavaScript (без внешних библиотек).
   Данные хранятся в localStorage браузера.
   ============================================================ */
'use strict';

/* ============================================================
   1. УТИЛИТЫ
   ============================================================ */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function download(name, content, mime) {
  const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const INCOME_CATS = ['Продажи', 'Услуги', 'Инвестиции', 'Прочее'];
const EXPENSE_CATS = ['Закупки', 'Аренда', 'Зарплата', 'Маркетинг', 'Налоги', 'Транспорт', 'Прочее'];
const PRIORITY = {
  low:    { label: 'Низкий',  cls: 'muted' },
  medium: { label: 'Средний', cls: 'amber' },
  high:   { label: 'Высокий', cls: 'red' }
};
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16'];

function fmtMoney(n, sign) {
  const cur = (getData() && getData().profile.currency) || '₽';
  const num = Number(n) || 0;
  const abs = Math.abs(num).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const s = num < 0 ? '−' : (sign === '+' && num > 0 ? '+' : '');
  return s + abs + ' ' + cur;
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function monthKey(iso) { return (iso || '').slice(0, 7); }
function todayMonth() { return todayISO().slice(0, 7); }

/* ============================================================
   2. ХРАНИЛИЩЕ И АВТОРИЗАЦИЯ
   ============================================================ */
const LS_USERS = 'moiseif.users';
const LS_SESSION = 'moiseif.session';
const LS_DATA = 'moiseif.data.';

// Простая хеш-функция (для демонстрации; в продакшене — bcrypt на сервере)
function hashPass(pass, salt) {
  let h = 5381;
  const s = salt + '::' + pass;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36) + '.' + (h * 2654435761 >>> 0).toString(36);
}

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(LS_USERS)) || {}; }
  catch (e) { return {}; }
}
function saveUsers(u) { localStorage.setItem(LS_USERS, JSON.stringify(u)); }
function currentUsername() { return localStorage.getItem(LS_SESSION); }

function defaultData(name) {
  return {
    profile: { name: name || '', company: '', currency: '₽' },
    transactions: [],
    tasks: [],
    goals: [],
    events: [],
    calculations: [],
    clients: [],
    deals: [],
    recurrings: [],
    chat: [],
    settings: { theme: 'light', taxRate: 6, notifications: false, ai: { mode: 'local', provider: 'openrouter', apiKey: '', model: '', baseURL: '' } }
  };
}
function normalizeData(d) {
  if (!d || typeof d !== 'object') d = defaultData();
  if (!d.profile || typeof d.profile !== 'object') d.profile = { name: '', company: '', currency: '₽' };
  if (!d.profile.currency) d.profile.currency = '₽';
  ['transactions', 'tasks', 'goals', 'events', 'calculations', 'clients', 'deals', 'recurrings', 'chat'].forEach(k => {
    if (!Array.isArray(d[k])) d[k] = [];
  });
  if (!d.settings || typeof d.settings !== 'object') d.settings = {};
  if (typeof d.settings.taxRate !== 'number') d.settings.taxRate = 6;
  if (typeof d.settings.notifications !== 'boolean') d.settings.notifications = false;
  if (!d.settings.theme) d.settings.theme = 'light';
  if (!d.settings.ai || typeof d.settings.ai !== 'object') {
    d.settings.ai = { mode: 'local', provider: 'openrouter', apiKey: '', model: '', baseURL: '' };
  }
  return d;
}
function getData() {
  const u = currentUsername();
  if (!u) return null;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(LS_DATA + u)); } catch (e) { d = null; }
  return normalizeData(d || defaultData());
}
function saveData(d) {
  const u = currentUsername();
  if (u) localStorage.setItem(LS_DATA + u, JSON.stringify(d));
}

function register(name, username, pass) {
  const users = loadUsers();
  const login = username.trim().toLowerCase();
  if (!name.trim()) return 'Укажите имя';
  if (!login) return 'Укажите логин';
  if (!/^[a-z0-9_.-]{2,}$/.test(login)) return 'Логин: латиница, цифры, точка, дефис (от 2 символов)';
  if (pass.length < 4) return 'Пароль должен быть не короче 4 символов';
  if (users[login]) return 'Такой логин уже занят';
  users[login] = { name: name.trim(), pass: hashPass(pass, login), created: todayISO() };
  saveUsers(users);
  localStorage.setItem(LS_SESSION, login);
  localStorage.setItem(LS_DATA + login, JSON.stringify(defaultData(name.trim())));
  return null;
}
function login(username, pass) {
  const users = loadUsers();
  const login = username.trim().toLowerCase();
  const user = users[login];
  if (!user) return 'Пользователь не найден';
  if (user.pass !== hashPass(pass, login)) return 'Неверный пароль';
  localStorage.setItem(LS_SESSION, login);
  if (!localStorage.getItem(LS_DATA + login)) localStorage.setItem(LS_DATA + login, JSON.stringify(defaultData(user.name)));
  return null;
}
function logout() {
  localStorage.removeItem(LS_SESSION);
  showAuth();
}

/* ============================================================
   3. ГРАФИКИ (canvas, без библиотек)
   ============================================================ */
function setupCanvas(canvas, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.clientWidth || canvas.parentElement.clientWidth || 300);
  let hh = height || 240;
  if (w < 440 && hh > 200) hh = 200;
  canvas.width = w * dpr;
  canvas.height = hh * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hh);
  return { ctx, w, h: hh };
}

function drawDonut(canvas, segments, centerValue, centerLabel) {
  const { ctx, w, h } = setupCanvas(canvas, 230);
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 12;
  const inner = r * 0.62;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  let start = -Math.PI / 2;
  segments.forEach(seg => {
    if (seg.value <= 0) return;
    const ang = (seg.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + ang);
    ctx.arc(cx, cy, inner, start + ang, start, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    start += ang;
  });
  if (centerValue != null) {
    ctx.textAlign = 'center';
    ctx.fillStyle = cssVar('--text');
    ctx.font = '800 22px -apple-system, Segoe UI, sans-serif';
    ctx.fillText(centerValue, cx, cy + 2);
    if (centerLabel) {
      ctx.fillStyle = cssVar('--text-2');
      ctx.font = '500 12px -apple-system, Segoe UI, sans-serif';
      ctx.fillText(centerLabel, cx, cy + 22);
    }
  }
}

function niceNum(range) {
  if (!(range > 0)) return 1;
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  let nf;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * Math.pow(10, exp);
}

function fmtAxis(v) {
  if (v === 0) return '0';
  if (Math.abs(v) < 1) return String(Math.round(v * 100) / 100);
  if (v >= 1000000) return (v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1) + 'М';
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'к';
  return String(Math.round(v));
}

function drawAxisGrid(ctx, padL, padR, padT, plotH, w, steps) {
  ctx.strokeStyle = cssVar('--border');
  ctx.lineWidth = 1;
  for (let i = 0; i <= steps; i++) {
    const y = padT + plotH - (plotH * i / steps);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }
}

function drawBars(canvas, labels, datasets, opts) {
  const { ctx, w, h } = setupCanvas(canvas, 240);
  const padL = 46, padB = 26, padT = 16, padR = 10;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const n = labels.length || 1;
  const groupW = plotW / n;
  const barW = Math.min(26, (groupW * 0.7) / datasets.length);
  const steps = 4;

  ctx.font = '11px -apple-system, Segoe UI, sans-serif';
  ctx.fillStyle = cssVar('--text-3');
  drawAxisGrid(ctx, padL, padR, padT, plotH, w, steps);

  const rawMax = Math.max(0, ...datasets.flatMap(ds => ds.values.map(v => Math.max(0, Number(v) || 0))));

  if (rawMax <= 0) {
    ctx.textAlign = 'right';
    ctx.fillText('0', padL - 6, padT + plotH + 4);
    ctx.textAlign = 'center';
    ctx.font = '500 12px -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Пока нет данных за период', padL + plotW / 2, padT + plotH / 2 + 4);
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    labels.forEach((lab, i) => ctx.fillText(lab, padL + groupW * i + groupW / 2, h - 8));
    return;
  }

  const step = niceNum(rawMax / steps);
  const max = step * steps;

  ctx.textAlign = 'right';
  for (let i = 0; i <= steps; i++) {
    const y = padT + plotH - (plotH * i / steps);
    ctx.fillText(fmtAxis(step * i), padL - 6, y + 4);
  }

  labels.forEach((lab, i) => {
    const x = padL + groupW * i + groupW / 2;
    datasets.forEach((ds, di) => {
      const val = Math.max(0, Number(ds.values[i]) || 0);
      const bh = (val / max) * plotH;
      const bx = x - (datasets.length * barW) / 2 + di * barW;
      const by = padT + plotH - bh;
      ctx.fillStyle = ds.color;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bx, by, barW, Math.max(bh, 1), 4); ctx.fill(); }
      else { ctx.rect(bx, by, barW, Math.max(bh, 1)); ctx.fill(); }
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = cssVar('--text-3');
    ctx.fillText(lab, x, h - 8);
  });
}

function drawLine(canvas, labels, series) {
  const { ctx, w, h } = setupCanvas(canvas, 220);
  const padL = 44, padB = 24, padT = 14, padR = 12;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const steps = 4;

  ctx.font = '11px -apple-system, Segoe UI, sans-serif';
  ctx.fillStyle = cssVar('--text-3');
  drawAxisGrid(ctx, padL, padR, padT, plotH, w, steps);

  const rawMax = Math.max(0, ...series.flatMap(s => s.values.map(v => Math.max(0, Number(v) || 0))));
  const step = rawMax <= 0 ? 1 : niceNum(rawMax / steps);
  const max = step * steps;

  ctx.textAlign = 'right';
  for (let i = 0; i <= steps; i++) {
    const y = padT + plotH - (plotH * i / steps);
    ctx.fillText(fmtAxis(step * i), padL - 6, y + 4);
  }

  if (rawMax <= 0) {
    ctx.textAlign = 'center';
    ctx.font = '500 12px -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Пока нет данных за период', padL + plotW / 2, padT + plotH / 2 + 4);
    return;
  }

  const xStep = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  series.forEach(s => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = padL + xStep * i;
      const y = padT + plotH - ((Math.max(0, Number(v) || 0)) / max) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    s.values.forEach((v, i) => {
      const x = padL + xStep * i;
      const y = padT + plotH - ((Math.max(0, Number(v) || 0)) / max) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    });
  });
  if (labels.length) {
    ctx.textAlign = 'center'; ctx.fillStyle = cssVar('--text-3');
    ctx.fillText(labels[0], padL, h - 8);
    if (labels.length > 1) ctx.fillText(labels[labels.length - 1], padL + xStep * (labels.length - 1), h - 8);
  }
}

function legendHTML(items) {
  return '<div class="legend" style="display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;">' +
    items.map(it =>
      '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2);">' +
      '<span style="width:10px;height:10px;border-radius:3px;background:' + it.color + ';display:inline-block;"></span>' +
      esc(it.label) + '</span>'
    ).join('') + '</div>';
}

/* ============================================================
   4. ВЫЧИСЛЕНИЯ ПО ФИНАНСАМ
   ============================================================ */
function txSum(list, type) {
  return list.filter(t => t.type === type).reduce((s, t) => s + (Number(t.amount) || 0), 0);
}
function balanceOf(list) { return txSum(list, 'income') - txSum(list, 'expense'); }
function inMonth(t, m) { return monthKey(t.date) === m; }

function calcProfit(inputs) {
  const revenue = Number(inputs.revenue) || 0;
  const variable = Number(inputs.variableCosts) || 0;
  const fixed = Number(inputs.fixedCosts) || 0;
  const taxRate = Math.max(0, Number(inputs.taxRate) || 0);
  const gross = revenue - variable;
  const operating = gross - fixed;
  const tax = operating > 0 ? operating * taxRate / 100 : 0;
  const net = operating - tax;
  const margin = revenue > 0 ? (operating / revenue) * 100 : 0;
  const markup = variable > 0 ? (gross / variable) * 100 : 0;
  const totalCosts = variable + fixed + tax;
  const roi = totalCosts > 0 ? (net / totalCosts) * 100 : 0;
  let breakEven = null;
  if (revenue > 0 && variable >= 0) {
    const cmRatio = revenue > 0 ? (revenue - variable) / revenue : 0;
    if (cmRatio > 0) breakEven = fixed / cmRatio;
  }
  return { revenue, variable, fixed, taxRate, gross, operating, tax, net, margin, markup, totalCosts, roi, breakEven };
}

/* ============================================================
   5. РОУТЕР
   ============================================================ */
const TITLES = {
  dashboard: 'Дашборд', calculator: 'Калькулятор прибыли', finance: 'Финансы',
  clients: 'Клиенты и сделки', reports: 'Отчёты',
  tasks: 'Задачи', goals: 'Цели', calendar: 'Календарь', assistant: 'ИИ-ассистент', settings: 'Настройки'
};
const DEAL_STAGES = [
  { id: 'new', label: 'Новые', color: '#3b82f6' },
  { id: 'negotiation', label: 'Переговоры', color: '#f59e0b' },
  { id: 'offer', label: 'Предложение', color: '#8b5cf6' },
  { id: 'paid', label: 'Оплачено', color: '#10b981' }
];
let currentView = 'dashboard';
let calState = { year: null, month: null, selected: todayISO() };
let financeFilter = { month: 'all', type: 'all', q: '' };
let calcMode = 'revenue'; // 'revenue' | 'units'

function navigate(view) {
  currentView = view;
  $$('#nav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#pageTitle').textContent = TITLES[view] || '';
  $('#viewContainer').innerHTML = RENDERERS[view]();
  (BINDERS[view] || (() => {}))();
  if (view === 'assistant') scrollChatBottom();
  window.scrollTo({ top: 0 });
}

/* ============================================================
   6. ВИДЫ — РЕНДЕР
   ============================================================ */
const RENDERERS = {};

RENDERERS.dashboard = function () {
  const d = getData();
  const cur = d.profile.currency;
  const balance = balanceOf(d.transactions);
  const mInc = txSum(d.transactions.filter(t => inMonth(t, todayMonth())), 'income');
  const mExp = txSum(d.transactions.filter(t => inMonth(t, todayMonth())), 'expense');
  const activeTasks = d.tasks.filter(t => !t.done);
  const doneTasks = d.tasks.filter(t => t.done);
  const overdue = activeTasks.filter(t => t.due && t.due < todayISO());
  const goalsTotal = d.goals.reduce((s, g) => s + (Number(g.target) || 0), 0);
  const goalsSaved = d.goals.reduce((s, g) => s + Math.min(Number(g.target) || 0, Number(g.saved) || 0), 0);
  const today = todayISO();
  const todaysTasks = activeTasks.filter(t => t.due === today);
  const upcoming = d.events.filter(e => e.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 4);

  // график за 6 месяцев
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'));
  }
  const incVals = months.map(m => txSum(d.transactions.filter(t => inMonth(t, m)), 'income'));
  const expVals = months.map(m => txSum(d.transactions.filter(t => inMonth(t, m)), 'expense'));
  const monthLabels = months.map(m => new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'short' }));

  // структура расходов за месяц
  const expThisMonth = d.transactions.filter(t => t.type === 'expense' && inMonth(t, todayMonth()));
  const catAgg = {};
  expThisMonth.forEach(t => { catAgg[t.category] = (catAgg[t.category] || 0) + (Number(t.amount) || 0); });
  const donutSegs = Object.keys(catAgg).map((c, i) => ({ label: c, value: catAgg[c], color: PALETTE[i % PALETTE.length] }));

  return `
  <div class="grid" style="gap:20px;">
    <div class="card" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:13px;opacity:.85;">Добро пожаловать</div>
          <div style="font-size:24px;font-weight:800;margin-top:4px;">${esc(d.profile.name || 'Пользователь')} 👋</div>
          <div style="font-size:13px;opacity:.85;margin-top:6px;">${esc(d.profile.company || 'Личный бизнес-кабинет')}</div>
        </div>
        <button class="btn" style="background:rgba(255,255,255,.18);color:#fff;box-shadow:none;" data-action="goto" data-goto="assistant">🤖 Спросить ИИ</button>
      </div>
    </div>

    <div class="grid grid-cards">
      <div class="card stat ${balance >= 0 ? 'positive' : 'negative'}">
        <div class="stat-label">Баланс</div>
        <div class="stat-value">${fmtMoney(balance)}</div>
        <div class="stat-hint">доходы − расходы</div>
        <div class="stat-ico" style="background:var(--accent-soft);">💰</div>
      </div>
      <div class="card stat positive">
        <div class="stat-label">Доход за месяц</div>
        <div class="stat-value">${fmtMoney(mInc)}</div>
        <div class="stat-hint">${todayMonthLabel()}</div>
        <div class="stat-ico" style="background:var(--green-soft);">📈</div>
      </div>
      <div class="card stat negative">
        <div class="stat-label">Расход за месяц</div>
        <div class="stat-value">${fmtMoney(mExp)}</div>
        <div class="stat-hint">${todayMonthLabel()}</div>
        <div class="stat-ico" style="background:var(--red-soft);">📉</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Задачи</div>
        <div class="stat-value">${doneTasks.length}/${d.tasks.length}</div>
        <div class="stat-hint">${overdue.length ? '⏰ просрочено: ' + overdue.length : 'выполнено / всего'}</div>
        <div class="stat-ico" style="background:var(--amber-soft);">✅</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Динамика за 6 месяцев</div></div></div>
        <canvas id="dashBars" height="240"></canvas>
        ${legendHTML([{ label: 'Доход', color: '#10b981' }, { label: 'Расход', color: '#ef4444' }])}
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">Структура расходов</div><div class="card-sub">за текущий месяц</div></div></div>
        ${donutSegs.length
          ? `<canvas id="dashDonut" height="230"></canvas>${legendHTML(donutSegs.map(s => ({ label: s.label + ' — ' + fmtMoney(s.value), color: s.color })))}`
          : '<div class="empty"><div class="empty-ico">🍩</div><p>Пока нет расходов — добавьте их в разделе «Финансы»</p></div>'}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Задачи на сегодня</div></div>
          <button class="btn btn-ghost btn-sm" data-action="goto" data-goto="tasks">Все задачи</button>
        </div>
        ${todaysTasks.length ? todaysTasks.slice(0, 5).map(taskHTML).join('')
          : (activeTasks.length ? '<div class="empty"><p>На сегодня задач нет, но есть другие — загляните в «Задачи»</p></div>'
            : '<div class="empty"><div class="empty-ico">🎉</div><p>Все задачи выполнены или не добавлены</p></div>')}
      </div>
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Ближайшие события</div></div>
          <button class="btn btn-ghost btn-sm" data-action="goto" data-goto="calendar">Календарь</button>
        </div>
        ${upcoming.length ? upcoming.map(evtHTML).join('') : '<div class="empty"><div class="empty-ico">📅</div><p>Событий пока нет</p></div>'}
      </div>
    </div>

    ${insightsHTML(d)}

    ${d.goals.length ? `
    <div class="card">
      <div class="card-header"><div><div class="card-title">Цели</div><div class="card-sub">общий прогресс ${fmtMoney(goalsSaved)} из ${fmtMoney(goalsTotal)}</div></div>
        <button class="btn btn-ghost btn-sm" data-action="goto" data-goto="goals">Все цели</button></div>
      <div class="progress" style="height:12px;"><div class="progress-fill" style="width:${goalsTotal ? Math.min(100, goalsSaved / goalsTotal * 100) : 0}%;"></div></div>
    </div>` : ''}
  </div>`;
};

function todayMonthLabel() {
  return new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
function taskHTML(t) {
  const p = PRIORITY[t.priority] || PRIORITY.low;
  return `<div class="task-item ${t.done ? 'done' : ''}" data-task-id="${t.id}">
    <button class="task-check" data-action="toggle-task" data-id="${t.id}">${t.done ? '✓' : ''}</button>
    <div class="task-title">${esc(t.title)}</div>
    <span class="badge ${p.cls}">${p.label}</span>
    ${t.due ? `<span class="task-meta">📅 ${fmtDateShort(t.due)}</span>` : ''}
    <button class="icon-btn" data-action="delete-task" data-id="${t.id}" title="Удалить">🗑</button>
  </div>`;
}
function evtHTML(e) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
    <div class="avatar" style="width:36px;height:36px;font-size:15px;">${e.emoji || '📅'}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;font-size:14px;">${esc(e.title)}</div>
      <div class="task-meta">${fmtDate(e.date)}${e.time ? ' · ' + esc(e.time) : ''}</div>
    </div>
  </div>`;
}

/* ---------- КАЛЬКУЛЯТОР ---------- */
RENDERERS.calculator = function () {
  const d = getData();
  return `
  <div class="grid" style="gap:20px;">
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">🧮 Умный калькулятор прибыли</div>
        <div class="card-sub">Рассчитайте прибыль, маржу, рентабельность и точку безубыточности</div></div>
        <div class="segmented" style="min-width:280px;">
          <button class="${calcMode === 'revenue' ? 'active' : ''}" data-action="calc-mode" data-mode="revenue">По выручке и затратам</button>
          <button class="${calcMode === 'units' ? 'active' : ''}" data-action="calc-mode" data-mode="units">По цене и объёму</button>
        </div>
      </div>

      <div class="form-grid" style="margin-bottom:16px;">
        ${calcMode === 'revenue' ? `
          <label class="field"><span>Выручка (доход от продаж)</span><input type="number" id="inRevenue" value="500000" min="0"></label>
          <label class="field"><span>Переменные затраты (себестоимость)</span><input type="number" id="inVariable" value="200000" min="0"></label>
        ` : `
          <label class="field"><span>Цена за единицу</span><input type="number" id="inPrice" value="5000" min="0"></label>
          <label class="field"><span>Себестоимость единицы</span><input type="number" id="inUnitCost" value="2000" min="0"></label>
          <label class="field"><span>Кол-во продаж (шт.)</span><input type="number" id="inQty" value="100" min="0"></label>
        `}
        <label class="field"><span>Постоянные затраты (аренда, зарплата)</span><input type="number" id="inFixed" value="150000" min="0"></label>
        <label class="field"><span>Налог на прибыль, %</span><input type="number" id="inTax" value="6" min="0"></label>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" data-action="run-calc">Рассчитать</button>
        <button class="btn btn-ghost" data-action="save-calc">💾 Сохранить расчёт</button>
      </div>
    </div>

    <div id="calcResult" class="grid" style="gap:16px;">${calcResultHTML(null)}</div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">История расчётов</div><div class="card-sub">сохранённые сценарии</div></div></div>
      ${d.calculations.length ? `<div class="table-wrap" style="overflow-x:auto;"><table class="table">
        <thead><tr><th>Дата</th><th>Выручка</th><th>Затраты</th><th>Чистая прибыль</th><th>Маржа</th><th></th></tr></thead>
        <tbody>${d.calculations.slice().reverse().map(c => `
          <tr>
            <td>${fmtDate(c.date)}</td>
            <td>${fmtMoney(c.kpis.revenue)}</td>
            <td>${fmtMoney(c.kpis.totalCosts)}</td>
            <td class="${c.kpis.net >= 0 ? 'amount-in' : 'amount-out'}">${fmtMoney(c.kpis.net, '+')}</td>
            <td>${c.kpis.margin.toFixed(1)}%</td>
            <td><button class="icon-btn" data-action="delete-calc" data-id="${c.id}" title="Удалить">🗑</button></td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty"><div class="empty-ico">🧾</div><p>Сохранённых расчётов пока нет</p></div>'}
    </div>
  </div>`;
};

function calcResultHTML(k) {
  if (!k) return '<div class="empty" style="grid-column:1/-1;"><div class="empty-ico">📐</div><p>Введите данные и нажмите «Рассчитать»</p></div>';
  const netCls = k.net >= 0 ? 'positive' : 'negative';
  return `
    <div class="kpi-row" style="grid-column:1/-1;">
      <div class="kpi"><div class="kpi-label">Валовая прибыль</div><div class="kpi-value">${fmtMoney(k.gross)}</div></div>
      <div class="kpi ${netCls}"><div class="kpi-label">Чистая прибыль</div><div class="kpi-value">${fmtMoney(k.net, '+')}</div></div>
      <div class="kpi"><div class="kpi-label">Маржа (рентабельность)</div><div class="kpi-value">${k.margin.toFixed(1)}%</div></div>
      <div class="kpi"><div class="kpi-label">Наценка</div><div class="kpi-value">${isFinite(k.markup) ? k.markup.toFixed(0) + '%' : '—'}</div></div>
      <div class="kpi"><div class="kpi-label">ROI</div><div class="kpi-value">${k.roi.toFixed(0)}%</div></div>
      <div class="kpi"><div class="kpi-label">Налог</div><div class="kpi-value">${fmtMoney(k.tax)}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">Структура выручки</div></div></div>
      <canvas id="calcDonut" height="230"></canvas>
      ${legendHTML([
        { label: 'Переменные затраты', color: '#f59e0b' },
        { label: 'Постоянные затраты', color: '#3b82f6' },
        { label: 'Налог', color: '#ef4444' },
        { label: 'Чистая прибыль', color: '#10b981' }
      ])}
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">Выручка и затраты</div></div></div>
      <canvas id="calcBars" height="240"></canvas>
      ${legendHTML([{ label: 'Выручка', color: '#10b981' }, { label: 'Итого затрат', color: '#ef4444' }])}
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">Ключевые выводы</div></div></div>
      <ul style="padding-left:18px;line-height:2;font-size:14px;">
        <li>Точка безубыточности: <b>${k.breakEven != null ? fmtMoney(k.breakEven) + ' выручки' : 'недостижима при таких данных'}</b></li>
        <li>Каждый рубль выручки приносит <b>${k.revenue > 0 ? (k.net / k.revenue * 100).toFixed(1) : 0}%</b> чистой прибыли.</li>
        <li>Бизнес ${k.net >= 0 ? 'прибыльный ✅' : 'убыточный ⚠️ — пересмотрите затраты или цену'}.</li>
      </ul>
    </div>`;
}

/* ---------- ФИНАНСЫ ---------- */
RENDERERS.finance = function () {
  const d = getData();
  const months = [...new Set(d.transactions.map(t => monthKey(t.date)))].sort().reverse();
  return `
  <div class="grid" style="gap:20px;">
    <div class="grid grid-cards">
      <div class="card stat positive"><div class="stat-label">Доходы (период)</div><div class="stat-value" id="finInc">—</div></div>
      <div class="card stat negative"><div class="stat-label">Расходы (период)</div><div class="stat-value" id="finExp">—</div></div>
      <div class="card stat"><div class="stat-label">Баланс (период)</div><div class="stat-value" id="finBal">—</div></div>
    </div>

    <div class="card">
      <div class="card-header">
        <div><div class="card-title">➕ Добавить операцию</div></div>
      </div>
      <form id="txForm" class="form-row">
        <div class="segmented" style="min-width:170px;">
          <button type="button" class="active" data-action="tx-type" data-type="income">Доход</button>
          <button type="button" data-action="tx-type" data-type="expense">Расход</button>
        </div>
        <label class="field" style="flex:1;min-width:120px;"><span>Сумма</span><input type="number" id="txAmount" min="0" step="0.01" placeholder="1000" required></label>
        <label class="field" style="flex:1;min-width:150px;"><span>Категория</span><select id="txCategory">${INCOME_CATS.map(c => `<option>${c}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:140px;"><span>Дата</span><input type="date" id="txDate" value="${todayISO()}"></label>
        <label class="field" style="flex:2;min-width:160px;"><span>Комментарий</span><input type="text" id="txNote" placeholder="необязательно"></label>
        <label class="check-inline" title="Повторять каждый месяц"><input type="checkbox" id="txRecurring"> 🔁 Каждый месяц</label>
        <button type="submit" class="btn btn-primary">Добавить</button>
      </form>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Доходы по категориям</div></div></div>
        <div id="finDonutInc"></div>
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">Расходы по категориям</div></div></div>
        <div id="finDonutExp"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;">
        <div><div class="card-title">История операций</div></div>
        <div class="form-row" style="align-items:center;">
          <select id="finMonthFilter" class="field-select" style="padding:8px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface);">
            <option value="all">Все месяцы</option>
            ${months.map(m => `<option value="${m}">${new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</option>`).join('')}
          </select>
          <select id="finTypeFilter" style="padding:8px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface);">
            <option value="all">Все типы</option><option value="income">Доходы</option><option value="expense">Расходы</option>
          </select>
          <input type="text" id="finSearch" placeholder="Поиск по комментарию" style="padding:8px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface);min-width:150px;">
          <button class="btn btn-ghost btn-sm" data-action="import-csv">⬆ Импорт CSV</button>
          <input type="file" id="csvFile" accept=".csv,text/csv" style="display:none;">
          <button class="btn btn-ghost btn-sm" data-action="export-csv">⬇ Экспорт CSV</button>
        </div>
      </div>
      <div id="finList"></div>
    </div>

    ${d.recurrings.length ? `
    <div class="card">
      <div class="card-header"><div><div class="card-title">🔁 Повторяющиеся операции</div><div class="card-sub">добавляются автоматически раз в месяц</div></div></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${d.recurrings.map(r => `
          <div class="client-row">
            <div class="avatar" style="width:34px;height:34px;font-size:15px;">🔁</div>
            <div style="flex:1;min-width:0;">
              <div class="client-name">${esc(r.category)} · ${r.type === 'income' ? '+' : '−'}${fmtMoney(r.amount)}</div>
              <div class="task-meta">${esc(r.note || 'без комментария')} · день ${r.day}</div>
            </div>
            <button class="icon-btn" data-action="delete-recurring" data-id="${r.id}" title="Удалить">🗑</button>
          </div>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
};

function renderFinanceData() {
  const d = getData();
  const flt = d.transactions.filter(t => {
    if (financeFilter.month !== 'all' && monthKey(t.date) !== financeFilter.month) return false;
    if (financeFilter.type !== 'all' && t.type !== financeFilter.type) return false;
    if (financeFilter.q && !(t.note || '').toLowerCase().includes(financeFilter.q.toLowerCase())) return false;
    return true;
  });
  const inc = txSum(flt, 'income');
  const exp = txSum(flt, 'expense');
  $('#finInc').textContent = fmtMoney(inc);
  $('#finExp').textContent = fmtMoney(exp);
  $('#finBal').textContent = fmtMoney(inc - exp);
  $('#finBal').parentElement.className = 'card stat ' + (inc - exp >= 0 ? 'positive' : 'negative');

  const list = $('#finList');
  if (!flt.length) {
    list.innerHTML = '<div class="empty"><div class="empty-ico">💸</div><p>Операций по выбранным фильтрам нет</p></div>';
  } else {
    const sorted = flt.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    list.innerHTML = `<div class="table-wrap" style="overflow-x:auto;"><table class="table">
      <thead><tr><th>Дата</th><th>Тип</th><th>Категория</th><th>Комментарий</th><th style="text-align:right;">Сумма</th><th></th></tr></thead>
      <tbody>${sorted.map(t => `
        <tr>
          <td>${fmtDate(t.date)}</td>
          <td><span class="badge ${t.type === 'income' ? 'green' : 'red'}">${t.type === 'income' ? 'Доход' : 'Расход'}</span></td>
          <td>${esc(t.category)}</td>
          <td style="color:var(--text-2);">${esc(t.note || '—')}</td>
          <td class="${t.type === 'income' ? 'amount-in' : 'amount-out'}" style="text-align:right;">${t.type === 'income' ? '+' : '−'}${fmtMoney(t.amount)}</td>
          <td><button class="icon-btn" data-action="delete-tx" data-id="${t.id}" title="Удалить">🗑</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  }

  // донатсы
  const incCats = aggregateCats(d.transactions.filter(t => t.type === 'income' && (financeFilter.month === 'all' || inMonth(t, financeFilter.month))));
  const expCats = aggregateCats(d.transactions.filter(t => t.type === 'expense' && (financeFilter.month === 'all' || inMonth(t, financeFilter.month))));
  renderDonutBlock('#finDonutInc', incCats, 'Доходы', 'нет данных');
  renderDonutBlock('#finDonutExp', expCats, 'Расходы', 'нет данных');
}
function aggregateCats(list) {
  const agg = {};
  list.forEach(t => { agg[t.category] = (agg[t.category] || 0) + (Number(t.amount) || 0); });
  return Object.keys(agg).map((c, i) => ({ label: c, value: agg[c], color: PALETTE[i % PALETTE.length] }));
}
function renderDonutBlock(sel, cats, title, emptyText) {
  const box = $(sel);
  if (!box) return;
  if (!cats.length) { box.innerHTML = '<div class="empty"><p>' + emptyText + '</p></div>'; return; }
  const id = 'donut-' + sel.replace('#', '');
  box.innerHTML = `<canvas id="${id}" height="230"></canvas>${legendHTML(cats.map(c => ({ label: c.label + ' — ' + fmtMoney(c.value), color: c.color })))}`;
  drawDonut($('#' + id), cats, null, null);
}

/* ---------- КЛИЕНТЫ И СДЕЛКИ (мини-CRM) ---------- */
RENDERERS.clients = function () {
  const d = getData();
  const paid = d.deals.filter(x => x.stage === 'paid');
  const paidSum = paid.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const active = d.deals.filter(x => x.stage !== 'paid');
  const activeSum = active.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const conv = d.deals.length ? (paid.length / d.deals.length * 100) : 0;
  const avg = paid.length ? paidSum / paid.length : 0;

  return `
  <div class="grid" style="gap:20px;">
    <div class="grid grid-cards">
      <div class="card stat"><div class="stat-label">Клиенты</div><div class="stat-value">${d.clients.length}</div><div class="stat-hint">в базе</div><div class="stat-ico" style="background:var(--accent-soft);">👥</div></div>
      <div class="card stat"><div class="stat-label">В работе</div><div class="stat-value">${active.length}</div><div class="stat-hint">${fmtMoney(activeSum)}</div><div class="stat-ico" style="background:var(--amber-soft);">💼</div></div>
      <div class="card stat positive"><div class="stat-label">Оплачено</div><div class="stat-value">${fmtMoney(paidSum)}</div><div class="stat-hint">${paid.length} сделок</div><div class="stat-ico" style="background:var(--green-soft);">✅</div></div>
      <div class="card stat"><div class="stat-label">Конверсия</div><div class="stat-value">${conv.toFixed(0)}%</div><div class="stat-hint">средний чек ${fmtMoney(avg)}</div><div class="stat-ico" style="background:var(--accent-soft);">📈</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div><div class="card-title">👥 Клиенты</div><div class="card-sub">база контактов</div></div></div>
        <form id="clientForm" class="form-row" style="margin-bottom:14px;">
          <label class="field" style="flex:2;min-width:140px;"><span>Имя / компания</span><input type="text" id="clientName" placeholder="Иван Петров" required></label>
          <label class="field" style="flex:1;min-width:120px;"><span>Телефон</span><input type="text" id="clientPhone" placeholder="+7…"></label>
          <button type="submit" class="btn btn-primary">Добавить</button>
        </form>
        <div id="clientList" style="display:flex;flex-direction:column;gap:8px;">
          ${d.clients.length ? d.clients.map(clientHTML).join('') : '<div class="empty"><div class="empty-ico">👥</div><p>Клиентов пока нет</p></div>'}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div><div class="card-title">💼 Новая сделка</div><div class="card-sub">добавьте клиента и сумму</div></div></div>
        <form id="dealForm" class="grid" style="gap:12px;">
          <label class="field"><span>Сделка</span><input type="text" id="dealTitle" placeholder="Поставка кофе" required></label>
          <div class="form-grid">
            <label class="field"><span>Клиент</span><select id="dealClient">${d.clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="">— без клиента —</option></select></label>
            <label class="field"><span>Сумма</span><input type="number" id="dealAmount" min="0" placeholder="50000" required></label>
          </div>
          <label class="field"><span>Этап</span><select id="dealStage">${DEAL_STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}</select></label>
          <button type="submit" class="btn btn-primary">Добавить сделку</button>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">🚀 Воронка продаж</div><div class="card-sub">двигайте сделки по этапам кнопкой →</div></div></div>
      <div class="pipeline">
        ${DEAL_STAGES.map(st => {
          const items = d.deals.filter(x => x.stage === st.id);
          const sum = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
          return `<div class="pipe-col">
            <div class="pipe-head"><span class="pipe-dot" style="background:${st.color}"></span><span>${st.label}</span><span class="pipe-sum">${fmtMoney(sum)}</span></div>
            <div class="pipe-body">${items.length ? items.map(dealHTML).join('') : '<div class="pipe-empty">Пусто</div>'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
};

function clientHTML(c) {
  const deals = getData().deals.filter(x => x.clientId === c.id);
  const paid = deals.filter(x => x.stage === 'paid').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return `<div class="client-row">
    <div class="avatar" style="width:34px;height:34px;font-size:14px;">${esc((c.name || '?')[0]).toUpperCase()}</div>
    <div style="flex:1;min-width:0;">
      <div class="client-name">${esc(c.name)}</div>
      <div class="task-meta">${esc(c.phone || 'без телефона')} · сделок: ${deals.length}${paid ? ' · оплачено ' + fmtMoney(paid) : ''}</div>
    </div>
    <button class="icon-btn" data-action="delete-client" data-id="${c.id}" title="Удалить">🗑</button>
  </div>`;
}

function dealHTML(deal) {
  const d = getData();
  const client = d.clients.find(c => c.id === deal.clientId);
  const idx = DEAL_STAGES.findIndex(s => s.id === deal.stage);
  const next = DEAL_STAGES[idx + 1];
  return `<div class="deal">
    <div class="deal-top"><span class="deal-title">${esc(deal.title)}</span><button class="deal-del" data-action="delete-deal" data-id="${deal.id}" title="Удалить">✕</button></div>
    <div class="deal-amount">${fmtMoney(deal.amount)}</div>
    <div class="deal-client">${client ? esc(client.name) : 'Без клиента'}</div>
    ${next ? `<button class="btn btn-ghost btn-sm deal-next" data-action="deal-next" data-id="${deal.id}">${next.label} →</button>` : '<span class="badge green">✅ Оплачено</span>'}
  </div>`;
}

/* ---------- ОТЧЁТЫ (P&L + прогноз) ---------- */
let reportMonth = null;
RENDERERS.reports = function () {
  const d = getData();
  const months = [...new Set([...d.transactions.map(t => monthKey(t.date)), todayMonth()])].filter(Boolean).sort().reverse();
  const m = reportMonth && months.includes(reportMonth) ? reportMonth : months[0];
  reportMonth = m;
  const stats = reportStats(d, m);
  const prev = reportStats(d, prevMonthKey(m));
  const diff = prev.net !== 0 ? ((stats.net - prev.net) / Math.abs(prev.net)) * 100 : null;
  const forecast = forecastProfit(d);
  const cats = aggregateCats(d.transactions.filter(t => t.type === 'expense' && monthKey(t.date) === m));
  const maxCat = Math.max(1, ...cats.map(c => c.value));

  return `
  <div class="grid" style="gap:20px;">
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">📈 Отчёт о прибыли и убытках</div><div class="card-sub">${monthLabel(m)}</div></div>
        <div class="form-row" style="align-items:center;">
          <select id="reportMonthSelect" style="padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);color:var(--text);">
            ${months.map(mm => `<option value="${mm}" ${mm === m ? 'selected' : ''}>${monthLabel(mm)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" data-action="export-report" data-month="${m}">⬇ CSV</button>
          <button class="btn btn-ghost btn-sm" data-action="print-report">🖨 PDF</button>
        </div>
      </div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Выручка</div><div class="kpi-value">${fmtMoney(stats.income)}</div></div>
        <div class="kpi"><div class="kpi-label">Расходы</div><div class="kpi-value">${fmtMoney(stats.expense)}</div></div>
        <div class="kpi"><div class="kpi-label">Прибыль до налога</div><div class="kpi-value">${fmtMoney(stats.profit)}</div></div>
        <div class="kpi"><div class="kpi-label">Налог ${d.settings.taxRate}%</div><div class="kpi-value">${fmtMoney(stats.tax)}</div></div>
        <div class="kpi ${stats.net >= 0 ? 'positive' : 'negative'}"><div class="kpi-label">Чистая прибыль</div><div class="kpi-value">${fmtMoney(stats.net, '+')}</div></div>
        <div class="kpi"><div class="kpi-label">Динамика к прошлому</div><div class="kpi-value">${diff == null ? '—' : (diff >= 0 ? '+' : '') + diff.toFixed(0) + '%'}</div></div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Доходы и расходы по месяцам</div></div></div>
        <canvas id="reportBars" height="240"></canvas>
        ${legendHTML([{ label: 'Доход', color: '#10b981' }, { label: 'Расход', color: '#ef4444' }])}
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">Расходы по категориям</div></div></div>
        ${cats.length ? `<div class="cat-bars">${cats.sort((a, b) => b.value - a.value).map(c => `
          <div class="cat-bar-row">
            <div class="cat-bar-label"><span>${esc(c.label)}</span><b>${fmtMoney(c.value)}</b></div>
            <div class="progress"><div class="progress-fill" style="width:${c.value / maxCat * 100}%;background:${c.color};"></div></div>
          </div>`).join('')}</div>` : '<div class="empty"><div class="empty-ico">📊</div><p>Расходов за этот месяц нет</p></div>'}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div><div class="card-title">🔮 Прогноз</div></div></div>
        <div class="kpi-row" style="grid-template-columns:1fr 1fr;">
          <div class="kpi"><div class="kpi-label">Прогноз на следующий месяц</div><div class="kpi-value ${forecast >= 0 ? 'positive' : 'negative'}">${fmtMoney(forecast, '+')}</div></div>
          <div class="kpi"><div class="kpi-label">Средняя прибыль за 3 месяца</div><div class="kpi-value">${fmtMoney(avgNet3(d))}</div></div>
        </div>
        <p class="task-meta" style="margin-top:10px;">Прогноз считается по среднему значению за последние 3 месяца. Это ориентир, а не гарантия.</p>
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">Налоги</div></div></div>
        <label class="field" style="max-width:220px;"><span>Ставка налога, %</span>
          <input type="number" id="taxRateInput" min="0" max="60" step="0.5" value="${d.settings.taxRate}">
        </label>
        <button class="btn btn-primary btn-sm" data-action="save-tax" style="margin-top:10px;">Сохранить ставку</button>
        <p class="task-meta" style="margin-top:10px;">Налог считается с прибыли до налога. Для УСН «доходы» поставьте 6% и учитывайте особенности режима.</p>
      </div>
    </div>
  </div>`;
};

function monthLabel(m) {
  if (!m) return '';
  return new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
function prevMonthKey(m) {
  const parts = m.split('-').map(Number);
  const dt = new Date(parts[0], parts[1] - 2, 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}
function reportStats(d, m) {
  const tx = d.transactions.filter(t => monthKey(t.date) === m);
  const income = txSum(tx, 'income');
  const expense = txSum(tx, 'expense');
  const profit = income - expense;
  const tax = profit > 0 ? profit * (Number(d.settings.taxRate) || 0) / 100 : 0;
  return { income, expense, profit, tax, net: profit - tax };
}
function avgNet3(d) {
  const now = new Date();
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
    sum += reportStats(d, key).net;
  }
  return sum / 3;
}
function forecastProfit(d) { return avgNet3(d); }

/* ---------- ЗАДАЧИ ---------- */
RENDERERS.tasks = function () {
  const d = getData();
  const done = d.tasks.filter(t => t.done).length;
  const pct = d.tasks.length ? Math.round(done / d.tasks.length * 100) : 0;
  return `
  <div class="grid" style="gap:20px;">
    <div class="card">
      <div class="card-header"><div><div class="card-title">➕ Новая задача</div></div></div>
      <form id="taskForm" class="form-row">
        <label class="field" style="flex:3;min-width:180px;"><span>Задача</span><input type="text" id="taskTitle" placeholder="Что нужно сделать?" required></label>
        <label class="field" style="flex:1;min-width:120px;"><span>Приоритет</span>
          <select id="taskPriority"><option value="low">Низкий</option><option value="medium" selected>Средний</option><option value="high">Высокий</option></select></label>
        <label class="field" style="flex:1;min-width:140px;"><span>Срок</span><input type="date" id="taskDue" value="${todayISO()}"></label>
        <button type="submit" class="btn btn-primary">Добавить</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Прогресс</div><div class="card-sub">${done} из ${d.tasks.length} выполнено · ${pct}%</div></div>
        <div class="segmented" style="min-width:220px;">
          <button class="active" data-action="task-filter" data-f="all">Все</button>
          <button data-action="task-filter" data-f="active">Активные</button>
          <button data-action="task-filter" data-f="done">Готово</button>
        </div>
      </div>
      <div class="progress" style="height:12px;margin-bottom:16px;"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div id="taskList" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>
  </div>`;
};
let taskFilter = 'all';
function renderTaskList() {
  const d = getData();
  let list = d.tasks.slice();
  if (taskFilter === 'active') list = list.filter(t => !t.done);
  if (taskFilter === 'done') list = list.filter(t => t.done);
  const order = { high: 0, medium: 1, low: 2 };
  list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    return (order[a.priority] || 1) - (order[b.priority] || 1);
  });
  $('#taskList').innerHTML = list.length ? list.map(taskHTML).join('') : '<div class="empty"><div class="empty-ico">🗒</div><p>Задач нет</p></div>';
}

/* ---------- ЦЕЛИ ---------- */
RENDERERS.goals = function () {
  const d = getData();
  return `
  <div class="grid" style="gap:20px;">
    <div class="card">
      <div class="card-header"><div><div class="card-title">🎯 Новая финансовая цель</div></div></div>
      <form id="goalForm" class="form-row">
        <label class="field" style="flex:2;min-width:180px;"><span>Название цели</span><input type="text" id="goalTitle" placeholder="Накопить на…" required></label>
        <label class="field" style="flex:1;min-width:120px;"><span>Целевая сумма</span><input type="number" id="goalTarget" min="0" placeholder="100000" required></label>
        <label class="field" style="flex:1;min-width:140px;"><span>Срок</span><input type="date" id="goalDeadline" value="${todayISO()}"></label>
        <button type="submit" class="btn btn-primary">Добавить</button>
      </form>
    </div>
    <div class="grid grid-cards" id="goalList">
      ${d.goals.length ? d.goals.map(goalHTML).join('') : '<div class="empty" style="grid-column:1/-1;"><div class="empty-ico">🎯</div><p>Целей пока нет — добавьте первую!</p></div>'}
    </div>
  </div>`;
};
function goalHTML(g) {
  const target = Number(g.target) || 0;
  const saved = Math.min(Number(g.saved) || 0, target);
  const pct = target ? saved / target * 100 : 0;
  const days = g.deadline ? Math.max(0, Math.ceil((new Date(g.deadline + 'T00:00:00') - new Date()) / 86400000)) : null;
  const remaining = Math.max(0, target - saved);
  const perMonth = days != null ? (remaining / Math.max(1, days / 30)) : null;
  const reached = target > 0 && saved >= target;
  return `<div class="card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <div style="font-size:22px;">${reached ? '🏆' : '🎯'}</div>
      <div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:15px;">${esc(g.title)}</div>
      <div class="task-meta">${g.deadline ? 'до ' + fmtDate(g.deadline) : 'без срока'}${days != null ? ' · осталось ' + days + ' дн.' : ''}</div></div>
      <button class="icon-btn" data-action="delete-goal" data-id="${g.id}" title="Удалить">🗑</button>
    </div>
    <div class="progress" style="height:11px;"><div class="progress-fill ${reached ? 'green' : ''}" style="width:${Math.min(100, pct)}%;"></div></div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;color:var(--text-2);">
      <span>${fmtMoney(saved)} из ${fmtMoney(target)} (${pct.toFixed(0)}%)</span>
    </div>
    ${!reached && perMonth != null ? `<div class="task-meta" style="margin-top:4px;">Чтобы успеть: ≈ <b>${fmtMoney(perMonth)}</b> в месяц</div>` : ''}
    ${reached ? '<div class="badge green" style="margin-top:10px;">✅ Цель достигнута!</div>' : `
      <form class="form-row" data-goal-add="${g.id}" style="margin-top:12px;">
        <input type="number" min="0" placeholder="Сумма пополнения" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);">
        <button class="btn btn-green btn-sm">➕ Пополнить</button>
      </form>`}
  </div>`;
}

/* ---------- КАЛЕНДАРЬ ---------- */
RENDERERS.calendar = function () {
  const d = getData();
  const now = new Date();
  if (calState.year == null) { calState.year = now.getFullYear(); calState.month = now.getMonth(); }
  const cells = monthGrid(calState.year, calState.month);
  const monthTitle = new Date(calState.year, calState.month, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const dow = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  const dayEvents = d.events.filter(e => e.date === calState.selected).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  return `
  <div class="grid grid-2" style="grid-template-columns:2fr 1fr;align-items:start;">
    <div class="card">
      <div class="cal-head">
        <button class="icon-btn" data-action="cal-prev">‹</button>
        <div style="font-size:18px;font-weight:800;">${monthTitle}</div>
        <button class="icon-btn" data-action="cal-next">›</button>
      </div>
      <div class="cal-grid">
        ${dow.map(dd => `<div class="cal-dow">${dd}</div>`).join('')}
        ${cells.map(c => c == null
          ? '<div class="cal-day empty"></div>'
          : calDayHTML(c)).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">События</div>
        <div class="card-sub">${fmtDate(calState.selected)}</div></div>
        <button class="btn btn-primary btn-sm" data-action="add-event">➕ Событие</button></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${dayEvents.length ? dayEvents.map(e => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;">
            <div style="font-size:20px;">${e.emoji || '📅'}</div>
            <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:14px;">${esc(e.title)}</div>
            <div class="task-meta">${e.time ? '🕐 ' + esc(e.time) : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
            <button class="icon-btn" data-action="delete-event" data-id="${e.id}">🗑</button>
          </div>`).join('') : '<div class="empty"><div class="empty-ico">📭</div><p>На эту дату событий нет</p></div>'}
      </div>
    </div>
  </div>`;
};
function calDayHTML(day) {
  const iso = calState.year + '-' + String(calState.month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const evts = getData().events.filter(e => e.date === iso);
  const cls = ['cal-day'];
  if (iso === todayISO()) cls.push('today');
  if (iso === calState.selected) cls.push('selected');
  const shown = evts.slice(0, 2).map(e => `<div class="cal-evt">${esc(e.title)}</div>`).join('');
  const more = evts.length > 2 ? `<div class="cal-evt more">+${evts.length - 2}</div>` : '';
  const dot = evts.length ? '<span class="cal-dot"></span>' : '';
  return `<div class="${cls.join(' ')}" data-action="select-day" data-date="${iso}">
    <div class="cal-day-num">${day}${dot}</div>${shown}${more}
  </div>`;
}
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Пн = 0
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}

/* ---------- ИИ-АССИСТЕНТ ---------- */
RENDERERS.assistant = function () {
  const d = getData();
  const aiMode = d.settings.ai.mode;
  return `
  <div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar">🤖</div>
        <div><div style="font-weight:700;">ИИ-ассистент «Сейф»</div>
        <div class="task-meta">${aiMode === 'remote' ? '🌐 подключён к внешнему ИИ' : '⚡ локальный помощник (бесплатно, без интернета)'}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm" data-action="clear-chat">🧹 Очистить чат</button>
    </div>
    <div class="chat" style="padding:16px 20px;">
      <div class="chat-log" id="chatLog">${chatHTML(d)}</div>
      <div>
        <div class="chips" id="chatChips">
          ${['💰 Какой у меня баланс?', '📊 Доходы и расходы', '✅ Что мне сделать?', '🎯 Как мои цели?', '📅 Ближайшие события', '💡 Совет по продажам'].map(c => `<button class="chip" data-action="quick-chat" data-q="${esc(c)}">${c}</button>`).join('')}
        </div>
        <div class="chat-input-row">
          <input type="text" id="chatInput" placeholder="Спросите о финансах, задачах или продажах…" autocomplete="off">
          <button class="icon-btn" data-action="voice-chat" title="Голосовой ввод">🎙</button>
          <button class="btn btn-primary" data-action="send-chat">Отправить ➤</button>
        </div>
      </div>
    </div>
  </div>`;
};
function mdBold(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
function chatHTML(d) {
  if (!d.chat.length) {
    const first = d.profile.name || 'друг';
    return `<div class="msg bot"><div class="msg-label">🤖 Ассистент</div>Привет, <b>${esc(first)}</b>! Я ваш личный бизнес-консультант. Спросите меня о балансе, доходах, задачах, целях, событиях — или попросите совет по продажам. Могу даже посчитать прибыль прямо в чате.</div>`;
  }
  return d.chat.map(m =>
    `<div class="msg ${m.role}">${m.role === 'bot' ? '<div class="msg-label">🤖 Ассистент</div>' : ''}${mdBold(m.text)}</div>`
  ).join('');
}
function scrollChatBottom() {
  const el = $('#chatLog');
  if (el) el.scrollTop = el.scrollHeight;
}

/* ---------- НАСТРОЙКИ ---------- */
RENDERERS.settings = function () {
  const d = getData();
  const ai = d.settings.ai;
  return `
  <div class="grid grid-2" style="gap:20px;align-items:start;">
    <div class="card">
      <div class="card-header"><div><div class="card-title">👤 Профиль</div></div></div>
      <form id="profileForm" class="grid" style="gap:14px;">
        <label class="field"><span>Имя</span><input type="text" id="setName" value="${esc(d.profile.name)}"></label>
        <label class="field"><span>Компания / проект</span><input type="text" id="setCompany" value="${esc(d.profile.company)}" placeholder="Моя компания"></label>
        <label class="field"><span>Символ валюты</span>
          <select id="setCurrency">
            ${['₽', '$', '€', '₸', '₴', 'BYN'].map(c => `<option ${c === d.profile.currency ? 'selected' : ''}>${c}</option>`).join('')}
          </select></label>
        <button class="btn btn-primary">Сохранить</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">🎨 Оформление</div></div></div>
      <div class="form-grid">
        <div class="segmented" style="grid-column:1/-1;">
          <button class="${d.settings.theme !== 'dark' ? 'active' : ''}" data-action="set-theme" data-t="light">☀️ Светлая</button>
          <button class="${d.settings.theme === 'dark' ? 'active' : ''}" data-action="set-theme" data-t="dark">🌙 Тёмная</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">🤖 ИИ-агент</div><div class="card-sub">настройка связи с ИИ</div></div></div>
      <div class="grid" style="gap:14px;">
        <div class="segmented" style="grid-column:1/-1;">
          <button class="${ai.mode !== 'remote' ? 'active' : ''}" data-action="ai-mode" data-m="local">⚡ Локальный (бесплатно)</button>
          <button class="${ai.mode === 'remote' ? 'active' : ''}" data-action="ai-mode" data-m="remote">🌐 Внешний ИИ (API)</button>
        </div>
        <div id="aiRemoteFields" class="grid" style="gap:12px;grid-column:1/-1;${ai.mode !== 'remote' ? 'display:none;' : ''}">
          <label class="field"><span>Провайдер</span>
            <select id="aiProvider">
              <option value="openrouter" ${ai.provider === 'openrouter' ? 'selected' : ''}>OpenRouter (бесплатные модели)</option>
              <option value="openai" ${ai.provider === 'openai' ? 'selected' : ''}>OpenAI-совместимый (Groq и др.)</option>
            </select></label>
          <label class="field"><span>API-ключ</span><input type="password" id="aiKey" value="${esc(ai.apiKey)}" placeholder="sk-…"></label>
          <label class="field"><span>Модель</span><input type="text" id="aiModel" value="${esc(ai.model)}" placeholder="meta-llama/llama-3.1-8b-instruct:free"></label>
          <label class="field"><span>Базовый URL (для OpenAI-совместимых)</span><input type="text" id="aiBaseURL" value="${esc(ai.baseURL)}" placeholder="https://api.groq.com/openai/v1"></label>
          <p style="font-size:12px;color:var(--text-3);grid-column:1/-1;">💡 На OpenRouter есть бесплатные модели (суффикс «:free»). Без ключа работает локальный помощник — он отвечает по вашим данным офлайн.</p>
        </div>
        <button class="btn btn-primary" data-action="save-ai" style="grid-column:1/-1;">Сохранить настройки ИИ</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">🔔 Напоминания</div><div class="card-sub">события и просроченные задачи</div></div></div>
      <div class="grid" style="gap:10px;">
        <button class="btn btn-ghost" data-action="enable-notifications">${d.settings.notifications ? '✅ Напоминания включены' : '🔔 Включить напоминания'}</button>
        <button class="btn btn-ghost" data-action="test-notification">Отправить тестовое уведомление</button>
        <p class="task-meta">Браузер напомнит о событиях на сегодня и просроченных задачах. Работает, пока вкладка открыта.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">📱 Приложение на телефон</div><div class="card-sub">установка в один клик</div></div></div>
      <div class="grid" style="gap:10px;">
        <button class="btn btn-primary" data-action="install-pwa">📲 Установить приложение</button>
        <p class="task-meta">iPhone: «Поделиться» → «На экран Домой». Android/Chrome: меню → «Установить приложение». После установки «Мой Сейф» откроется как обычное приложение и будет работать офлайн.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div><div class="card-title">💾 Данные</div><div class="card-sub">резервное копирование</div></div></div>
      <div class="grid" style="gap:12px;">
        <button class="btn btn-ghost" data-action="export-json">⬇ Экспорт всех данных (JSON)</button>
        <label class="btn btn-ghost" style="cursor:pointer;">⬆ Импорт из JSON<input type="file" id="importFile" accept=".json" style="display:none;"></label>
        <button class="btn btn-danger" data-action="reset-data">♻ Сбросить данные аккаунта</button>
        <button class="btn btn-danger" data-action="delete-account">⛔ Удалить аккаунт</button>
      </div>
    </div>
  </div>`;
};

/* ============================================================
   7. ИИ — ЛОКАЛЬНЫЙ ПОМОЩНИК
   ============================================================ */
const SALES_TIPS = [
  '💡 Продавайте не товар, а выгоду: говорите клиенту, какую проблему решает продукт и что он получит в результате.',
  '💡 Используйте правило «3 варианта»: предлагайте базовую, среднюю и премиум-версию — чаще выбирают среднюю.',
  '💡 Задавайте открытые вопросы («Что для вас важнее всего?»), чтобы понять потребность, прежде чем предлагать.',
  '💡 Работайте с возражениями: «Дорого» → разбейте цену на выгоду во времени и окупаемость.',
  '💡 Ведите базу клиентов и напоминайте о себе: повторные продажи дают до 30% выручки.',
  '💡 Увеличивайте средний чек: предлагайте допродажи и комплекты («вместе выгоднее»).',
  '💡 Считайте конверсию: из скольких обращений выходит продажа. Рост конверсии на 1% часто выгоднее роста трафика.',
  '💡 Делайте оффер конкретным: цена + срок + выгода + гарантия. Размытое предложение не продаёт.'
];

function localReply(text, d) {
  const t = text.toLowerCase();
  const name = d.profile.name || 'друг';
  const inc = txSum(d.transactions, 'income');
  const exp = txSum(d.transactions, 'expense');
  const bal = inc - exp;
  const mInc = txSum(d.transactions.filter(x => inMonth(x, todayMonth())), 'income');
  const mExp = txSum(d.transactions.filter(x => inMonth(x, todayMonth())), 'expense');

  if (/(привет|здравств|добрый|хай|hello|hi|ку)/.test(t) && t.length < 40)
    return `Привет, ${name}! 👋 Чем помочь? Могу рассказать о балансе, доходах, задачах, целях, событиях — или дать совет по продажам.`;

  if (/(баланс|сколько денег|остаток|сколько у меня|свободных средств)/.test(t))
    return `Ваш баланс: **${fmtMoney(bal)}**.\n\n📈 Доходы всего: ${fmtMoney(inc)}\n📉 Расходы всего: ${fmtMoney(exp)}\n🗓 За этот месяц: +${fmtMoney(mInc)} доходов, −${fmtMoney(mExp)} расходов.`;

  if (/(доход|заработа|приход|выручк)/.test(t))
    return `📈 Доходы: за этот месяц — **${fmtMoney(mInc)}**, за всё время — **${fmtMoney(inc)}**.\nКрупнейшие категории: ${topCats(d, 'income')}`;

  if (/(расход|затрат|потрат|трат|уходит)/.test(t))
    return `📉 Расходы: за этот месяц — **${fmtMoney(mExp)}**, за всё время — **${fmtMoney(exp)}**.\nОсновные категории: ${topCats(d, 'expense')}`;

  if (/(задач|что мне сделать|список дел|дела|план на день|сделать)/.test(t)) {
    const active = d.tasks.filter(x => !x.done);
    const today = active.filter(x => x.due === todayISO());
    if (!active.length) return 'У вас нет активных задач — всё сделано! 🎉';
    const lines = active.slice(0, 6).map(x => `• ${x.title}${x.due ? ' (до ' + fmtDateShort(x.due) + ')' : ''}`).join('\n');
    return `У вас ${active.length} активных задач${today.length ? ', на сегодня: ' + today.length : ''}:\n${lines}`;
  }

  if (/(цел|коплю|накопить|мечт|откладыва)/.test(t)) {
    if (!d.goals.length) return 'Целей пока нет. Загляните в раздел «Цели» и добавьте первую — я помогу посчитать, сколько откладывать в месяц! 🎯';
    const lines = d.goals.map(g => {
      const target = Number(g.target) || 0, saved = Number(g.saved) || 0;
      const pct = target ? Math.round(saved / target * 100) : 0;
      return `• ${g.title}: ${fmtMoney(saved)} из ${fmtMoney(target)} (${pct}%)`;
    }).join('\n');
    return `Ваши цели:\n${lines}`;
  }

  if (/(календар|событи|встреч|планы|мероприят|напомни)/.test(t)) {
    const today = todayISO();
    const upcoming = d.events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    if (!upcoming.length) return 'Ближайших событий нет. Добавьте их в «Календаре» — и я напомню! 📅';
    const lines = upcoming.slice(0, 5).map(e => `• ${fmtDate(e.date)}${e.time ? ' в ' + e.time : ''} — ${e.title}`).join('\n');
    return `Ближайшие события:\n${lines}`;
  }

  if (/(совет|как увеличить продаж|продаж|маркетинг|клиент|привлеч|реклам|лид)/.test(t))
    return SALES_TIPS[Math.floor(Math.random() * SALES_TIPS.length)] + '\n\nХотите ещё совет — напишите «совет по продажам».';

  if (/(рассчитай|посчитай|прибыль|маржа|рентабель|наценк|калькул)/.test(t)) {
    const nums = parseNumbers(t);
    if (nums.length >= 2) {
      const revenue = nums[0];
      const costs = nums.slice(1).reduce((a, b) => a + b, 0);
      const profit = revenue - costs;
      const margin = revenue ? profit / revenue * 100 : 0;
      return `Считаю прибыль 📐\n• Выручка: ${fmtMoney(revenue)}\n• Затраты: ${fmtMoney(costs)}\n• Прибыль: **${fmtMoney(profit)}**\n• Маржа: ${margin.toFixed(1)}%\n\n${profit >= 0 ? '✅ Бизнес в плюсе.' : '⚠️ Убыток — проверьте цену или затраты.'}`;
    }
    const profit = mInc - mExp;
    return `В этом месяце прибыль: **${fmtMoney(profit)}** (доходы ${fmtMoney(mInc)} − расходы ${fmtMoney(mExp)}).\n\nДля точного расчёта зайдите в «Калькулятор прибыли» или напишите числа прямо здесь, например: «прибыль 500000 расход 350000».`;
  }

  if (/(что умеешь|помощь|команды|help|возможност)/.test(t))
    return `Я умею:\n• «баланс» — показать финансы\n• «доходы» / «расходы» — анализ\n• «задачи» — список дел\n• «цели» — прогресс накоплений\n• «события» — ближайшие встречи\n• «прибыль 500000 расход 350000» — посчитать в чате\n• «совет по продажам» — идеи для роста`;

  return `Я не совсем понял запрос 🤔, но могу помочь с этим:\n• «баланс» — финансовое состояние\n• «доходы» / «расходы»\n• «задачи», «цели», «события»\n• «прибыль 500000 расход 350000»\n• «совет по продажам»`;
}

function topCats(d, type) {
  const agg = {};
  d.transactions.filter(x => x.type === type).forEach(x => { agg[x.category] = (agg[x.category] || 0) + (Number(x.amount) || 0); });
  const sorted = Object.keys(agg).sort((a, b) => agg[b] - agg[a]).slice(0, 3);
  return sorted.length ? sorted.map(c => `${c} (${fmtMoney(agg[c])})`).join(', ') : 'пока нет данных';
}
function parseNumbers(text) {
  const m = text.replace(/\s+/g, '').match(/-?\d+(?:[.,]\d+)?/g);
  if (!m) return [];
  return m.map(x => parseFloat(x.replace(',', '.'))).filter(n => !isNaN(n));
}

/* ============================================================
   8. ИИ — ВНЕШНИЙ API (опционально, бесплатные модели)
   ============================================================ */
function buildSummary(d) {
  const bal = balanceOf(d.transactions);
  return `Пользователь: ${d.profile.name}. Бизнес: ${d.profile.company || '—'}. Баланс: ${fmtMoney(bal)}. ` +
    `Доходов: ${fmtMoney(txSum(d.transactions, 'income'))}, расходов: ${fmtMoney(txSum(d.transactions, 'expense'))}. ` +
    `Активных задач: ${d.tasks.filter(t => !t.done).length}. Целей: ${d.goals.length}. Событий: ${d.events.length}.`;
}
async function remoteReply(text) {
  const d = getData();
  const ai = d.settings.ai;
  const model = ai.model || (ai.provider === 'openrouter' ? 'meta-llama/llama-3.1-8b-instruct:free' : 'gpt-4o-mini');
  let url, headers;
  if (ai.provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { 'Authorization': 'Bearer ' + ai.apiKey, 'Content-Type': 'application/json' };
  } else {
    const base = (ai.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
    url = base + '/chat/completions';
    headers = { 'Authorization': 'Bearer ' + ai.apiKey, 'Content-Type': 'application/json' };
  }
  const messages = [
    { role: 'system', content: 'Ты — дружелюбный русскоязычный бизнес-ассистент и консультант по продажам приложения «Мой Сейф». Отвечай кратко и по делу. Контекст данных пользователя: ' + buildSummary(d) },
    ...d.chat.slice(-10).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: text }
  ];
  const resp = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 600 })
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error('HTTP ' + resp.status + (err ? ' — ' + err.slice(0, 200) : ''));
  }
  const json = await resp.json();
  return json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content.trim()
    : 'Пустой ответ от модели.';
}

/* ============================================================
   9. ЧАТ-ОБРАБОТКА
   ============================================================ */
async function handleChat(text) {
  const d = getData();
  d.chat.push({ role: 'user', text });
  saveData(d);
  renderChat();
  const typing = document.createElement('div');
  typing.className = 'msg bot'; typing.id = 'typingMsg';
  typing.textContent = 'Печатаю…';
  const log = $('#chatLog');
  log.appendChild(typing);
  scrollChatBottom();

  let reply;
  try {
    if (d.settings.ai.mode === 'remote' && d.settings.ai.apiKey) {
      reply = await remoteReply(text);
    } else {
      await new Promise(r => setTimeout(r, 450));
      reply = localReply(text, d);
    }
  } catch (e) {
    reply = '⚠️ Не удалось связаться с внешним ИИ (' + e.message + '). Отвечаю локально:\n\n' + localReply(text, d);
  }
  typing.remove();
  const dd = getData();
  dd.chat.push({ role: 'bot', text: reply });
  saveData(dd);
  renderChat();
}
function renderChat() {
  const d = getData();
  const log = $('#chatLog');
  if (log) { log.innerHTML = chatHTML(d); scrollChatBottom(); }
}
function clearChat() {
  const d = getData();
  d.chat = [];
  saveData(d);
  renderChat();
  toast('Чат очищен');
}

/* ============================================================
   10. ПРИВЯЗКА СОБЫТИЙ ПО ВИДАМ
   ============================================================ */
const BINDERS = {};

BINDERS.dashboard = function () {
  const d = getData();
  drawBars($('#dashBars'), monthLabels(), [{ label: 'Доход', values: monthIncs(), color: '#10b981' }, { label: 'Расход', values: monthExps(), color: '#ef4444' }]);
  const expThisMonth = d.transactions.filter(t => t.type === 'expense' && inMonth(t, todayMonth()));
  const catAgg = {};
  expThisMonth.forEach(t => { catAgg[t.category] = (catAgg[t.category] || 0) + (Number(t.amount) || 0); });
  const donutSegs = Object.keys(catAgg).map((c, i) => ({ label: c, value: catAgg[c], color: PALETTE[i % PALETTE.length] }));
  if (donutSegs.length && $('#dashDonut')) drawDonut($('#dashDonut'), donutSegs, fmtMoney(donutSegs.reduce((s, x) => s + x.value, 0)), 'расходы');
};
function monthLabels() {
  const now = new Date(); const arr = [];
  for (let i = 5; i >= 0; i--) { const dt = new Date(now.getFullYear(), now.getMonth() - i, 1); arr.push(dt.toLocaleDateString('ru-RU', { month: 'short' })); }
  return arr;
}
function monthKeys6() {
  const now = new Date(); const arr = [];
  for (let i = 5; i >= 0; i--) { const dt = new Date(now.getFullYear(), now.getMonth() - i, 1); arr.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')); }
  return arr;
}
function monthIncs() { const d = getData(); return monthKeys6().map(m => txSum(d.transactions.filter(t => inMonth(t, m)), 'income')); }
function monthExps() { const d = getData(); return monthKeys6().map(m => txSum(d.transactions.filter(t => inMonth(t, m)), 'expense')); }

BINDERS.calculator = function () {};
function readCalcInputs() {
  if (calcMode === 'revenue') {
    return { revenue: $('#inRevenue').value, variableCosts: $('#inVariable').value, fixedCosts: $('#inFixed').value, taxRate: $('#inTax').value };
  }
  const price = Number($('#inPrice').value) || 0;
  const unitCost = Number($('#inUnitCost').value) || 0;
  const qty = Number($('#inQty').value) || 0;
  return { revenue: price * qty, variableCosts: unitCost * qty, fixedCosts: $('#inFixed').value, taxRate: $('#inTax').value };
}
function runCalc() {
  const k = calcProfit(readCalcInputs());
  applyCalcResult(k);
  window._lastCalc = k;
  return k;
}
function applyCalcResult(k) {
  const box = $('#calcResult');
  box.innerHTML = calcResultHTML(k);
  if (!k) return;
  drawDonut($('#calcDonut'), [
    { label: 'Переменные', value: k.variable, color: '#f59e0b' },
    { label: 'Постоянные', value: k.fixed, color: '#3b82f6' },
    { label: 'Налог', value: k.tax, color: '#ef4444' },
    { label: 'Прибыль', value: Math.max(0, k.net), color: '#10b981' }
  ], fmtMoney(k.net), 'чистая прибыль');
  drawBars($('#calcBars'), ['Выручка', 'Затраты'], [
    { label: 'Выручка', values: [k.revenue, 0], color: '#10b981' },
    { label: 'Затраты', values: [0, k.totalCosts], color: '#ef4444' }
  ]);
}
function saveCalc() {
  const k = calcProfit(readCalcInputs());
  const d = getData();
  d.calculations.push({ id: uid(), date: todayISO(), kpis: k });
  saveData(d);
  toast('Расчёт сохранён в историю');
  navigate('calculator');
}

BINDERS.finance = function () {
  $('#finMonthFilter').value = financeFilter.month;
  $('#finTypeFilter').value = financeFilter.type;
  $('#finSearch').value = financeFilter.q;
  renderFinanceData();
};

BINDERS.tasks = function () { renderTaskList(); };

BINDERS.clients = function () {};

BINDERS.reports = function () {
  const d = getData();
  const keys = monthKeys6();
  drawBars($('#reportBars'), keys.map(k => monthLabel(k).split(' ')[0]), [
    { label: 'Доход', values: keys.map(k => reportStats(d, k).income), color: '#10b981' },
    { label: 'Расход', values: keys.map(k => reportStats(d, k).expense), color: '#ef4444' }
  ]);
};

BINDERS.goals = function () {};

BINDERS.calendar = function () {};

BINDERS.assistant = function () {};

BINDERS.settings = function () {};

/* ============================================================
   11. ГЛОБАЛЬНАЯ ДЕЛЕГАЦИЯ СОБЫТИЙ
   ============================================================ */
document.addEventListener('click', function (e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const d = getData();

  switch (action) {
    case 'goto': navigate(actionEl.dataset.goto); break;

    case 'calc-mode': calcMode = actionEl.dataset.mode; navigate('calculator'); break;
    case 'run-calc': runCalc(); toast('Расчёт выполнен'); break;
    case 'save-calc': saveCalc(); break;
    case 'delete-calc': {
      const id = actionEl.dataset.id;
      d.calculations = d.calculations.filter(c => c.id !== id);
      saveData(d); navigate('calculator'); break;
    }

    case 'tx-type': {
      const type = actionEl.dataset.type;
      $$('#txForm .segmented button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
      const sel = $('#txCategory');
      sel.innerHTML = (type === 'income' ? INCOME_CATS : EXPENSE_CATS).map(c => `<option>${c}</option>`).join('');
      sel.dataset.type = type;
      break;
    }

    case 'export-csv': exportCSV(); break;
    case 'import-csv': { const f = $('#csvFile'); if (f) f.click(); break; }
    case 'delete-recurring': {
      d.recurrings = d.recurrings.filter(x => x.id !== actionEl.dataset.id);
      saveData(d); navigate('finance'); break;
    }
    case 'install-pwa': installPWA(); break;
    case 'delete-tx': {
      const id = actionEl.dataset.id;
      d.transactions = d.transactions.filter(t => t.id !== id);
      saveData(d); renderFinanceData(); toast('Операция удалена'); break;
    }

    case 'toggle-task': {
      const id = actionEl.dataset.id;
      const t = d.tasks.find(x => x.id === id);
      if (t) {
        t.done = !t.done;
        saveData(d);
        if (currentView === 'tasks') renderTaskList(); else navigate(currentView);
      }
      break;
    }
    case 'delete-task': {
      d.tasks = d.tasks.filter(x => x.id !== actionEl.dataset.id);
      saveData(d);
      if (currentView === 'tasks') renderTaskList(); else navigate(currentView);
      break;
    }
    case 'task-filter': {
      taskFilter = actionEl.dataset.f;
      $$('.segmented button[data-action="task-filter"]').forEach(b => b.classList.toggle('active', b === actionEl));
      renderTaskList(); break;
    }

    case 'delete-goal': {
      d.goals = d.goals.filter(g => g.id !== actionEl.dataset.id);
      saveData(d); navigate('goals'); break;
    }

    case 'cal-prev': calState.month--; if (calState.month < 0) { calState.month = 11; calState.year--; } navigate('calendar'); break;
    case 'cal-next': calState.month++; if (calState.month > 11) { calState.month = 0; calState.year++; } navigate('calendar'); break;
    case 'select-day': calState.selected = actionEl.dataset.date; navigate('calendar'); break;
    case 'add-event': openEventModal(calState.selected); break;
    case 'delete-event': {
      d.events = d.events.filter(x => x.id !== actionEl.dataset.id);
      saveData(d); navigate('calendar'); break;
    }

    case 'quick-chat': $('#chatInput').value = actionEl.dataset.q; sendChat(); break;
    case 'send-chat': sendChat(); break;
    case 'clear-chat': clearChat(); break;

    case 'set-theme': setTheme(actionEl.dataset.t); navigate('settings'); break;
    case 'ai-mode': {
      d.settings.ai.mode = actionEl.dataset.m;
      saveData(d); navigate('settings'); break;
    }
    case 'save-ai': saveAiSettings(); break;
    case 'deal-next': {
      const deal = d.deals.find(x => x.id === actionEl.dataset.id);
      if (deal) {
        const idx = DEAL_STAGES.findIndex(s => s.id === deal.stage);
        if (idx >= 0 && idx < DEAL_STAGES.length - 1) {
          deal.stage = DEAL_STAGES[idx + 1].id;
          saveData(d);
          navigate('clients');
          if (deal.stage === 'paid') toast('Сделка оплачена ✅');
        }
      }
      break;
    }
    case 'delete-deal': {
      d.deals = d.deals.filter(x => x.id !== actionEl.dataset.id);
      saveData(d); navigate('clients'); break;
    }
    case 'delete-client': {
      const cid = actionEl.dataset.id;
      d.clients = d.clients.filter(x => x.id !== cid);
      d.deals.forEach(x => { if (x.clientId === cid) x.clientId = ''; });
      saveData(d); navigate('clients'); break;
    }
    case 'export-report': exportReportCSV(actionEl.dataset.month); break;
    case 'print-report': window.print(); break;
    case 'save-tax': {
      const v = Number($('#taxRateInput').value);
      d.settings.taxRate = isNaN(v) ? 6 : Math.max(0, Math.min(60, v));
      saveData(d); navigate('reports');
      toast('Ставка налога сохранена'); break;
    }
    case 'voice-chat': startVoice(); break;
    case 'enable-notifications': enableNotifications(); break;
    case 'test-notification': testNotification(); break;
    case 'export-json': exportJSON(); break;
    case 'reset-data': resetData(); break;
    case 'delete-account': deleteAccount(); break;
  }
});

function sendChat() {
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  handleChat(text);
}

/* ============================================================
   12. ФОРМЫ (submit)
   ============================================================ */
document.addEventListener('submit', function (e) {
  const form = e.target;
  const d = getData();
  if (!d) return;

  if (form.id === 'txForm') {
    e.preventDefault();
    const amount = Number($('#txAmount').value);
    if (!amount || amount <= 0) { toast('Введите корректную сумму'); return; }
    const type = ($('#txCategory').dataset.type || 'income');
    const category = $('#txCategory').value;
    const txDate = $('#txDate').value || todayISO();
    const note = $('#txNote').value.trim();
    const recurring = !!($('#txRecurring') && $('#txRecurring').checked);
    d.transactions.push({ id: uid(), type, amount, category, date: txDate, note });
    if (recurring) {
      const day = Number(txDate.slice(8, 10)) || 1;
      d.recurrings.push({ id: uid(), type, amount, category, note, day, lastRun: todayMonth() });
    }
    saveData(d);
    form.reset();
    $('#txDate').value = todayISO();
    $('#txCategory').dataset.type = 'income';
    $$('#txForm .segmented button').forEach(b => b.classList.toggle('active', b.dataset.type === 'income'));
    $('#txCategory').innerHTML = INCOME_CATS.map(c => `<option>${c}</option>`).join('');
    renderFinanceData();
    toast(recurring ? 'Операция добавлена, будет повторяться 🔁' : 'Операция добавлена ✅');
  }

  if (form.id === 'taskForm') {
    e.preventDefault();
    const title = $('#taskTitle').value.trim();
    if (!title) return;
    d.tasks.push({ id: uid(), title, priority: $('#taskPriority').value, due: $('#taskDue').value, done: false });
    saveData(d);
    form.reset();
    $('#taskDue').value = todayISO();
    renderTaskList();
    toast('Задача добавлена ✅');
  }

  if (form.id === 'goalForm') {
    e.preventDefault();
    const title = $('#goalTitle').value.trim();
    const target = Number($('#goalTarget').value);
    if (!title || !target || target <= 0) { toast('Укажите название и сумму'); return; }
    d.goals.push({ id: uid(), title, target, saved: 0, deadline: $('#goalDeadline').value });
    saveData(d);
    navigate('goals');
    toast('Цель добавлена 🎯');
  }

  if (form.dataset.goalAdd) {
    e.preventDefault();
    const id = form.dataset.goalAdd;
    const amount = Number(form.querySelector('input').value);
    const g = d.goals.find(x => x.id === id);
    if (g && amount > 0) {
      g.saved = (Number(g.saved) || 0) + amount;
      saveData(d);
      navigate('goals');
      toast('Цель пополнена: ' + fmtMoney(amount));
    }
  }

  if (form.id === 'clientForm') {
    e.preventDefault();
    const name = $('#clientName').value.trim();
    if (!name) return;
    d.clients.push({ id: uid(), name, phone: $('#clientPhone').value.trim(), created: todayISO() });
    saveData(d);
    navigate('clients');
    toast('Клиент добавлен 👥');
  }

  if (form.id === 'dealForm') {
    e.preventDefault();
    const title = $('#dealTitle').value.trim();
    const amount = Number($('#dealAmount').value);
    if (!title || !amount || amount <= 0) { toast('Укажите название и сумму сделки'); return; }
    d.deals.push({ id: uid(), title, amount, clientId: $('#dealClient').value, stage: $('#dealStage').value, created: todayISO() });
    saveData(d);
    navigate('clients');
    toast('Сделка добавлена 💼');
  }

  if (form.id === 'profileForm') {
    e.preventDefault();
    d.profile.name = $('#setName').value.trim() || d.profile.name;
    d.profile.company = $('#setCompany').value.trim();
    d.profile.currency = $('#setCurrency').value;
    saveData(d);
    updateSidebarUser();
    toast('Профиль сохранён ✅');
    navigate('settings');
  }
});

/* ============================================================
   13. МОДАЛКА (событие календаря)
   ============================================================ */
const EVENT_EMOJIS = ['📅', '🤝', '📞', '🚚', '✈️', '🎂', '💼', '📣', '🏦', '📝'];
function openEventModal(date) {
  $('#modalContent').innerHTML = `
    <div class="modal-title">Событие на ${fmtDate(date)}</div>
    <form id="eventForm" class="grid" style="gap:12px;">
      <label class="field"><span>Название</span><input type="text" id="evTitle" placeholder="Встреча с клиентом" required></label>
      <div class="form-grid">
        <label class="field"><span>Время</span><input type="time" id="evTime"></label>
        <label class="field"><span>Эмодзи</span><select id="evEmoji">${EVENT_EMOJIS.map(e => `<option>${e}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Заметка</span><textarea id="evNote" rows="2" placeholder="необязательно"></textarea></label>
      <input type="hidden" id="evDate" value="${date}">
      <div style="display:flex;gap:10px;">
        <button type="submit" class="btn btn-primary" style="flex:1;">Сохранить</button>
        <button type="button" class="btn btn-ghost" data-close-modal>Отмена</button>
      </div>
    </form>`;
  openModal();
  $('#eventForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const d = getData();
    d.events.push({ id: uid(), title: $('#evTitle').value.trim(), date: $('#evDate').value, time: $('#evTime').value, note: $('#evNote').value.trim(), emoji: $('#evEmoji').value });
    saveData(d);
    closeModal();
    navigate('calendar');
    toast('Событие добавлено 📅');
  });
}
function openModal() { $('#modalRoot').classList.remove('hidden'); }
function closeModal() { $('#modalRoot').classList.add('hidden'); $('#modalContent').innerHTML = ''; }
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-close-modal]')) closeModal();
});

/* ============================================================
   14. ДАННЫЕ: ЭКСПОРТ / ИМПОРТ / СБРОС / УДАЛЕНИЕ
   ============================================================ */
function applyRecurrings() {
  const d = getData();
  if (!d || !d.recurrings.length) return;
  const now = new Date();
  const key = todayMonth();
  let changed = false;
  d.recurrings.forEach(r => {
    if (r.lastRun === key) return;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = Math.min(Math.max(1, Number(r.day) || 1), daysInMonth);
    const target = new Date(now.getFullYear(), now.getMonth(), day);
    if (now >= target) {
      const iso = target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0');
      d.transactions.push({
        id: uid(), type: r.type, amount: Number(r.amount) || 0, category: r.category,
        date: iso, note: (r.note ? r.note + ' · ' : '') + 'авто-повтор'
      });
      r.lastRun = key;
      changed = true;
    }
  });
  if (changed) saveData(d);
}

function parseAmount(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, '').replace(/[₽$€]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}
function normalizeDate(s) {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  return null;
}
function importCSVText(text) {
  const d = getData();
  if (!d || !text) return 0;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const sep = lines[0].includes(';') ? ';' : ',';
  let added = 0;
  lines.forEach((line, i) => {
    const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /дата|date/i.test(cols[0])) return;
    if (cols.length < 3) return;
    const date = normalizeDate(cols[0]);
    if (!date) return;
    const typeRaw = (cols[1] || '').toLowerCase();
    const type = /доход|income|приход|\+/.test(typeRaw) ? 'income' : 'expense';
    const a2 = parseAmount(cols[2]);
    const a3 = parseAmount(cols[3]);
    let amount = null, category = '';
    if (a2 != null) { amount = a2; category = cols[3] || ''; }
    else if (a3 != null) { amount = a3; category = cols[2] || ''; }
    if (amount == null || amount <= 0) return;
    if (!category) category = type === 'income' ? 'Продажи' : 'Прочее';
    d.transactions.push({ id: uid(), type, amount, category, date, note: cols[4] || '' });
    added++;
  });
  if (added) saveData(d);
  return added;
}

function exportReportCSV(month) {
  const d = getData();
  const m = month || reportMonth || todayMonth();
  const s = reportStats(d, m);
  const rows = [];
  rows.push('Отчёт;' + monthLabel(m));
  rows.push('Выручка;' + s.income);
  rows.push('Расходы;' + s.expense);
  rows.push('Прибыль до налога;' + s.profit);
  rows.push('Налог;' + s.tax);
  rows.push('Чистая прибыль;' + s.net);
  rows.push('');
  rows.push('Дата;Тип;Категория;Сумма;Комментарий');
  d.transactions.filter(t => monthKey(t.date) === m).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .forEach(t => rows.push([t.date, t.type === 'income' ? 'Доход' : 'Расход', t.category, t.amount, t.note || ''].join(';')));
  download('moi-seif-report-' + m + '.csv', '\ufeff' + rows.join('\n'), 'text/csv');
  toast('Отчёт экспортирован ⬇');
}

function insightsHTML(d) {
  const items = [];
  const m = todayMonth();
  const cur = reportStats(d, m);
  const prev = reportStats(d, prevMonthKey(m));
  if (cur.expense > 0 && prev.expense > 0 && cur.expense > prev.expense * 1.15) {
    items.push({ ico: '⚠️', text: 'Расходы выросли на ' + Math.round((cur.expense / prev.expense - 1) * 100) + '% к прошлому месяцу.' });
  }
  const marketing = d.transactions.filter(t => t.type === 'expense' && t.category === 'Маркетинг' && monthKey(t.date) === m)
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  if (cur.expense > 0 && marketing / cur.expense > 0.25) {
    items.push({ ico: '📣', text: 'Маркетинг — ' + Math.round(marketing / cur.expense * 100) + '% расходов. Проверьте окупаемость.' });
  }
  const overdue = d.tasks.filter(t => !t.done && t.due && t.due < todayISO()).length;
  if (overdue) items.push({ ico: '⏰', text: 'Просрочено задач: ' + overdue + '. Загляните в «Задачи».' });
  if (!d.transactions.length) items.push({ ico: '🚀', text: 'Добавьте первую операцию — или нажмите «Демо», чтобы увидеть всё сразу.' });
  if (cur.net > 0) items.push({ ico: '✅', text: 'Чистая прибыль за месяц: ' + fmtMoney(cur.net) + '. Так держать!' });
  else if (cur.net < 0) items.push({ ico: '📉', text: 'Месяц в минусе: ' + fmtMoney(cur.net) + '. Проверьте крупные расходы.' });
  if (!items.length) return '';
  return `<div class="card insights-card">
    <div class="card-header"><div><div class="card-title">💡 Подсказки</div><div class="card-sub">на основе ваших данных</div></div></div>
    <div class="insights">${items.slice(0, 3).map(i => `<div class="insight"><span class="insight-ico">${i.ico}</span><span>${esc(i.text)}</span></div>`).join('')}</div>
  </div>`;
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredPrompt = e;
});
function installPWA() {
  if (!deferredPrompt) {
    toast('На телефоне: «Поделиться» → «На экран Домой» (iPhone) или меню → «Установить»');
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt = null;
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Голосовой ввод не поддерживается этим браузером'); return; }
  const rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  const btn = document.querySelector('[data-action="voice-chat"]');
  if (btn) btn.textContent = '🔴';
  rec.onresult = function (e) {
    const text = e.results[0][0].transcript;
    const inp = $('#chatInput');
    if (inp) { inp.value = text; sendChat(); }
  };
  rec.onerror = function () { toast('Не удалось распознать голос'); };
  rec.onend = function () { if (btn) btn.textContent = '🎙'; };
  try { rec.start(); toast('Говорите…'); }
  catch (e) { toast('Микрофон недоступен'); }
}

function enableNotifications() {
  if (!('Notification' in window)) { toast('Уведомления не поддерживаются'); return; }
  Notification.requestPermission().then(function (p) {
    const d = getData();
    d.settings.notifications = p === 'granted';
    saveData(d);
    navigate('settings');
    toast(p === 'granted' ? 'Напоминания включены 🔔' : 'Разрешение не выдано');
  });
}
function testNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') { toast('Сначала включите напоминания'); return; }
  new Notification('Мой Сейф', { body: 'Напоминания работают! Здесь будут события и дедлайны.' });
  toast('Тестовое уведомление отправлено');
}
function checkNotifications() {
  const d = getData();
  if (!d || !d.settings.notifications) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayISO();
  const flag = 'moiseif.notified.' + currentUsername() + '.' + today;
  if (localStorage.getItem(flag)) return;
  const todays = d.events.filter(e => e.date === today);
  const overdue = d.tasks.filter(t => !t.done && t.due && t.due < today);
  if (!todays.length && !overdue.length) return;
  const parts = [];
  if (todays.length) parts.push('Сегодня событий: ' + todays.length + '.');
  if (overdue.length) parts.push('Просрочено задач: ' + overdue.length + '.');
  new Notification('Мой Сейф — напоминание', { body: parts.join(' ') });
  localStorage.setItem(flag, '1');
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(function () {});
}

function exportCSV() {
  const d = getData();
  const rows = d.transactions.map(t => [t.date, t.type === 'income' ? 'Доход' : 'Расход', t.category, t.amount, t.note || ''].join(';'));
  download('moi-seif-finances.csv', '\ufeff' + ['Дата;Тип;Категория;Сумма;Комментарий'].concat(rows).join('\n'), 'text/csv');
  toast('CSV экспортирован ⬇');
}
function exportJSON() {
  const d = getData();
  download('moi-seif-backup.json', JSON.stringify(d, null, 2), 'application/json');
  toast('Резервная копия скачана ⬇');
}
function resetData() {
  if (!confirm('Сбросить все данные аккаунта (транзакции, задачи, цели, события)? Это действие необратимо.')) return;
  const name = getData().profile.name;
  localStorage.setItem(LS_DATA + currentUsername(), JSON.stringify(defaultData(name)));
  navigate(currentView);
  toast('Данные сброшены');
}
function deleteAccount() {
  if (!confirm('Удалить аккаунт и все данные безвозвратно?')) return;
  const users = loadUsers();
  delete users[currentUsername()];
  saveUsers(users);
  localStorage.removeItem(LS_DATA + currentUsername());
  localStorage.removeItem(LS_SESSION);
  showAuth();
  toast('Аккаунт удалён');
}

/* ============================================================
   15. ТЕМА
   ============================================================ */
function setTheme(theme) {
  const d = getData();
  d.settings.theme = theme;
  saveData(d);
  applyTheme(theme);
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  if (currentView && RENDERERS[currentView]) {
    // перерисовать активный вид для обновления цветов графиков
    navigate(currentView);
  }
}

/* ============================================================
   16. АВТОРИЗАЦИЯ UI
   ============================================================ */
function showAuth() {
  $('#app').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  $('#loginError').textContent = '';
  $('#registerError').textContent = '';
  $('#loginUser').value = '';
  $('#loginPass').value = '';
}
function enterApp() {
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  applyRecurrings();
  const d = getData();
  applyTheme(d.settings.theme || 'light');
  updateSidebarUser();
  $('#todayDate').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  navigate('dashboard');
  setTimeout(checkNotifications, 1200);
  registerSW();
}
function updateSidebarUser() {
  const d = getData();
  const name = d.profile.name || currentUsername() || 'Пользователь';
  $('#sidebarUserName').textContent = name;
  $('#sidebarAvatar').textContent = (name[0] || 'П').toUpperCase();
  $('#sidebarCompany').textContent = d.profile.company || 'Личный кабинет';
}

function initAuth() {
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const err = login($('#loginUser').value, $('#loginPass').value);
    if (err) { $('#loginError').textContent = err; return; }
    $('#loginError').textContent = '';
    enterApp();
    toast('Добро пожаловать!');
  });
  $('#registerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const err = register($('#regName').value, $('#regUser').value, $('#regPass').value);
    if (err) { $('#registerError').textContent = err; return; }
    $('#registerError').textContent = '';
    enterApp();
    toast('Аккаунт создан 🎉');
  });
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      $$('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.authtab === 'login';
      $('#loginForm').classList.toggle('hidden', !isLogin);
      $('#registerForm').classList.toggle('hidden', isLogin);
    });
  });
  const demoBtn = $('#demoBtn');
  if (demoBtn) demoBtn.addEventListener('click', function () { enterDemo('dashboard'); });
}

/* ============================================================
   16b. ДЕМО-РЕЖИМ (пример данных для защиты проекта)
   ============================================================ */
function dISO(offsetDays) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function monthISO(monthsAgo, day) {
  const now = new Date();
  const dt = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function seedDemoData() {
  const data = defaultData('Алексей');
  data.profile.company = 'Кофейня «Бодрость»';

  const tx = [];
  for (let m = 4; m >= 0; m--) {
    const k = 0.9 + ((m * 37) % 21) / 100; // детерминированный разброс
    tx.push({ id: uid(), type: 'income', amount: Math.round(420000 * k), category: 'Продажи', date: monthISO(m, 5), note: 'Выручка за месяц' });
    tx.push({ id: uid(), type: 'income', amount: Math.round(58000 * k), category: 'Услуги', date: monthISO(m, 14), note: 'Кофе-кейтеринг' });
    tx.push({ id: uid(), type: 'expense', amount: Math.round(138000 * k), category: 'Закупки', date: monthISO(m, 3), note: 'Зерно, молоко, сиропы' });
    tx.push({ id: uid(), type: 'expense', amount: 60000, category: 'Аренда', date: monthISO(m, 1), note: 'Помещение 45 м²' });
    tx.push({ id: uid(), type: 'expense', amount: 152000, category: 'Зарплата', date: monthISO(m, 28), note: 'Бариста и менеджер' });
    tx.push({ id: uid(), type: 'expense', amount: Math.round(34000 * k), category: 'Маркетинг', date: monthISO(m, 16), note: 'Соцсети и акции' });
    tx.push({ id: uid(), type: 'expense', amount: Math.round(27000 * k), category: 'Налоги', date: monthISO(m, 20), note: 'УСН 6%' });
  }
  data.transactions = tx;

  data.tasks = [
    { id: uid(), title: 'Согласовать меню на декабрь', priority: 'high', due: dISO(0), done: false },
    { id: uid(), title: 'Заказать зерно у поставщика', priority: 'medium', due: dISO(1), done: false },
    { id: uid(), title: 'Запустить акцию «2 кофе по цене 1»', priority: 'high', due: dISO(3), done: false },
    { id: uid(), title: 'Оплатить аренду помещения', priority: 'medium', due: dISO(-2), done: false },
    { id: uid(), title: 'Обновить сайт кофейни', priority: 'low', due: dISO(7), done: false },
    { id: uid(), title: 'Провести инвентаризацию', priority: 'low', due: dISO(-5), done: true }
  ];

  data.goals = [
    { id: uid(), title: 'Новое кофейное оборудование', target: 300000, saved: 120000, deadline: dISO(120) },
    { id: uid(), title: 'Резервный фонд (3 месяца)', target: 600000, saved: 250000, deadline: dISO(240) },
    { id: uid(), title: 'Ремонт зоны отдыха', target: 150000, saved: 150000, deadline: dISO(-10) }
  ];

  data.events = [
    { id: uid(), title: 'Встреча с поставщиком зерна', date: dISO(0), time: '11:00', note: 'обсудить скидку', emoji: '🤝' },
    { id: uid(), title: 'Созвон с маркетологом', date: dISO(0), time: '16:30', note: '', emoji: '📞' },
    { id: uid(), title: 'Дегустация нового меню', date: dISO(2), time: '14:00', note: '', emoji: '📝' },
    { id: uid(), title: 'Оплата аренды', date: dISO(5), time: '', note: '', emoji: '🏦' },
    { id: uid(), title: 'Ярмарка кофе', date: dISO(9), time: '10:00', note: 'стенд №12', emoji: '📣' }
  ];

  const cl1 = { id: uid(), name: 'ООО «Ромашка»', phone: '+7 900 111-22-33', created: todayISO() };
  const cl2 = { id: uid(), name: 'Иван Петров', phone: '+7 900 222-33-44', created: todayISO() };
  const cl3 = { id: uid(), name: 'Кафе «Утро»', phone: '+7 900 333-44-55', created: todayISO() };
  data.clients = [cl1, cl2, cl3];
  data.deals = [
    { id: uid(), title: 'Поставка зерна, 50 кг', amount: 85000, clientId: cl1.id, stage: 'paid', created: todayISO() },
    { id: uid(), title: 'Кофейня под ключ', amount: 240000, clientId: cl2.id, stage: 'offer', created: todayISO() },
    { id: uid(), title: 'Ежемесячное обслуживание', amount: 60000, clientId: cl3.id, stage: 'negotiation', created: todayISO() },
    { id: uid(), title: 'Дегустация для офиса', amount: 15000, clientId: cl2.id, stage: 'new', created: todayISO() },
    { id: uid(), title: 'Поставка сиропов', amount: 32000, clientId: cl3.id, stage: 'paid', created: todayISO() }
  ];
  data.recurrings = [
    { id: uid(), type: 'expense', amount: 60000, category: 'Аренда', note: 'Помещение', day: 1, lastRun: todayMonth() },
    { id: uid(), type: 'expense', amount: 152000, category: 'Зарплата', note: 'Команда', day: 28, lastRun: todayMonth() }
  ];

  data.calculations = [
    { id: uid(), date: dISO(-3), kpis: calcProfit({ revenue: 480000, variableCosts: 190000, fixedCosts: 240000, taxRate: 6 }) },
    { id: uid(), date: dISO(-10), kpis: calcProfit({ revenue: 520000, variableCosts: 210000, fixedCosts: 250000, taxRate: 6 }) }
  ];

  data.chat = [];
  return data;
}

function enterDemo(view) {
  const users = loadUsers();
  if (!users['demo']) {
    users['demo'] = { name: 'Алексей', pass: hashPass('demo', 'demo'), created: todayISO() };
    saveUsers(users);
  }
  localStorage.setItem(LS_SESSION, 'demo');
  localStorage.setItem(LS_DATA + 'demo', JSON.stringify(seedDemoData()));
  enterApp();
  if (view && TITLES[view]) navigate(view);
  toast('Демо-режим: загружены примерные данные');
}

/* ============================================================
   17. ДОП. ПРИВЯЗКИ (фильтры, импорт, меню, выход)
   ============================================================ */
function initChrome() {
  $('#logoutBtn').addEventListener('click', logout);
  $('#themeToggle').addEventListener('click', function () {
    const d = getData();
    setTheme(d.settings.theme === 'dark' ? 'light' : 'dark');
  });
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('#nav .nav-item').forEach(item => item.addEventListener('click', () => {
    navigate(item.dataset.view);
    $('#sidebar').classList.remove('open');
  }));

  document.addEventListener('input', function (e) {
    if (e.target.id === 'finSearch') { financeFilter.q = e.target.value; renderFinanceData(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'finMonthFilter') { financeFilter.month = e.target.value; renderFinanceData(); }
    if (e.target.id === 'finTypeFilter') { financeFilter.type = e.target.value; renderFinanceData(); }
    if (e.target.id === 'reportMonthSelect') { reportMonth = e.target.value; navigate('reports'); }
    if (e.target.id === 'csvFile') {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const added = importCSVText(String(reader.result || ''));
        toast(added ? 'Импортировано операций: ' + added : 'Не удалось распознать CSV');
        if (added) navigate('finance'); else renderFinanceData();
      };
      reader.readAsText(file);
      e.target.value = '';
    }
    if (e.target.id === 'importFile') {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const obj = JSON.parse(reader.result);
          if (!obj || typeof obj !== 'object' || !Array.isArray(obj.transactions)) throw new Error('bad');
          localStorage.setItem(LS_DATA + currentUsername(), JSON.stringify(obj));
          toast('Данные импортированы ✅');
          navigate(currentView);
        } catch (err) {
          toast('Файл не похож на резервную копию');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }
    if (e.target.id === 'aiProvider') {
      const p = e.target.value;
      const model = $('#aiModel');
      const base = $('#aiBaseURL');
      if (p === 'openrouter') {
        if (!model.value) model.value = 'meta-llama/llama-3.1-8b-instruct:free';
        base.value = '';
      } else {
        if (!model.value) model.value = 'gpt-4o-mini';
        if (!base.value) base.value = 'https://api.groq.com/openai/v1';
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'chatInput') {
      e.preventDefault(); sendChat();
    }
  });
}

function saveAiSettings() {
  const d = getData();
  d.settings.ai.provider = $('#aiProvider').value;
  d.settings.ai.apiKey = $('#aiKey').value.trim();
  d.settings.ai.model = $('#aiModel').value.trim();
  d.settings.ai.baseURL = $('#aiBaseURL').value.trim();
  saveData(d);
  toast('Настройки ИИ сохранены ✅');
}

/* ============================================================
   18. СТАРТ
   ============================================================ */
function init() {
  initAuth();
  initChrome();
  const params = new URLSearchParams(location.search);
  if (params.get('demo') != null && !currentUsername()) {
    enterDemo(params.get('demo') || 'dashboard');
    return;
  }
  if (currentUsername() && loadUsers()[currentUsername()]) {
    enterApp();
  } else {
    localStorage.removeItem(LS_SESSION);
    showAuth();
  }
}
document.addEventListener('DOMContentLoaded', init);
