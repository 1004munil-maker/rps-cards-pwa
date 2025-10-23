/* =========================================================
   RPS Cards — app.js（安定版フル）
   ---------------------------------------------------------
   [01] モバイル対策
   [02] 効果音（SFX）
   [03] Firebase 初期化（CDN）
   [04] DOM取得
   [04.5] 名前必須ガード
   [05] 定数
   [06] 状態（提出/演出/ポーラー）
   [07] 初期描画（盤面）
   [08] イベント紐づけ
   [09] 対戦前の広告（ネイティブ時のみ）
   [10] ルーム作成/参加
   [11] ロビー購読
   [12] ゲーム開始
   [13] 退出
   [14] レンダリング（演出・入力制御）
   [15] 10秒タイマー
   [16] カード選択
   [17] 提出→演出起動
   [18] タイムアウト
   [19] ルール＆SFX
   [20] 結果適用→自動次R（p1）
   [21] 盤面ヘルパ
   [22] ユーティリティ（オーバーレイ/カウントダウン/ポーラー/再戦）
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

// ★あなたの設定（公開リポなら key ローテーション推奨）
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
const BOARD_SIZE = 20;         // ★ 20マス
const MIN_ROUNDS = 8;
const TURN_TIME  = 10_000;     // ms
const REVEAL_MS  = 3000;       // ms
const BASIC_TOTAL = 12;        // G/C/P 合計
const BASIC_MIN   = 2;         // 各最低枚数
const SPECIALS    = { WIN:1, SWAP:1, BARRIER:1 };

/* [06] 状態（提出/演出/ポーラー） */
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
let revealApplyPoller = null;  // p1: 演出終了監視＆結果適用
let countdownTicker = null;    // 両端末: 3,2,1 表示更新
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
  try {
    await createRoom(roomId, myName);
    enterLobby();
  } catch (e) {
    console.error("createRoom failed:", e);
    alert("部屋作成に失敗しました：" + (e?.message || e));
  }
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

if (btnStart) btnStart.onclick = async () => { await maybeAdThenStart(); };
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

/* [09] 対戦前の広告（ネイティブ時のみ） */
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
    round: 0,
    minRounds: MIN_ROUNDS,
    boardSize: BOARD_SIZE,
    roundStartMs: null,
    lastResult: null,
    revealRound: null,
    revealUntilMs: null,
    rematchVotes: { p1:false, p2:false },
    players: {
      p1: { id: myId, name, pos: 0, choice: null, hand: randomHand(), joinedAt: serverTimestamp() },
      p2: { id: null, name: null, pos: 0, choice: null, hand: randomHand(), joinedAt: null }
    }
  });
}

async function joinRoom(id, name){
  name = (name || "").trim();
  if (!name) return { ok:false, reason:"NO_NAME" };

  const roomRef = ref(db, `rooms/${id}`);
  const snap = await get(roomRef);
  if (!snap.exists()) return { ok:false, reason:"NO_ROOM" };

  const d = snap.val();
  if (d.players?.p2?.id) return { ok:false, reason:"FULL" };

  await update(ref(db, `rooms/${id}/players/p2`), {
    id: myId, name, pos: 0, choice: null, hand: randomHand(), joinedAt: serverTimestamp()
  });

  // 念のため確認
  const check = await get(child(roomRef, `players/p2/id`));
  if (!check.exists()) return { ok:false, reason:"WRITE_FAIL" };

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
    curRoom = d;
    renderGame(d);
    ensurePollers();
  });
}

/* [12] ゲーム開始 */
async function startGame(){
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()) { alert("部屋が見つかりません"); return; }
  const d = snap.val();

  if (seat !== "p1") { alert("ホストのみ開始できます"); return; }
  const hasP1 = !!d?.players?.p1?.id;
  const hasP2 = !!d?.players?.p2?.id;
  if (!(hasP1 && hasP2)) { alert("2人そろってから開始できます"); return; }
  if (d.state === "playing") return;

  await update(ref(db, `rooms/${roomId}`), {
    state: "playing",
    round: 1,
    roundStartMs: Date.now(),
    lastResult: null,
    revealRound: null,
    revealUntilMs: null,
    rematchVotes: { p1:false, p2:false },
    "players/p1/pos": 0,
    "players/p2/pos": 0,
    "players/p1/choice": null,
    "players/p2/choice": null,
    "players/p1/hand": randomHand(),
    "players/p2/hand": randomHand(),
  });
}

/* [13] 退出 */
async function leaveRoom(){
  try {
    if (btnLeave) btnLeave.disabled = true;
    if (btnExit)  btnExit.disabled  = true;

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
      updates[`${base}/hand`]     = randomHand();
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

/* [14] レンダリング（演出・入力制御） */
function renderGame(d){
  // 画面切替
  if (d.state === "lobby"){
    auth.classList.add("hidden");
    lobby.classList.remove("hidden");
    game.classList.add("hidden");
  } else {
    lobby.classList.add("hidden");
    game.classList.remove("hidden");
  }

  roundNo.textContent = d.round ?? 0;
  minRoundsEl.textContent = d.minRounds ?? MIN_ROUNDS;

  const meSeat = seat;
  const opSeat = seat==="p1" ? "p2" : "p1";
  const me = d.players[meSeat];
  const op = d.players[opSeat];

  const iSubmitted     = !!me.choice;
  const opSubmitted    = !!op.choice;
  const bothSubmitted  = iSubmitted && opSubmitted;
  const endedThisRound = !!(d.lastResult && d.lastResult._round === d.round);
  const revealing      = (d.revealRound === d.round);

  // ロビー表示
  p1Label.textContent = d.players.p1?.name || "-";
  p2Label.textContent = d.players.p2?.name || "-";
  btnStart.disabled = !(seat==="p1" && d.players.p1?.id && d.players.p2?.id) || d.state!=="lobby";

  // 手札・ボード
  updateCounts(me.hand);
  placeTokens(d.players.p1.pos, d.players.p2.pos, d.boardSize);
  mePosEl.textContent = seat==="p1" ? d.players.p1.pos : d.players.p2.pos;
  opPosEl.textContent = seat==="p1" ? d.players.p2.pos : d.players.p1.pos;

  diffEl.textContent = Math.abs(
    (seat==="p1"?d.players.p1.pos:d.players.p2.pos) -
    (seat==="p1"?d.players.p2.pos:d.players.p1.pos)
  );

  // 自分は自分の選択を表示、相手のは隠す（提出済みかだけ）
  meChoiceEl.textContent = toFace(me.choice) || "？";
  opChoiceEl.textContent = opSubmitted ? "⏳" : "？";
  if (endedThisRound) {
    // 結果が確定した後は非表示のままでもOK（演出で説明する）
  }

  // SWAP使用可否（差が8以上は不可）
  const diff = Math.abs(d.players.p1.pos - d.players.p2.pos);
  const swapBtn = document.querySelector('.cardBtn[data-card="SWAP"]');

  // ラウンド提出ロック
  roundLocked = iSubmitted;

  // 入力可否
  cardBtns.forEach(b=>{
    const k = b.dataset.card;
    const left = me.hand[k]||0;
    const swapBlocked = (k==="SWAP" && diff>=8);
    const disable = (left<=0) || iSubmitted || endedThisRound || revealing || d.state!=="playing";
    b.disabled = swapBlocked ? true : disable;
    b.classList.toggle("selected", selectedCard === k && !disable && !swapBlocked);
  });
  if (swapBtn) swapBtn.disabled = (me.hand.SWAP<=0) || diff >= 8 || iSubmitted || endedThisRound || revealing || d.state!=="playing";
  if (btnPlay) btnPlay.disabled = !selectedCard || iSubmitted || endedThisRound || revealing || d.state!=="playing";

  // メッセージ
  if (d.state === "ended"){
    const w = d.lastResult?.winner;
    stateMsg.textContent = w===null ? "🤝 引き分け。もう一回する？" : ( (w===meSeat) ? "🏆 勝利！" : "😢 敗北…" );
  } else if (revealing){
    const remain = Math.max(0, Math.ceil((d.revealUntilMs - Date.now())/1000));
    stateMsg.textContent = `判定まで… ${remain}s`;
  } else if (endedThisRound){
    stateMsg.textContent = "結果表示中… 次ラウンドへ進みます";
  } else if (iSubmitted && !opSubmitted){
    stateMsg.textContent = "提出済み！相手の手を待っています…";
  } else {
    stateMsg.textContent = "10秒以内に出してね（出さないと負け）";
  }

  // タイマー
  setupTimer(d.roundStartMs, d.round, me.choice, op.choice, d);

  // 保険：両者提出 → p1 が演出開始
  if (bothSubmitted && seat==="p1" && !revealing && !endedThisRound && d.state==="playing"){
    update(ref(db, `rooms/${roomId}`), {
      revealRound: d.round,
      revealUntilMs: Date.now() + REVEAL_MS
    });
  }

  // 結果オーバーレイ（全端末）
  if (endedThisRound && overlayShownRound !== d.round){
    showResultOverlay(makeRoundSummary(d.lastResult, meSeat), REVEAL_MS);
    overlayShownRound = d.round;
  }

  // 終局：再戦UI
  if (d.state === "ended"){
    showRematchOverlay(d);
  } else {
    hideRematchOverlay();
  }

  // 次ラウンドでオーバーレイが残らないよう掃除
  if (!endedThisRound && !revealing && overlayShownRound !== d.round){
    hideResultOverlay();
  }
}

/* [15] 10秒タイマー */
function setupTimer(roundStartMs, round, myChoice, opChoice, roomData){
  if (localTimer) clearInterval(localTimer);
  lastBeepSec = null;

  const ended = !!(roomData?.lastResult && roomData.lastResult._round === roomData.round);
  const revealing = (roomData?.revealRound === roomData?.round);
  if (roomData?.state==="ended" || ended || revealing || (myChoice && opChoice)){ timerEl.textContent = "OK"; return; }

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
        const dNow = roomData ?? (await get(child(ref(db), `rooms/${roomId}`))).val();
        await settleTimeout(dNow);
      }
      timerEl.textContent = "OK";
    }
  };
  tick();
  localTimer = setInterval(tick, 200);
}

/* [16] カード選択 */
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

/* [17] 提出→演出起動 */
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

  if ((me.hand[selectedCard]||0) <= 0){ alert("そのカードはもうありません"); return; }
  if (selectedCard === "SWAP"){
    const room = (await get(child(ref(db), `rooms/${roomId}`))).val();
    const diff = Math.abs(room.players.p1.pos - room.players.p2.pos);
    if (diff >= 8){ alert("差が8マス以上のため、位置交換カードは使えません"); return; }
  }

  await update(ref(db, `rooms/${roomId}/players/${seat}`), {
    choice: selectedCard,
    [`hand/${selectedCard}`]: (me.hand[selectedCard]||0) - 1
  });

  // ローカルロック
  roundLocked = true;
  selectedCard = null;
  cardBtns.forEach(b => { b.classList.remove("selected"); b.disabled = true; });
  if (btnPlay) btnPlay.disabled = true;

  // 両者提出済みなら p1 が演出開始
  await tryStartRevealIfBothReady();
}

async function tryStartRevealIfBothReady(){
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()) return;
  const d = snap.val();
  const p1 = d.players.p1, p2 = d.players.p2;
  const both = !!p1.choice && !!p2.choice;

  if (both && seat === "p1" && d.revealRound !== d.round){
    await update(ref(db, `rooms/${roomId}`), {
      revealRound: d.round,
      revealUntilMs: Date.now() + REVEAL_MS
    });
  }
}

/* [18] タイムアウト */
async function settleTimeout(roomData){
  const d = roomData ?? (await get(child(ref(db), `rooms/${roomId}`))).val();
  const p1 = d.players.p1, p2 = d.players.p2;
  const a = p1.choice, b = p2.choice;
  if (a && b) return; // 両者提出済 → 演出ルート

  let result;
  if (!a && b){ result = winByDefault("p2", b, d); }
  else if (a && !b){ result = winByDefault("p1", a, d); }
  else { result = { type:"timeout-tie", winner:null, delta:{p1:0,p2:0}, note:"両者未提出", _round:d.round }; }

  if (!result._round) result._round = d.round;

  await applyResult(d, result);
  playResultSfx(result);
  showResultOverlay(makeRoundSummary(result, seat), REVEAL_MS);
  scheduleAutoNext(d);
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

/* [19] ルール＆SFX */
function judgeRound(p1, p2){
  const a = p1.choice, b = p2.choice;

  // 必勝 vs 必勝 → 引き分け
  if (a==="WIN" && b==="WIN") {
    return { type:"win", winner:null, delta:{p1:0,p2:0}, note:"必勝同士" };
  }

  // バリア vs 必勝/交換（防御側の勝ち、進まない）
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

  // 位置交換（差<8のみ）
  if (a==="SWAP" && b!=="BARRIER"){ return { type:"swap", winner:"p1", swap:true }; }
  if (b==="SWAP" && a!=="BARRIER"){ return { type:"swap", winner:"p2", swap:true }; }
  if (a==="SWAP" && b==="SWAP") return { type:"tie", winner:null, delta:{p1:0,p2:0}, note:"ダブルSWAPは相殺" };

  // 通常じゃんけん
  if (isBasic(a) && isBasic(b)){
    if (a===b) return { type:"tie", winner:null, delta:{p1:0,p2:0} };
    const aWin = (a==="G"&&b==="C")||(a==="C"&&b==="P")||(a==="P"&&b==="G");
    if (aWin){ return { type:"rps", winner:"p1", delta:{p1: gain(a), p2:0} }; }
    else{ return { type:"rps", winner:"p2", delta:{p1:0, p2: gain(b)} }; }
  }
  return { type:"tie", winner:null, delta:{p1:0,p2:0} };
}

function playResultSfx(r){
  if (r.type==="swap"){ sfx.swap(); return; }
  if (r.type==="barrier"){ sfx.barrier(); return; }
  if (r.type==="barrier-penalty"){ sfx.penalty(); return; }
  if (r.type==="win" || (r.type==="rps" && r.winner)){
    const amIWinner = (r.winner === (seat==="p1"?"p1":"p2"));
    amIWinner ? sfx.win() : sfx.lose();
    return;
  }
  if (r.type==="timeout"){
    const amIWinner = (r.winner === (seat==="p1"?"p1":"p2"));
    amIWinner ? sfx.win() : sfx.lose();
    return;
  }
}

/* [20] 結果適用→自動次R（p1） */
async function applyResult(d, r){
  if (d.lastResult && d.lastResult._round === d.round) return;

  let p1pos = d.players.p1.pos;
  let p2pos = d.players.p2.pos;

  const posDiff = Math.abs(p1pos - p2pos);
  if (r.swap){
    if (posDiff < 8){ const tmp = p1pos; p1pos = p2pos; p2pos = tmp; }
  }else{
    p1pos = clampN(p1pos + (r.delta?.p1||0), d.boardSize);
    p2pos = clampN(p2pos + (r.delta?.p2||0), d.boardSize);
  }
  p1pos = Math.max(0, p1pos);
  p2pos = Math.max(0, p2pos);

  await update(ref(db, `rooms/${roomId}`), {
    [`players/p1/pos`]: p1pos,
    [`players/p2/pos`]: p2pos,
    lastResult: { ...r, _round: d.round },
    revealRound: null,
    revealUntilMs: null
  });
}

function scheduleAutoNext(d){
  if (seat !== "p1") return;
  setTimeout(async ()=>{
    const snap = await get(child(ref(db), `rooms/${roomId}`));
    if (!snap.exists()) return;
    const cur = snap.val();

    const roundsDone  = cur.round >= (cur.minRounds ?? MIN_ROUNDS);
    const someoneGoal = cur.players.p1.pos >= cur.boardSize || cur.players.p2.pos >= cur.boardSize;

    const handLeft = (h)=> (h.G+h.C+h.P+h.WIN+h.SWAP+h.BARRIER);
    const p1left = handLeft(cur.players.p1.hand);
    const p2left = handLeft(cur.players.p2.hand);
    const noCards = (p1left===0 || p2left===0);

    if ((roundsDone && someoneGoal) || (roundsDone && noCards)){
      const winner = cur.players.p1.pos===cur.players.p2.pos ? null : (cur.players.p1.pos>cur.players.p2.pos?"p1":"p2");
      await update(ref(db, `rooms/${roomId}`), {
        state:"ended",
        lastResult: { ...(cur.lastResult||{}), final:true, winner }
      });
      // 終局時は再戦オーバーレイで案内
      return;
    }

    await update(ref(db, `rooms/${roomId}`), {
      round: (cur.round||0)+1,
      roundStartMs: Date.now(),
      "players/p1/choice": null,
      "players/p2/choice": null
    });
    roundLocked = false;
    selectedCard = null;
    hideResultOverlay();
  }, REVEAL_MS);
}

/* [21] 盤面ヘルパ */
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
  cells.forEach(c=>{
    c.querySelector(".token.me")?.remove();
    c.querySelector(".token.op")?.remove();
  });
  const idx1 = Math.min(size, Math.max(0,p1)) - 1;
  const idx2 = Math.min(size, Math.max(0,p2)) - 1;

  if (idx1>=0){
    const t1 = document.createElement("div");
    t1.className = "token me";
    cells[idx1]?.appendChild(t1);
  }
  if (idx2>=0){
    const t2 = document.createElement("div");
    t2.className = "token op";
    cells[idx2]?.appendChild(t2);
  }
  // 同マス重なり対処：左右にズラす
  if (idx1>=0 && idx1===idx2){
    const cell = cells[idx1];
    cell.style.position = "relative";
    const tm = cell.querySelector(".token.me");
    const to = cell.querySelector(".token.op");
    if (tm){ tm.style.position="relative"; tm.style.transform="translateX(-6px)"; tm.style.zIndex="2"; }
    if (to){ to.style.position="relative"; to.style.transform="translateX(6px)"; to.style.zIndex="1"; }
  }
}

/* [22] ユーティリティ（オーバーレイ/カウントダウン/ポーラー/再戦） */
function randomHand(){
  // G/C/P を合計 BASIC_TOTAL でランダム配分（最低 BASIC_MIN 保証）
  let rest = BASIC_TOTAL - BASIC_MIN*3;
  let g = BASIC_MIN, c = BASIC_MIN, p = BASIC_MIN;
  const add = [0,0,0];
  for(let i=0;i<rest;i++){ add[Math.floor(Math.random()*3)]++; }
  g += add[0]; c += add[1]; p += add[2];
  return { G:g, C:c, P:p, ...SPECIALS };
}
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
function prettyResult(r, seatKey){
  switch(r.type){
    case "rps": {
      const myDelta = r.delta?.[seatKey] ?? 0;
      const opDelta = r.delta?.[seatKey==="p1"?"p2":"p1"] ?? 0;
      if (myDelta>0) return `あなたの勝ち！ +${myDelta} マス`;
      if (opDelta>0) return `相手の勝ち… 相手が +${opDelta} マス`;
      return "あいこ";
    }
    case "win": {
      if (r.winner===seatKey) return "あなたの必勝！ +4";
      if (r.winner) return "相手の必勝！ +4";
      return "必勝同士";
    }
    case "swap": return "位置を交換！";
    case "barrier": return (r.winner===seatKey) ? "あなたのバリアが防いだ" : "相手のバリアが防いだ";
    case "barrier-penalty": {
      const myDelta = r.delta?.[seatKey] ?? 0;
      return myDelta<0 ? "バリアのペナルティ：あなたが -1" : "バリアのペナルティ：相手が -1";
    }
    case "timeout": {
      if (r.winner===seatKey) return "相手の時間切れであなたの勝ち";
      if (r.winner) return "あなたの時間切れ…相手の勝ち";
      return "時間切れ";
    }
    case "timeout-tie": return "両者時間切れ";
    case "tie": return "引き分け";
    default: return "-";
  }
}
function clampN(x,n){ return Math.max(0, Math.min(n, x)); }
function rid(n=6){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:n},()=>A[Math.floor(Math.random()*A.length)]).join(""); }

// === 結果オーバーレイ ===
function ensureOverlay(){
  if (resultOverlayEl) return resultOverlayEl;
  resultOverlayEl = document.createElement("div");
  Object.assign(resultOverlayEl.style, {
    position:"fixed", inset:"0", background:"rgba(0,0,0,0.5)",
    display:"none", alignItems:"center", justifyContent:"center",
    zIndex:"9999", backdropFilter:"blur(2px)"
  });
  const inner = document.createElement("div");
  inner.id = "overlayInner";
  Object.assign(inner.style, {
    background:"#fff", borderRadius:"16px", padding:"24px 28px",
    fontSize:"22px", textAlign:"center", minWidth:"260px",
    boxShadow:"0 8px 24px rgba(0,0,0,.25)", fontWeight:"700"
  });
  resultOverlayEl.appendChild(inner);
  document.body.appendChild(resultOverlayEl);
  return resultOverlayEl;
}
function showResultOverlay(text, ms=REVEAL_MS){
  const el = ensureOverlay();
  const inner = el.querySelector("#overlayInner");
  inner.textContent = text;
  inner.style.fontSize = "22px";
  el.style.display = "flex";
  if (overlayTimerId) clearTimeout(overlayTimerId);
  overlayTimerId = setTimeout(hideResultOverlay, ms);
}
function hideResultOverlay(){
  if (!resultOverlayEl) return;
  resultOverlayEl.style.display = "none";
  if (overlayTimerId) { clearTimeout(overlayTimerId); overlayTimerId = null; }
}
function updateCountdownOverlay(){
  if (!curRoom) return;
  if (curRoom.revealRound !== curRoom.round) { hideResultOverlay(); return; }
  const remain = Math.max(0, Math.ceil((curRoom.revealUntilMs - Date.now())/1000));
  const el = ensureOverlay();
  const inner = el.querySelector("#overlayInner");
  inner.textContent = remain>0 ? `${remain}` : "0";
  inner.style.fontSize = "64px";
  el.style.display = "flex";
}

// ラウンド結果の要約（自分視点で対称表現）
function makeRoundSummary(r, mySeat){
  const seatKey = mySeat || (seat==="p1"?"p1":"p2");
  if (r.swap) return "🔁 位置を交換！";
  if (r.type === "barrier") return (r.winner===seatKey) ? "🛡️ バリアで防いだ！" : "🛡️ 相手のバリアが発動";
  if (r.type === "barrier-penalty") {
    const myDelta = r.delta?.[seatKey] ?? 0;
    return myDelta<0 ? "🛡️ バリアのペナルティ：あなたが -1" : "🛡️ バリアのペナルティ：相手が -1";
  }
  if (r.type === "win") {
    if (r.winner===seatKey) return "👑 必勝！ +4";
    if (r.winner) return "👑 相手の必勝… +4";
    return "👑 必勝同士";
  }
  if (r.type === "rps") {
    const myDelta = r.delta?.[seatKey] ?? 0;
    const opDelta = r.delta?.[seatKey==="p1"?"p2":"p1"] ?? 0;
    if (myDelta>0) return `🎉 勝ち！ +${myDelta} マス`;
    if (opDelta>0) return `😣 負け… 相手が +${opDelta} マス`;
    return "🤝 あいこ";
  }
  if (r.type === "timeout") {
    const meWin = (r.winner === seatKey);
    return meWin ? "⏱ 相手の時間切れで勝利！" : "⏱ 時間切れ…相手の勝ち";
  }
  if (r.type === "timeout-tie") return "⏱ 両者時間切れ";
  if (r.type === "tie") return "🤝 あいこ";
  return "—";
}

// === ポーラー（p1の結果確定 / 両端末のカウントダウン表示 / 再戦合意監視） ===
function ensurePollers(){
  // カウントダウン表示（両端末）
  if (!countdownTicker){
    countdownTicker = setInterval(()=>{ if (curRoom) updateCountdownOverlay(); }, 250);
  }
  // p1だけ：演出終了したら必ず結果を適用／再戦合意で再開
  if (seat === "p1" && !revealApplyPoller){
    revealApplyPoller = setInterval(async ()=>{
      if (!curRoom) return;

      // 演出終了→判定適用
      if (curRoom.state==="playing"){
        const d = curRoom;
        const both = !!d.players.p1.choice && !!d.players.p2.choice;
        const revealing = (d.revealRound === d.round);
        const already = !!(d.lastResult && d.lastResult._round === d.round);
        if (both && revealing && !already && Date.now() >= d.revealUntilMs){
          const result = judgeRound(d.players.p1, d.players.p2);
          result._round = d.round;
          await applyResult(d, result);
          playResultSfx(result);
          showResultOverlay(makeRoundSummary(result, seat), REVEAL_MS);
          scheduleAutoNext(d);
        }
      }

      // 再戦（両者合意）→新規試合
      if (curRoom.state==="ended"){
        const v = curRoom.rematchVotes || {p1:false,p2:false};
        if (v.p1 && v.p2){
          await startNewMatch(); // P1が一括リセット
        }
      }
    }, 200);
  }
}

/* === 再戦系 === */
function showRematchOverlay(d){
  // 既に表示していれば更新のみ
  let box = document.getElementById("rematchBox");
  if (!box){
    box = document.createElement("div");
    box.id = "rematchBox";
    Object.assign(box.style, {
      position:"fixed", left:"50%", top:"50%", transform:"translate(-50%,-50%)",
      background:"#fff", borderRadius:"14px", padding:"16px 18px", zIndex:"10000",
      boxShadow:"0 8px 24px rgba(0,0,0,.25)", minWidth:"260px", textAlign:"center"
    });
    const h = document.createElement("div");
    h.id="rematchTitle"; h.style.fontWeight="700"; h.style.fontSize="18px"; h.style.marginBottom="12px";
    const p = document.createElement("div");
    p.id="rematchStatus"; p.style.margin="8px 0 12px"; p.style.fontSize="13px"; p.style.color="#666";
    const row = document.createElement("div"); row.style.display="flex"; row.style.gap="8px"; row.style.justifyContent="center";
    const again = document.createElement("button"); again.textContent = "もう一回";
    again.style.padding="10px 14px"; again.style.borderRadius="8px"; again.style.border="none"; again.style.background="#4caf50"; again.style.color="#fff"; again.style.fontWeight="700";
    again.onclick = voteRematch;
    const exit = document.createElement("button"); exit.textContent = "退出";
    exit.style.padding="10px 14px"; exit.style.borderRadius="8px"; exit.style.border="none"; exit.style.background="#f44336"; exit.style.color="#fff"; exit.style.fontWeight="700";
    exit.onclick = leaveRoom;
    row.appendChild(again); row.appendChild(exit);
    box.appendChild(h); box.appendChild(p); box.appendChild(row);
    document.body.appendChild(box);
  }
  const w = d.lastResult?.winner;
  const title = document.getElementById("rematchTitle");
  const status = document.getElementById("rematchStatus");
  title.textContent = (w===null) ? "🤝 引き分け！" : ((w===seat) ? "🏆 勝利！" : "😢 敗北…");
  const v = d.rematchVotes || {p1:false,p2:false};
  status.textContent = `再戦の同意：P1 ${v.p1?"✅":"—"} / P2 ${v.p2?"✅":"—"}`;
  box.style.display = "block";
}
function hideRematchOverlay(){
  const box = document.getElementById("rematchBox");
  if (box) box.style.display = "none";
}
async function voteRematch(){
  const key = seat; // "p1" or "p2"
  await update(ref(db, `rooms/${roomId}/rematchVotes`), { [key]: true });
}
async function startNewMatch(){
  // 新しい手札もランダム・ポジション/ラウンド初期化
  await update(ref(db, `rooms/${roomId}`), {
    state: "playing",
    round: 1,
    boardSize: BOARD_SIZE,
    roundStartMs: Date.now(),
    lastResult: null,
    revealRound: null,
    revealUntilMs: null,
    rematchVotes: { p1:false, p2:false },
    "players/p1/pos": 0,
    "players/p2/pos": 0,
    "players/p1/choice": null,
    "players/p2/choice": null,
    "players/p1/hand": randomHand(),
    "players/p2/hand": randomHand(),
  });
  roundLocked = false;
  selectedCard = null;
  hideResultOverlay();
}

/* 小さい補助 */
function prettyResultTextForLabel(r, mySeat){
  return prettyResult(r, mySeat);
}