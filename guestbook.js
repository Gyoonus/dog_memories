// 방명록 — 식구 다섯과 이모 · 삼촌이 강아지마다 따로 남기는 글 (Supabase · PostgREST RPC만 부른다)
// 강아지 방마다 그 강아지의 방명록 책이 놓여 있다: main.js가 책을 누르면 window에 'gb:open' 이벤트({ dog })를 보내고, 여기서 그 강아지의 방명록을 연다.
// 키보드로는 방 머리줄의 숨은 단추(#gbKey)로 연다 (어느 방인지는 #roomUI 제목에서 읽는다). 열려 있는 동안 키 · 포인터는 3D 쪽으로 보내지 않는다.
// 남이 쓴 글은 textContent로만 그린다 (innerHTML을 쓰지 않는다). Math.random · requestAnimationFrame도 쓰지 않는다 (점검 스크립트의 씨앗 흐름을 건드리지 않게).
// 핑키 · 재롱이 방명록에는 강아지 답장이 글 밑에 붙는다 (서버가 글을 쓰고 한 시간쯤 뒤에야 보내 준다 — 그 전에는 아무것도 그리지 않는다).
// 그 두 방명록을 펼쳐 둔 동안만 1분쯤마다 목록을 다시 받고, 책을 닫거나 탭을 숨기면 타이머를 모두 멈춘다.

const GB_URL = 'https://xqultctkqnwsowsayyiw.supabase.co'; // Supabase 프로젝트 주소 (예: https://abcd1234.supabase.co)
const GB_KEY = 'sb_publishable_t8ULF8CDx0VCLqrbA77Zvg_1JOb4N-D'; // publishable key (sb_publishable_...) 또는 예전 anon key (eyJ...)

const cfg = (typeof window !== 'undefined' && window.GB_CONFIG) || {};
const API = String(cfg.url != null ? cfg.url : GB_URL).trim().replace(/\/+$/, '');
const KEY = String(cfg.key != null ? cfg.key : GB_KEY).trim();
const READY = !!(API && KEY);

const TOKEN_KEY = 'gb_token', NAME_KEY = 'gb_name', GUEST_KEY = 'gb_guest_name'; // 기억하는 것: 토큰 · 마지막에 고른 칩 · 마지막 이모 · 삼촌 이름 (비밀번호는 기억하지 않는다)
const MAX = 500, PAGE = 20;
const MEMBERS = [{ name: '재롱맘' }, { name: '푸맘' }, { name: '푸파' }, { name: '규시기', admin: true }, { name: '담온니' }];
// 명단에 없는 분들은 여섯째 칩 '이모 · 삼촌'을 고르고 '영희 이모'처럼 이름을 써서, 함께 쓰는 비밀번호로 들어온다 (서버도 같은 규칙으로 다시 본다)
const GUEST = '*guest'; // 이모 · 삼촌 칩의 data-name (식구 이름과 겹치지 않는 값)
// 이모 · 삼촌 이름으로 쓸 수 없는 말: 강아지 이름 · 가족을 부르는 말 (서버 gb_private.guest_name 과 같은 목록 — 강아지 답장이 가족 · 형제로 읽지 않게)
const NOT_GUEST = ['엄마', '아빠', '언니', '누나', '오빠', '형', '누님', '온니', '핑키', '재롱', '재롱이', '담이', '푸푸', '알팡', '알팡이'];
function guestCheck(raw) {
  let v = String(raw || '').replace(/[­​-‏⁠﻿]/g, ''); // 보이지 않는 글자는 지운다 (붙여 넣은 이름도 받게. 서버도 같다)
  try { v = v.normalize('NFC'); } catch (e) { /* 오래된 브라우저: 그대로 */ }
  v = v.replace(/[  　]+/g, ' ').replace(/^ | $/g, '');
  if (!v) return { err: '이름을 써 주세요. (예: 영희 이모)' };
  const m = /^([가-힣A-Za-z0-9]{1,8}) ?(이모|삼촌)$/.exec(v);
  if (!m) {
    const pre = v.replace(/ ?(이모|삼촌)$/, '');
    if (pre === v) return { err: "이름 뒤에 '이모'나 '삼촌'을 붙여 주세요. (예: 영희 이모)" };
    if (!pre) return { err: "'이모' · '삼촌' 앞에 이름을 써 주세요. (예: 영희 이모)" };
    if (/\s/.test(pre)) return { err: '이름은 띄어 쓰지 않고 써 주세요. (예: 영희 이모)' };
    if (/[^가-힣A-Za-z0-9]/.test(pre)) return { err: '이름은 한글 · 영문 · 숫자만 쓸 수 있어요.' };
    return { err: '이름은 8글자까지 쓸 수 있어요.' };
  }
  if (MEMBERS.some((x) => x.name.toLowerCase() === m[1].toLowerCase())) return { err: '식구 이름은 위에서 골라 주세요.' };
  if (NOT_GUEST.includes(m[1])) return { err: "강아지 이름이나 '엄마' 같은 말은 이름으로 쓸 수 없어요. (예: 영희 이모)" };
  return { name: `${m[1]} ${m[2]}` };
}
// id · 이름 (방 제목과 같다) · "~에게" · 장소
const DOGS = [['pinky', '핑키', '핑키에게', '푸맘네 집'], ['dami', '담이', '담이에게', '동네 놀이터'], ['pupu', '푸푸', '푸푸에게', '남산 산책길'], ['jaerong', '재롱', '재롱이에게', '과천 호숫가 잔디밭'], ['alpang', '알팡', '알팡이에게', '의왕 아울렛']];
const DOG = {}; for (const [id, name, to, place] of DOGS) DOG[id] = { name, to, place };
const ROOM_DOG = {}; for (const [id, name] of DOGS) ROOM_DOG[name] = id; // 방 제목의 이름 → id
// 답장하는 강아지: 무지개다리를 건넌 핑키와 재롱이뿐 (담이 · 푸푸 · 알팡이 방명록에는 답장이 없다). 답장은 서버가 글을 쓰고 한 시간쯤 뒤에야 보내 준다
const REPLY = {
  pinky: { who: '핑키의 답장', ack: '핑키가 글을 읽었어요. 천천히 답장을 쓸 거예요.', ackEdit: '핑키가 고친 글을 읽었어요. 천천히 답장을 쓸 거예요.' },
  jaerong: { who: '재롱이의 답장', ack: '재롱이가 글을 읽었어요. 천천히 답장을 쓸 거예요.', ackEdit: '재롱이가 고친 글을 읽었어요. 천천히 답장을 쓸 거예요.' },
};
const RELIST_MS = 60000; // 핑키 · 재롱이 방명록을 펼쳐 두면 1분쯤마다 목록을 다시 받는다 (보일 때가 된 답장이 나타나게)
const POLL_MS = 2000, POLL_MAX = 45; // 보일 때가 지났는데 아직 쓰는 중인 답장(드물다)이 있을 때만 2초마다, 45번까지

const $ = (s, r = document) => r.querySelector(s);
const root = $('#gb');
if (root) setup();

function setup() {
  const panel = $('#gbPanel'), back = $('.gb-back', root), scroll = $('#gbScroll');
  const scr = { setup: $('#gbSetup'), login: $('#gbLogin'), wait: $('#gbWait'), book: $('#gbBook') };
  const meBox = $('#gbMe'), meName = $('#gbMeName');
  const namesEl = $('#gbNames'), pass = $('#gbPass'), peek = $('#gbPeek'), loginErr = $('#gbLoginErr'), enterBtn = $('#gbEnter');
  const guestBox = $('#gbGuestBox'), guestIn = $('#gbGuest'), passHint = $('#gbPassHint');
  const waitMsg = $('#gbWaitMsg'), retryBtn = $('#gbRetry');
  const text = $('#gbText'), count = $('#gbCount'), sendBtn = $('#gbSend'), sendMsg = $('#gbSendMsg');
  const list = $('#gbList'), empty = $('#gbEmpty'), more = $('#gbMore'), listMsg = $('#gbListMsg');
  const titleEl = $('#gbTitle'), placeEl = $('#gbPlace'), leadEl = $('#gbLoginLead');

  const S = {
    open: false, opener: null, token: null, me: null, pick: null, busy: false,
    dog: null, notes: [], more: false, loading: false, seq: 0, // dog: 지금 펼친 방명록의 강아지 (목록도 글도 이 강아지 것만)
    editing: null, confirming: null, clock: 0, downOnBack: false,
    relist: 0, poll: 0, polls: 0, acked: null, // 답장 타이머 (1분 목록 · 2초 확인) · 고친 뒤 '글을 읽었어요'를 보여 줄 글
  };
  const compose = scr.book.querySelector('.gb-compose');
  const ack = h('p', { class: 'gb-ack', role: 'status', hidden: true }); // 핑키 · 재롱이 방명록에 글을 남긴 뒤의 한 줄
  compose.append(ack);
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
  function openBook(opener, dog) {
    if (S.open || !DOG[dog]) return; // 방명록은 강아지마다 하나 (어느 강아지 것인지 모르면 열지 않는다)
    S.open = true; S.opener = opener || null; // 책을 눌러 열었으면 닫을 때 돌려줄 단추가 없다
    paintDog(dog);
    for (const id of ['selectUI', 'roomUI']) { const el = document.getElementById(id); if (el) el.inert = true; }
    root.hidden = false;
    for (const b of document.querySelectorAll('.gb-open')) b.setAttribute('aria-expanded', 'true');
    fitViewport();
    if (window.visualViewport) { visualViewport.addEventListener('resize', fitViewport); visualViewport.addEventListener('scroll', fitViewport); }
    startClock();
    panel.focus({ preventScroll: true });
    start();
  }
  function closeBook() {
    if (!S.open) return;
    S.open = false;
    root.hidden = true;
    stopTimers(); S.acked = null; // 닫으면 시계 · 목록 다시 받기 · 답장 확인을 모두 멈춘다
    pass.value = ''; showPass(false);
    if (window.visualViewport) { visualViewport.removeEventListener('resize', fitViewport); visualViewport.removeEventListener('scroll', fitViewport); }
    for (const id of ['selectUI', 'roomUI']) { const el = document.getElementById(id); if (el) el.inert = false; }
    for (const b of document.querySelectorAll('.gb-open')) b.setAttribute('aria-expanded', 'false');
    const o = S.opener; S.opener = null;
    if (o && o.isConnected && typeof o.focus === 'function') o.focus({ preventScroll: true });
    else if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur(); // 책을 눌러 열었으면 초점은 3D 화면(문서)으로
  }
  // 어느 강아지의 방명록인지: 제목 · 장소 · 들어가기 안내 · 쓰기 칸 안내. 다른 강아지 방명록을 펼치면 쓰던 글과 지난 목록은 비운다
  function paintDog(dog) {
    const d = DOG[dog], changed = S.dog !== dog;
    S.dog = dog;
    titleEl.textContent = `${d.name} 방명록`;
    placeEl.textContent = d.place;
    leadEl.textContent = `${d.to} 추억을 남겨 주세요`;
    text.placeholder = `${d.to} 한마디 남겨 주세요`;
    text.setAttribute('aria-label', `${d.to} 남길 글`);
    if (!changed) return;
    text.value = ''; setSend('', ''); paintCount();
    S.seq++; S.loading = false; S.notes = []; S.more = false; S.editing = S.confirming = S.acked = null; list.replaceChildren(); empty.hidden = true; more.hidden = true; listMsg.hidden = true;
    stopReplyTimers(); S.polls = 0;
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
    if (r.ok) { S.token = t; S.me = { name: r.name, admin: !!r.admin, guest: !!r.guest }; enterBook(); return; }
    if (r.error === 'auth') { store.set(TOKEN_KEY, null); toLogin(); return; }
    waitMsg.textContent = failText(r); retryBtn.hidden = false; retryBtn.focus({ preventScroll: true });
  }

  // ---------------- 들어가기 ----------------
  function toLogin(msg = '') {
    S.me = null; S.token = null; S.notes = []; S.editing = S.confirming = S.acked = null;
    stopReplyTimers();
    if (!S.pick) { const last = store.get(NAME_KEY); if (last === GUEST || MEMBERS.some((m) => m.name === last)) S.pick = last; }
    paintNames(); pass.value = ''; showPass(false); loginErr.textContent = msg; loginErr.classList.toggle('soft', !!msg);
    enterBtn.disabled = false; enterBtn.textContent = '들어가기';
    show('login');
    const sel = namesEl.querySelector('[aria-checked="true"]');
    (sel || namesEl.firstElementChild).focus({ preventScroll: true });
  }
  function pick(name) {
    S.pick = name; store.set(NAME_KEY, name); paintNames(); loginErr.textContent = '';
    if (name !== GUEST) { pass.focus(); return; }
    guestIn.focus(); try { guestIn.setSelectionRange(guestIn.value.length, guestIn.value.length); } catch (e) { /* 그만 */ }
  }
  // 식구 다섯 + 이모 · 삼촌 칩 (한 radiogroup). 이모 · 삼촌을 고르면 이름 칸이 나타나고, 지난번에 쓴 이름이 들어 있다
  function paintNames() {
    const chip = (key, label, admin) => h('button', {
      type: 'button', class: key === GUEST ? 'gb-name guest' : 'gb-name', role: 'radio', 'aria-checked': String(S.pick === key), 'data-name': key,
      'aria-label': admin ? `${label} (신)` : label, on: { click: () => pick(key) },
    }, h('span', { class: 'gb-name-t' }, label), admin ? h('span', { class: 'gb-name-s', 'aria-hidden': 'true' }, ' (신)') : null);
    namesEl.replaceChildren(...MEMBERS.map((m) => chip(m.name, m.name, m.admin)), chip(GUEST, '이모 · 삼촌'));
    const guest = S.pick === GUEST;
    guestBox.hidden = !guest;
    passHint.textContent = guest ? '이모 · 삼촌이 함께 쓰는 숫자' : '숫자 8자리';
    if (guest && !guestIn.value) guestIn.value = store.get(GUEST_KEY) || '';
  }
  const later = (min) => (min >= 90 ? `${Math.round(min / 60)}시간` : `${min}분`); // 기다릴 시간: 90분부터는 시간으로 (반올림)
  scr.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.busy) return;
    loginErr.classList.remove('soft');
    if (!S.pick) { loginErr.textContent = '누구인지 먼저 골라 주세요.'; namesEl.firstElementChild.focus(); return; }
    const guest = S.pick === GUEST;
    let name = S.pick;
    if (guest) {
      const g = guestCheck(guestIn.value);
      if (g.err) { loginErr.textContent = g.err; guestIn.focus(); return; }
      name = g.name;
    }
    const pw = pass.value.trim();
    if (guest && !pw) { loginErr.textContent = '비밀번호를 넣어 주세요.'; pass.focus(); return; }
    if (guest ? !/^\d{4,12}$/.test(pw) : !/^\d{8}$/.test(pw)) { loginErr.textContent = guest ? '비밀번호는 숫자 4~12자리예요.' : '비밀번호는 숫자 8자리예요.'; pass.focus(); return; }
    S.busy = true; enterBtn.disabled = true; enterBtn.textContent = '들어가는 중…'; loginErr.textContent = '';
    const r = await rpc('gb_login', { p_name: name, p_pass: pw });
    S.busy = false; enterBtn.disabled = false; enterBtn.textContent = '들어가기';
    if (!S.open) return;
    if (r.ok && r.token) {
      pass.value = ''; showPass(false);
      S.token = r.token; S.me = { name: r.name, admin: !!r.admin, guest: !!r.guest };
      store.set(TOKEN_KEY, r.token);
      if (r.guest) { store.set(GUEST_KEY, r.name); guestIn.value = r.name; } // 다음에 이모 · 삼촌을 고르면 이 이름이 들어 있다
      enterBook(); return;
    }
    if (r.error === 'wrong') { pass.value = ''; loginErr.textContent = `비밀번호가 달라요 (${r.left}번 더 틀리면 잠깐 잠겨요)`; pass.focus(); return; }
    if (r.error === 'locked') { pass.value = ''; loginErr.textContent = r.minutes > 1440 ? '지금은 이 이름으로 들어올 수 없어요.' : `너무 많이 틀렸어요. ${later(r.minutes || 15)} 뒤에 다시 해 주세요.`; return; }
    if (r.error === 'name') { loginErr.textContent = guest ? "이 이름으로는 들어올 수 없어요. '영희 이모'처럼 써 주세요." : '식구 이름을 찾을 수 없어요.'; if (guest) guestIn.focus(); return; }
    if (r.error === 'guest_off') { loginErr.textContent = '지금은 이모 · 삼촌 입장이 닫혀 있어요.'; return; }
    if (r.error === 'busy') { pass.value = ''; loginErr.textContent = `이모 · 삼촌 입장이 잠깐 막혀 있어요. ${later(r.minutes || 15)} 뒤에 다시 해 주세요.`; return; }
    if (r.error === 'full') { loginErr.textContent = '오늘은 처음 오신 분이 많아 더 받을 수 없어요. 내일 다시 와 주세요.'; return; }
    if (r.error === 'unknown') { loginErr.textContent = '식구 이름을 찾을 수 없어요.'; return; }
    loginErr.textContent = failText(r);
  });
  // 이름 칸에서 Enter (아래 keydown에서 부른다): 비밀번호가 비어 있으면 이름만 보고 비밀번호 칸으로, 다 써 있으면 그대로 들어가기
  function guestEnter(e) {
    if (e.isComposing || e.keyCode === 229 || pass.value) return; // 한글 조합 중이면 조합만 끝낸다
    e.preventDefault();
    const g = guestCheck(guestIn.value);
    loginErr.classList.remove('soft');
    if (g.err) { loginErr.textContent = g.err; return; }
    loginErr.textContent = ''; pass.focus();
  }
  guestIn.addEventListener('input', () => { if (loginErr.textContent && !loginErr.classList.contains('soft')) loginErr.textContent = ''; });
  pass.addEventListener('input', () => { const v = pass.value.replace(/\D/g, '').slice(0, 12); if (v !== pass.value) pass.value = v; });
  // 비밀번호 보기 · 숨기기 (숫자를 잘못 누르기 쉬우니 확인할 수 있게). 닫거나 들어가거나 나가면 다시 숨긴다
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
    paintCount();
    show('book');
    panel.focus({ preventScroll: true });
    loadList(true);
  }
  function setSend(kind, msg) {
    sendMsg.dataset.kind = kind; sendMsg.textContent = msg; sendMsg.className = `gb-msg ${kind === 'ok' ? 'ok' : 'err'}`;
    ack.hidden = true; // '글을 읽었어요'는 남긴 바로 뒤에만 (다시 쓰기 시작하거나 다른 안내가 나오면 지운다)
  }
  function showAck(dog) {
    if (!REPLY[dog]) return; // 담이 · 푸푸 · 알팡이 방명록에는 답장이 없어서 이 줄도 없다 (핑키 · 재롱이도 답장이 올 글에만: 부르는 쪽이 reply_pending을 본다)
    ack.replaceChildren(h('span', { class: 'gb-paw', 'aria-hidden': 'true' }, '🐾'), ' ', REPLY[dog].ack);
    ack.hidden = false;
  }
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
    const r = await rpc('gb_list', { p_token: S.token, p_dog: S.dog, p_before: before, p_limit: PAGE });
    if (seq !== S.seq || !S.open) { if (seq === S.seq) S.loading = false; return; } // 그사이 다른 걸 눌렀다 (더 새 목록을 부르는 중이면 그쪽이 loading을 푼다)
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
    armTimers();
  }
  function paintEmpty() {
    empty.hidden = S.notes.length > 0;
    if (!empty.hidden) empty.textContent = `아직 ${DOG[S.dog].to} 남긴 글이 없어요. 첫 글을 남겨 주세요`;
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
    kids.push(...replyParts(n));
    li.replaceChildren(...kids);
  }

  // ---------------- 강아지 답장 (핑키 · 재롱이 방명록만) ----------------
  // 서버는 보일 때(글을 쓰고 한 시간쯤 뒤)가 되기 전에는 reply를 null로 보낸다: 그 전에는 아무것도 그리지 않는다 (답장 글은 받지도 않는다).
  // 관리자(규시기)만 reply_admin으로 언제 보이는지를 받아, 글 밑에 작은 상태 한 줄만 본다 (답장 글은 관리자에게도 보일 때까지 오지 않는다)
  const isLetter = (s) => chars(s) > 120 || /\n/.test(s); // 가족에게 쓰는 긴 편지 (3~6문장 · 짧은 답장은 120자까지)
  // 끝의 ♥ · 🐾 묶음이 혼자 다음 줄로 떨어지지 않게: 그 앞 빈칸(과 ♥ 🐾 사이 빈칸)만 줄바꿈 없는 빈칸(U+00A0)으로 (글은 textContent로만 넣는다)
  const keepTail = (s) => String(s).replace(/[ \t]*((?:♥|🐾)(?:[ \t]*(?:♥|🐾))*)[ \t]*$/u,
    (m, run, at) => (at > 0 && /^[ \t]/.test(m) ? '\u00A0' : '') + run.replace(/[ \t]+/g, '\u00A0'));
  function soonText(iso) { // '오후 7:12' · '내일 오전 7:12' · '11월 14일 오전 7:12'
    const t = parse(iso), now = new Date();
    if (t.toDateString() === now.toDateString()) return clockText(t);
    if (t.toDateString() === new Date(now.getTime() + 86400000).toDateString()) return `내일 ${clockText(t)}`;
    return `${t.getMonth() + 1}월 ${t.getDate()}일 ${clockText(t)}`;
  }
  function replyParts(n) {
    const R = REPLY[n.dog];
    if (!R) return []; // 담이 · 푸푸 · 알팡이 (그리고 예전 '모두에게' 글)에는 답장이 없다
    const out = [], r = n.reply, a = S.me && S.me.admin ? n.reply_admin : null;
    const paw = () => h('span', { class: 'gb-paw', 'aria-hidden': 'true' }, '🐾');
    const done = !!(r && r.state === 'done' && typeof r.body === 'string' && r.body.trim());
    if (S.acked === n.id && !done) out.push(h('p', { class: 'gb-ack in-note', role: 'status', 'data-reply': 'ack' }, paw(), ' ', R.ackEdit));
    if (done) {
      out.push(h('div', { class: `gb-reply${isLetter(r.body) ? ' letter' : ''}`, role: 'group', 'aria-label': R.who, 'data-reply': 'reply', 'data-dog': n.dog },
        h('div', { class: 'gb-reply-top' },
          h('span', { class: 'gb-reply-who' }, paw(), ` ${R.who}`),
          r.at ? h('time', { class: 'gb-time gb-reply-time', datetime: r.at, title: fullDate(r.at), 'data-t': r.at }, when(r.at)) : null),
        h('p', { class: 'gb-reply-text' }, keepTail(r.body))));
    } else if (a && (a.state === 'wait' || a.state === 'done')) {
      // 관리자만: '답장 오후 7:12에 보여요' · '답장 준비 중' (+ 많이 힘들어 보이는 글이면 '마음을 살펴 주세요')
      const ahead = !r && parse(a.reveal_at).getTime() > Date.now();
      let msg = ahead ? `답장 ${soonText(a.reveal_at)}에 보여요` : '답장 준비 중';
      if (a.care) msg += ' · 마음을 살펴 주세요';
      out.push(h('p', { class: 'gb-reply-admin', 'data-reply': 'admin' }, paw(), ` ${msg}`));
    }
    return out;
  }
  // 답장 칸만 다시 그린다 (고치던 글 · 지우기 확인 · 초점은 그대로)
  function paintReply(li, n) {
    for (const e of li.querySelectorAll(':scope > [data-reply]')) e.remove();
    li.append(...replyParts(n));
  }
  function applyReply(n, e) { // 서버가 준 답장으로 바꾸고, 바뀐 글의 답장 칸만 다시 그린다
    const before = J(n.reply) + J(n.reply_admin);
    n.reply = e.reply === undefined ? null : e.reply;
    if (S.me && S.me.admin) n.reply_admin = e.reply_admin === undefined ? null : e.reply_admin;
    if (n.reply && n.reply.state === 'done' && S.acked === n.id) S.acked = null;
    if (J(n.reply) + J(n.reply_admin) === before) return;
    const li = list.querySelector(`:scope > li[data-id="${n.id}"]`);
    if (li) paintReply(li, n);
  }
  const J = (v) => JSON.stringify(v == null ? null : v);
  const waiting = () => S.notes.some((n) => REPLY[n.dog] && n.reply && n.reply.state === 'wait'); // 보일 때가 지났는데 아직 쓰는 중
  const inBook = () => S.open && !document.hidden && root.dataset.screen === 'book' && !!S.token && !!REPLY[S.dog];
  function startClock() { clearInterval(S.clock); S.clock = S.open && !document.hidden ? setInterval(refreshTimes, 30000) : 0; }
  function stopReplyTimers() { clearTimeout(S.relist); clearTimeout(S.poll); S.relist = S.poll = 0; }
  function stopTimers() { stopReplyTimers(); clearInterval(S.clock); S.clock = 0; }
  // 1분 뒤 목록 다시 받기 + (필요하면) 2초 뒤 답장 확인. 핑키 · 재롱이 방명록을 펼쳐 둔 동안만
  function armTimers() {
    stopReplyTimers();
    if (!inBook()) return;
    S.relist = setTimeout(relist, RELIST_MS);
    if (!waiting()) { S.polls = 0; return; }
    if (S.polls < POLL_MAX) S.poll = setTimeout(pollReplies, POLL_MS); // 45번(1분 반쯤)이 지나면 1분마다 다시 받는 목록에 맡긴다
  }
  // 목록 다시 받기: 이미 받은 글의 답장을 바꾸고, 그사이 새로 남긴 글은 맨 위에 더한다 (펼친 글 · 쓰던 글은 그대로)
  async function relist() {
    S.relist = 0;
    if (!inBook() || S.loading) { armTimers(); return; }
    const dog = S.dog, seq = S.seq;
    const r = await rpc('gb_list', { p_token: S.token, p_dog: dog, p_before: null, p_limit: Math.min(50, Math.max(PAGE, S.notes.length)) });
    if (!S.open || S.dog !== dog || seq !== S.seq) return; // 그사이 닫았거나 다른 방명록 · 새 목록 (그쪽이 타이머를 다시 건다)
    if (r.ok) {
      const top = S.notes.length ? S.notes[0].id : 0, fresh = [];
      for (const x of r.notes || []) {
        const n = S.notes.find((o) => o.id === x.id);
        if (n) applyReply(n, x); else if (x.id > top) fresh.push(x);
      }
      if (fresh.length) { S.notes.unshift(...fresh); list.prepend(...fresh.map(card)); paintEmpty(); }
    } else if (r.error === 'auth') { authLost(); return; }
    armTimers();
  }
  // 보일 때가 지났는데 아직 쓰는 중인 답장만 2초마다 확인 (gb_replies: 그 글들의 답장만 받는다)
  async function pollReplies() {
    S.poll = 0;
    if (!inBook()) return;
    const ids = S.notes.filter((n) => REPLY[n.dog] && n.reply && n.reply.state === 'wait').map((n) => n.id).slice(0, 50);
    if (!ids.length) { S.polls = 0; return; }
    S.polls++;
    const dog = S.dog, seq = S.seq;
    const r = await rpc('gb_replies', { p_token: S.token, p_ids: ids });
    if (!S.open || S.dog !== dog || seq !== S.seq) return;
    if (r.ok) for (const e of r.replies || []) { const n = S.notes.find((o) => o.id === e.id); if (n) applyReply(n, e); }
    else if (r.error === 'auth') { authLost(); return; }
    if (!inBook()) return;
    clearTimeout(S.poll); S.poll = 0;
    if (!waiting()) { S.polls = 0; return; }
    if (S.polls < POLL_MAX) S.poll = setTimeout(pollReplies, POLL_MS);
  }
  // 탭을 숨기면 타이머를 모두 멈추고, 다시 보이면 바로 한 번 받아 온 뒤 다시 건다
  document.addEventListener('visibilitychange', () => {
    if (!S.open) return;
    if (document.hidden) { stopTimers(); return; }
    startClock(); refreshTimes();
    if (inBook()) relist();
  });
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
      if (r.ok && r.note) {
        const changed = r.note.body !== n.body; // 내용이 바뀌면 서버가 답장을 새로 부탁한다 (고친 때부터 한 시간쯤 뒤)
        const pending = r.note.reply_pending === true; delete r.note.reply_pending; // 답장이 올 때만 '고친 글을 읽었어요'
        if (!('reply_admin' in r.note)) delete n.reply_admin;
        Object.assign(n, r.note); S.editing = null;
        if (changed && REPLY[n.dog] && pending) S.acked = n.id;
        else if (changed && S.acked === n.id) S.acked = null;
        fillCard(li, n); focusAct(li, 'edit'); armTimers(); return;
      }
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

  compose.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.busy || sendBtn.disabled) return;
    const n = chars(text.value);
    if (!n) { setSend('err', '내용을 써 주세요.'); return; }
    S.busy = true; sendBtn.disabled = true; sendBtn.textContent = '남기는 중…';
    const dog = S.dog;
    const r = await rpc('gb_post', { p_token: S.token, p_dog: dog, p_body: sendable(text.value) });
    S.busy = false; sendBtn.textContent = '남기기';
    if (r.ok && r.note) {
      if (S.dog !== dog) { paintCount(); return; } // 그사이 닫고 다른 강아지 방명록을 펼쳤다
      text.value = ''; paintCount();
      setSend('ok', `${DOG[r.note.dog] ? DOG[r.note.dog].to : ''} 남겼어요 ♥`);
      if (r.note.reply_pending === true) showAck(r.note.dog); // 핑키 · 재롱이: '…가 글을 읽었어요. 천천히 답장을 쓸 거예요.' (언제 오는지는 말하지 않는다 · 답장을 꺼 두었으면 말하지 않는다)
      delete r.note.reply_pending;
      if (r.note.dog === S.dog && !S.notes.some((o) => o.id === r.note.id)) { S.notes.unshift(r.note); list.prepend(card(r.note)); paintEmpty(); }
      armTimers();
      return;
    }
    paintCount();
    if (r.error === 'auth') { authLost(); return; }
    const msg = { slow: `조금만 천천히요. ${r.wait || 5}초 뒤에 다시 남겨 주세요.`, daily: r.guests ? '오늘은 이모 · 삼촌 글이 다 찼어요. 내일 또 남겨 주세요.' : '오늘은 여기까지 남길 수 있어요. 내일 또 남겨 주세요.', empty: '내용을 써 주세요.', long: `${MAX}자까지 쓸 수 있어요.` }[r.error] || failText(r);
    setSend('err', msg);
  });

  $('#gbOut').addEventListener('click', async () => {
    const t = S.token;
    store.set(TOKEN_KEY, null);
    text.value = '';
    toLogin('나왔어요. 또 와 주세요.');
    if (t) await rpc('gb_logout', { p_token: t });
  });

  // ---------------- 열기 · 닫기 ----------------
  // 방 안의 책을 누르면 main.js가 보낸다: window.dispatchEvent(new CustomEvent('gb:open', { detail: { dog } }))
  window.addEventListener('gb:open', (e) => { const dog = e && e.detail && e.detail.dog; if (typeof dog === 'string') openBook(null, dog); });
  for (const b of document.querySelectorAll('.gb-open')) b.addEventListener('click', () => openBook(b, roomDog())); // 키보드 · 화면 읽기용 숨은 단추: 지금 방의 강아지
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
    if (e.key === 'Enter' && t === guestIn) { guestEnter(e); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t && t.tagName === 'TEXTAREA') { e.preventDefault(); const f = t.closest('form'); if (f) f.requestSubmit(); return; }
    if (t && t.getAttribute && t.getAttribute('role') === 'radio' && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault();
      const box = t.parentElement, radios = [...box.querySelectorAll('[role="radio"]')], i = radios.indexOf(t), d = /Right|Down/.test(e.key) ? 1 : -1;
      const nb = radios[(i + d + radios.length) % radios.length], sel = `[data-name="${nb.dataset.name}"]`;
      nb.click(); // 이름 단추를 다시 그리므로 새로 그린 단추를 찾아 초점을 둔다
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
