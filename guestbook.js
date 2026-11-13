// 방명록 — 식구 넷이 강아지들에게 남기는 글 (Supabase · PostgREST RPC만 부른다)
// main.js와는 DOM으로만 이어진다: 어느 방에 있는지는 #roomUI 제목에서 읽고, 열려 있는 동안 키 · 포인터는 3D 쪽으로 보내지 않는다.
// 남이 쓴 글은 textContent로만 그린다 (innerHTML을 쓰지 않는다). Math.random · requestAnimationFrame도 쓰지 않는다 (점검 스크립트의 씨앗 흐름을 건드리지 않게).

const GB_URL = ''; // Supabase 프로젝트 주소 (예: https://abcd1234.supabase.co)
const GB_KEY = ''; // publishable key (sb_publishable_...) 또는 예전 anon key (eyJ...)

const cfg = (typeof window !== 'undefined' && window.GB_CONFIG) || {};
const API = String(cfg.url != null ? cfg.url : GB_URL).trim().replace(/\/+$/, '');
const KEY = String(cfg.key != null ? cfg.key : GB_KEY).trim();
const READY = !!(API && KEY);

const TOKEN_KEY = 'gb_token', NAME_KEY = 'gb_name';
const MAX = 500, PAGE = 20;
const MEMBERS = [{ name: '재롱맘' }, { name: '푸맘' }, { name: '규시기', admin: true }, { name: '담온니' }];
// id · 짧은 이름 (칩) · "~에게"
const DOGS = [['pinky', '핑키', '핑키에게'], ['dami', '담이', '담이에게'], ['pupu', '푸푸', '푸푸에게'], ['jaerong', '재롱', '재롱이에게'], ['alpang', '알팡', '알팡이에게']];
const TO = { all: '모두에게' }; for (const [id, , to] of DOGS) TO[id] = to;
const ROOM_DOG = {}; for (const [id, name] of DOGS) ROOM_DOG[name] = id; // 방 제목의 이름 → id

const $ = (s, r = document) => r.querySelector(s);
const root = $('#gb');
if (root) setup();

function setup() {
  const panel = $('#gbPanel'), back = $('.gb-back', root), scroll = $('#gbScroll');
  const scr = { setup: $('#gbSetup'), login: $('#gbLogin'), wait: $('#gbWait'), book: $('#gbBook') };
  const meBox = $('#gbMe'), meName = $('#gbMeName');
  const namesEl = $('#gbNames'), pass = $('#gbPass'), peek = $('#gbPeek'), loginErr = $('#gbLoginErr'), enterBtn = $('#gbEnter');
  const waitMsg = $('#gbWaitMsg'), retryBtn = $('#gbRetry');
  const toEl = $('#gbTo'), text = $('#gbText'), count = $('#gbCount'), sendBtn = $('#gbSend'), sendMsg = $('#gbSendMsg');
  const filterEl = $('#gbFilter'), list = $('#gbList'), empty = $('#gbEmpty'), more = $('#gbMore'), listMsg = $('#gbListMsg');

  const S = {
    open: false, opener: null, token: null, me: null, pick: null, busy: false,
    target: 'all', filter: null, notes: [], more: false, loading: false, seq: 0,
    editing: null, confirming: null, clock: 0, downOnBack: false,
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 그만 */ } },
  };

  // ---------------- 서버 ----------------
  async function rpc(fn, args) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`; // 예전 JWT 키만 Authorization에도 싣는다
    try {
      const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
      let data = null;
      try { data = await res.json(); } catch (e) { /* 본문이 JSON이 아님 */ }
      if (!res.ok || !data || typeof data !== 'object') return { ok: false, error: 'server', status: res.status };
      return data;
    } catch (e) {
      return { ok: false, error: 'network' };
    } finally { clearTimeout(timer); }
  }
  const NET = '연결이 안 돼요. 잠시 뒤 다시 해 주세요.';
  const SERVER = '잠깐 문제가 생겼어요. 잠시 뒤 다시 해 주세요.';
  const failText = (r) => (r.error === 'network' ? NET : SERVER);

  // ---------------- 작은 도우미 ----------------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids) if (c != null && c !== false) e.append(c); // 문자열은 글자 그대로 들어간다
    return e;
  }
  const god = () => h('span', { class: 'gb-god', title: '관리자', 'aria-label': '관리자' }, '신');
  const chars = (s) => [...String(s || '').replace(/\r\n?/g, '\n').trim()].length;
  // 보내기 전에: 데이터베이스가 받지 못하는 글자(NUL, 짝 없는 서로게이트)는 빼거나 U+FFFD로 바꾼다
  function sendable(s) {
    s = String(s || '').replace(/\u0000/g, '');
    if (typeof s.toWellFormed === 'function') return s.toWellFormed();
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; } else out += '\ufffd';
      } else out += c >= 0xdc00 && c <= 0xdfff ? '\ufffd' : s[i];
    }
    return out;
  }
  function show(name) {
    for (const [k, el] of Object.entries(scr)) el.hidden = k !== name;
    meBox.hidden = !(name === 'book' && S.me);
    root.dataset.screen = name;
    scroll.scrollTop = 0;
  }
  const two = (n) => String(n).padStart(2, '0');
  function clockText(d) { const hr = d.getHours(); return `${hr < 12 ? '오전' : '오후'} ${hr % 12 || 12}:${two(d.getMinutes())}`; }
  const parse = (iso) => new Date(String(iso || '').replace(/(\.\d{3})\d+/, '$1')); // 마이크로초는 잘라야 사파리도 읽는다
  function when(iso, now = Date.now()) {
    const t = parse(iso), s = (now - t.getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 60) return '방금';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 6 * 3600) return `${Math.floor(s / 3600)}시간 전`;
    const d = new Date(now), y = new Date(now - 86400000);
    if (t.toDateString() === d.toDateString()) return `오늘 ${clockText(t)}`;
    if (t.toDateString() === y.toDateString()) return `어제 ${clockText(t)}`;
    const md = `${t.getMonth() + 1}월 ${t.getDate()}일 ${clockText(t)}`;
    return t.getFullYear() === d.getFullYear() ? md : `${t.getFullYear()}년 ${md}`;
  }
  const fullDate = (iso) => { const t = parse(iso); return `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일 ${clockText(t)}`; };

  // ---------------- 열기 · 닫기 ----------------
  function roomDog() {
    const ui = $('#roomUI');
    if (!ui || ui.hidden) return null;
    const n = $('#roomUI .title .name');
    return (n && ROOM_DOG[n.textContent.trim()]) || null;
  }
  function openBook(opener) {
    if (S.open) return;
    S.open = true; S.opener = opener || document.activeElement;
    S.target = roomDog() || 'all'; // 방에서 열면 그 강아지에게
    paintTo();
    for (const id of ['selectUI', 'roomUI']) { const el = document.getElementById(id); if (el) el.inert = true; }
    root.hidden = false;
    for (const b of document.querySelectorAll('.gb-open')) b.setAttribute('aria-expanded', 'true');
    fitViewport();
    if (window.visualViewport) { visualViewport.addEventListener('resize', fitViewport); visualViewport.addEventListener('scroll', fitViewport); }
    clearInterval(S.clock); S.clock = setInterval(refreshTimes, 30000);
    panel.focus({ preventScroll: true });
    start();
  }
  function closeBook() {
    if (!S.open) return;
    S.open = false;
    root.hidden = true;
    clearInterval(S.clock);
    pass.value = ''; showPass(false);
    if (window.visualViewport) { visualViewport.removeEventListener('resize', fitViewport); visualViewport.removeEventListener('scroll', fitViewport); }
    for (const id of ['selectUI', 'roomUI']) { const el = document.getElementById(id); if (el) el.inert = false; }
    for (const b of document.querySelectorAll('.gb-open')) b.setAttribute('aria-expanded', 'false');
    const o = S.opener; S.opener = null;
    if (o && o.isConnected && typeof o.focus === 'function') o.focus({ preventScroll: true });
  }
  // 폰 자판이 올라오면 보이는 높이에 맞춘다 (글 쓰는 칸이 자판 뒤로 숨지 않게)
  function fitViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    root.style.setProperty('--gb-vh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--gb-vt', `${Math.round(vv.offsetTop)}px`);
  }

  async function start() {
    if (!READY) { show('setup'); return; }
    if (S.me && S.token) { show('book'); loadList(true); return; }
    const t = store.get(TOKEN_KEY);
    if (!t || !/^[0-9a-f-]{36}$/i.test(t)) { store.set(TOKEN_KEY, null); toLogin(); return; }
    waitMsg.textContent = '방명록을 여는 중…'; retryBtn.hidden = true; show('wait');
    const r = await rpc('gb_me', { p_token: t });
    if (!S.open) return;
    if (r.ok) { S.token = t; S.me = { name: r.name, admin: !!r.admin }; enterBook(); return; }
    if (r.error === 'auth') { store.set(TOKEN_KEY, null); toLogin(); return; }
    waitMsg.textContent = failText(r); retryBtn.hidden = false; retryBtn.focus({ preventScroll: true });
  }

  // ---------------- 들어가기 ----------------
  function toLogin(msg = '') {
    S.me = null; S.token = null; S.notes = []; S.editing = S.confirming = null;
    if (!S.pick) { const last = store.get(NAME_KEY); if (MEMBERS.some((m) => m.name === last)) S.pick = last; }
    paintNames(); pass.value = ''; showPass(false); loginErr.textContent = msg; loginErr.classList.toggle('soft', !!msg);
    enterBtn.disabled = false; enterBtn.textContent = '들어가기';
    show('login');
    const sel = namesEl.querySelector('[aria-checked="true"]');
    (sel || namesEl.firstElementChild).focus({ preventScroll: true });
  }
  function paintNames() {
    namesEl.replaceChildren(...MEMBERS.map((m) => h('button', {
      type: 'button', class: 'gb-name', role: 'radio', 'aria-checked': String(S.pick === m.name), 'data-name': m.name,
      'aria-label': m.admin ? `${m.name} (신)` : m.name,
      on: { click: () => { S.pick = m.name; store.set(NAME_KEY, m.name); paintNames(); loginErr.textContent = ''; pass.focus(); } },
    }, h('span', { class: 'gb-name-t' }, m.name), m.admin ? h('span', { class: 'gb-name-s', 'aria-hidden': 'true' }, ' (신)') : null)));
  }
  scr.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.busy) return;
    loginErr.classList.remove('soft');
    if (!S.pick) { loginErr.textContent = '누구인지 먼저 골라 주세요.'; namesEl.firstElementChild.focus(); return; }
    const pw = pass.value.trim();
    if (!/^\d{8}$/.test(pw)) { loginErr.textContent = '비밀번호는 숫자 8자리예요.'; pass.focus(); return; }
    S.busy = true; enterBtn.disabled = true; enterBtn.textContent = '들어가는 중…'; loginErr.textContent = '';
    const r = await rpc('gb_login', { p_name: S.pick, p_pass: pw });
    S.busy = false; enterBtn.disabled = false; enterBtn.textContent = '들어가기';
    if (!S.open) return;
    if (r.ok && r.token) {
      pass.value = ''; showPass(false);
      S.token = r.token; S.me = { name: r.name, admin: !!r.admin };
      store.set(TOKEN_KEY, r.token);
      enterBook(); return;
    }
    if (r.error === 'wrong') { pass.value = ''; loginErr.textContent = `비밀번호가 달라요 (${r.left}번 더 틀리면 잠깐 잠겨요)`; pass.focus(); return; }
    if (r.error === 'locked') { pass.value = ''; loginErr.textContent = `너무 많이 틀렸어요. ${r.minutes}분 뒤에 다시 해 주세요.`; return; }
    if (r.error === 'unknown') { loginErr.textContent = '식구 이름을 찾을 수 없어요.'; return; }
    loginErr.textContent = failText(r);
  });
  pass.addEventListener('input', () => { const v = pass.value.replace(/\D/g, '').slice(0, 8); if (v !== pass.value) pass.value = v; });
  // 비밀번호 보기 · 숨기기 (8자리를 잘못 누르기 쉬우니 확인할 수 있게). 닫거나 들어가거나 나가면 다시 숨긴다
  function showPass(on) {
    pass.type = on ? 'text' : 'password';
    peek.textContent = on ? '숨기기' : '보기';
    peek.setAttribute('aria-label', on ? '비밀번호 숨기기' : '비밀번호 보기');
  }
  peek.addEventListener('mousedown', (e) => e.preventDefault()); // 칸에서 초점이 빠지지 않게 (폰 자판이 내려갔다 올라오지 않게)
  peek.addEventListener('click', () => {
    const n = pass.value.length, had = document.activeElement === pass;
    const a = had ? pass.selectionStart : n, z = had ? pass.selectionEnd : n; // 쓰던 자리 (칸 밖에서 눌렀으면 맨 끝)
    showPass(pass.type === 'password');
    void pass.offsetWidth; // type을 바꾸면 커서가 맨 앞으로 가므로, 화면을 먼저 다시 잡고 나서 자리를 되돌린다
    pass.focus({ preventScroll: true });
    try { pass.setSelectionRange(a == null ? n : a, z == null ? n : z); } catch (e) { /* 그만 */ }
  });
  retryBtn.addEventListener('click', () => start());

  // ---------------- 방명록 ----------------
  function enterBook() {
    meName.replaceChildren(...[h('span', null, `${S.me.name}님`), S.me.admin ? god() : null].filter(Boolean)); // replaceChildren(null)은 "null" 글자가 된다
    S.filter = null; paintFilter(); paintTo(); paintCount();
    show('book');
    panel.focus({ preventScroll: true });
    loadList(true);
  }
  function paintTo() {
    toEl.replaceChildren(...[['all', '모두에게'], ...DOGS.map(([id, n]) => [id, n])].map(([id, label]) => h('button', {
      type: 'button', class: 'gb-chip', role: 'radio', 'aria-checked': String(S.target === id), 'data-dog': id,
      on: { click: () => { S.target = id; paintTo(); } },
    }, label)));
  }
  function paintFilter() {
    filterEl.replaceChildren(...[[null, '전체'], ...DOGS.map(([id, n]) => [id, n])].map(([id, label]) => h('button', {
      type: 'button', class: 'gb-chip', 'aria-pressed': String(S.filter === id), 'data-dog': id || '',
      on: { click: () => { if (S.filter === id) return; S.filter = id; paintFilter(); loadList(true); } },
    }, label)));
  }
  function setSend(kind, msg) { sendMsg.dataset.kind = kind; sendMsg.textContent = msg; sendMsg.className = `gb-msg ${kind === 'ok' ? 'ok' : 'err'}`; }
  function paintCount() {
    const n = chars(text.value);
    count.textContent = `${n}/${MAX}`;
    count.classList.toggle('over', n > MAX);
    sendBtn.disabled = S.busy || n === 0 || n > MAX;
    if (n > MAX) setSend('long', `${MAX}자까지 쓸 수 있어요.`);
    else if (sendMsg.dataset.kind === 'long') setSend('', '');
  }
  text.addEventListener('input', () => { if (sendMsg.dataset.kind === 'ok' || sendMsg.dataset.kind === 'err') setSend('', ''); paintCount(); }); // 다시 쓰기 시작하면 지난 안내는 지운다

  function authLost() { store.set(TOKEN_KEY, null); toLogin('다시 들어와 주세요.'); }

  async function loadList(reset) {
    const seq = ++S.seq;
    S.loading = true;
    if (reset) { S.notes = []; S.more = false; S.editing = S.confirming = null; list.replaceChildren(); empty.hidden = true; }
    more.hidden = true; listMsg.hidden = false; listMsg.replaceChildren('불러오는 중…');
    const before = reset || !S.notes.length ? null : S.notes[S.notes.length - 1].id;
    const r = await rpc('gb_list', { p_token: S.token, p_dog: S.filter, p_before: before, p_limit: PAGE });
    if (seq !== S.seq || !S.open) return; // 그사이 다른 걸 눌렀다
    S.loading = false;
    if (!r.ok) {
      if (r.error === 'auth') { authLost(); return; }
      listMsg.replaceChildren(failText(r), ' ', h('button', { type: 'button', class: 'gb-link', on: { click: () => loadList(!S.notes.length) } }, '다시 해 보기'));
      more.hidden = !S.more;
      return;
    }
    listMsg.hidden = true;
    const add = (r.notes || []).filter((n) => !S.notes.some((o) => o.id === n.id));
    S.notes.push(...add); S.more = !!r.more;
    list.append(...add.map(card));
    paintEmpty();
    more.hidden = !S.more;
  }
  function paintEmpty() {
    empty.hidden = S.notes.length > 0;
    if (!empty.hidden) empty.textContent = S.filter ? `아직 ${TO[S.filter]} 남긴 글이 없어요. 첫 글을 남겨 주세요` : '아직 남긴 글이 없어요. 첫 글을 남겨 주세요';
  }
  more.addEventListener('click', () => { if (!S.loading) loadList(false); });

  function card(n) {
    const li = h('li', { class: 'gb-note', 'data-id': n.id, 'data-dog': n.dog });
    fillCard(li, n);
    return li;
  }
  function fillCard(li, n) {
    const top = h('div', { class: 'gb-note-top' },
      h('span', { class: 'gb-author' }, n.author), n.admin_author ? god() : null,
      h('span', { class: `gb-to${n.dog === 'all' ? ' all' : ''}` }, TO[n.dog] || ''),
      h('time', { class: 'gb-time', datetime: n.created_at, title: fullDate(n.created_at), 'data-t': n.created_at, 'data-e': n.edited_at ? '1' : null }, when(n.created_at) + (n.edited_at ? ' · 고침' : '')));
    const kids = [top];
    if (S.editing === n.id) kids.push(editForm(li, n));
    else kids.push(h('p', { class: 'gb-text' }, n.body));
    if (S.confirming === n.id) {
      const msg = n.mine ? '이 글을 지울까요?' : `${n.author}님의 글을 지울까요?`;
      kids.push(h('div', { class: 'gb-confirm', role: 'group', 'aria-label': msg },
        h('span', { class: 'gb-confirm-q' }, msg),
        h('button', { type: 'button', class: 'gb-mini danger', 'data-act': 'del-yes', on: { click: () => removeNote(li, n) } }, '지우기'),
        h('button', { type: 'button', class: 'gb-mini', 'data-act': 'del-no', on: { click: () => { S.confirming = null; fillCard(li, n); focusAct(li, 'del'); } } }, '그만두기')));
    } else if (S.editing !== n.id && (n.can_edit || n.can_delete)) {
      kids.push(h('div', { class: 'gb-note-act' },
        n.can_edit ? h('button', { type: 'button', class: 'gb-mini', 'data-act': 'edit', on: { click: () => startEdit(li, n) } }, '수정') : null,
        n.can_delete ? h('button', { type: 'button', class: 'gb-mini', 'data-act': 'del', on: { click: () => { S.editing = null; S.confirming = n.id; fillCard(li, n); focusAct(li, 'del-no'); } } }, '삭제') : null));
    }
    li.replaceChildren(...kids);
  }
  const focusAct = (li, act) => { const b = li.querySelector(`[data-act="${act}"]`); if (b) b.focus({ preventScroll: true }); };
  function noteMsg(li, msg) {
    let m = li.querySelector(':scope > .gb-msg');
    if (!m) { m = h('p', { class: 'gb-msg err', role: 'alert' }); li.append(m); }
    m.textContent = msg;
  }
  function startEdit(li, n) {
    if (S.editing != null && S.editing !== n.id) { const o = list.querySelector(`[data-id="${S.editing}"]`), on = S.notes.find((x) => x.id === S.editing); S.editing = null; if (o && on) fillCard(o, on); }
    S.confirming = null; S.editing = n.id; fillCard(li, n);
    const ta = li.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function editForm(li, n) {
    const ta = h('textarea', { class: 'gb-input gb-edit', rows: 4, maxlength: 2000, 'aria-label': '고칠 글' });
    ta.value = n.body;
    const cnt = h('span', { class: 'gb-count' });
    const save = h('button', { type: 'submit', class: 'gb-mini primary', 'data-act': 'save' }, '저장');
    const paint = () => { const k = chars(ta.value); cnt.textContent = `${k}/${MAX}`; cnt.classList.toggle('over', k > MAX); save.disabled = k === 0 || k > MAX; };
    ta.addEventListener('input', paint); paint();
    const f = h('form', { class: 'gb-editform', 'data-id': n.id },
      ta, h('div', { class: 'gb-row' }, cnt, h('span', { class: 'gb-grow' }),
        h('button', { type: 'button', class: 'gb-mini', 'data-act': 'cancel', on: { click: () => { S.editing = null; fillCard(li, n); focusAct(li, 'edit'); } } }, '그만두기'), save));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (save.disabled || S.busy) return;
      S.busy = true; save.disabled = true; save.textContent = '저장 중…';
      const r = await rpc('gb_edit', { p_token: S.token, p_id: n.id, p_body: sendable(ta.value) });
      S.busy = false; save.textContent = '저장'; paint();
      if (r.ok && r.note) { Object.assign(n, r.note); S.editing = null; fillCard(li, n); focusAct(li, 'edit'); return; }
      if (r.error === 'auth') { authLost(); return; }
      if (r.error === 'gone') { dropCard(li, n); return; }
      noteMsg(li, r.error === 'forbidden' ? '이 글은 고칠 수 없어요.' : r.error === 'empty' ? '내용을 써 주세요.' : r.error === 'long' ? `${MAX}자까지 쓸 수 있어요.` : failText(r));
    });
    return f;
  }
  async function removeNote(li, n) {
    if (S.busy) return;
    S.busy = true;
    const yes = li.querySelector('[data-act="del-yes"]'); if (yes) { yes.disabled = true; yes.textContent = '지우는 중…'; }
    const r = await rpc('gb_delete', { p_token: S.token, p_id: n.id });
    S.busy = false;
    if (r.ok || r.error === 'gone') { dropCard(li, n); return; }
    if (r.error === 'auth') { authLost(); return; }
    if (yes) { yes.disabled = false; yes.textContent = '지우기'; }
    noteMsg(li, r.error === 'forbidden' ? '이 글은 지울 수 없어요.' : failText(r));
  }
  function dropCard(li, n) {
    const i = S.notes.indexOf(n); if (i >= 0) S.notes.splice(i, 1);
    if (S.editing === n.id) S.editing = null;
    if (S.confirming === n.id) S.confirming = null;
    const next = li.nextElementSibling || li.previousElementSibling;
    li.remove(); paintEmpty();
    (next && next.querySelector('button')) ? next.querySelector('button').focus({ preventScroll: true }) : panel.focus({ preventScroll: true });
  }
  function refreshTimes() {
    for (const t of list.querySelectorAll('time[data-t]')) t.textContent = when(t.dataset.t) + (t.dataset.e ? ' · 고침' : '');
  }

  scr.book.querySelector('.gb-compose').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.busy || sendBtn.disabled) return;
    const n = chars(text.value);
    if (!n) { setSend('err', '내용을 써 주세요.'); return; }
    S.busy = true; sendBtn.disabled = true; sendBtn.textContent = '남기는 중…';
    const r = await rpc('gb_post', { p_token: S.token, p_dog: S.target, p_body: sendable(text.value) });
    S.busy = false; sendBtn.textContent = '남기기';
    if (r.ok && r.note) {
      text.value = ''; paintCount();
      setSend('ok', `${TO[r.note.dog]} 남겼어요 ♥`);
      if (S.filter && S.filter !== r.note.dog) { S.filter = null; paintFilter(); loadList(true); return; }
      if (!S.notes.some((o) => o.id === r.note.id)) { S.notes.unshift(r.note); list.prepend(card(r.note)); paintEmpty(); }
      return;
    }
    paintCount();
    if (r.error === 'auth') { authLost(); return; }
    const msg = { slow: `조금만 천천히요. ${r.wait || 5}초 뒤에 다시 남겨 주세요.`, daily: '오늘은 여기까지 남길 수 있어요. 내일 또 남겨 주세요.', empty: '내용을 써 주세요.', long: `${MAX}자까지 쓸 수 있어요.`, dog: '누구에게 남길지 골라 주세요.' }[r.error] || failText(r);
    setSend('err', msg);
  });

  $('#gbOut').addEventListener('click', async () => {
    const t = S.token;
    store.set(TOKEN_KEY, null);
    text.value = '';
    toLogin('나왔어요. 또 와 주세요.');
    if (t) await rpc('gb_logout', { p_token: t });
  });

  // ---------------- 버튼 · 닫기 ----------------
  for (const b of document.querySelectorAll('.gb-open')) b.addEventListener('click', () => openBook(b));
  for (const b of root.querySelectorAll('[data-gb-close]')) b.addEventListener('click', closeBook);
  back.addEventListener('click', () => { if (S.downOnBack) closeBook(); S.downOnBack = false; });

  // 열려 있는 동안: 포인터 · 키는 방명록 안에서 끝난다 (3D 화면 · 강아지 고르기 · 방 나가기로 새지 않게)
  window.addEventListener('pointerdown', (e) => {
    if (!S.open) return;
    S.downOnBack = e.target === back;
    if (root.contains(e.target)) e.stopPropagation();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (!S.open) return;
    e.stopPropagation();
    const t = e.target;
    if (e.key === 'Escape') {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중에는 조합만 끝낸다
      e.preventDefault();
      const li = t && t.closest && t.closest('.gb-note');
      if (li && (S.editing === +li.dataset.id || S.confirming === +li.dataset.id)) {
        const n = S.notes.find((x) => x.id === +li.dataset.id);
        const act = S.editing === n.id ? 'edit' : 'del';
        S.editing = S.confirming = null; fillCard(li, n); focusAct(li, act); return;
      }
      closeBook(); return;
    }
    if (e.key === 'Tab') { trapTab(e); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t && t.tagName === 'TEXTAREA') { e.preventDefault(); const f = t.closest('form'); if (f) f.requestSubmit(); return; }
    if (t && t.getAttribute && t.getAttribute('role') === 'radio' && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault();
      const box = t.parentElement, radios = [...box.querySelectorAll('[role="radio"]')], i = radios.indexOf(t), d = /Right|Down/.test(e.key) ? 1 : -1;
      const nb = radios[(i + d + radios.length) % radios.length], sel = nb.dataset.name ? `[data-name="${nb.dataset.name}"]` : `[data-dog="${nb.dataset.dog}"]`;
      nb.click(); // 칩을 다시 그리므로 새로 그린 칩을 찾아 초점을 둔다
      (box.querySelector(sel) || nb).focus();
    }
  }, true);
  document.addEventListener('focusin', (e) => { if (S.open && !root.contains(e.target)) panel.focus({ preventScroll: true }); });
  function focusables() {
    return [...panel.querySelectorAll('button, input, textarea, [href], [tabindex="0"]')].filter((el) => !el.disabled && el.getClientRects().length && !el.closest('[hidden]'));
  }
  function trapTab(e) {
    const f = focusables(); if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
}
