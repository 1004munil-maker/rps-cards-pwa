/* =========================================================
   RPS Cards — app.js（番号付き・フル/自動進行版）
   ---------------------------------------------------------
   [01] モバイル対策（コピー/ズーム禁止・縦固定）
   [02] 効果音（SFX）
   [03] Firebase 初期化（CDNからimport済み前提）
   [04] DOM取得
   [04.5] 名前必須ガード（1文字未満は作成/参加不可）
   [05] 定数
   [06] 状態（seat復元・観戦対策・演出用）
   [07] 初期描画（盤面）
   [08] イベント紐づけ
   [09] 対戦前の広告（Capacitor AdMob: ネイティブ時のみ 50%）
   [10] ルーム作成/参加
   [11] ロビー購読（開始ボタンのガード付き）
   [12] ゲーム開始（サーバー側ガード & phase=select）
   [13] 退出処理（ホストは部屋削除 / ゲストはp2クリア）
   [14] UIレンダリング（提出ロック・進行ガード・タイマー制御・phase対応）
   [15] 10秒ターンタイマー（select時のみ動作）
   [16] カード選択＆ヒント（提出後は選べない）
   [17] 提出（多重提出防止）→ 両者出揃いなら phase=reveal + 3秒演出開始
   [18] タイムアウト決着（未提出側負け or 仕様通り）
   [19] ルール判定（通常/必勝/交換/バリア/ペナルティ）
   [20] リビール完了 → 結果適用 → 次ラウンド or 試合終了（自動）
   [21] 盤面ヘルパ
   [22] ユーティリティ（seat再特定・テキスト生成ほか）
   ========================================================= */

/* [01] モバイル対策（コピー/ズーム禁止・縦固定） */
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
  ensure(){
    if(!this.ctx){
      const AC=window.AudioContext||window.webkitAudioContext;
      if(AC) this.ctx=new AC();
    }
    if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume();
  }
  // ← TS誤検知を避けるため安全な引数展開に修正
  tone(opts = {}){
    const {
      freq=440, dur=0.08, type='sine', gain=0.06, attack=0.005, release=0.04
    } = opts;
    if(!this.enabled) return; this.ensure(); if(!this.ctx) return;
    const t0=this.ctx.currentTime, osc=this.ctx.createOscillator(), g=this.ctx.createGain();
    osc.type=type; osc.frequency.value=freq;
    g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(gain,t0+attack);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+dur+release);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0+attack+dur+release+0.01);
  }
  click(){ this.tone({freq:900,dur:0.03,type:'square',gain:0.04}); }
  play(){  this.tone({freq:660,dur:0.06,type:'triangle',gain:0.05}); } // ← dur: に修正
  win(){   this.tone({freq:740,dur:0.09,type:'sine',gain:0.06}); setTimeout(()=>this.tone({freq:880,dur:0.09}),90); }
  lose(){  this.tone({freq:200,dur:0.12,type:'sawtooth',gain:0.05}); }
  swap(){  this.tone({freq:520,dur:0.06}); setTimeout(()=>this.tone({freq:420,dur:0.06}),70); }
  barrier(){ this.tone({freq:320,dur:0.05}); setTimeout(()=>this.tone({freq:260,dur:0.05}),60); }
  penalty(){ this.tone({freq:180,dur:0.05}); }
  tick(){  this.tone({freq:1000,dur:0.03,type:'square',gain:0.04}); }
  timesup(){this.tone({freq:140,dur:0.18,type:'sawtooth',gain:0.06}); }
}
const sfx = new SFX();
['touchstart','mousedown','keydown'].forEach(ev=>{
  window.addEventListener(ev, ()=> sfx.ensure(), { once:true, passive:true });
});

/* [03] Firebase 初期化（CDNインポート済み想定） */
const { initializeApp, getDatabase, ref, onValue, set, update, get, child, serverTimestamp, remove } = window.FirebaseAPI;

// ★ あなたの firebaseConfig（公開でOKなWeb用キー）
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
const btnNext    = $("#btnNext"); // 自動進行で未使用
const btnExit    = $("#btnExit");

const cardBtns   = [...document.querySelectorAll(".cardBtn")];
const cntG       = $("#cntG"), cntC=$("#cntC"), cntP=$("#cntP"), cntWIN=$("#cntWIN"), cntSWAP=$("#cntSWAP"), cntBARRIER=$("#cntBARRIER");

/* [04.5] 名前必須ガード（1文字未満は作成/参加不可） */
btnCreate.disabled = true;
btnJoin.disabled   = true;
playerName.addEventListener('input', () => {
  const ok = playerName.value.trim().length >= 1;
  btnCreate.disabled = !ok;
  btnJoin.disabled   = !ok;
});

/* [05] 定数 */
const BOARD_SIZE = 25;
const MIN_ROUNDS = 8;
const TURN_TIME  = 10_000; // ms
const REVEAL_MS  = 3_000;  // リビール（演出）時間
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
let revealTicker = null;
let handledRevealRound = null;

try {
  const sRoom = localStorage.getItem("rps.room");
  const sId   = localStorage.getItem("rps.myId");
  const sSeat = localStorage.getItem("rps.seat");
  if (sId)   myId  = sId;
  if (sSeat) seat  = sSeat;
  if (sRoom) roomId = sRoom;
} catch {}

/* [07] 初期描画（盤面） */
makeBoard();

/* [08] イベント紐づけ */
btnCreate.onclick = async () => {
  sfx.click();
  const name = (playerName.value || "").trim();
  if (name.length < 1) { alert("名前を1文字以上入力してね"); playerName.focus(); return; }
  myName = name;
  roomId = rid(6);
  seat = "p1";
  localStorage.setItem("rps.room", roomId);
  localStorage.setItem("rps.myId", myId);
  localStorage.setItem("rps.seat", seat);

  try {
    await createRoom(roomId, myName);
    enterLobby();
  } catch (e) {
    console.error("createRoom failed:", e);
    alert("部屋作成に失敗しました：" + (e?.message || e));
  }
};

btnJoin.onclick = async () => {
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
  localStorage.setItem("rps.room", roomId);
  localStorage.setItem("rps.myId", myId);
  localStorage.setItem("rps.seat", seat);

  enterLobby();
};

btnCopy.onclick = () => {
  navigator.clipboard.writeText(roomIdLabel.textContent || "");
  btnCopy.textContent = "コピー済み";
  setTimeout(()=>btnCopy.textContent="コピー",1200);
  sfx.click();
};

btnStart.onclick = async () => { await maybeAdThenStart(); };
btnLeave.onclick = () => { sfx.click(); leaveRoom(); };
btnExit.onclick  = () => { sfx.click(); leaveRoom(); };

cardBtns.forEach(b => { b.onclick = () => { sfx.click(); pickCard(b.dataset.card); }; });

btnClear.onclick = () => {
  if (roundLocked) return;
  selectedCard = null;
  cardBtns.forEach(b => b.classList.remove("selected"));
  btnPlay.disabled = true;
  sfx.click();
};

btnPlay.onclick = () => { sfx.play(); submitCard(); };
btnNext.onclick = () => { /* 自動進行 */ };

/* [09] 対戦前の広告（ネイティブのみ） */
async function maybeAdThenStart(){
  const showAd = Math.random() < 0.5;
  const isNative = !!window.Capacitor?.isNativePlatform;
  const AdMob = window.Capacitor?.Plugins?.AdMob;
  if (isNative && showAd && AdMob){
    try {
      await AdMob.initialize({ requestTrackingAuthorization: true });
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const adId = isIOS
        ? "ca-app-pub-3940256099942544/6978759866"
        : "ca-app-pub-3940256099942544/5354046379";
      await AdMob.prepareRewardedInterstitial({ adId });
      await AdMob.showRewardedInterstitial();
    } catch (e) {
      console.warn("Ad error, start anyway:", e);
    }
    await startGame();
    return;
  }
  await startGame();
}

/* [10] ルーム作成/参加 */
async function createRoom(id, name){
  await set(ref(db, `rooms/${id}`), {
    createdAt: serverTimestamp(),
    state: "lobby",
    phase: null,              // select / reveal / ended
    revealEndMs: null,
    round: 0,
    minRounds: MIN_ROUNDS,
    boardSize: BOARD_SIZE,
    roundStartMs: null,
    lastResult: null,
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

/* [11] ロビー購読 */
function enterLobby(){
  auth.classList.add("hidden");
  lobby.classList.remove("hidden");
  roomIdLabel.textContent = roomId;

  const roomRef = ref(db, `rooms/${roomId}`);
  if (unsubRoom) unsubRoom();
  unsubRoom = onValue(roomRef, (snap)=>{
    if (!snap.exists()) return;
    const d = snap.val();
    ensureSeatById(d);

    const p1 = d.players?.p1 || {};
    const p2 = d.players?.p2 || {};

    p1Label.textContent = p1.name || "-";
    p2Label.textContent = p2.name || "-";

    const isHost = (seat === "p1");
    const twoJoined = !!p1.id && !!p2.id;
    const inGame = (d.state === "playing" || d.state === "ended");

    btnStart.disabled = !(isHost && twoJoined) || inGame;
    btnStart.textContent = isHost ? (twoJoined ? "▶ 対戦開始" : "相手待ち…") : "ホストが開始します";
    btnStart.title = isHost ? (twoJoined ? "開始できます" : "もう一人が入室するまで待ってね") : "開始はホストが行います";

    if (inGame){
      lobby.classList.add("hidden");
      game.classList.remove("hidden");
      renderGame(d);
    }
  });
}

/* [12] ゲーム開始（phase=select） */
async function startGame(){
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()) { alert("部屋が見つかりません"); return; }
  const d = snap.val();

  if (seat !== "p1") { alert("ホストのみ開始できます"); return; }

  const hasP1 = !!d?.players?.p1?.id;
  const hasP2 = !!d?.players?.p2?.id;
  if (!(hasP1 && hasP2)) { alert("2人そろってから開始できます"); return; }

  const updates = {};
  updates[`rooms/${roomId}/state`]        = "playing";
  updates[`rooms/${roomId}/phase`]        = "select";
  updates[`rooms/${roomId}/revealEndMs`]  = null;
  updates[`rooms/${roomId}/round`]        = 1;
  updates[`rooms/${roomId}/roundStartMs`] = Date.now();
  updates[`rooms/${roomId}/lastResult`]   = null;
  updates[`rooms/${roomId}/players/p1/pos`]    = 0;
  updates[`rooms/${roomId}/players/p2/pos`]    = 0;
  updates[`rooms/${roomId}/players/p1/choice`] = null;
  updates[`rooms/${roomId}/players/p2/choice`] = null;
  updates[`rooms/${roomId}/players/p1/hand`]   = HAND_INIT;
  updates[`rooms/${roomId}/players/p2/hand`]   = HAND_INIT;

  await update(ref(db), updates);
}

/* [13] 退出処理 */
async function leaveRoom(){
  try {
    if (typeof btnLeave !== "undefined") btnLeave.disabled = true;
    if (typeof btnExit  !== "undefined") btnExit.disabled  = true;

    if (!roomId) { location.reload(); return; }

    const snap = await get(child(ref(db), `rooms/${roomId}`));
    if (!snap.exists()) {
      if (unsubRoom) unsubRoom();
      location.reload();
      return;
    }
    const d = snap.val();

    if (seat === "p1") {
      await remove(ref(db, `rooms/${roomId}`));
    } else {
      const base = `rooms/${roomId}/players/p2`;
      const updates = {};
      updates[`${base}/id`]       = null;
      updates[`${base}/name`]     = null;
      updates[`${base}/pos`]      = 0;
      updates[`${base}/choice`]   = null;
      updates[`${base}/hand`]     = HAND_INIT;
      updates[`${base}/joinedAt`] = null;

      if (d.state === "playing") {
        updates[`rooms/${roomId}/state`]         = "lobby";
        updates[`rooms/${roomId}/phase`]         = null;
        updates[`rooms/${roomId}/round`]         = 0;
        updates[`rooms/${roomId}/roundStartMs`]  = null;
        updates[`rooms/${roomId}/revealEndMs`]   = null;
        updates[`rooms/${roomId}/lastResult`]    = null;
      }
      await update(ref(db), updates);
    }
  } catch (err) {
    console.error("leaveRoom error:", err);
    alert("退出に失敗しました。ネットワークを確認してもう一度お試しください。");
  } finally {
    if (unsubRoom) unsubRoom();
    try {
      localStorage.removeItem("rps.room");
      localStorage.removeItem("rps.myId");
      localStorage.removeItem("rps.seat");
    } catch {}
    setTimeout(()=>location.reload(), 150);
  }
}

/* [14] UIレンダリング（phase対応） */
function renderGame(d){
  ensureSeatById(d);
  if (!seat || !d.players?.[seat]) {
    stateMsg.textContent = "観戦モード：参加するとカードを出せます";
    btnPlay.disabled = true;
    cardBtns.forEach(b => b.disabled = true);
    return;
  }

  roundNo.textContent = d.round ?? 0;
  minRoundsEl.textContent = d.minRounds ?? MIN_ROUNDS;

  const me     = d.players[seat];
  const opSeat = seat === "p1" ? "p2" : "p1";
  const op     = d.players[opSeat] || {};

  const iSubmitted    = !!me.choice;
  const opSubmitted   = !!op.choice;
  const isHost        = (seat === "p1");
  const phase         = d.phase || "select";

  updateCounts(me.hand || HAND_INIT);
  placeTokens(d.players.p1.pos, d.players.p2.pos, d.boardSize);
  mePosEl.textContent = seat==="p1" ? d.players.p1.pos : d.players.p2.pos;
  opPosEl.textContent = seat==="p1" ? d.players.p2.pos : d.players.p1.pos;
  diffEl.textContent  = Math.abs((seat==="p1"?d.players.p1.pos:d.players.p2.pos) - (seat==="p1"?d.players.p2.pos:d.players.p1.pos));

  meChoiceEl.textContent = toFace(me.choice) || "？";
  opChoiceEl.textContent = toFace(op.choice) || "？";

  const diff = Math.abs(d.players.p1.pos - d.players.p2.pos);
  const swapBtn = document.querySelector('.cardBtn[data-card="SWAP"]');

  roundLocked = iSubmitted;

  const inSelect = (phase === "select");
  cardBtns.forEach(b=>{
    const k = b.dataset.card;
    const left = (me.hand?.[k]||0);
    const swapBlocked = (k==="SWAP" && diff>=8);
    b.disabled = (left<=0) || roundLocked || !inSelect || swapBlocked;
    b.classList.toggle("selected", selectedCard === k && !roundLocked && inSelect);
  });
  if (swapBtn) swapBtn.disabled = (me.hand?.SWAP<=0) || diff >= 8 || roundLocked || !inSelect;
  btnPlay.disabled = !selectedCard || roundLocked || !inSelect;

  if (phase === "reveal"){
    stateMsg.textContent = "結果演出中…";
  } else if (iSubmitted && !opSubmitted){
    stateMsg.textContent = "提出済み！相手の手を待っています…";
  } else {
    stateMsg.textContent = "10秒以内に出してね（出さないと負け）";
  }

  setupTimer(d.roundStartMs, d.round, me.choice, op.choice, d);

  const lr = d.lastResult;
  resultText.textContent = lr ? prettyResult(lr) : "-";

  if (phase === "reveal"){
    showReveal(d);
    if (isHost && d.revealEndMs && Date.now() >= d.revealEndMs){
      if (handledRevealRound !== d.round){
        handledRevealRound = d.round;
        finalizeRevealAndAdvance(d).catch(console.error);
      }
    }
  } else {
    hideReveal();
    handledRevealRound = null;
  }
}

/* [15] 10秒タイマー（select時のみ） */
function setupTimer(roundStartMs, round, myChoice, opChoice, d){
  if (localTimer) clearInterval(localTimer);
  lastBeepSec = null;

  if (d.phase !== "select"){ timerEl.textContent = "▶"; return; }

  const deadline = (roundStartMs || Date.now()) + TURN_TIME;

  const tick = async ()=>{
    const remain = Math.max(0, deadline - Date.now());
    const sec = Math.ceil(remain/1000);
    timerEl.textContent = sec;

    if (sec <= 3 && sec !== lastBeepSec && remain > 0) { sfx.tick(); lastBeepSec = sec; }

    if (remain <= 0){
      clearInterval(localTimer);
      sfx.timesup();
      if (seat === "p1"){
        const dNow = d ?? (await get(child(ref(db), `rooms/${roomId}`))).val();
        await settleTimeout(dNow);
      }
      timerEl.textContent = "0";
    }
  };
  tick();
  localTimer = setInterval(tick, 200);
}

/* [16] カード選択＆ヒント */
function pickCard(code){
  if (roundLocked) return;
  if (!code) return;
  cardBtns.forEach(b => b.classList.remove("selected"));
  const btn = document.querySelector(`.cardBtn[data-card="${code}"]`);
  if (btn?.disabled) return;

  selectedCard = code;
  btn?.classList.add("selected");
  btnPlay.disabled = false;
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

/* [17] 提出（多重提出防止）→ phase=reveal */
async function submitCard(){
  if (!selectedCard) return;

  const meSnap = await get(child(ref(db), `rooms/${roomId}/players/${seat}`));
  let me = meSnap.val();
  if (!me) return;
  if (me.choice){
    roundLocked = true;
    btnPlay.disabled = true;
    cardBtns.forEach(b => b.disabled = true);
    alert("このターンは提出済みです");
    return;
  }

  if ((me.hand[selectedCard]||0) <= 0){ alert("そのカードはもうありません"); return; }

  if (selectedCard === "SWAP"){
    const room = (await get(child(ref(db), `rooms/${roomId}`))).val();
    const diff = Math.abs(room.players.p1.pos - room.players.p2.pos);
    if (diff >= 8){ alert("差が8マス以上のため、位置交換カードは使えません"); return; }
  }

  const updates = {};
  updates[`rooms/${roomId}/players/${seat}/choice`] = selectedCard;
  updates[`rooms/${roomId}/players/${seat}/hand/${selectedCard}`] = (me.hand[selectedCard]||0) - 1;
  await update(ref(db), updates);

  roundLocked = true;
  selectedCard = null;
  cardBtns.forEach(b => { b.classList.remove("selected"); b.disabled = true; });
  btnPlay.disabled = true;

  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (snap.exists()){
    const d = snap.val();
    const p1 = d.players.p1, p2 = d.players.p2;
    if (p1.choice && p2.choice){
      if (seat === "p1"){
        const r = judgeRound(p1, p2);
        const text = resultSpeak(r);
        await update(ref(db), {
          [`rooms/${roomId}/phase`]: "reveal",
          [`rooms/${roomId}/revealEndMs`]: Date.now() + REVEAL_MS,
          [`rooms/${roomId}/lastResult`]: { ...r, _round: d.round, speak: text }
        });
      }
      showReveal(d);
    }
  }
}

/* [18] タイムアウト決着 */
async function settleIfReady(){ /* submit側で処理するので未使用 */ }

async function settleTimeout(roomData){
  const d = roomData ?? (await get(child(ref(db), `rooms/${roomId}`))).val();
  const p1 = d.players.p1, p2 = d.players.p2;
  const a = p1.choice, b = p2.choice;
  if (a && b) return;

  let result;
  if (!a && b){ result = winByDefault("p2", b, d); }
  else if (a && !b){ result = winByDefault("p1", a, d); }
  else { result = { type:"timeout-tie", winner:null, delta:{p1:0,p2:0}, note:"両者未提出" }; }

  const text = resultSpeak(result);
  await update(ref(db), {
    [`rooms/${roomId}/phase`]: "reveal",
    [`rooms/${roomId}/revealEndMs`]: Date.now() + REVEAL_MS,
    [`rooms/${roomId}/lastResult`]: { ...result, _round: d.round, speak: text }
  });
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

/* [19] ルール判定 */
function judgeRound(p1, p2){
  const a = p1.choice, b = p2.choice;

  if (a==="BARRIER" && (b==="WIN"||b==="SWAP")) return { type:"barrier", winner:"p1", delta:{p1:0,p2:0}, barrier:true };
  if (b==="BARRIER" && (a==="WIN"||a==="SWAP")) return { type:"barrier", winner:"p2", delta:{p1:0,p2:0}, barrier:true };

  if (a==="BARRIER" && (b==="G"||b==="C"||b==="P")) return { type:"barrier-penalty", winner:"p2", delta:{p1:-1,p2:0} };
  if (b==="BARRIER" && (a==="G"||a==="C"||a==="P")) return { type:"barrier-penalty", winner:"p1", delta:{p1:0,p2:-1} };

  if (a==="BARRIER" && b==="BARRIER") return { type:"tie", winner:null, delta:{p1:0,p2:0} };

  if (a==="WIN" && b!=="BARRIER") return { type:"win", winner:"p1", delta:{p1:4,p2:0} };
  if (b==="WIN" && a!=="BARRIER") return { type:"win", winner:"p2", delta:{p1:0,p2:4} };

  if (a==="SWAP" && b!=="BARRIER"){ return { type:"swap", winner:"p1", swap:true }; }
  if (b==="SWAP" && a!=="BARRIER"){ return { type:"swap", winner:"p2", swap:true }; }
  if (a==="SWAP" && b==="SWAP") return { type:"tie", winner:null, delta:{p1:0,p2:0}, note:"ダブルSWAPは相殺" };

  if (isBasic(a) && isBasic(b)){
    if (a===b) return { type:"tie", winner:null, delta:{p1:0,p2:0} };
    const aWin = (a==="G"&&b==="C")||(a==="C"&&b==="P")||(a==="P"&&b==="G");
    if (aWin){ return { type:"rps", winner:"p1", delta:{p1: gain(a), p2:0} }; }
    else{ return { type:"rps", winner:"p2", delta:{p1:0, p2: gain(b)} }; }
  }
  return { type:"tie", winner:null, delta:{p1:0,p2:0} };
}

/* [20] リビール完了 → 結果適用 → 次ラウンド or 終了 */
async function finalizeRevealAndAdvance(d){
  if (d.phase !== "reveal") return;

  let p1pos = d.players.p1.pos;
  let p2pos = d.players.p2.pos;
  const r = d.lastResult || { delta:{p1:0,p2:0} };

  const posDiff = Math.abs(p1pos - p2pos);
  if (r.swap){
    if (posDiff < 8){ const tmp = p1pos; p1pos = p2pos; p2pos = tmp; sfx.swap(); }
  }else{
    p1pos = clamp25(p1pos + (r.delta?.p1||0));
    p2pos = clamp25(p2pos + (r.delta?.p2||0));
  }
  p1pos = Math.max(0, p1pos);
  p2pos = Math.max(0, p2pos);

  const roundsDone   = d.round >= (d.minRounds ?? MIN_ROUNDS);
  const someoneGoal  = p1pos >= d.boardSize || p2pos >= d.boardSize;

  const handLeft = (h)=> (h.G+h.C+h.P+h.WIN+h.SWAP+h.BARRIER);
  const p1left   = handLeft(d.players.p1.hand || HAND_INIT);
  const p2left   = handLeft(d.players.p2.hand || HAND_INIT);
  const noCards  = (p1left===0 || p2left===0);

  const shouldEnd = (roundsDone && someoneGoal) || (roundsDone && noCards);

  if (shouldEnd){
    const winner = p1pos===p2pos ? null : (p1pos>p2pos ? "p1" : "p2");
    await update(ref(db), {
      [`rooms/${roomId}/players/p1/pos`]: p1pos,
      [`rooms/${roomId}/players/p2/pos`]: p2pos,
      [`rooms/${roomId}/state`]: "ended",
      [`rooms/${roomId}/phase`]: "ended",
      [`rooms/${roomId}/lastResult`]: { ...(d.lastResult||{}), final:true, winner }
    });
    showMatchEndOverlay(winner);
    return;
  }

  await update(ref(db), {
    [`rooms/${roomId}/players/p1/pos`]: p1pos,
    [`rooms/${roomId}/players/p2/pos`]: p2pos,
    [`rooms/${roomId}/round`]: (d.round||0)+1,
    [`rooms/${roomId}/phase`]: "select",
    [`rooms/${roomId}/roundStartMs`]: Date.now(),
    [`rooms/${roomId}/revealEndMs`]: null,
    [`rooms/${roomId}/players/p1/choice`]: null,
    [`rooms/${roomId}/players/p2/choice`]: null
  });

  roundLocked = false;
  selectedCard = null;
  if (localTimer) { clearInterval(localTimer); localTimer = null; }
  hideReveal();
}

/* [21] 盤面ヘルパ */
function makeBoard(){
  boardEl.innerHTML = "";
  for(let i=1;i<=BOARD_SIZE;i++){
    const cell = document.createElement("div");
    cell.className = "cell"+(i===BOARD_SIZE?" goal":"");
    boardEl.appendChild(cell);
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

/* [22] ユーティリティ */
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

function ensureSeatById(d){
  if (seat && d.players?.[seat]?.id === myId) return seat;
  if (d.players?.p1?.id === myId){ seat = "p1"; return seat; }
  if (d.players?.p2?.id === myId){ seat = "p2"; return seat; }
  return seat;
}

// ▼ リビール（3秒演出）オーバーレイ
function ensureRevealEl(){
  let el = document.getElementById("revealOverlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "revealOverlay";
  el.style.cssText = `
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,.5); z-index:9999; color:#fff; text-align:center; padding:24px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans JP", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
  `;
  const card = document.createElement("div");
  card.style.cssText = `
    background:#222; border-radius:16px; padding:20px 24px; min-width:260px; max-width:86vw;
    box-shadow:0 8px 30px rgba(0,0,0,.4)
  `;
  const t = document.createElement("div");
  t.id = "revealCount";
  t.style.cssText = "font-size:40px; font-weight:700; letter-spacing:1px; margin-bottom:6px";
  const msg = document.createElement("div");
  msg.id = "revealMsg";
  msg.style.cssText = "font-size:16px; opacity:.9; white-space:pre-wrap; line-height:1.5";
  card.appendChild(t); card.appendChild(msg); el.appendChild(card);
  document.body.appendChild(el);
  return el;
}

function showReveal(d){
  const el = ensureRevealEl();
  const tEl = el.querySelector("#revealCount");
  const mEl = el.querySelector("#revealMsg");
  el.style.display = "flex";

  const r = d.lastResult || {};
  const end = d.revealEndMs || (Date.now()+REVEAL_MS);

  if (revealTicker) clearInterval(revealTicker);
  revealTicker = setInterval(()=>{
    const ms = Math.max(0, end - Date.now());
    const sec = Math.ceil(ms/1000);
    if (ms > 0){
      tEl.textContent = `… ${sec}`;
      mEl.textContent = "";
    } else {
      tEl.textContent = "結果！";
      mEl.textContent = r.speak || prettyResult(r);
      clearInterval(revealTicker);
      revealTicker = null;
    }
  }, 100);
}

function hideReveal(){
  const el = document.getElementById("revealOverlay");
  if (el) el.style.display = "none";
  if (revealTicker){ clearInterval(revealTicker); revealTicker = null; }
}

// ▼ リザルトの自然言語
function resultSpeak(r){
  const deltaText = (d)=> {
    const a = d?.p1||0, b=d?.p2||0;
    if (a>0 && b===0) return `あなたは+${a}マス！`;
    if (b>0 && a===0) return `相手は+${b}マス…`;
    if (a<0) return `バリアのペナルティであなたは${a}マス`;
    if (b<0) return `バリアのペナルティで相手は${b}マス`;
    return "";
  };
  switch(r.type){
    case "rps": return (r.winner==="p1") ? `通常勝ち！${deltaText(r.delta)}` : (r.winner==="p2" ? `通常負け…${deltaText(r.delta)}` : "あいこ");
    case "win": return (r.winner==="p1") ? `👑必勝で+4マス！` : `相手の👑必勝…相手+4マス`;
    case "swap": return (r.winner==="p1") ? `🔁位置交換カード！位置を入れ替えました` : `相手が🔁位置交換カード！位置を入れ替えました`;
    case "barrier": return (r.winner==="p1") ? `🛡️バリア成功！相手の特殊を防ぎました` : `相手の🛡️バリア成功！特殊を防がれた`;
    case "barrier-penalty": return `🛡️バリアのペナルティ！出した側が-1マス`;
    case "timeout": return (r.winner==="p1") ? `時間切れであなたの勝ち！${deltaText(r.delta)}` : `時間切れ…相手の勝ち ${deltaText(r.delta)}`;
    case "timeout-tie": return `両者時間切れ`;
    case "tie": return `引き分け`;
    default: return `-`;
  }
}

// ▼ 試合終了オーバーレイ
function showMatchEndOverlay(winner){
  const el = ensureRevealEl();
  const tEl = el.querySelector("#revealCount");
  const mEl = el.querySelector("#revealMsg");
  el.style.display = "flex";
  const iAm = (seat === "p1") ? "p1" : "p2";
  if (winner === null){
    tEl.textContent = "引き分け";
  } else if (winner === iAm){
    tEl.textContent = "🏆 勝利！";
  } else {
    tEl.textContent = "😭 敗北…";
  }
  mEl.innerHTML = "";

  const btnBox = document.createElement("div");
  btnBox.style.cssText = "margin-top:10px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap";
  const b1 = document.createElement("button");
  b1.textContent = "もう一回";
  b1.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#ff99c8; color:#222; font-weight:700; cursor:pointer";
  const b2 = document.createElement("button");
  b2.textContent = "退室";
  b2.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#ffd6e5; color:#222; font-weight:700; cursor:pointer";
  btnBox.appendChild(b1); btnBox.appendChild(b2); mEl.appendChild(btnBox);

  b1.onclick = async ()=>{
    if (seat !== "p1"){ alert("ホストが開始します。少し待ってね！"); return; }
    hideReveal();
    await startGame();
  };
  b2.onclick = ()=> { hideReveal(); leaveRoom(); };
}