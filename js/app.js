;(() => {
  'use strict';
  const $  = (s, c=document) => c.querySelector(s);
  const $$ = (s, c=document) => Array.from(c.querySelectorAll(s));

  // ---------- Навигация с анимацией ----------
  let tabs = [];
  let pages = [];
  function _scrollToTop(){
    try{
      const target = document.scrollingElement || document.documentElement || document.body;
      target.scrollTop = 0; document.body.scrollTop = 0; window.scrollTo(0,0);
    }catch{}
  }
  function show(page){
    pages.forEach(p => {
      const active = (p.id === 'page-' + page);
      p.classList.toggle('active', active);
    });
    tabs.forEach(b => b.classList.toggle('active', b.dataset.page === page));
    try{ localStorage.setItem('activePage', page); }catch{}
    _scrollToTop();
  }

  // инициализируем ссылки на элементы после загрузки DOM
  
  // ---------- Заполнение списков ----------
  async function refreshEmployees() {
    const list = await DB.getEmployees();
    const empSel = $('#employee'), bankEmp = $('#bankEmployee');
    if (empSel) empSel.innerHTML = '<option value="">Сотрудник</option>';
    if (bankEmp) bankEmp.innerHTML = '<option value="">Сотрудник</option>';
    (list || []).forEach(n => {
      if (empSel) empSel.append(new Option(n, n));
      if (bankEmp) bankEmp.append(new Option(n, n));
    });
  }
  async function refreshPoints() {
    const list = await DB.getPoints();
    const sel = $('#point'); if (!sel) return;
    sel.innerHTML = '<option value="">ПВЗ</option>';
    (list || []).forEach(p => sel.append(new Option(p, p)));
  }
document.addEventListener('DOMContentLoaded', () => {
    tabs  = $$('.tabbar button');
    pages = $$('.page');
    tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.page)));
    try{ localStorage.setItem('activePage','checkin'); }catch{}
    show('checkin');
  });

  const monthTitle = $('#monthTitle'), cal = $('#calendar');
  let today = new Date(); let currentYear = today.getFullYear(), currentMonth = today.getMonth();

  function monthName(y, m) {
    return new Date(y, m, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }
  function monthDays(y, m) {
    const first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
    const cells = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); } return cells;
  }

  async function renderCalendar(y, m) {
    try {
      if (monthTitle) monthTitle.textContent = monthName(y, m);
      if (!cal) return;

      const shifts = await DB.getShiftsByMonth(y, m) || {};
      cal.innerHTML = '';

      monthDays(y, m).forEach(d => {
        const iso = d.toISOString().slice(0, 10);
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.opacity = (d.getMonth() === m) ? '1' : '.45';
        cell.innerHTML = `<div class="text-xs mb-1">${d.getDate()}</div>`;

        const daily = Array.isArray(shifts[iso]) ? shifts[iso] : [];
        if (daily.length) {
          daily.forEach(s => {
            if (!s) return;
            const span = document.createElement('span');
            span.className = 'vtext';
            span.textContent = `${s.name || '—'} — ${s.point || ''}`;
            cell.appendChild(span);
          });
        }

        if (iso === new Date().toISOString().slice(0, 10)) cell.classList.add('active');
        cal.appendChild(cell);
      });
    } catch (e) {
      console.error('Render calendar error:', e);
    }
  }

  const prev = $('#prevMonth'), next = $('#nextMonth');
  if (prev) prev.addEventListener('click', () => { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(currentYear, currentMonth); refreshPayroll(); });
  if (next) next.addEventListener('click', () => { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderCalendar(currentYear, currentMonth); refreshPayroll(); });

  // ---------- ВСПОМОГАТЕЛЬНОЕ: расчёт периода по МСК ----------
  function nowMSK() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc + 3 * 3600000); // UTC+3 постоянно
  }
  const isoUTC = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

  // Возвращает {from,to,label} по сегодняшней дате в МСК
  function getPayrollRangeByMoscowToday() {
    const msk = nowMSK();
    const y = msk.getUTCFullYear();
    const m = msk.getUTCMonth();
    const day = msk.getUTCDate();

    if (day >= 11 && day <= 25) {
      return { from: isoUTC(y, m, 11), to: isoUTC(y, m, 25), label: '11–25' };
    }
    if (day <= 10) {
      const prev = new Date(Date.UTC(y, m, 1)); prev.setUTCMonth(m - 1);
      return { from: isoUTC(prev.getUTCFullYear(), prev.getUTCMonth(), 26), to: isoUTC(y, m, 10), label: '26–10' };
    }
    const next = new Date(Date.UTC(y, m, 1)); next.setUTCMonth(m + 1);
    return { from: isoUTC(y, m, 26), to: isoUTC(next.getUTCFullYear(), next.getUTCMonth(), 10), label: '26–10' };
  }

  // ---------- нормализация ПВЗ и ставки ----------
  function canonKey(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  }
  function buildPointsIndex(pointsObj) {
    const idx = new Map();
    Object.entries(pointsObj || {}).forEach(([k, v]) => idx.set(canonKey(k), { key: k, value: Number(v) || 0 }));
    // известные алиасы
    [['Половина302', 'Половина 302'], ['МО_ХИМКИ_89', 'МО ХИМКИ 89'], ['ХИМКИ_241', 'ХИМКИ 241']]
      .forEach(([a, b]) => {
        const ca = canonKey(a), cb = canonKey(b);
        if (idx.has(ca) && !idx.has(cb)) idx.set(cb, idx.get(ca));
        if (idx.has(cb) && !idx.has(ca)) idx.set(ca, idx.get(cb));
      });
    return idx;
  }
  function getPointRateSmart(pointsIndex, name) {
    const hit = pointsIndex.get(canonKey(name));
    if (!hit) { console.warn('[payroll] ставка не найдена для точки:', name); return 0; }
    return hit.value;
  }

  // ---------- собрать смены за ISO-интервал через DB.getShiftsByMonth ----------
  async function collectShiftsByRange(fromISO, toISO) {
    // месяцы, которые нужно покрыть (макс. два)
    const fromY = Number(fromISO.slice(0, 4)), fromM = Number(fromISO.slice(5, 7)) - 1;
    const toY = Number(toISO.slice(0, 4)), toM = Number(toISO.slice(5, 7)) - 1;

    const months = [];
    months.push({ y: fromY, m: fromM });
    if (fromY !== toY || fromM !== toM) months.push({ y: toY, m: toM });

    const byDay = {};
    for (const { y, m } of months) {
      const mm = await DB.getShiftsByMonth(y, m);
      Object.entries(mm || {}).forEach(([iso, list]) => {
        (byDay[iso] ||= []).push(...list);
      });
    }

    // фильтруем по границам ISO (строковое сравнение работает для YYYY-MM-DD)
    const byEmp = {};
    Object.entries(byDay).forEach(([iso, arr]) => {
      if (iso < fromISO || iso > toISO) return;
      arr.forEach(s => {
        if (!s) return;
        const name = s.name || s.employee;
        if (!name) return;
        (byEmp[name] ||= []).push({ date: iso, point: s.point });
      });
    });
    return byEmp;
  }

  // ---------- Зарплаты по ставкам ПВЗ (период по МСК) ----------
  async function refreshPayroll() {
    try {
      // 1) период
      const { from, to, label } = getPayrollRangeByMoscowToday();

      // 2) смены за период
      const shiftsByEmp = await collectShiftsByRange(from, to);

      // 3) ставки
      const ratesObj = (await (DB.getPointsWithRates ? DB.getPointsWithRates() : {})) || {};
      const pointsIndex = buildPointsIndex(ratesObj);

      // 4) считаем
      const counts = {}, totals = {};
      Object.entries(shiftsByEmp).forEach(([name, list]) => {
        counts[name] = (counts[name] || 0) + list.length;
        list.forEach(s => {
          const r = getPointRateSmart(pointsIndex, s.point);
          totals[name] = (totals[name] || 0) + r;
        });
      });

      // 5) итоги по всем
      const sCount = $('#shiftsCount'), total = $('#total'), hdr = $('#payroll-period');
      if (hdr) hdr.textContent = `Расчёт зарплат за период ${label}:`;
      if (sCount) sCount.textContent = Object.values(counts).reduce((a, b) => a + b, 0) || 0;
      if (total) total.textContent = ((Object.values(totals).reduce((a, b) => a + b, 0) || 0)) + ' ₽';

      // 6) таблица
      const body = $('#payrollBody'); if (!body) return;
      body.innerHTML = '';
      const names = Object.keys({ ...counts, ...totals }).sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
      names.forEach(name => {
        const tr = document.createElement('tr');
        const cnt = counts[name] || 0, sum = totals[name] || 0;
        tr.innerHTML = `<td class="py-2 px-3">${name}</td><td class="py-2 px-3">${cnt}</td><td class="py-2 px-3">${sum} ₽</td>`;
        body.appendChild(tr);
      });
    } catch (e) {
      console.error('refreshPayroll error', e);
    }
  }

  // ---------- Реквизиты ----------
  async function refreshReqs() {
    const req = await DB.getRequisites();
    const body = $('#reqBody'); if (!body) return;
    body.innerHTML = '';
    Object.entries(req).forEach(([name, { phone, bank }]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="py-2 px-3">${name}</td><td class="py-2 px-3">${phone || ''} — ${bank || ''}</td>
      <td class="py-2 px-3"><button class="glass-ink px-2 py-1 rounded-lg text-xs" data-del="${name}">Удалить</button></td>`;
      body.appendChild(tr);
    });
  }
  const saveReq = $('#saveReqBtn'), clearReq = $('#clearReqBtn'), reqBody = $('#reqBody');
  if (saveReq) saveReq.addEventListener('click', async () => {
    const name = $('#bankEmployee').value, phone = $('#bankPhone').value, bank = $('#bankName').value;
    if (!name || !phone || !bank) return alert('Заполни все поля');
    await DB.saveRequisite(name, phone, bank); await refreshReqs();
  });
  if (reqBody) reqBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-del]'); if (!btn) return;
    await DB.deleteRequisite(btn.dataset.del); await refreshReqs();
  });
  if (clearReq) clearReq.addEventListener('click', () => { $('#bankPhone').value = ''; $('#bankName').value = ''; });

  // ---------- Правила и админы ----------
  async function loadRules() { const el = $('#rulesContent'); if (el) el.innerHTML = await DB.getRules(); }
  async function loadAdmins() {
    const ul = $('#adminsList'); if (!ul) return;
    ul.innerHTML = '';
    (await DB.getAdmins()).forEach(a => {
      const li = document.createElement('li');
      li.className = 'glass-ink rounded-xl p-3';
      li.innerHTML = `<div class="text-sm font-semibold">${a.name || ''}</div><div class="text-xs text-gray-600">${a.handle || ''} ${a.phone || ''}</div>`;
      ul.appendChild(li);
    });
  }

  // ---------- «Авторизация» ----------
  const login = $('#btn-login'), logout = $('#btn-logout');
  if (login) login.addEventListener('click', async () => { await DB.authLogin(); applyAuth(); });
  if (logout) logout.addEventListener('click', async () => { await DB.authLogout(); applyAuth(); });
  function applyAuth() {
    const admin = DB.isAdmin();
    if (login) login.classList.toggle('hidden', admin);
    if (logout) logout.classList.toggle('hidden', !admin);
    const adminPage = $('#page-admin');
    if (adminPage) adminPage.classList.toggle('hidden', !admin);
  }
  // ---------- Расходники ----------
  const SUPPLY_ITEMS = [
    {id:'bags', label:'Брендированные пакеты'},
    {id:'tape', label:'Скотч'},
    {id:'knife', label:'Нож (целиком)'},
    {id:'blades', label:'Лезвия для ножа'},
    {id:'paper', label:'Бумага'},
    {id:'toilet', label:'Туалетная бумага'},
    {id:'freshener', label:'Освежитель для воздуха'},
    {id:'safepacks', label:'Сейфпакеты'},
    {id:'barcodes', label:'Наклейки со штрихкодами'},
    {id:'markers', label:'Маркеры'},
  ];

  function renderSuppliesChecklist(){
    const box = $('#supChecklist'); if (!box) return;
    box.innerHTML = SUPPLY_ITEMS.map(it=>`
      <label class="flex items-center gap-2 glass-ink rounded-xl px-3 py-2">
        <input type="checkbox" value="${it.id}"/>
        <span>${it.label}</span>
      </label>
    `).join('');
  }
  async function refreshSuppliesSelectors(){
    const [emps, points] = await Promise.all([DB.getEmployees(), DB.getPoints()]);
    const eSel = $('#supEmployee'), pSel = $('#supPoint');
    if (eSel){
      eSel.innerHTML = '<option value="">Сотрудник</option>' + (emps||[]).map(n=>`<option value="${n}">${n}</option>`).join('');
    }
    if (pSel){
      pSel.innerHTML = '<option value="">ПВЗ</option>' + (points||[]).map(n=>`<option value="${n}">${n}</option>`).join('');
    }
  }
  function supplyItemsToLabels(items){
    const map = Object.fromEntries(SUPPLY_ITEMS.map(i=>[i.id,i.label]));
    return (items||[]).map(id=>map[id]||id);
  }
  function fmtDate(ts){
    try{ const d = new Date(ts); return d.toLocaleString('ru-RU'); } catch{ return String(ts); }
  }
  async function loadSupplyRequests(){
    const box = $('#supRequestsList'); if (!box) return;
    const list = await DB.getSupplyRequests();
    (list||[]).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    box.innerHTML = (list||[]).map(r=>{
      const labels = supplyItemsToLabels(r.items);
      const closed = r.status==='closed';
      return `
        <div class="glass-ink rounded-2xl p-3 flex items-start justify-between gap-3 ${closed?'opacity-60':''}" data-id="${r.id||''}">
          <div>
            <div class="text-xs text-gray-600">${fmtDate(r.createdAt)} · ${r.employeeName} · ${r.pointName}</div>
            <div class="mt-1">${labels.map(l=>`<span class="inline-block text-xs px-2 py-1 rounded-lg bg-white/50 mr-1 mb-1">${l}</span>`).join('')}</div>
            ${closed && r.closedBy ? `<div class="text-xs text-gray-500 mt-1">Закрыто: ${fmtDate(r.closedAt)} · ${r.closedByName||r.closedBy}</div>`:''}
          </div>
          <button class="glass-ink px-2 py-1 rounded-lg text-sm" data-close ${closed?'disabled':''}>✕</button>
        </div>
      `;
    }).join('');

    box.querySelectorAll('[data-close]:not([disabled])').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const card = e.target.closest('[data-id]');
        const id = card?.dataset.id;
        if (!id) return;
        try{ await DB.closeSupplyRequest(id); await loadSupplyRequests(); }
        catch(err){ console.error(err); alert('Не удалось закрыть заявку'); }
      });
    });
  }
  async function createSupplyRequest(){
    const eSel = $('#supEmployee'), pSel = $('#supPoint');
    const items = $$('#supChecklist input[type="checkbox"]:checked').map(i=>i.value);
    if (!eSel?.value) return alert('Выбери сотрудника');
    if (!pSel?.value) return alert('Выбери ПВЗ');
    if (!items.length) return alert('Отметь хотя бы один расходник');
    await DB.addSupplyRequest({ employeeName: eSel.value, pointName: pSel.value, items });
    // reset
    eSel.value=''; pSel.value=''; $$('#supChecklist input[type="checkbox"]').forEach(i=>i.checked=false);
    await loadSupplyRequests();
  }
  function initSuppliesPage(){
    renderSuppliesChecklist();
    refreshSuppliesSelectors();
    const btn = $('#createSupplyReq'); if (btn) btn.addEventListener('click', createSupplyRequest);
    loadSupplyRequests();
  }

  // Floating button + routing
  const suppliesFab = $('#suppliesFab');
  /* INIT FAB VIS */
  try {
    const current = localStorage.getItem('activePage') || 'checkin';
    if (suppliesFab) suppliesFab.style.display = (current==='checkin') ? 'block' : 'none';
  } catch {}

  $('#openSupplies')?.addEventListener('click', ()=> show('supplies'));

  const _show = show;
  show = function(page){
    _show(page);
    if (suppliesFab) suppliesFab.style.display = (page==='checkin') ? 'block' : 'none';
    if (page==='supplies') initSuppliesPage();
   _scrollToTop(); };



  // ---------- init ----------
  async function init() {
    applyAuth();
    await refreshEmployees(); await refreshPoints();
    await renderCalendar(currentYear, currentMonth);
    await refreshPayroll();
    await refreshReqs();
    await loadRules(); await loadAdmins();
    try { document.body.classList.add('ready'); } catch(e) {}
  
  }

  // если DB уже есть — стартуем сразу, иначе ждём событие от data.js
  if (window.DB) init();
  else window.addEventListener('DB_READY', init, { once: true });
})();
