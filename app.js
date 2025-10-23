/* =========================================================
   RPS Cards — app.js（同期安定版・リマッチ対応）
   ---------------------------------------------------------
   [01] モバイル対策
   [02] 効果音（SFX）
   [03] Firebase 初期化（CDN）
   [04] DOM取得
   [05] 定数（★BOARD_SIZE=20）
   [06] ローカル状態
   [07] 盤面初期描画
   [08] イベント紐づけ
   [09] ルーム作成/参加
   [10] ロビー購読（単一購読）
   [11] p1の進行ポーラー（唯一の司令塔）
   [12] レンダリング（UI/入力制御/オーバーレイ）
   [13] 提出処理
   [14] 判定/結果適用
   [15] 次ラウンド・終了・リマッチ
   [16] ユーティリティ
   ========================================================= */

/* [01] モバイル対策 */
window.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });
['gesturestart','gesturechange','gestureend'].forEach(ev=>{
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
});
let __lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - __lastTouchEnd <= 300) e.preventDefault();
  __lastTouchEnd = now;
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
    osc.start(t0); osc.stop(t0+attack+dur+release+0.02);
  }
  click(){ this.tone({freq:900,dur:0.03,type:'square',gain:0.04}); }
  play(){ this.tone({freq:660,dur:0.06,type:'triangle',gain:0.05}); }
  win(){ this.tone({freq:740,dur:0.1,type:'sine',gain:0.06}); setTimeout(()=>this.tone({freq:880,dur:0.1}),110); }
  lose(){ this.tone({freq:200,dur:0.12,type:'sawtooth',gain:0.05}); }
  swap(){ this.tone({freq:520,dur:0.08}); setTimeout(()=>this.tone({freq:420,dur:0.08}),90); }
  barrier(){ this.tone({freq:320,dur:0.06}); setTimeout(()=>this.tone({freq:260,dur:0.06}),80); }
  penalty(){ this.tone({freq:180,dur:0.06}); }
  tick(){ this.tone({freq:1000,dur:0.03,type:'square',gain:0.045}); }
  timesup(){ this.tone({freq:140,dur:0.2,type:'sawtooth',gain:0.07}); }
}
const sfx = new SFX();
['touchstart','mousedown','keydown'].forEach(ev=>{
  window.addEventListener(ev, ()=> sfx.ensure(), { once:true, passive:true });
});

/* [03] Firebase 初期化（CDN） */
const { initializeApp, getDatabase, ref, onValue, set, update, get, child, serverTimestamp, remove } = window.FirebaseAPI;

// ★あなたの設定（公開用キーでOK）
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
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const playerName  = $("#playerName");
const btnCreate   = $("#btnCreate");
const joinId      = $("#joinId");
const btnJoin     = $("#btnJoin");
const btnCopy     = $("#btnCopy");

const auth        = $("#auth");
const lobby       = $("#lobby");
const roomIdLabel = $("#roomIdLabel");
const p1Label     = $("#p1Label");
const p2Label     = $("#p2Label");
const btnStart    = $("#btnStart");
const btnLeave    = $("#btnLeave");

const game        = $("#game");
const roundNo     = $("#roundNo");
const minRoundsEl = $("#minRounds");
const timerEl     = $("#timer");
const diffEl      = $("#diff");
const boardEl     = $("#board");
const mePosEl     = $("#mePos");
const opPosEl     = $("#opPos");
const stateMsg    = $("#stateMsg");
const meChoiceEl  = $("#meChoice");
const opChoiceEl  = $("#opChoice");
const resultText  = $("#resultText");
const btnPlay     = $("#btnPlay");
const btnClear    = $("#btnClear");
const btnExit     = $("#btnExit");

const cardBtns    = $$(".cardBtn");
const cntG        = $("#cntG"), cntC=$("#cntC"), cntP=$("#cntP"), cntWIN=$("#cntWIN"), cntSWAP=$("#cntSWAP"), cntBARRIER=$("#cntBARRIER");

/* [05] 定数（★BOARD_SIZE=20） */
const BOARD_SIZE    = 20;
const MIN_ROUNDS    = 8;
const TURN_TIME     = 10_000; // 提出猶予
const COUNTDOWN_MS  = 3000;   // 3,2,1
const RESULT_MS     = 1800;   // 結果見せ時間

/* [06] ローカル状態 */
let myId = rid(6);
let myName = "";
let roomId = "";
let seat = ""; // "p1" | "p2"

let unsubRoom = null;
let curRoom = null;

let selectedCard = null;
let roundLocked  = false;

let controllerTick = null;   // p1のみ：進行管理
let uiTicker = null;         // 両端末：カウント/タイマー描画
let lastBeepSec = null;

let resultOverlayEl = null;  // オーバーレイDOM
let overlayHideTimer = null; // 自動クローズTimer
let lastSfxRoundPlayed = 0;  // 同一RでSFX重複防止

/* [07] 盤面初期描画 */
makeBoard();

/* [08] イベント紐づけ */
if (playerName && btnCreate && btnJoin){
  btnCreate.disabled = true;
  btnJoin.disabled   = true;
  playerName.addEventListener('input', ()=>{
    const ok = playerName.value.trim().length >= 1;
    btnCreate.disabled = !ok;
    btnJoin.disabled   = !ok;
  });
}

if (btnCreate) btnCreate.onclick = async ()=>{
  sfx.click();
  const name = (playerName.value||"").trim();
  if (!name){ alert("名前を1文字以上入力してね"); return; }
  myName = name;
  roomId = rid(6);
  seat = "p1";
  try{
    await createRoom(roomId, myName);
    enterLobby();
  }catch(e){
    console.error(e);
    alert("部屋作成に失敗：" + (e?.message||e));
  }
};
if (btnJoin) btnJoin.onclick = async ()=>{
  sfx.click();
  const name = (playerName.value||"").trim();
  if (!name){ alert("名前を1文字以上入力してね"); return; }
  myName = name;

  const id = (joinId.value||"").trim().toUpperCase();
  if (!id){ alert("部屋IDを入力してね"); return; }
  const res = await joinRoom(id, name);
  if (!res.ok){
    alert(res.reason==="NO_ROOM" ? "部屋番号が存在しません"
         :res.reason==="FULL"    ? "その部屋は満席です"
         :res.reason==="NO_NAME" ? "名前を1文字以上入力してね"
         :"参加に失敗しました。時間をおいて再度お試しください。");
    return;
  }
  roomId = id;
  seat = "p2";
  enterLobby();
};
if (btnCopy) btnCopy.onclick = ()=>{
  if (!roomIdLabel) return;
  navigator.clipboard.writeText(roomIdLabel.textContent || "");
  btnCopy.textContent = "コピー済み";
  setTimeout(()=>btnCopy.textContent="コピー", 1200);
  sfx.click();
};
if (btnStart) btnStart.onclick = async ()=>{
  sfx.click();
  await startGame();
};
if (btnLeave) btnLeave.onclick = ()=>{ sfx.click(); leaveRoom(); };
if (btnExit)  btnExit.onclick  = ()=>{ sfx.click(); leaveRoom(); };

cardBtns.forEach(b=>{
  b.addEventListener('click', ()=>{
    sfx.click();
    pickCard(b.dataset.card);
  });
});
if (btnClear) btnClear.onclick = ()=>{
  if (roundLocked) return;
  selectedCard = null;
  cardBtns.forEach(b=> b.classList.remove('selected'));
  if (btnPlay) btnPlay.disabled = true;
  sfx.click();
};
if (btnPlay) btnPlay.onclick = ()=>{ sfx.play(); submitCard(); };

/* [09] ルーム作成/参加 */
function HAND_INIT(){ return { G:4, C:4, P:4, WIN:1, SWAP:1, BARRIER:1 }; }

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
    showUntilMs: null,
    rematch: { p1: false, p2: false }, // ★リマッチ投票
    players: {
      p1: { id: myId, name, pos: 0, choice: null, hand: HAND_INIT(), joinedAt: serverTimestamp() },
      p2: { id: null, name: null, pos: 0, choice: null, hand: HAND_INIT(), joinedAt: null }
    }
  });
}
async function joinRoom(id, name){
  name = (name||"").trim();
  if (!name) return { ok:false, reason:"NO_NAME" };

  const snap = await get(child(ref(db), `rooms/${id}`));
  if (!snap.exists()) return { ok:false, reason:"NO_ROOM" };

  const d = snap.val();
  if (d.players?.p2?.id) return { ok:false, reason:"FULL" };

  await update(ref(db), {
    [`rooms/${id}/players/p2/id`]: myId,
    [`rooms/${id}/players/p2/name`]: name,
    [`rooms/${id}/players/p2/pos`]: 0,
    [`rooms/${id}/players/p2/choice`]: null,
    [`rooms/${id}/players/p2/hand`]: HAND_INIT(),
    [`rooms/${id}/players/p2/joinedAt`]: serverTimestamp()
  });
  return { ok:true };
}

/* [10] ロビー購読（単一購読） */
function enterLobby(){
  if (!auth || !lobby) return;
  auth.classList.add("hidden");
  lobby.classList.remove("hidden");
  if (roomIdLabel) roomIdLabel.textContent = roomId;

  const roomRef = ref(db, `rooms/${roomId}`);
  if (unsubRoom) unsubRoom();
  unsubRoom = onValue(roomRef, (snap)=>{
    if (!snap.exists()) return;
    curRoom = snap.val();

    // ロビー表示
    if (p1Label) p1Label.textContent = curRoom?.players?.p1?.name || "-";
    if (p2Label) p2Label.textContent = curRoom?.players?.p2?.name || "-";

    // ゲーム表示切替
    if (curRoom.state === "playing" || curRoom.state === "ended"){
      lobby.classList.add("hidden");
      if (game) game.classList.remove("hidden");
    }

    renderGame(curRoom);
    ensureLoops(); // p1の司令塔・UIタイカー
  });
}

/* [11] p1の進行ポーラー（唯一の司令塔） */
function ensureLoops(){
  // UIタイカー（両端末）
  if (!uiTicker){
    uiTicker = setInterval(()=>{ updateTimeAndOverlays(); }, 250);
  }

  // p1のみ：進行管理
  if (seat === "p1" && !controllerTick){
    controllerTick = setInterval(async ()=>{
      const d = curRoom;
      if (!d) return;

      if (d.state === "playing"){
        const round = d.round||0;
        const bothSubmitted = !!(d.players?.p1?.choice) && !!(d.players?.p2?.choice);
        const deadline = (d.roundStartMs||0) + TURN_TIME;
        const now = Date.now();

        const resultAlready = !!(d.lastResult && d.lastResult._round === round);
        const countingDown  = (d.revealRound === round) && (now < (d.revealUntilMs||0));
        const countdownEnded= (d.revealRound === round) && (now >= (d.revealUntilMs||0));
        const showingResult = resultAlready && d.showUntilMs && now < d.showUntilMs;
        const showEnded     = resultAlready && d.showUntilMs && now >= d.showUntilMs;

        // 1) タイムアウト → 勝敗確定
        if (!resultAlready && !countingDown && !bothSubmitted && now >= deadline){
          const result = judgeTimeout(d);
          await applyResult(d, result);
          playResultSfxOnce(round, result);
          await update(ref(db), { [`rooms/${roomId}/showUntilMs`]: now + RESULT_MS });
          return;
        }

        // 2) 両者提出 → カウントダウン開始
        if (bothSubmitted && !resultAlready && !countingDown && d.revealRound !== round){
          await update(ref(db), {
            [`rooms/${roomId}/revealRound`]: round,
            [`rooms/${roomId}/revealUntilMs`]: now + COUNTDOWN_MS
          });
          return;
        }

        // 3) カウントダウン終了 → 結果確定
        if (bothSubmitted && countdownEnded && !resultAlready){
          const result = judgeRound(d.players.p1, d.players.p2);
          await applyResult(d, result);
          playResultSfxOnce(round, result);
          await update(ref(db), {
            [`rooms/${roomId}/showUntilMs`]: now + RESULT_MS,
            [`rooms/${roomId}/revealRound`]: null,
            [`rooms/${roomId}/revealUntilMs`]: null
          });
          return;
        }

        // 4) 結果表示が終わった → 次R or 終了
        if (showEnded){
          await goNextOrFinish();
          return;
        }
      }

      // === state: ended → リマッチ制御 ===
      if (d.state === "ended"){
        // 両者が「もう一回」を押したら、p1がリセットして開始
        if (d.rematch?.p1 && d.rematch?.p2){
          await resetMatchFromEnded();
        }
      }
    }, 200);
  }
}

/* [12] レンダリング（UI/入力制御/オーバーレイ） */
function renderGame(d){
  if (!d) return;

  if (roundNo) roundNo.textContent = d.round ?? 0;
  if (minRoundsEl) minRoundsEl.textContent = d.minRounds ?? MIN_ROUNDS;

  // 盤面/位置
  const meSeat = seat;
  const opSeat = seat==="p1" ? "p2" : "p1";
  const me = d.players[meSeat];
  const op = d.players[opSeat];

  if (me && me.hand) updateCounts(me.hand);
  if (d.players) placeTokens(d.players.p1.pos, d.players.p2.pos, d.boardSize);

  if (mePosEl) mePosEl.textContent = seat==="p1" ? d.players.p1.pos : d.players.p2.pos;
  if (opPosEl) opPosEl.textContent = seat==="p1" ? d.players.p2.pos : d.players.p1.pos;

  if (diffEl){
    const diff = Math.abs(d.players.p1.pos - d.players.p2.pos);
    diffEl.textContent = diff;
  }

  if (meChoiceEl) meChoiceEl.textContent = toFace(me?.choice) || "？";
  if (opChoiceEl) opChoiceEl.textContent = toFace(op?.choice) || "？";

  // このラウンドの状態
  const now = Date.now();
  const round = d.round||0;

  const bothSubmitted = !!me?.choice && !!op?.choice;
  const resultAlready = !!(d.lastResult && d.lastResult._round === round);
  const countingDown  = (d.revealRound === round) && (now < (d.revealUntilMs||0));
  const showingResult = resultAlready && d.showUntilMs && now < d.showUntilMs;

  // 入力ロック：提出済 or カウントダウン中 or 結果中 or 結果確定済 or 終了
  roundLocked = !!me?.choice;
  const disableAll = roundLocked || countingDown || showingResult || resultAlready || d.state!=="playing";

  cardBtns.forEach(b=>{
    const k = b.dataset.card;
    const left = (me?.hand && typeof me.hand[k]==="number") ? me.hand[k] : 0;
    const disable = disableAll || left<=0;
    b.disabled = disable;
    b.classList.toggle("selected", selectedCard===k && !disable);
  });
  if (btnPlay) btnPlay.disabled = disableAll || !selectedCard;

  if (stateMsg){
    if (d.state==="ended") stateMsg.textContent = "試合終了";
    else if (countingDown) stateMsg.textContent = "判定までカウントダウン中…";
    else if (showingResult) stateMsg.textContent = "結果表示中…";
    else if (roundLocked && !bothSubmitted) stateMsg.textContent = "提出済み！相手を待っています…";
    else stateMsg.textContent = "10秒以内に出してね（出さないと負け）";
  }

  // 結果テキスト（前Rのもの）
  if (resultText){
    if (resultAlready) resultText.textContent = prettyResult(d.lastResult);
    else resultText.textContent = "-";
  }
}

/* [13] 提出処理 */
function pickCard(code){
  if (roundLocked) return;
  const btn = document.querySelector(`.cardBtn[data-card="${code}"]`);
  if (!btn || btn.disabled) return;
  selectedCard = code;
  cardBtns.forEach(b=> b.classList.toggle("selected", b===btn));
  if (btnPlay) btnPlay.disabled = false;
  stateMsg && (stateMsg.textContent = hintText(code));
}
async function submitCard(){
  if (!selectedCard || !curRoom || curRoom.state!=="playing") return;

  // サーバー再確認
  const meSnap = await get(child(ref(db), `rooms/${roomId}/players/${seat}`));
  const me = meSnap.val();
  if (!me) return;
  if (me.choice){
    roundLocked = true;
    lockHandUI();
    alert("このターンは提出済みです");
    return;
  }
  const left = (me.hand && typeof me.hand[selectedCard]==="number") ? me.hand[selectedCard] : 0;
  if (left<=0){ alert("そのカードはもうありません"); return; }

  const updates = {};
  updates[`rooms/${roomId}/players/${seat}/choice`] = selectedCard;
  updates[`rooms/${roomId}/players/${seat}/hand/${selectedCard}`] = left - 1;
  await update(ref(db), updates);

  roundLocked = true;
  selectedCard = null;
  lockHandUI();
}
function lockHandUI(){
  cardBtns.forEach(b=>{ b.classList.remove("selected"); b.disabled = true; });
  if (btnPlay) btnPlay.disabled = true;
}

/* [14] 判定/結果適用 */
function judgeRound(p1, p2){
  const a = p1.choice, b = p2.choice;

  // 必勝 vs 必勝 → 引き分け
  if (a==="WIN" && b==="WIN") return { type:"win", winner:null, delta:{p1:0,p2:0}, note:"必勝同士" };

  // バリア vs (WIN/SWAP) → 防御側の勝ち（進まない）
  if (a==="BARRIER" && (b==="WIN"||b==="SWAP")) return { type:"barrier", winner:"p1", delta:{p1:0,p2:0}, barrier:true };
  if (b==="BARRIER" && (a==="WIN"||a==="SWAP")) return { type:"barrier", winner:"p2", delta:{p1:0,p2:0}, barrier:true };

  // 通常手に対するバリア → 出した側ペナルティ -1
  if (a==="BARRIER" && isBasic(b)) return { type:"barrier-penalty", winner:"p2", delta:{p1:-1,p2:0} };
  if (b==="BARRIER" && isBasic(a)) return { type:"barrier-penalty", winner:"p1", delta:{p1:0,p2:-1} };

  // バリア同士
  if (a==="BARRIER" && b==="BARRIER") return { type:"tie", winner:null, delta:{p1:0,p2:0} };

  // 必勝（バリアでない限り +4）
  if (a==="WIN" && b!=="BARRIER") return { type:"win", winner:"p1", delta:{p1:4,p2:0} };
  if (b==="WIN" && a!=="BARRIER") return { type:"win", winner:"p2", delta:{p1:0,p2:4} };

  // 位置交換：バリアでなければ必ず交換（距離制限なし）
  if (a==="SWAP" && b!=="BARRIER") return { type:"swap", winner:"p1", swap:true };
  if (b==="SWAP" && a!=="BARRIER") return { type:"swap", winner:"p2", swap:true };
  if (a==="SWAP" && b==="SWAP")     return { type:"tie", winner:null, delta:{p1:0,p2:0}, note:"ダブルSWAPは相殺" };

  // 通常RPS
  if (isBasic(a) && isBasic(b)){
    if (a===b) return { type:"tie", winner:null, delta:{p1:0,p2:0} };
    const aWin = (a==="G"&&b==="C")||(a==="C"&&b==="P")||(a==="P"&&b==="G");
    if (aWin) return { type:"rps", winner:"p1", delta:{p1: gain(a), p2:0} };
    else      return { type:"rps", winner:"p2", delta:{p1:0, p2: gain(b)} };
  }
  return { type:"tie", winner:null, delta:{p1:0,p2:0} };
}
function judgeTimeout(d){
  const a = d.players.p1.choice;
  const b = d.players.p2.choice;
  if (a && b) return { type:"tie", winner:null, delta:{p1:0,p2:0} }; // 保険

  if (!a && !b) return { type:"timeout-tie", winner:null, delta:{p1:0,p2:0}, note:"両者未提出" };

  // 片方だけ出した → そのカードの効果
  const winnerSeat = a ? "p1" : "p2";
  const card = a || b;

  if (card==="G"||card==="C"||card==="P"){
    const g = card==="G"?3:card==="C"?4:5;
    return {
      type:"timeout", winner:winnerSeat,
      delta:{ p1: winnerSeat==="p1"?g:0, p2: winnerSeat==="p2"?g:0 },
      note:"時間切れ"
    };
  }
  if (card==="WIN"){
    return {
      type:"timeout", winner:winnerSeat,
      delta:{ p1: winnerSeat==="p1"?4:0, p2: winnerSeat==="p2"?4:0 },
      note:"時間切れ(必勝)"
    };
  }
  if (card==="SWAP"){
    // 距離制限なし、必ず交換
    return { type:"swap", winner:winnerSeat, swap:true, note:"時間切れ(位置交換)" };
  }
  if (card==="BARRIER"){
    return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0}, note:"バリアは進まない" };
  }
  return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0} };
}
async function applyResult(d, r){
  // 二重適用防止
  if (d.lastResult && d.lastResult._round === d.round) return;

  let p1pos = d.players.p1.pos;
  let p2pos = d.players.p2.pos;

  if (r.swap){
    const tmp = p1pos; p1pos = p2pos; p2pos = tmp; // バリアでない限り常に交換
  }else{
    p1pos = clampToBoard(p1pos + (r.delta?.p1||0), d.boardSize);
    p2pos = clampToBoard(p2pos + (r.delta?.p2||0), d.boardSize);
  }
  p1pos = Math.max(0, p1pos);
  p2pos = Math.max(0, p2pos);

  await update(ref(db), {
    [`rooms/${roomId}/players/p1/pos`]: p1pos,
    [`rooms/${roomId}/players/p2/pos`]: p2pos,
    [`rooms/${roomId}/lastResult`]: { ...r, _round: d.round }
  });
}

/* [15] 次ラウンド・終了・リマッチ */
async function startGame(){
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()){ alert("部屋が見つかりません"); return; }
  const d = snap.val();
  if (seat!=="p1"){ alert("ホストのみ開始できます"); return; }
  if (!d.players?.p1?.id || !d.players?.p2?.id){ alert("2人そろってから開始できます"); return; }
  if (d.state === "playing") return;

  const now = Date.now();
  const updates = {};
  updates[`rooms/${roomId}/state`] = "playing";
  updates[`rooms/${roomId}/round`] = 1;
  updates[`rooms/${roomId}/roundStartMs`] = now;
  updates[`rooms/${roomId}/lastResult`] = null;
  updates[`rooms/${roomId}/revealRound`] = null;
  updates[`rooms/${roomId}/revealUntilMs`] = null;
  updates[`rooms/${roomId}/showUntilMs`] = null;
  updates[`rooms/${roomId}/boardSize`] = BOARD_SIZE; // 念のため
  updates[`rooms/${roomId}/rematch`] = { p1:false, p2:false };
  updates[`rooms/${roomId}/players/p1/pos`] = 0;
  updates[`rooms/${roomId}/players/p2/pos`] = 0;
  updates[`rooms/${roomId}/players/p1/choice`] = null;
  updates[`rooms/${roomId}/players/p2/choice`] = null;
  updates[`rooms/${roomId}/players/p1/hand`] = HAND_INIT();
  updates[`rooms/${roomId}/players/p2/hand`] = HAND_INIT();
  await update(ref(db), updates);
}

async function goNextOrFinish(){
  const snap = await get(child(ref(db), `rooms/${roomId}`));
  if (!snap.exists()) return;
  const d = snap.val();

  // 終了判定
  const roundsDone  = d.round >= (d.minRounds ?? MIN_ROUNDS);
  const someoneGoal = d.players.p1.pos >= d.boardSize || d.players.p2.pos >= d.boardSize;

  const handLeft = (h)=> (h.G+h.C+h.P+h.WIN+h.SWAP+h.BARRIER);
  const p1left = handLeft(d.players.p1.hand || HAND_INIT());
  const p2left = handLeft(d.players.p2.hand || HAND_INIT());
  const noCards = (p1left===0 || p2left===0);

  if ((roundsDone && someoneGoal) || (roundsDone && noCards)){
    const winner = d.players.p1.pos===d.players.p2.pos ? null
                  : (d.players.p1.pos > d.players.p2.pos ? "p1":"p2");
    await update(ref(db), {
      [`rooms/${roomId}/state`]: "ended",
      [`rooms/${roomId}/lastResult`]: { ...(d.lastResult||{}), final:true, winner },
      [`rooms/${roomId}/showUntilMs`]: null,
      [`rooms/${roomId}/revealRound`]: null,
      [`rooms/${roomId}/revealUntilMs`]: null,
      [`rooms/${roomId}/rematch`]: { p1:false, p2:false }
    });
    // 終了オーバーレイ（両端末にボタン）
    showEndOverlay();
    return;
  }

  // 次ラウンド開始
  const now = Date.now();
  await update(ref(db), {
    [`rooms/${roomId}/round`]: (d.round||0) + 1,
    [`rooms/${roomId}/roundStartMs`]: now,
    [`rooms/${roomId}/players/p1/choice`]: null,
    [`rooms/${roomId}/players/p2/choice`]: null,
    [`rooms/${roomId}/revealRound`]: null,
    [`rooms/${roomId}/revealUntilMs`]: null,
    [`rooms/${roomId}/showUntilMs`]: null
  });
  // ローカルUI解錠
  roundLocked = false;
  selectedCard = null;
  lastBeepSec = null;
  hideResultOverlay();
}

async function resetMatchFromEnded(){
  // 両者が「もう一回」を押した → p1が完全リセット
  const now = Date.now();
  const updates = {};
  updates[`rooms/${roomId}/state`] = "playing";
  updates[`rooms/${roomId}/round`] = 1;
  updates[`rooms/${roomId}/roundStartMs`] = now;
  updates[`rooms/${roomId}/lastResult`] = null;
  updates[`rooms/${roomId}/revealRound`] = null;
  updates[`rooms/${roomId}/revealUntilMs`] = null;
  updates[`rooms/${roomId}/showUntilMs`] = null;
  updates[`rooms/${roomId}/boardSize`] = BOARD_SIZE;
  updates[`rooms/${roomId}/rematch`] = { p1:false, p2:false };
  updates[`rooms/${roomId}/players/p1/pos`] = 0;
  updates[`rooms/${roomId}/players/p2/pos`] = 0;
  updates[`rooms/${roomId}/players/p1/choice`] = null;
  updates[`rooms/${roomId}/players/p2/choice`] = null;
  updates[`rooms/${roomId}/players/p1/hand`] = HAND_INIT();
  updates[`rooms/${roomId}/players/p2/hand`] = HAND_INIT();
  await update(ref(db), updates);
  hideResultOverlay();
}

/* 退出（そのまま） */
async function leaveRoom(){
  try{
    if (!roomId){ location.reload(); return; }
    const snap = await get(child(ref(db), `rooms/${roomId}`));
    if (!snap.exists()){ if (unsubRoom) unsubRoom(); location.reload(); return; }
    const d = snap.val();

    if (seat === "p1"){
      await remove(ref(db), `rooms/${roomId}`);
    }else{
      const updates = {};
      const base = `rooms/${roomId}/players/p2`;
      updates[`${base}/id`]=null; updates[`${base}/name`]=null; updates[`${base}/pos`]=0;
      updates[`${base}/choice`]=null; updates[`${base}/hand`]=HAND_INIT(); updates[`${base}/joinedAt`]=null;

      if (d.state==="playing" || d.state==="ended"){
        updates[`rooms/${roomId}/state`]="lobby";
        updates[`rooms/${roomId}/round`]=0;
        updates[`rooms/${roomId}/roundStartMs`]=null;
        updates[`rooms/${roomId}/lastResult`]=null;
        updates[`rooms/${roomId}/revealRound`]=null;
        updates[`rooms/${roomId}/revealUntilMs`]=null;
        updates[`rooms/${roomId}/showUntilMs`]=null;
        updates[`rooms/${roomId}/rematch`]={p1:false,p2:false};
      }
      await update(ref(db), updates);
    }
  }catch(e){
    console.error(e);
    alert("退出に失敗しました。ネットワークをご確認ください。");
  }finally{
    if (unsubRoom) unsubRoom();
    setTimeout(()=>location.reload(), 150);
  }
}

/* [16] ユーティリティ */
function updateCounts(h){
  if (!h) return;
  if (cntG) cntG.textContent = `×${h.G||0}`;
  if (cntC) cntC.textContent = `×${h.C||0}`;
  if (cntP) cntP.textContent = `×${h.P||0}`;
  if (cntWIN) cntWIN.textContent = `×${h.WIN||0}`;
  if (cntSWAP) cntSWAP.textContent = `×${h.SWAP||0}`;
  if (cntBARRIER) cntBARRIER.textContent = `×${h.BARRIER||0}`;
}
function isBasic(x){ return x==="G"||x==="C"||x==="P"; }
function gain(x){ return x==="G"?3:x==="C"?4:5; }
function toFace(x){ return x==="G"?"✊":x==="C"?"✌️":x==="P"?"🫲":x==="WIN"?"👑":x==="SWAP"?"🔁":x==="BARRIER"?"🛡️":null; }
function clampToBoard(x, size){ return Math.max(0, Math.min(size, x)); }
function rid(n=6){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:n},()=>A[Math.floor(Math.random()*A.length)]).join(""); }
function hintText(code){
  switch(code){
    case "G": return "グーで勝つと +3 マス";
    case "C": return "チョキで勝つと +4 マス";
    case "P": return "パーで勝つと +5 マス";
    case "WIN": return "必勝：なんにでも勝って +4（バリアに負け）";
    case "SWAP": return "位置交換：相手がバリアでなければ必ず入れ替え";
    case "BARRIER": return "バリア：相手の必勝/位置交換を無効。通常手相手だと自分 -1";
    default: return "カードを選んでね";
  }
}
function prettyResult(r){
  if (!r) return "-";
  switch(r.type){
    case "rps": return r.winner ? (r.winner==="p1"?"あなたの勝ち（通常手）":"相手の勝ち（通常手）") : "あいこ";
    case "win": return r.winner ? (r.winner==="p1"?"あなたの必勝！+4":"相手の必勝！+4") : "必勝同士";
    case "swap": return r.winner ? (r.winner==="p1"?"あなたが位置を交換！":"相手が位置を交換！") : "交換なし";
    case "barrier": return r.winner ? (r.winner==="p1"?"あなたのバリアが防いだ":"相手のバリアが防いだ") : "バリア発動";
    case "barrier-penalty": return "バリアのペナルティ：出した側が -1";
    case "timeout": return r.winner ? (r.winner==="p1"?"相手の時間切れであなたの勝ち":"あなたの時間切れ…相手の勝ち") : "時間切れ";
    case "timeout-tie": return "両者時間切れ";
    case "tie": return "引き分け";
    default: return "-";
  }
}

/* 盤面 */
function makeBoard(){
  if (!boardEl) return;
  boardEl.innerHTML = "";
  for(let i=1;i<=BOARD_SIZE;i++){
    const cell = document.createElement("div");
    cell.className = "cell" + (i===BOARD_SIZE ? " goal" : "");
    boardEl.appendChild(cell);
  }
}
function placeTokens(p1, p2, size){
  const cells = Array.from(boardEl.children);
  cells.forEach(c=>{
    const m = c.querySelector(".token.me"); if (m) m.remove();
    const o = c.querySelector(".token.op"); if (o) o.remove();
  });
  const idx1 = Math.min(size, Math.max(0,p1)) - 1;
  const idx2 = Math.min(size, Math.max(0,p2)) - 1;
  if (idx1>=0){ const t=document.createElement("div"); t.className="token me"; cells[idx1]?.appendChild(t); }
  if (idx2>=0){ const t=document.createElement("div"); t.className="token op"; cells[idx2]?.appendChild(t); }
}

/* オーバーレイ（結果/カウント/終了） */
function ensureOverlay(){
  if (resultOverlayEl) return resultOverlayEl;
  const el = document.createElement("div");
  el.id = "resultOverlay";
  el.style.position = "fixed";
  el.style.left = "0"; el.style.top = "0";
  el.style.right = "0"; el.style.bottom = "0";
  el.style.background = "rgba(0,0,0,0.5)";
  el.style.display = "none";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.zIndex = "9999";
  const inner = document.createElement("div");
  inner.id = "overlayInner";
  inner.style.background = "#fff";
  inner.style.borderRadius = "16px";
  inner.style.padding = "20px 24px";
  inner.style.fontSize = "22px";
  inner.style.fontWeight = "700";
  inner.style.textAlign = "center";
  inner.style.minWidth = "260px";
  inner.style.boxShadow = "0 8px 24px rgba(0,0,0,.25)";
  el.appendChild(inner);
  document.body.appendChild(el);
  resultOverlayEl = el;
  return el;
}
function showResultOverlay(text, ms){
  const el = ensureOverlay();
  const inner = el.querySelector("#overlayInner");
  inner.innerHTML = ""; // クリア
  const div = document.createElement("div");
  div.textContent = text;
  inner.appendChild(div);
  el.style.display = "flex";
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  if (typeof ms === "number"){
    overlayHideTimer = setTimeout(()=>{ hideResultOverlay(); }, ms);
  }
}
function hideResultOverlay(){
  if (!resultOverlayEl) return;
  resultOverlayEl.style.display = "none";
  if (overlayHideTimer){ clearTimeout(overlayHideTimer); overlayHideTimer=null; }
}

/* 終了オーバーレイ（もう一回/退室ボタン） */
function showEndOverlay(){
  const d = curRoom;
  if (!d) return;
  const el = ensureOverlay();
  const inner = el.querySelector("#overlayInner");
  inner.innerHTML = "";

  const winner = d.lastResult?.winner ?? null;
  const title = document.createElement("div");
  title.style.fontSize = "24px";
  title.style.marginBottom = "12px";
  title.textContent = winner===null ? "🤝 引き分け！" : (winner==="p1" ? (seat==="p1"?"🏆 勝利！":"😢 敗北…") : (seat==="p2"?"🏆 勝利！":"😢 敗北…"));
  inner.appendChild(title);

  const sub = document.createElement("div");
  sub.style.fontSize = "14px";
  sub.style.marginBottom = "16px";
  sub.textContent = "もう一回遊ぶ？";
  inner.appendChild(sub);

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "12px";
  btnRow.style.justifyContent = "center";

  const againBtn = document.createElement("button");
  againBtn.textContent = "もう一回";
  againBtn.style.padding = "10px 14px";
  againBtn.style.fontSize = "16px";
  againBtn.style.borderRadius = "10px";
  againBtn.style.border = "none";
  againBtn.style.cursor = "pointer";

  const leaveBtn = document.createElement("button");
  leaveBtn.textContent = "退室";
  leaveBtn.style.padding = "10px 14px";
  leaveBtn.style.fontSize = "16px";
  leaveBtn.style.borderRadius = "10px";
  leaveBtn.style.border = "none";
  leaveBtn.style.cursor = "pointer";
  leaveBtn.style.background = "#eee";

  btnRow.appendChild(againBtn);
  btnRow.appendChild(leaveBtn);
  inner.appendChild(btnRow);

  const note = document.createElement("div");
  note.style.marginTop = "10px";
  note.style.fontSize = "12px";
  note.textContent = (seat==="p1" ? (d.rematch?.p1 ? "あなたはリマッチ希望。相手を待っています…" : "")
                                  : (d.rematch?.p2 ? "あなたはリマッチ希望。相手を待っています…" : ""));
  inner.appendChild(note);

  againBtn.onclick = async ()=>{
    const key = seat==="p1" ? "p1" : "p2";
    await update(ref(db), { [`rooms/${roomId}/rematch/${key}`]: true });
    note.textContent = "リマッチ希望を送信しました。相手を待っています…";
  };
  leaveBtn.onclick = ()=>{
    hideResultOverlay();
    leaveRoom();
  };

  el.style.display = "flex";
}

/* タイマー/カウント/結果/終了UI の更新 */
function updateTimeAndOverlays(){
  const d = curRoom;
  if (!d){
    if (timerEl) timerEl.textContent = "-";
    return;
  }
  const now = Date.now();
  const round = d.round||0;

  // 選択タイマー（選択フェーズのみ）
  const inSelect = d.state==="playing"
                && !(d.lastResult && d.lastResult._round === round)
                && !(d.revealRound === round && now < (d.revealUntilMs||0))
                && d.roundStartMs!=null;

  if (timerEl){
    if (inSelect){
      const remain = Math.max(0, (d.roundStartMs + TURN_TIME) - now);
      const sec = Math.ceil(remain/1000);
      timerEl.textContent = String(sec);
      if (sec<=3 && sec!==lastBeepSec && remain>0){
        sfx.tick(); lastBeepSec = sec;
      }
    }else{
      timerEl.textContent = "OK";
      lastBeepSec = null;
    }
  }

  // 終了時：終了オーバーレイ（ボタン）
  if (d.state === "ended"){
    showEndOverlay();
    return;
  }

  // カウントダウンオーバーレイ
  if (d.revealRound === round && now < (d.revealUntilMs||0)){
    const remainSec = Math.ceil(((d.revealUntilMs||0) - now)/1000);
    const n = Math.max(0, remainSec);
    showResultOverlay(n>=3 ? "3" : n===2 ? "2" : n===1 ? "1" : "…", 500);
  }else{
    // 結果オーバーレイ（このRの結果を表示時間中だけ）
    const resultNow = d.lastResult && d.lastResult._round === round;
    if (resultNow && d.showUntilMs && now < d.showUntilMs){
      showResultOverlay(makeRoundSummary(d.lastResult), 300);
    }else{
      hideResultOverlay();
    }
  }
}

function makeRoundSummary(r){
  if (!r) return "—";
  if (r.swap) return "🔁 位置を交換！";
  if (r.type === "barrier") return "🛡️ バリア発動：必勝/位置交換を無効";
  if (r.type === "barrier-penalty") return "🛡️ バリアのペナルティ：出した側が -1";
  if (r.type === "win"){
    const meWin = (r.winner === (seat==="p1"?"p1":"p2"));
    return meWin ? "👑 必勝！ +4" : "👑 相手の必勝… +4";
  }
  if (r.type === "rps" && r.winner){
    const meWin = (r.winner === (seat==="p1"?"p1":"p2"));
    const mv = meWin ? (r.delta?.p1||0) : (r.delta?.p2||0);
    return meWin ? `🎉 勝ち！ +${mv} マス` : `😣 負け… 相手が +${mv} マス`;
  }
  if (r.type === "timeout"){
    const meWin = (r.winner === (seat==="p1"?"p1":"p2"));
    return meWin ? "⏱ 相手の時間切れで勝利！" : "⏱ 時間切れ…相手の勝ち";
  }
  if (r.type === "timeout-tie") return "⏱ 両者時間切れ";
  if (r.type === "tie") return "🤝 あいこ";
  return "—";
}
function playResultSfxOnce(round, r){
  if (lastSfxRoundPlayed === round) return;
  lastSfxRoundPlayed = round;
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
  }
}