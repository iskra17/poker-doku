// 보너스 CG 루프 검토 화면 생성 — 50 루프(mp4/webm 100파일) + 원화를 한 페이지에서 승인/반려하고 반려 목록을 뽑는다.
// 사용: node scripts/art/bonus-cg/review-page.mjs [staging=C:/code/claude/poker-doku-art/bonus-cg] [ledger=D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906]
// 출력: <staging>/review/index.html (file:// 로 열면 됨 — 미디어는 ../encode-probe, ../out 상대 경로). 검토 상태는 브라우저 localStorage에 남는다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const STAGING = (process.argv[2] ?? 'C:/code/claude/poker-doku-art/bonus-cg').replace(/\\/g, '/');
const LEDGER = (process.argv[3] ?? 'D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906').replace(/\\/g, '/');
const plan = JSON.parse(fs.readFileSync(new URL('./bonus-cg-plan-2026-09-06.json', import.meta.url), 'utf8'));
const SCENES = ['beach', 'gym', 'yoga', 'sing', 'casual'];

// (캐릭터, 장면)의 최신 비반려 원화 job → 그 원화의 최신 비반려 video job (재생성 -v2 … 자동 추적)
function resolveVideoJob(db, cid, scene, image) {
  if (!db) return `${image}-video`;
  const img = db.prepare("SELECT id FROM jobs WHERE character=? AND scene=? AND kind!='video' AND state!='rejected' ORDER BY created DESC LIMIT 1").get(cid, scene)?.id ?? image;
  const row = db.prepare("SELECT id, state FROM jobs WHERE json_extract(spec,'$.job.parent_job')=? AND state!='rejected' ORDER BY created DESC LIMIT 1").get(img);
  if (!row) return { job: `${image}-video`, loopPending: true };
  return { job: row.id, loopPending: ['pending', 'submitted', 'running', 'queued', 'failed'].includes(row.state) };
}

let db = null;
try { db = new DatabaseSync(path.join(LEDGER, 'library.sqlite3'), { readOnly: true }); } catch { db = null; }

const kb = (file) => (fs.existsSync(file) ? Math.round(fs.statSync(file).size / 1024) : null);
const items = [];
const missing = [];
for (const c of plan.characters) {
  for (const scene of SCENES) {
    const image = `bonus-${c.id}-${scene}`;
    const resolved = resolveVideoJob(db, c.id, scene, image);
    let job = resolved.job;
    // 루프가 아직 없거나(생성 중) probe 인코딩이 없으면 카드는 원화만 보여 주고 결정을 잠근다
    const loopPending = resolved.loopPending || !fs.existsSync(`${STAGING}/encode-probe/${job}.mp4`);
    const still = `${STAGING}/out/${c.id}/${scene}.png`;
    const item = {
      key: `${c.id}:${scene}`, id: c.id, name: c.name_ko, age: c.age, scene, sceneTitle: plan.scenes[scene].title_ko, job,
      mp4: `../encode-probe/${job}.mp4`, webm: `../encode-probe/${job}.webm`, still: `../out/${c.id}/${scene}.png`,
      mp4Kb: kb(`${STAGING}/encode-probe/${job}.mp4`), webmKb: kb(`${STAGING}/encode-probe/${job}.webm`), stillKb: kb(still),
      prompt: c.scenes[scene], loopPending,
    };
    for (const [label, present] of [['mp4', item.mp4Kb], ['webm', item.webmKb], ['png', item.stillKb]]) if (present === null) missing.push(`${item.key} ${label}`);
    items.push(item);
  }
}

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>보너스 CG 루프 검토 — ${plan.batch}</title>
<style>
:root { color-scheme: dark; --bg:#12111a; --panel:#1c1a27; --line:#2f2c40; --text:#ece8f5; --muted:#9a94b3; --ok:#3ddc97; --ng:#ff5d7a; --accent:#c99cff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font: 14px/1.45 system-ui, "Pretendard", "Malgun Gothic", sans-serif; }
header { position: sticky; top:0; z-index:20; background:rgba(18,17,26,.96); backdrop-filter: blur(6px); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; }
header h1 { font-size:16px; margin:0 12px 0 0; }
.counts span { margin-right:10px; color:var(--muted); }
.counts b { color:var(--text); }
.counts .ok b { color:var(--ok); } .counts .ng b { color:var(--ng); }
.group { display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
button, select, input[type=text] { font: inherit; color:var(--text); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:5px 10px; cursor:pointer; }
button:hover { border-color:var(--accent); }
button.on { background:var(--accent); color:#1a1030; border-color:var(--accent); font-weight:600; }
button.ok.on { background:var(--ok); border-color:var(--ok); }
button.ng.on { background:var(--ng); border-color:var(--ng); }
main { padding:14px 16px 60px; }
.section { margin-bottom:26px; }
.section h2 { font-size:15px; margin:0 0 8px; color:var(--accent); display:flex; gap:10px; align-items:baseline; }
.section h2 small { color:var(--muted); font-weight:400; }
.grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fill, minmax(var(--card,320px), 1fr)); }
.card { background:var(--panel); border:2px solid var(--line); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }
.card.ok { border-color:var(--ok); } .card.ng { border-color:var(--ng); }
.card .head { padding:8px 10px 4px; display:flex; justify-content:space-between; align-items:baseline; gap:6px; }
.card .head b { font-size:14px; }
.card .head code { color:var(--muted); font-size:11px; }
.media { position:relative; aspect-ratio: 2 / 3; background:#000; cursor: zoom-in; }
.media video, .media img { width:100%; height:100%; object-fit:contain; display:block; }
.media img { display:none; }
.media.still video { display:none; } .media.still img { display:block; }
.media .badge { position:absolute; left:6px; top:6px; font-size:11px; padding:2px 6px; border-radius:6px; background:rgba(0,0,0,.6); color:#fff; }
.media .err { position:absolute; inset:0; display:none; place-items:center; color:var(--ng); background:rgba(0,0,0,.7); font-weight:600; }
.media.broken .err { display:grid; }
.foot { padding:8px 10px 10px; display:flex; flex-direction:column; gap:6px; }
.foot .meta { color:var(--muted); font-size:11px; display:flex; justify-content:space-between; }
.foot .actions { display:flex; gap:6px; }
.foot .actions button { flex:1; }
.foot input { width:100%; }
.hidden { display:none !important; }
#lb { position:fixed; inset:0; z-index:50; background:rgba(0,0,0,.92); display:none; flex-direction:column; }
#lb.open { display:flex; }
#lb .bar { display:flex; gap:8px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
#lb .bar b { margin-right:auto; }
#lb .body { flex:1; display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:12px 16px; min-height:0; }
#lb .pane { position:relative; min-height:0; display:flex; flex-direction:column; gap:6px; }
#lb .pane .label { color:var(--muted); font-size:12px; }
#lb video, #lb img { flex:1; min-height:0; width:100%; object-fit:contain; background:#000; border-radius:8px; }
#lb .prompt { grid-column: 1 / -1; color:var(--muted); font-size:12px; max-height:64px; overflow:auto; }
#sheet { position:fixed; inset:0; z-index:60; background:rgba(0,0,0,.85); display:none; place-items:center; }
#sheet.open { display:grid; }
#sheet .box { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; width:min(720px, 92vw); display:flex; flex-direction:column; gap:10px; }
#sheet textarea { width:100%; height:260px; font: 13px/1.4 ui-monospace, Consolas, monospace; background:#0f0e16; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px; }
kbd { border:1px solid var(--line); border-radius:4px; padding:0 4px; font-size:11px; color:var(--muted); }
.help { color:var(--muted); font-size:12px; width:100%; }
</style>
</head>
<body>
<header>
  <h1>보너스 CG 루프 검토 <small style="color:var(--muted);font-weight:400">${plan.batch} · ${items.length}루프 · mp4/webm ${items.length * 2}파일</small></h1>
  <div class="counts"><span>미검토 <b id="cPending">0</b></span><span class="ok">승인 <b id="cOk">0</b></span><span class="ng">반려 <b id="cNg">0</b></span></div>
  <div class="group" id="filters">
    <button data-f="all" class="on">전체</button><button data-f="pending">미검토</button><button data-f="ok">승인</button><button data-f="ng">반려</button>
  </div>
  <div class="group">
    <select id="fmt"><option value="mp4">mp4 재생</option><option value="webm">webm 재생</option></select>
    <button id="autoplay" class="on">자동 재생</button>
    <button id="stillAll">원화 보기</button>
    <select id="size"><option value="200">작게</option><option value="240">보통</option><option value="320" selected>크게</option><option value="420">아주 크게</option></select>
  </div>
  <div class="group" id="chars"><button data-c="all" class="on">전원</button>${plan.characters.map((c) => `<button data-c="${c.id}">${c.name_ko}</button>`).join('')}</div>
  <div class="group">
    <button id="exportNg">반려 목록</button>
    <button id="exportJson">JSON 저장</button>
    <label><input type="file" id="importJson" accept="application/json" class="hidden"><button id="importBtn">JSON 불러오기</button></label>
    <button id="reset">초기화</button>
  </div>
  <div class="help">카드 클릭 = 크게 보기(원화와 나란히, 처음/끝 프레임 이음새 확인). 단축키(크게 보기): <kbd>A</kbd> 승인 <kbd>R</kbd> 반려 <kbd>S</kbd> 원화/영상 <kbd>←</kbd><kbd>→</kbd> 이동 <kbd>Esc</kbd> 닫기. 상태는 이 브라우저에 자동 저장.</div>
</header>
<main id="main"></main>

<div id="lb">
  <div class="bar">
    <b id="lbTitle"></b>
    <button id="lbPrev">← 이전</button><button id="lbNext">다음 →</button>
    <button id="lbPlay">재생/정지</button><button id="lbFirst">처음 프레임</button><button id="lbLast">끝 프레임</button>
    <button id="lbFmt">webm로 보기</button>
    <button id="lbOk" class="ok">승인 (A)</button><button id="lbNg" class="ng">반려 (R)</button>
    <input type="text" id="lbNote" placeholder="반려 사유 / 메모" style="min-width:220px">
    <button id="lbClose">닫기 (Esc)</button>
  </div>
  <div class="body">
    <div class="pane"><div class="label" id="lbVideoLabel">루프</div><video id="lbVideo" muted loop playsinline controls></video></div>
    <div class="pane"><div class="label">원화 (GPT Image 2)</div><img id="lbStill" alt=""></div>
    <div class="prompt" id="lbPrompt"></div>
  </div>
</div>

<div id="sheet"><div class="box"><b id="sheetTitle"></b><textarea id="sheetText" readonly></textarea><div class="group"><button id="sheetCopy">복사</button><button id="sheetClose">닫기</button><span id="sheetMsg" style="color:var(--muted)"></span></div></div></div>

<script>
const ITEMS = ${JSON.stringify(items)};
const KEY = 'bonus-cg-review-${plan.batch}';
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { state = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
// job 필드가 없는 예전 결정은 첫 검토 화면(2026-09-06)의 job에 묶는다 — 원본 클립, 린 요가만 v4.
for (const it of ITEMS) { const s = state[it.key]; if (s && !s.job && (s.d || s.n)) s.job = it.key === 'lin:yoga' ? 'bonus-lin-yoga-video-v4' : 'bonus-' + it.id + '-' + it.scene + '-video'; }
save();
const ui = { filter: 'all', char: 'all', fmt: 'mp4', autoplay: true, stillAll: false, size: 240 };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byKey = new Map(ITEMS.map((it) => [it.key, it]));
const cards = new Map();

// 결정은 검토 당시의 video job에 묶인다 — 클립이 재생성돼 job id가 바뀌면 자동으로 '미검토'로 돌아온다(메모는 남김).
function decision(key) { const s = state[key]; if (!s) return ''; if (s.job && s.job !== byKey.get(key).job) return ''; return s.d || ''; }
function setDecision(key, d) {
  state[key] = { ...(state[key] || {}), d: decision(key) === d ? '' : d, job: byKey.get(key).job };
  save(); paint(key); counts(); applyFilter();
}
function setNote(key, n) { state[key] = { ...(state[key] || {}), n }; save(); }

function build() {
  const main = $('#main');
  const chars = [...new Set(ITEMS.map((i) => i.id))];
  for (const id of chars) {
    const its = ITEMS.filter((i) => i.id === id);
    const sec = document.createElement('section');
    sec.className = 'section'; sec.dataset.char = id;
    sec.innerHTML = '<h2>' + its[0].name + ' <small>' + id + ' · ' + its[0].age + '세</small></h2><div class="grid"></div>';
    const grid = $('.grid', sec);
    for (const it of its) {
      const card = document.createElement('article');
      card.className = 'card'; card.dataset.key = it.key;
      card.innerHTML =
        '<div class="head"><b>' + it.sceneTitle + '</b><code>' + it.key + '</code></div>' +
        '<div class="media' + (it.loopPending ? ' still' : '') + '"><span class="badge">' + (it.loopPending ? '⏳ 루프 생성 중 — 원화만' : it.job + (state[it.key]?.job && state[it.key].job !== it.job ? ' · 재생성됨' : '')) + '</span>' +
        '<video muted loop playsinline preload="metadata" poster="' + it.still + '"></video>' +
        '<img loading="lazy" src="' + it.still + '" alt="' + it.key + ' 원화"><div class="err">파일 없음/재생 실패</div></div>' +
        '<div class="foot"><div class="meta"><span>mp4 ' + (it.mp4Kb ?? '—') + 'KB · webm ' + (it.webmKb ?? '—') + 'KB</span><button class="stillBtn" style="padding:1px 8px;font-size:11px">원화</button></div>' +
        '<div class="actions"><button class="ok">✅ 승인</button><button class="ng">❌ 반려</button></div>' +
        '<input type="text" placeholder="반려 사유 / 메모" value="' + (state[it.key]?.n || '').replace(/"/g, '&quot;') + '"></div>';
      const video = $('video', card);
      if (it.loopPending) { for (const b of $$('.actions button', card)) { b.disabled = true; b.title = '루프가 나오면 검토할 수 있어요'; } }
      else video.src = ui.fmt === 'mp4' ? it.mp4 : it.webm;
      video.addEventListener('error', () => $('.media', card).classList.add('broken'));
      video.addEventListener('loadeddata', () => $('.media', card).classList.remove('broken'));
      $('.media', card).addEventListener('click', () => openLb(it.key));
      $('.stillBtn', card).addEventListener('click', () => $('.media', card).classList.toggle('still'));
      $('button.ok', card).addEventListener('click', () => setDecision(it.key, 'ok'));
      $('button.ng', card).addEventListener('click', () => setDecision(it.key, 'ng'));
      $('input', card).addEventListener('input', (e) => setNote(it.key, e.target.value));
      grid.appendChild(card); cards.set(it.key, card); paint(it.key);
      io.observe(video);
    }
    main.appendChild(sec);
  }
}
function paint(key) {
  const card = cards.get(key); if (!card) return;
  const d = decision(key);
  card.classList.toggle('ok', d === 'ok'); card.classList.toggle('ng', d === 'ng');
  $('button.ok', card).classList.toggle('on', d === 'ok'); $('button.ng', card).classList.toggle('on', d === 'ng');
}
function counts() {
  let ok = 0, ng = 0;
  for (const it of ITEMS) { const d = decision(it.key); if (d === 'ok') ok++; else if (d === 'ng') ng++; }
  $('#cOk').textContent = ok; $('#cNg').textContent = ng; $('#cPending').textContent = ITEMS.length - ok - ng;
}
function applyFilter() {
  for (const it of ITEMS) {
    const card = cards.get(it.key); const d = decision(it.key) || 'pending';
    const show = (ui.filter === 'all' || ui.filter === d) && (ui.char === 'all' || ui.char === it.id);
    card.classList.toggle('hidden', !show);
  }
  for (const sec of $$('.section')) sec.classList.toggle('hidden', $$('.card:not(.hidden)', sec).length === 0);
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting && ui.autoplay && !$('#lb').classList.contains('open')) { if (v.preload !== 'auto') v.preload = 'auto'; v.play().catch(() => {}); }
    else v.pause();
  }
}, { threshold: 0.25 });
function refreshSources() {
  for (const it of ITEMS) { if (it.loopPending) continue; const v = $('video', cards.get(it.key)); const src = ui.fmt === 'mp4' ? it.mp4 : it.webm; if (v.getAttribute('src') !== src) { v.src = src; v.load(); } }
}

// 크게 보기
let lbKey = null; let lbFmt = 'mp4';
function visibleKeys() { return ITEMS.map((i) => i.key).filter((k) => !cards.get(k).classList.contains('hidden')); }
function openLb(key) {
  lbKey = key; const it = byKey.get(key); lbFmt = ui.fmt;
  $('#lbTitle').textContent = it.name + ' · ' + it.sceneTitle + ' (' + it.key + ') — ' + it.job;
  $('#lbVideo').src = lbFmt === 'mp4' ? it.mp4 : it.webm; $('#lbVideoLabel').textContent = '루프 · ' + lbFmt + ' ' + (lbFmt === 'mp4' ? it.mp4Kb : it.webmKb) + 'KB';
  $('#lbFmt').textContent = lbFmt === 'mp4' ? 'webm로 보기' : 'mp4로 보기';
  $('#lbStill').src = it.still; $('#lbPrompt').textContent = it.prompt; $('#lbNote').value = state[key]?.n || '';
  paintLb(); $('#lb').classList.add('open');
  for (const v of $$('.card video')) v.pause();
  $('#lbVideo').play().catch(() => {});
}
function paintLb() { const d = decision(lbKey); $('#lbOk').classList.toggle('on', d === 'ok'); $('#lbNg').classList.toggle('on', d === 'ng'); }
function closeLb() { $('#lb').classList.remove('open'); $('#lbVideo').pause(); $('#lbVideo').removeAttribute('src'); $('#lbVideo').load(); lbKey = null; for (const v of $$('.card video')) io.unobserve(v), io.observe(v); }
function moveLb(delta) { const keys = visibleKeys(); const i = keys.indexOf(lbKey); const next = keys[(i + delta + keys.length) % keys.length]; if (next) openLb(next); }
$('#lbClose').addEventListener('click', closeLb);
$('#lbPrev').addEventListener('click', () => moveLb(-1)); $('#lbNext').addEventListener('click', () => moveLb(1));
$('#lbPlay').addEventListener('click', () => { const v = $('#lbVideo'); v.paused ? v.play() : v.pause(); });
$('#lbFirst').addEventListener('click', () => { const v = $('#lbVideo'); v.pause(); v.currentTime = 0; });
$('#lbLast').addEventListener('click', () => { const v = $('#lbVideo'); v.pause(); v.currentTime = Math.max(0, (v.duration || 4.4) - 0.05); });
$('#lbFmt').addEventListener('click', () => { const it = byKey.get(lbKey); lbFmt = lbFmt === 'mp4' ? 'webm' : 'mp4'; $('#lbVideo').src = lbFmt === 'mp4' ? it.mp4 : it.webm; $('#lbVideoLabel').textContent = '루프 · ' + lbFmt + ' ' + (lbFmt === 'mp4' ? it.mp4Kb : it.webmKb) + 'KB'; $('#lbFmt').textContent = lbFmt === 'mp4' ? 'webm로 보기' : 'mp4로 보기'; $('#lbVideo').play().catch(() => {}); });
$('#lbOk').addEventListener('click', () => { setDecision(lbKey, 'ok'); paintLb(); });
$('#lbNg').addEventListener('click', () => { setDecision(lbKey, 'ng'); paintLb(); });
$('#lbNote').addEventListener('input', (e) => { setNote(lbKey, e.target.value); $('input', cards.get(lbKey)).value = e.target.value; });
document.addEventListener('keydown', (e) => {
  if (!$('#lb').classList.contains('open')) return;
  if (e.target === $('#lbNote')) { if (e.key === 'Escape') { e.target.blur(); } return; }
  const k = e.key.toLowerCase();
  if (k === 'escape') closeLb(); else if (k === 'arrowleft') moveLb(-1); else if (k === 'arrowright') moveLb(1);
  else if (k === 'a') { setDecision(lbKey, 'ok'); paintLb(); } else if (k === 'r') { setDecision(lbKey, 'ng'); paintLb(); }
  else if (k === 's') { const v = $('#lbVideo'); v.style.display = v.style.display === 'none' ? '' : 'none'; }
  else if (k === ' ') { e.preventDefault(); $('#lbPlay').click(); }
});

// 툴바
$('#filters').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ui.filter = b.dataset.f; $$('#filters button').forEach((x) => x.classList.toggle('on', x === b)); applyFilter(); });
$('#chars').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ui.char = b.dataset.c; $$('#chars button').forEach((x) => x.classList.toggle('on', x === b)); applyFilter(); });
$('#fmt').addEventListener('change', (e) => { ui.fmt = e.target.value; refreshSources(); });
$('#autoplay').addEventListener('click', (e) => { ui.autoplay = !ui.autoplay; e.target.classList.toggle('on', ui.autoplay); for (const v of $$('.card video')) { if (ui.autoplay) { io.unobserve(v); io.observe(v); } else v.pause(); } });
$('#stillAll').addEventListener('click', (e) => { ui.stillAll = !ui.stillAll; e.target.classList.toggle('on', ui.stillAll); for (const m of $$('.card .media')) m.classList.toggle('still', ui.stillAll); });
$('#size').addEventListener('change', (e) => { document.documentElement.style.setProperty('--card', e.target.value + 'px'); });

function rejectText() {
  const ng = ITEMS.filter((i) => decision(i.key) === 'ng');
  const pending = ITEMS.filter((i) => !decision(i.key));
  const lines = ['반려 ' + ng.length + '건 (' + new Date().toLocaleString('ko-KR') + ')', ng.map((i) => i.key).join(', '), '', ...ng.map((i) => i.key + ' — ' + i.name + ' ' + i.sceneTitle + (state[i.key]?.n ? ' — ' + state[i.key].n : ''))];
  const waiting = pending.filter((i) => i.loopPending); const todo = pending.filter((i) => !i.loopPending);
  if (todo.length) lines.push('', '미검토 ' + todo.length + '건: ' + todo.map((i) => i.key).join(', '));
  if (waiting.length) lines.push('', '루프 생성 중 ' + waiting.length + '건: ' + waiting.map((i) => i.key).join(', '));
  return lines.join('\\n');
}
function openSheet(title, text) { $('#sheetTitle').textContent = title; $('#sheetText').value = text; $('#sheetMsg').textContent = ''; $('#sheet').classList.add('open'); }
$('#sheetClose').addEventListener('click', () => $('#sheet').classList.remove('open'));
$('#sheetCopy').addEventListener('click', async () => { const t = $('#sheetText'); t.select(); let ok = false; try { await navigator.clipboard.writeText(t.value); ok = true; } catch { ok = document.execCommand && document.execCommand('copy'); } $('#sheetMsg').textContent = ok ? '복사했어요' : '복사 실패 — 텍스트를 직접 선택해 복사하세요'; });
$('#exportNg').addEventListener('click', () => openSheet('반려 목록 (캐릭터:장면)', rejectText()));
$('#exportJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ batch: '${plan.batch}', savedAt: new Date().toISOString(), decisions: state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bonus-cg-review-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importBtn').addEventListener('click', () => $('#importJson').click());
$('#importJson').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); state = data.decisions || data; save(); for (const it of ITEMS) { paint(it.key); $('input', cards.get(it.key)).value = state[it.key]?.n || ''; } counts(); applyFilter(); } catch { alert('JSON을 읽지 못했어요'); } e.target.value = ''; });
let resetArmed = false;
$('#reset').addEventListener('click', (e) => { if (!resetArmed) { resetArmed = true; e.target.textContent = '정말 초기화? (다시 클릭)'; setTimeout(() => { resetArmed = false; e.target.textContent = '초기화'; }, 3000); return; } state = {}; save(); for (const it of ITEMS) { paint(it.key); $('input', cards.get(it.key)).value = ''; } counts(); applyFilter(); resetArmed = false; e.target.textContent = '초기화'; });

build(); counts(); applyFilter();
</script>
</body>
</html>`;

fs.mkdirSync(`${STAGING}/review`, { recursive: true });
fs.writeFileSync(`${STAGING}/review/index.html`, html, 'utf8');
console.log(`wrote ${STAGING}/review/index.html — ${items.length} loops`);
if (missing.length) console.log('missing files:', missing.join(' | '));
for (const it of items) if (!it.job.endsWith('-video')) console.log(`regenerated clip: ${it.key} -> ${it.job}`);
