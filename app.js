/* =========================================================
   RPS Cards — app.js（安定版フル／デッドロック解消）
   ========================================================= */

/* [01] モバイル対策 */
window.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });
['gesturestart','gesturechange','gestureend'].forEach(ev=>{
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
});
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false, capture: true });
document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
(async () => { try { if (screen.orientation?.lock) await screen.orientation.lock('portrait'); } catch(_) {} })();

/* [02] 効果音（SFX） */
class SFX {
  constructor() { this.ctx=null; this.enabled=true; }
  ensure(){ if(!this.ctx){ const AC=window.AudioContext||window.webkitAudioContext; if(AC) this.ctx=new AC(); } if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); }
  tone({freq=440,dur=0.08,type='sine',gain=0.06,attack=0.005,release=0.04}){
    if(!this.enabled) return; this.ensure(); if(!this.ctx) return;
    const t0=this.ctx.currentTime, osc=this.ctx.createOscillator(), g=this.ctx.createGain();
    osc.type=type; osc.frequency.value=freq; g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(gain,t0+attack);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+dur+release); osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0+attack+dur+release+0.01);
  }
  click(){ this.tone({freq:900,dur:0.03,type:'square',gain:0.04}); }
  play(){ this.tone({freq:660,dur:0.06,type:'triangle',gain:0.05}); }
  win(){ this.tone({freq:740,dur:0.09,type:'sine',gain:0.06}); setTimeout(()=>this.tone({freq:880,dur:0.09}),90); }
  lose(){ this.tone({freq:200,dur:0.12,type:'sawtooth',gain:0.05}); }
  swap(){ this.tone({freq:520,dur:0.06}); setTimeout(()=>this.tone({freq:420,dur:0.06}),70); }
  barrier(){ this.tone({freq:320,dur:0.05}); setTimeout(()=>this.tone({freq:260,dur:0.05}),60); }
  penalty(){ this.tone({freq:180,dur:0.05}); }
  tick(){ this.tone({freq:1000,dur:0.03,type:'square',gain:0.04}); }
  timesup(){ this.tone({freq:140,dur:0.18,type:'sawtooth',gain:0.06}); }
}
const sfx = new SFX();
['touchstart','mousedown','keydown'].forEach(ev=>{
  window.addEventListener(ev, ()=> sfx.ensure(), { once:true, passive:true });
});

/* [03] Firebase 初期化（CDN） */
const { initializeApp, getDatabase, ref, onValue, set, update, get, child, serverTimestamp, remove } = window.FirebaseAPI;

// ★あなたの設定
const firebaseConfig = {
  apiKey: "AIzaSyBfrZSzcdCazQii03POnM--fRRMOa5LEs0",
  authDomain: "rps-cards-pwa.firebaseapp.com",
  databaseURL: "https://rps-cards-pwa-default-rtdb.firebaseio.com/",
  projectId: "rps-cards-pwa",
  storageBucket: "rps-cards-pwa.appspot.com",
  messagingSenderId: "1080977402813",
  appId: "1:1080977402813:web:2a82ba4946c6e9717e40d4",
  measurementId: "G-BZM8R02K18"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

/* [04] DOM取得 */
const $ = s => document.querySelector(s);
const playerName = $("#playerName");
const btnCreate  = $("#btnCreate");
const joinId     = $("#joinId");
const btnJoin    = $("#btnJoin");
const btnCopy    = $("#btnCopy");

const auth       = $("#auth");
const lobby      = $("#lobby");
const roomIdLabel= $("#roomIdLabel");
const p1Label    = $("#p1Label");
const p2Label    = $("#p2Label");
const btnStart   = $("#btnStart");
const btnLeave   = $("#btnLeave");

const game       = $("#game");
const roundNo    = $("#roundNo");
const minRoundsEl= $("#minRounds");
const timerEl    = $("#timer");
const diffEl     = $("#diff");
const boardEl    = $("#board");
const mePosEl    = $("#mePos");
const opPosEl    = $("#opPos");
const stateMsg   = $("#stateMsg");
const meChoiceEl = $("#meChoice");
const opChoiceEl = $("#opChoice");
const resultText = $("#resultText");
const btnPlay    = $("#btnPlay");
const btnClear   = $("#btnClear");
const btnExit    = $("#btnExit");

const cardBtns   = [...document.querySelectorAll(".cardBtn")];
const cntG       = $("#cntG"), cntC=$("#cntC"), cntP=$("#cntP"), cntWIN=$("#cntWIN"), cntSWAP=$("#cntSWAP"), cntBARRIER=$("#cntBARRIER");

/* [04.5] 名前必須ガード */
if (playerName && btnCreate && btnJoin) {
  btnCreate.disabled = true;
  btnJoin.disabled   = true;
  playerName.addEventListener('input', () => {
    const ok = playerName.value.trim().length >= 1;
    btnCreate.disabled = !ok;
    btnJoin.disabled   = !ok;
  });
}

/* [05] 定数 */
const BOARD_SIZE = 25;
const MIN_ROUNDS = 8;
const TURN_TIME  = 10_000; // ms
const REVEAL_MS  = 3000;   // ms（3,2,1）
const HAND_INIT  = { G:4, C:4, P:4, WIN:1, SWAP:1, BARRIER:1 };

/* [06] 状態 */
let myId = rid(6);
let myName = "";
let roomId = "";
let seat = ""; // "p1" or "p2"
let unsubRoom = null;
let selectedCard = null;
let localTimer = null;
let lastBeepSec = null;
let roundLocked = false;

let curRoom = null;
let overlayShownRound = 0;
let poller = null;         // 統合ポーラー（演出＆結果確定＆自動次R）
let countdownTicker = null;
let overlayTimerId = null;
let resultOverlayEl = null;

/* [07] 初期描画（盤面） */
makeBoard();

/* [08] イベント紐づけ */
if (btnCreate) btnCreate.onclick = async () => {
  sfx.click();
  const name = (playerName.value || "").trim();
  if (name.length < 1) { alert("名前を1文字以上入力してね"); playerName.focus(); return; }
  myName = name;
  roomId = rid(6);
  seat = "p1";
  try { await createRoom(roomId, myName); enterLobby(); }
  catch (e) { console.error("createRoom failed:", e); alert("部屋作成に失敗しました：" + (e?.message || e)); }
};

if (btnJoin) btnJoin.onclick = async () => {
  sfx.click();
  const name = (playerName.value || "").trim();
  if (name.length < 1) { alert("名前を1文字以上入力してね"); playerName.focus(); return; }
  myName = name;
  roomId = (joinId.value || "").trim().toUpperCase();
  if (!roomId) { alert("部屋IDを入力してね"); joinId.focus(); return; }
  const res = await joinRoom(roomId, myName);
  if (!res.ok) {
    if (res.reason === "NO_ROOM") alert("部屋番号が存在しません");
    else if (res.reason === "FULL") alert("その部屋は満席です");
    else if (res.reason === "NO_NAME") alert("名前を1文字以上入力してね");
    else alert("参加に失敗しました。時間をおいて再度お試しください。");
    return;
  }
  seat = "p2";
  enterLobby();
};

if (btnCopy) btnCopy.onclick = () => {
  navigator.clipboard.writeText(roomIdLabel.textContent || "");
  btnCopy.textContent = "コピー済み";
  setTimeout(()=>btnCopy.textContent="コピー",1200);
  sfx.click();
};

if (btnStart) btnStart.onclick = async () => { await startGame(); };
if (btnLeave) btnLeave.onclick = () => { sfx.click(); leaveRoom(); };
if (btnExit)  btnExit.onclick  = () => { sfx.click(); leaveRoom(); };

cardBtns.forEach(b => { b.onclick = () => { sfx.click(); pickCard(b.dataset.card); }; });

if (btnClear) btnClear.onclick = () => {
  if (roundLocked) return;
  selectedCard = null;
  cardBtns.forEach(b => b.classList.remove("selected"));
  if (btnPlay) btnPlay.disabled = true;
  sfx.click();
};

if (btnPlay) btnPlay.onclick = () => { sfx.play(); submitCard(); };

/* [09] ルーム作成/参加 */
async function createRoom(id, name){
  await set(ref(db, `rooms/${id}`), {
    createdAt: serverTimestamp(),
    state: "lobby",
    round: 0,
    minRounds: MIN_ROUNDS,
    boardSize: BOARD_SIZE,
    roundStartMs: null,
    lastResult: null,
    revealRound: null,
    revealUntilMs: null,
    players: {
      p1: { id: myId, name, pos: 0, choice: null, hand: HAND_INIT, joinedAt: serverTimestamp() },
      p2: { id: null, name: null, pos: 0, choice: null, hand: HAND_INIT, joinedAt: null }
    }
  });
}
async function joinRoom(id, name){
  name = (name || "").trim();
  if (!name) return { ok:false, reason:"NO_NAME" };
  const snap = await get(child(ref(db), `rooms/${id}`));
  if (!snap.exists()) return { ok:false, reason:"NO_ROOM" };
  const d = snap.val();
  if (d.players?.p2?.id) return { ok:false, reason:"FULL" };
  await update(ref(db, `rooms/${id}/players/p2`), {
    id: myId, name, pos: 0, choice: null, hand: HAND_INIT, joinedAt: serverTimestamp()
  });
  return { ok:true };
}

/* [10] ロビー購読 */
function enterLobby(){
  auth.classList.add("hidden");
  lobby.classList.remove("hidden");
  roomIdLabel.textContent = roomId;

  const roomRef = ref(db, `rooms/${roomId}`);
  if (unsubRoom) unsubRoom();
  unsubRoom = onValue(roomRef, (snap)=>{
    if (!snap.exists()) return;
    const d = snap.val();
    curRoom = d;

    // 画面切り替え
    const inGame = (d.state === "playing" || d.state === "ended");
    if (inGame){ lobby.classList.add("hidden"); game.classList.remove("hidden"); }

    // ロビー表示
    if (!inGame){
      const p1 = d.players?.p1 || {}, p2 = d.players?.p2 || {};
      p1Label.textContent = p1.name || "-";
      p2Label.textContent = p2.name || "-";
      const isHost = (seat==="p1");
      const twoJoined = !!p1.id && !!p2.id;
      btnStart.disabled = !(isHost && twoJoined);
      btnStart.textContent = isHost ? (twoJoined ? "▶ 対戦開始" : "相手待ち…") : "ホストが開始します";
    }

    renderGame(d);
    ensurePoller();  // 重要：どの端末でも演出＆結果確定＆自動次Rを進められる
  });
}

/* [11] ゲーム開始 */
async function startGame(){
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()) { alert("部屋が見つかりません"); return; }
  const d = snap.val();
  if (seat !== "p1") { alert("ホストのみ開始できます"); return; }
  const hasP1 = !!d?.players?.p1?.id;
  const hasP2 = !!d?.players?.p2?.id;
  if (!(hasP1 && hasP2)) { alert("2人そろってから開始できます"); return; }
  if (d.state === "playing") return;

  await update(ref(db), {
    [`rooms/${roomId}/state`]: "playing",
    [`rooms/${roomId}/round`]: 1,
    [`rooms/${roomId}/roundStartMs`]: Date.now(),
    [`rooms/${roomId}/lastResult`]: null,
    [`rooms/${roomId}/revealRound`]: null,
    [`rooms/${roomId}/revealUntilMs`]: null,
    [`rooms/${roomId}/players/p1/pos`]: 0,
    [`rooms/${roomId}/players/p2/pos`]: 0,
    [`rooms/${roomId}/players/p1/choice`]: null,
    [`rooms/${roomId}/players/p2/choice`]: null,
    [`rooms/${roomId}/players/p1/hand`]: HAND_INIT,
    [`rooms/${roomId}/players/p2/hand`]: HAND_INIT,
  });
}

/* [12] 退出 */
async function leaveRoom(){
  try {
    if (btnLeave) btnLeave.disabled = true;
    if (btnExit)  btnExit.disabled  = true;

    if (!roomId) { location.reload(); return; }
    const snap = await get(child(ref(db), `rooms/${roomId}`));
    if (!snap.exists()) { if (unsubRoom) unsubRoom(); location.reload(); return; }
    const d = snap.val();

    if (seat === "p1") {
      await remove(ref(db, `rooms/${roomId}`));
    } else {
      const base = `rooms/${roomId}/players/p2`;
      const updates = {};
      updates[`${base}/id`] = null;
      updates[`${base}/name`] = null;
      updates[`${base}/pos`] = 0;
      updates[`${base}/choice`] = null;
      updates[`${base}/hand`] = HAND_INIT;
      updates[`${base}/joinedAt`] = null;
      if (d.state === "playing") {
        updates[`rooms/${roomId}/state`]         = "lobby";
        updates[`rooms/${roomId}/round`]         = 0;
        updates[`rooms/${roomId}/roundStartMs`]  = null;
        updates[`rooms/${roomId}/lastResult`]    = null;
        updates[`rooms/${roomId}/revealRound`]   = null;
        updates[`rooms/${roomId}/revealUntilMs`] = null;
      }
      await update(ref(db), updates);
    }
  } catch (err) {
    console.error("leaveRoom error:", err);
    alert("退出に失敗しました。ネットワークを確認してもう一度お試しください。");
  } finally {
    if (unsubRoom) unsubRoom();
    setTimeout(()=>location.reload(), 150);
  }
}

/* [13] レンダリング */
function renderGame(d){
  roundNo.textContent = d.round ?? 0;
  minRoundsEl.textContent = d.minRounds ?? MIN_ROUNDS;

  const meSeat = seat, opSeat = (seat==="p1"?"p2":"p1");
  const me = d.players[meSeat], op = d.players[opSeat];

  const iSubmitted     = !!me.choice;
  const opSubmitted    = !!op.choice;
  const bothSubmitted  = iSubmitted && opSubmitted;
  const endedThisRound = !!(d.lastResult && d.lastResult._round === d.round);
  const revealing      = (d.revealRound === d.round);

  // ボード
  updateCounts(me.hand || HAND_INIT);
  placeTokens(d.players.p1.pos, d.players.p2.pos, d.boardSize);
  mePosEl.textContent = (seat==="p1") ? d.players.p1.pos : d.players.p2.pos;
  opPosEl.textContent = (seat==="p1") ? d.players.p2.pos : d.players.p1.pos;
  diffEl.textContent  = Math.abs(d.players.p1.pos - d.players.p2.pos);

  meChoiceEl.textContent = toFace(me.choice) || "？";
  opChoiceEl.textContent = toFace(op.choice) || "？";

  // カード入力状態
  roundLocked = iSubmitted;
  const diff = Math.abs(d.players.p1.pos - d.players.p2.pos);
  cardBtns.forEach(b=>{
    const k = b.dataset.card;
    const left = (me.hand?.[k] ?? 0);
    const swapBlocked = (k==="SWAP" && diff>=8);
    const disable = (left<=0) || iSubmitted || endedThisRound || revealing;
    b.disabled = swapBlocked ? true : disable;
    b.classList.toggle("selected", selectedCard===k && !disable && !swapBlocked);
  });
  const swapBtn = document.querySelector('.cardBtn[data-card="SWAP"]');
  if (swapBtn) swapBtn.disabled = (me.hand?.SWAP<=0) || diff>=8 || iSubmitted || endedThisRound || revealing;
  if (btnPlay) btnPlay.disabled = !selectedCard || iSubmitted || endedThisRound || revealing;

  // メッセージ
  if (revealing){ stateMsg.textContent = "判定準備中…"; }
  else if (endedThisRound){ stateMsg.textContent = "結果表示中… 次ラウンドへ進みます"; }
  else if (iSubmitted && !opSubmitted){ stateMsg.textContent = "提出済み！相手の手を待っています…"; }
  else { stateMsg.textContent = "10秒以内に出してね（出さないと負け）"; }

  // タイマー
  setupTimer(d.roundStartMs, d.round, me.choice, op.choice, d);

  // 両者提出かつ演出未設定なら誰でも演出開始してよい（p1縛りを撤廃）
  if (bothSubmitted && !revealing && !endedThisRound){
    update(ref(db), {
      [`rooms/${roomId}/revealRound`]: d.round,
      [`rooms/${roomId}/revealUntilMs`]: Date.now() + REVEAL_MS
    });
  }

  // 結果オーバーレイ（このRで1回だけ）
  if (endedThisRound && overlayShownRound !== d.round){
    showResultOverlay(makeRoundSummary(d.lastResult), REVEAL_MS);
    overlayShownRound = d.round;
  }
  if (!endedThisRound && !revealing && overlayShownRound !== d.round){
    hideResultOverlay();
  }
}

/* [14] 10秒タイマー */
function setupTimer(roundStartMs, round, myChoice, opChoice, roomData){
  if (localTimer) clearInterval(localTimer);
  lastBeepSec = null;

  const ended = !!(roomData?.lastResult && roomData.lastResult._round === roomData.round);
  const revealing = (roomData?.revealRound === roomData?.round);
  if (ended || revealing || (myChoice && opChoice)){ timerEl.textContent = "OK"; return; }

  const deadline = (roundStartMs || Date.now()) + TURN_TIME;

  const tick = async ()=>{
    const remain = Math.max(0, deadline - Date.now());
    const sec = Math.ceil(remain/1000);
    timerEl.textContent = sec;

    if (sec <= 3 && sec !== lastBeepSec && remain > 0) { sfx.tick(); lastBeepSec = sec; }

    if (remain <= 0){
      clearInterval(localTimer);
      sfx.timesup();
      // timeoutは誰でも確定して良い（二重はapplyResult側で抑止）
      const dNowSnap = await get(child(ref(db), `rooms/${roomId}`));
      if (!dNowSnap.exists()) return;
      const dNow = dNowSnap.val();
      if (!(dNow.players.p1.choice && dNow.players.p2.choice)){ // まだ両者提出じゃない
        await settleTimeout(dNow);
      }
      timerEl.textContent = "OK";
    }
  };
  tick();
  localTimer = setInterval(tick, 200);
}

/* [15] カード選択 */
function pickCard(code){
  if (roundLocked) return;
  const btn = document.querySelector(`.cardBtn[data-card="${code}"]`);
  if (btn?.disabled) return;

  selectedCard = code;
  cardBtns.forEach(b => b.classList.toggle("selected", b===btn));
  if (btnPlay) btnPlay.disabled = false;
  stateMsg.textContent = displayHint(code);
}
function displayHint(code){
  switch(code){
    case "G": return "グーで勝つと+3マス";
    case "C": return "チョキで勝つと+4マス";
    case "P": return "パーで勝つと+5マス";
    case "WIN": return "必勝：なんにでも勝って+4（バリアには負け）";
    case "SWAP": return "位置交換：差が8未満なら位置を入れ替える（バリアに負け）";
    case "BARRIER": return "バリア：相手の必勝/位置交換を無効。通常手相手だと自分-1のペナルティ";
    default: return "カードを選んでね";
  }
}

/* [16] 提出 */
async function submitCard(){
  if (!selectedCard) return;

  const meSnap = await get(child(ref(db), `rooms/${roomId}/players/${seat}`));
  let me = meSnap.val();
  if (!me) return;
  if (me.choice){
    roundLocked = true;
    if (btnPlay) btnPlay.disabled = true;
    cardBtns.forEach(b => b.disabled = true);
    alert("このターンは提出済みです");
    return;
  }

  if ((me.hand?.[selectedCard]||0) <= 0){ alert("そのカードはもうありません"); return; }
  if (selectedCard === "SWAP"){
    const room = (await get(child(ref(db), `rooms/${roomId}`))).val();
    const diff = Math.abs(room.players.p1.pos - room.players.p2.pos);
    if (diff >= 8){ alert("差が8マス以上のため、位置交換カードは使えません"); return; }
  }

  const updates = {};
  updates[`rooms/${roomId}/players/${seat}/choice`] = selectedCard;
  updates[`rooms/${roomId}/players/${seat}/hand/${selectedCard}`] = (me.hand[selectedCard]||0) - 1;
  await update(ref(db), updates);

  // ローカルロック
  roundLocked = true;
  selectedCard = null;
  cardBtns.forEach(b => { b.classList.remove("selected"); b.disabled = true; });
  if (btnPlay) btnPlay.disabled = true;
}

/* [17] タイムアウト決着 */
async function settleTimeout(d){
  const p1 = d.players.p1, p2 = d.players.p2;
  const a = p1.choice, b = p2.choice;
  if (a && b) return; // 両者提出済 → 演出へ

  let result;
  if (!a && b){ result = winByDefault("p2", b, d); }
  else if (a && !b){ result = winByDefault("p1", a, d); }
  else { result = { type:"timeout-tie", winner:null, delta:{p1:0,p2:0}, note:"両者未提出" }; }

  await applyResultSafe(result); // ★ safe（最新DBを再確認して一度だけ）
  playResultSfx(result);
  showResultOverlay(makeRoundSummary(result), REVEAL_MS);
  await scheduleAutoNextSafe();
}
function winByDefault(winnerSeat, card, d){
  const diff = Math.abs(d.players.p1.pos - d.players.p2.pos);
  if (card==="G"||card==="C"||card==="P"){
    const gain = (card==="G"?3:card==="C"?4:5);
    return { type:"timeout", winner:winnerSeat, delta:{p1: winnerSeat==="p1"?gain:0, p2: winnerSeat==="p2"?gain:0}, note:"時間切れ" };
  }
  if (card==="WIN"){
    return { type:"timeout", winner:winnerSeat, delta:{p1: winnerSeat==="p1"?4:0, p2: winnerSeat==="p2"?4:0}, note:"時間切れ(必勝)" };
  }
  if (card==="SWAP"){
    if (diff<8) return { type:"swap", winner:winnerSeat, swap:true, note:"時間切れ(位置交換)" };
    else return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0}, note:"SWAP不可(差>=8)" };
  }
  if (card==="BARRIER"){
    return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0}, note:"バリアは進まない" };
  }
  return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0} };
}

/* [18] ルール＆SFX */
function judgeRound(p1, p2){
  const a = p1.choice, b = p2.choice;

  // WIN同士は引き分け
  if (a==="WIN" && b==="WIN") return { type:"win", winner:null, delta:{p1:0,p2:0}, note:"必勝同士" };

  // バリア vs 必勝/交換（進まない）
  if (a==="BARRIER" && (b==="WIN"||b==="SWAP")) return { type:"barrier", winner:"p1", delta:{p1:0,p2:0}, barrier:true };
  if (b==="BARRIER" && (a==="WIN"||a==="SWAP")) return { type:"barrier", winner:"p2", delta:{p1:0,p2:0}, barrier:true };

  // 通常手に対するバリアのペナルティ（出した側-1）
  if (a==="BARRIER" && (b==="G"||b==="C"||b==="P")) return { type:"barrier-penalty", winner:"p2", delta:{p1:-1,p2:0} };
  if (b==="BARRIER" && (a==="G"||a==="C"||a==="P")) return { type:"barrier-penalty", winner:"p1", delta:{p1:0,p2:-1} };

  // バリア同士
  if (a==="BARRIER" && b==="BARRIER") return { type:"tie", winner:null, delta:{p1:0,p2:0} };

  // 必勝（バリアでない限り+4）
  if (a==="WIN" && b!=="BARRIER") return { type:"win", winner:"p1", delta:{p1:4,p2:0} };
  if (b==="WIN" && a!=="BARRIER") return { type:"win", winner:"p2", delta:{p1:0,p2:4} };

  // 位置交換（差<8のみ有効）
  if (a==="SWAP" && b!=="BARRIER") return { type:"swap", winner:"p1", swap:true };
  if (b==="SWAP" && a!=="BARRIER") return { type:"swap", winner:"p2", swap:true };
  if (a==="SWAP" && b==="SWAP")   return { type:"tie", winner:null, delta:{p1:0,p2:0}, note:"ダブルSWAPは相殺" };

  // 通常じゃんけん
  if (isBasic(a) && isBasic(b)){
    if (a===b) return { type:"tie", winner:null, delta:{p1:0,p2:0} };
    const aWin = (a==="G"&&b==="C")||(a==="C"&&b==="P")||(a==="P"&&b==="G");
    if (aWin) return { type:"rps", winner:"p1", delta:{p1: gain(a), p2:0} };
    return { type:"rps", winner:"p2", delta:{p1:0, p2: gain(b)} };
  }
  return { type:"tie", winner:null, delta:{p1:0,p2:0} };
}
function playResultSfx(r){
  if (r.type==="swap"){ sfx.swap(); return; }
  if (r.type==="barrier"){ sfx.barrier(); return; }
  if (r.type==="barrier-penalty"){ sfx.penalty(); return; }
  if (r.type==="win" || (r.type==="rps" && r.winner) || r.type==="timeout"){
    const amIWinner = (r.winner === (seat==="p1"?"p1":"p2"));
    amIWinner ? sfx.win() : sfx.lose();
  }
}

/* [19] 結果適用（安全版）＆ 自動次R（安全版） */
async function applyResultSafe(result){
  // 直前のDBを取得して、このラウンドが未確定なら反映
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()) return;
  const d = snap.val();
  if (d.lastResult && d.lastResult._round === d.round) return; // もう確定済み

  let p1pos = d.players.p1.pos;
  let p2pos = d.players.p2.pos;
  const posDiff = Math.abs(p1pos - p2pos);
  if (result.swap){
    if (posDiff < 8){ const tmp = p1pos; p1pos = p2pos; p2pos = tmp; }
  }else{
    p1pos = clamp25(p1pos + (result.delta?.p1||0));
    p2pos = clamp25(p2pos + (result.delta?.p2||0));
  }
  p1pos = Math.max(0, p1pos); p2pos = Math.max(0, p2pos);

  await update(ref(db), {
    [`rooms/${roomId}/players/p1/pos`]: p1pos,
    [`rooms/${roomId}/players/p2/pos`]: p2pos,
    [`rooms/${roomId}/lastResult`]: { ...result, _round: d.round },
    [`rooms/${roomId}/revealRound`]: null,
    [`rooms/${roomId}/revealUntilMs`]: null
  });
}
async function scheduleAutoNextSafe(){
  setTimeout(async ()=>{
    const snap = await get(child(ref(db), `rooms/${roomId}`));
    if (!snap.exists()) return;
    const cur = snap.val();

    // すでに次のラウンドに進んでいたら何もしない
    if (!(cur.lastResult && cur.lastResult._round === cur.round)) return;

    const roundsDone  = cur.round >= (cur.minRounds ?? MIN_ROUNDS);
    const someoneGoal = cur.players.p1.pos >= cur.boardSize || cur.players.p2.pos >= cur.boardSize;
    const handLeft = (h)=> (h.G+h.C+h.P+h.WIN+h.SWAP+h.BARRIER);
    const p1left = handLeft(cur.players.p1.hand || HAND_INIT);
    const p2left = handLeft(cur.players.p2.hand || HAND_INIT);
    const noCards = (p1left===0 || p2left===0);

    if ((roundsDone && someoneGoal) || (roundsDone && noCards)){
      const winner = cur.players.p1.pos===cur.players.p2.pos ? null : (cur.players.p1.pos>cur.players.p2.pos?"p1":"p2");
      // 既にendedならスキップ
      if (cur.state !== "ended"){
        await update(ref(db), {
          [`rooms/${roomId}/state`]: "ended",
          [`rooms/${roomId}/lastResult`]: { ...(cur.lastResult||{}), final:true, winner }
        });
      }
      showResultOverlay(winner===null ? "🤝 引き分け！" : (winner=== (seat==="p1"?"p1":"p2") ? "🏆 勝利！" : "😢 敗北…"), REVEAL_MS);
      return;
    }

    // 次ラウンドが未だなら開始（誰が押してもOK／重複は上の“もう進んでたらreturn”で回避）
    await update(ref(db), {
      [`rooms/${roomId}/round`]: (cur.round||0)+1,
      [`rooms/${roomId}/roundStartMs`]: Date.now(),
      [`rooms/${roomId}/players/p1/choice`]: null,
      [`rooms/${roomId}/players/p2/choice`]: null
    });
    roundLocked = false;
    selectedCard = null;
    hideResultOverlay();
  }, REVEAL_MS);
}

/* [20] 盤面ヘルパ */
function makeBoard(){
  const el = document.getElementById('board');
  if (!el) return;
  el.innerHTML = "";
  for(let i=1;i<=BOARD_SIZE;i++){
    const cell = document.createElement("div");
    cell.className = "cell"+(i===BOARD_SIZE?" goal":"");
    el.appendChild(cell);
  }
}
function placeTokens(p1, p2, size){
  const cells = [...boardEl.children];
  cells.forEach(c=>{ c.querySelector(".token.me")?.remove(); c.querySelector(".token.op")?.remove(); });
  const idx1 = Math.min(size, Math.max(0,p1)) - 1;
  const idx2 = Math.min(size, Math.max(0,p2)) - 1;
  if (idx1>=0){ const t = document.createElement("div"); t.className = "token me"; cells[idx1]?.appendChild(t); }
  if (idx2>=0){ const t = document.createElement("div"); t.className = "token op"; cells[idx2]?.appendChild(t); }
}

/* [21] ユーティリティ（オーバーレイ等） */
function updateCounts(h){
  cntG.textContent = `×${h.G||0}`;
  cntC.textContent = `×${h.C||0}`;
  cntP.textContent = `×${h.P||0}`;
  cntWIN.textContent = `×${h.WIN||0}`;
  cntSWAP.textContent = `×${h.SWAP||0}`;
  cntBARRIER.textContent = `×${h.BARRIER||0}`;
}
function isBasic(x){ return x==="G"||x==="C"||x==="P"; }
function gain(x){ return x==="G"?3:x==="C"?4:5; }
function toFace(x){ return x==="G"?"✊":x==="C"?"✌️":x==="P"?"🫲":x==="WIN"?"👑":x==="SWAP"?"🔁":x==="BARRIER"?"🛡️":null; }
function prettyResult(r){
  switch(r.type){
    case "rps": return r.winner ? (r.winner==="p1"?"あなたの勝ち（通常手）":"相手の勝ち（通常手）") : "あいこ";
    case "win": return r.winner ? (r.winner==="p1"?"あなたの必勝！+4":"相手の必勝！+4") : "必勝同士";
    case "swap": return r.winner ? (r.winner==="p1"?"あなたが位置を交換！":"相手が位置を交換！") : "交換なし";
    case "barrier": return r.winner ? (r.winner==="p1"?"あなたのバリアが防いだ":"相手のバリアが防いだ") : "バリア発動";
    case "barrier-penalty": return "バリアのペナルティ：出した側が-1";
    case "timeout": return r.winner ? (r.winner==="p1"?"相手の時間切れであなたの勝ち":"あなたの時間切れ…相手の勝ち") : "時間切れ";
    case "timeout-tie": return "両者時間切れ";
    case "tie": return "引き分け";
    default: return "-";
  }
}
function clamp25(x){ return Math.max(0, Math.min(25, x)); }
function rid(n=6){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:n},()=>A[Math.floor(Math.random()*A.length)]).join(""); }

// === オーバーレイ ===
function ensureOverlay(){
  if (resultOverlayEl) return resultOverlayEl;
  resultOverlayEl = document.createElement("div");
  Object.assign(resultOverlayEl.style, {
    position:"fixed", inset:"0", background:"rgba(0,0,0,0.55)",
    display:"none", alignItems:"center", justifyContent:"center",
    zIndex:"9999", backdropFilter:"blur(2px)"
  });
  const inner = document.createElement("div");
  inner.id = "overlayInner";
  Object.assign(inner.style, {
    background:"rgba(255,255,255,0.9)", borderRadius:"16px", padding:"24px 28px",
    fontSize:"22px", textAlign:"center", minWidth:"260px",
    boxShadow:"0 8px 24px rgba(0,0,0,.25)", fontWeight:"600"
  });
  resultOverlayEl.appendChild(inner);
  document.body.appendChild(resultOverlayEl);
  return resultOverlayEl;
}
function showResultOverlay(text, ms=REVEAL_MS){
  const el = ensureOverlay();
  const inner = el.querySelector("#overlayInner");
  inner.textContent = text;
  el.style.display = "flex";
  if (overlayTimerId) clearTimeout(overlayTimerId);
  overlayTimerId = setTimeout(hideResultOverlay, ms);
}
function hideResultOverlay(){
  if (!resultOverlayEl) return;
  resultOverlayEl.style.display = "none";
  if (overlayTimerId) { clearTimeout(overlayTimerId); overlayTimerId = null; }
}
// 大きな 3,2,1 を出す
function showCountdownOverlay(remainSec){
  const el = ensureOverlay();
  const inner = el.querySelector("#overlayInner");
  inner.style.fontSize = "64px";
  inner.textContent = String(remainSec);
  el.style.display = "flex";
}
function updateCountdownOverlay(){
  if (!curRoom) return;
  if (curRoom.revealRound !== curRoom.round) { hideResultOverlay(); return; }
  const remain = Math.max(0, Math.ceil((curRoom.revealUntilMs - Date.now())/1000));
  showCountdownOverlay(remain);
}

// 視点に合わせた1行要約
function makeRoundSummary(r){
  if (r.swap) return "🔁 位置を交換！";
  if (r.type === "barrier") return "🛡️ バリア発動：必勝/位置交換を防ぎました";
  if (r.type === "barrier-penalty") return "🛡️ バリアのペナルティ：出した側が -1 マス";
  if (r.type === "win") return (r.winner=== (seat==="p1"?"p1":"p2")) ? "👑 必勝！ +4" : "👑 相手の必勝… +4";
  if (r.type === "rps" && r.winner) {
    const meWin = (r.winner === (seat==="p1"?"p1":"p2"));
    const mv = meWin ? (r.delta?.p1||0) : (r.delta?.p2||0);
    return (meWin ? `🎉 勝ち！ +${mv} マス` : `😣 負け… 相手が +${mv} マス`);
  }
  if (r.type === "timeout") {
    const meWin = (r.winner === (seat==="p1"?"p1":"p2"));
    return meWin ? "⏱ 相手の時間切れで勝利！" : "⏱ 時間切れ…相手の勝ち";
  }
  if (r.type === "timeout-tie") return "⏱ 両者時間切れ";
  if (r.type === "tie") return "🤝 あいこ";
  return "—";
}

/* === 統合ポーラー（どの端末でも前進させる） === */
function ensurePoller(){
  if (!countdownTicker){
    countdownTicker = setInterval(()=>{ if (curRoom) updateCountdownOverlay(); }, 250);
  }
  if (!poller){
    poller = setInterval(async ()=>{
      if (!curRoom) return;
      const d = curRoom;
      if (d.state !== "playing") return;

      const both = !!d.players.p1.choice && !!d.players.p2.choice;
      const revealing = (d.revealRound === d.round);
      const already = !!(d.lastResult && d.lastResult._round === d.round);

      // 両者提出済みなのに演出未設定なら誰でも開始（冗長OK）
      if (both && !revealing && !already){
        await update(ref(db), {
          [`rooms/${roomId}/revealRound`]: d.round,
          [`rooms/${roomId}/revealUntilMs`]: Date.now() + REVEAL_MS
        });
        return;
      }

      // 演出が終わったら結果を誰でも1回だけ確定
      if (both && revealing && !already && Date.now() >= d.revealUntilMs){
        const result = judgeRound(d.players.p1, d.players.p2);
        await applyResultSafe(result);
        playResultSfx(result);
        showResultOverlay(makeRoundSummary(result), REVEAL_MS);
        await scheduleAutoNextSafe();
        return;
      }
    }, 200);
  }
}