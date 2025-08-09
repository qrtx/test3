/* js/data.js — RTDB адаптер под твою БД + MOCK fallback
 * Подключать как ES-модуль ДО app.js:
 * <script type="module" src="js/data.js"></script>
 */

export const DATA_MODE = (localStorage.getItem('DATA_MODE') || 'FIREBASE_RTDB'); // 'FIREBASE_RTDB' | 'MOCK'

/* ========= MOCK (на всякий случай) ========= */
const mockDB = (()=> {
  const seed = {
    employees: ['Серёга 3','Серёга Ш','Арина','Андрей','Валера','Даша','Ростислав','Алексей','Саня'],
    points: ['МО_ХИМКИ_89','ХИМКИ_241'],
    pointRates: {'МО_ХИМКИ_89':2666,'ХИМКИ_241':2000},
    requisites: {},
    admins: [{name:'Андрей', handle:'@andrey', phone:'+7 900 000-00-00'}],
    rules: '<ul><li>Не покидать ПВЗ вне перерывов</li><li>Не размещать КГТ в клиентской зоне</li></ul>',
    supplyRequests: [] ,
    shifts: {} // 'YYYY-MM-DD' : [{name, point}]
  };
  const KEY='mockDB_v1';
  const load=()=>JSON.parse(localStorage.getItem(KEY)||JSON.stringify(seed));
  const save=db=>localStorage.setItem(KEY, JSON.stringify(db));

  return {
    async getEmployees(){ return load().employees },
    async addEmployee(n){ const db=load(); if(!db.employees.includes(n)) db.employees.push(n); save(db); },
    async deleteEmployee(n){ const db=load(); db.employees=db.employees.filter(x=>x!==n); save(db); },

    async getPoints(){ return load().points },
    async getPointsWithRates(){ return load().pointRates },
    async addPoint(p){ const db=load(); if(!db.points.includes(p)) db.points.push(p); db.pointRates[p]=db.pointRates[p]||0; save(db); },
    async deletePoint(p){ const db=load(); db.points=db.points.filter(x=>x!==p); delete db.pointRates[p]; save(db); },

    async getRate(){ return 0 }, async setRate(){},

    async markShift({name, point, date}){ const iso=new Date(date||Date.now()).toISOString().slice(0,10); const db=load(); (db.shifts[iso]=db.shifts[iso]||[]).push({name,point}); save(db); },
    async getShiftsByMonth(y,m){ const db=load(),res={}; for(const [iso, arr] of Object.entries(db.shifts)){const d=new Date(iso); if(d.getFullYear()==y&&d.getMonth()==m) res[iso]=arr} return res; },

    async getRequisites(){ return load().requisites },
    async saveRequisite(n, phone, bank){ const db=load(); db.requisites[n]={phone, bank}; save(db); },
    async deleteRequisite(n){ const db=load(); delete db.requisites[n]; save(db); },

    async addSupplyRequest({employeeName, pointName, items}){
      const db=load(); const id = String(Date.now())+Math.random().toString(36).slice(2,7);
      db.supplyRequests = db.supplyRequests||[];
      db.supplyRequests.push({id, employeeName, pointName, items, status:'open', createdAt: Date.now()});
      save(db); return id;
    },
    async getSupplyRequests(){ const db=load(); return db.supplyRequests||[]; },
    async closeSupplyRequest(id){ const db=load(); (db.supplyRequests||[]).forEach(r=>{ if(r.id===id){ r.status='closed'; r.closedAt=Date.now(); r.closedBy='Система'; r.closedByName='Система'; } }); save(db); },

    async getRules(){ return load().rules },
    async getAdmins(){ return load().admins },

    async authLogin(){ localStorage.setItem('isAdmin','1'); return true; },
    async authLogout(){ localStorage.removeItem('isAdmin'); },
    isAdmin(){ return !!localStorage.getItem('isAdmin'); },
  };
})();

/* ========= Firebase RTDB ========= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, child, get, set, push, update,
  query, orderByChild, startAt, endAt
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ТВОЙ КОНФИГ (из консоли) */
const firebaseConfig = {
  apiKey: "AIzaSyBx7N43Wpf0Ohh6197YLlv-ppeHHaJq_TQ",
  authDomain: "ozon-shifts.firebaseapp.com",
  databaseURL: "https://ozon-shifts-default-rtdb.firebaseio.com",
  projectId: "ozon-shifts",
  storageBucket: "ozon-shifts.firebasestorage.app",
  messagingSenderId: "60204010303",
  appId: "1:60204010303:web:09997f126723460335618a"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

/* Пути и формат — как у тебя в базе */
const P = {
  bank      : 'bank',       // { "<name>": {phone, bank} } ИЛИ { "<pushId>": "Имя: +7... - Банк" }
  employees : 'employees',  // { "<pushId>": "Имя", ... }
  points    : 'points',     // { "МО_ХИМКИ_89": 2666, ... }
  shifts    : 'shifts',     // { "<pushId>": { date:"YYYY-MM-DD", employee:"Имя", point:"ПВЗ" } }
  meta      : 'meta',       // может отсутствовать
  admins    : 'admins',     // может отсутствовать
  supplyRequests : 'supplyRequests'
};

const toISO = (d) => {
  const dt = (d && d.toDate) ? d.toDate() : new Date(d || Date.now());
  return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()))
    .toISOString().slice(0,10);
};

const rtdb = {
  /* ----- сотрудники ----- */
  async getEmployees(){
    const snap = await get(ref(db, P.employees));
    const val = snap.val() || {};
    // значения = имена
    return Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
  },
  async addEmployee(name){ await set(push(ref(db, P.employees)), name); },
  async deleteEmployee(name){
    const snap = await get(ref(db, P.employees)); const val = snap.val() || {};
    const updates = {};
    for (const [k, v] of Object.entries(val)) if (v === name) updates[k] = null;
    if (Object.keys(updates).length) await update(ref(db, P.employees), updates);
  },

  /* ----- ПВЗ и ставки ----- */
  async getPoints(){
    const snap = await get(ref(db, P.points));
    return Object.keys(snap.val() || {});
  },
  async getPointsWithRates(){
    const snap = await get(ref(db, P.points));
    return snap.val() || {}; // { point: rate }
  },
  async addPoint(point){ await update(ref(db, P.points), { [point]: 0 }); },
  async deletePoint(point){ await update(ref(db, P.points), { [point]: null }); },

  /* ----- ставка в meta (если вдруг используешь) ----- */
  async getRate(){
    const snap = await get(child(ref(db, P.meta), 'rate'));
    return (snap.exists() ? snap.val() : 0) || 0;
  },
  async setRate(v){ await update(ref(db, P.meta), { rate: Number(v)||0 }); },

  /* ----- отметка смен ----- */
  async markShift({name, point, date}){
    const payload = { employee: name, point, date: toISO(date) };
    await set(push(ref(db, P.shifts)), payload);
  },

  /* ----- смены по месяцу (устойчиво к кривым данным) ----- */
  async getShiftsByMonth(y, m) {
    const from = `${y}-${String(m+1).padStart(2,'0')}-01`;
    const to   = `${y}-${String(m+1).padStart(2,'0')}-31`;
    const q = query(ref(db, P.shifts), orderByChild('date'), startAt(from), endAt(to));
    const snap = await get(q);
    const raw  = snap.exists() ? Object.values(snap.val()) : [];
    const res = {};
    raw.forEach(s => {
      if (!s || !s.date || !s.point || !(s.employee || s.name)) return;
      let key = null;
      try {
        const d = new Date(s.date);
        if (!isNaN(d)) {
          key = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
            .toISOString().slice(0,10);
        }
      } catch(_) {}
      if (!key) return;
      (res[key] = res[key] || []).push({ name: s.employee || s.name, point: s.point });
    });
    return res;
  },

  /* ----- реквизиты (bank) — нормализация строк/объектов ----- */
  async getRequisites(){
    const snap = await get(ref(db, P.bank));
    const v = snap.val() || {};
    const out = {};
    for (const [key, rec] of Object.entries(v)) {
      if (typeof rec === 'string') {
        // пример строки: "Даша: +79104653100 - Т-банк"
        const name = (rec.split(':')[0] || '').trim() || key;
        const m = rec.match(/:\s*([^–-]+)[–-]\s*(.+)$/); // телефон — банк
        out[name] = { phone: m ? m[1].trim() : '', bank: m ? m[2].trim() : rec };
      } else {
        out[key] = { phone: rec.phone || '', bank: rec.bank || '' };
      }
    }
    return out;
  },
  async saveRequisite(name, phone, bank){
    await set(ref(db, `${P.bank}/${name}`), { phone, bank });
  },
  async deleteRequisite(name){
    await update(ref(db, P.bank), { [name]: null });
  },

  /* ----- прочее ----- */
  async getRules(){
    const snap = await get(child(ref(db, P.meta), 'rules'));
    return (snap.exists() ? snap.val() : '') || '';
  },
  async getAdmins(){
    const snap = await get(ref(db, P.admins));
    const v = snap.val() || {};
    return Array.isArray(v) ? v.filter(Boolean) : Object.values(v);
  },

    async addSupplyRequest({employeeName, pointName, items}){
    const payload = { employeeName, pointName, items, status:'open', createdAt: Date.now() };
    const refPush = await set(push(ref(db, P.supplyRequests)), payload).then(()=>null).catch(()=>null);
  },
  async getSupplyRequests(){
    const snap = await get(ref(db, P.supplyRequests));
    const v = snap.val() || {};
    const list = Array.isArray(v) ? v.filter(Boolean) : Object.entries(v).map(([id, r])=>({ id, ...(r||{}) }));
    return list;
  },
  async closeSupplyRequest(id){
    const now = Date.now(); const who = 'Система';
    await update(child(ref(db, P.supplyRequests), id), { status:'closed', closedAt: now, closedBy: who, closedByName: who });
  },

  // простая «авторизация»
  async authLogin(){ localStorage.setItem('isAdmin','1'); return true; },
  async authLogout(){ localStorage.removeItem('isAdmin'); },
  isAdmin(){ return !!localStorage.getItem('isAdmin'); },
};

/* ===== отдать адаптер приложению и сигнал готовности ===== */
window.DB = (DATA_MODE === 'FIREBASE_RTDB') ? rtdb : mockDB;
console.log('[data.js] DB ready:', DATA_MODE);
window.dispatchEvent(new Event('DB_READY'));
