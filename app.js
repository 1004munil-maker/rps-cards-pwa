/* =========================================================
   RPS Cards — app.js（安定版 / ランダム対戦＋精密タイマー＋再実行OK）
   変更点サマリ
   [00] 依存の動的importを堅牢化（RTDB off も含める）
   [01] モバイル系の誤タップ防止＆画面縦固定
   [02] SFX（効果音）
   [03] Firebase初期化（CDN import → initializeApp → getDatabase）
   [04] DOMキャッシュ
   [05] オーバーレイ（結果・カウントダウン・マッチング）／Match管理
   [06] 定数（ルール/時間）
   [07] 状態（プレイヤー／ルーム／タイマー）
   [08] 盤面生成
   [09] イベント束ね（作成/参加/コピー/開始/退出/カード/ランダム）
   [10] ルーム作成・参加・ロビー購読
   [11] 描画（UIの一括更新）
   [12] 精密10秒タイマー（秒飛びゼロ）
   [13] カード選択～提出
   [14] タイムアウト処理／判定ルール／SFX出力
   [15] 結果適用→自動ラウンド遷移
   [16] 補助（手札生成/表記/数値処理/待機）
   [17] ポーリング（判定終了→結果→次R・再戦）
   [18] 再戦UI
   [19] ランダム対戦内部（奪取・待機票）
   ========================================================= */

/* [00] Firebase import（必要関数を揃える／CDNから動的読込） */
async function ensureFirebaseAPI(){
  const need = [
    "initializeApp","getDatabase","ref","onValue","off","set","update","get","child",
    "serverTimestamp","remove","push","onDisconnect","query","orderByChild",
    "limitToFirst","runTransaction","equalTo"
  ];
  const ok = (api)=> api && need.every(k => typeof api[k] === "function");
  if (ok(window.FirebaseAPI)) return window.FirebaseAPI;

  const appMod = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js");
  const dbMod  = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js");
  const api = {
    initializeApp: appMod.initializeApp,
    getDatabase: dbMod.getDatabase,
    ref: dbMod.ref,
    onValue: dbMod.onValue,
    off: dbMod.off,
    set: dbMod.set,
    update: dbMod.update,
    get: dbMod.get,
    child: dbMod.child,
    serverTimestamp: dbMod.serverTimestamp,
    remove: dbMod.remove,
    push: dbMod.push,
    onDisconnect: dbMod.onDisconnect,
    query: dbMod.query,
    orderByChild: dbMod.orderByChild,
    limitToFirst: dbMod.limitToFirst,
    runTransaction: dbMod.runTransaction,
    equalTo: dbMod.equalTo
  };
  window.FirebaseAPI = api;
  return api;
}

/* =================== メイン =================== */
(async function main(){
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
    constructor(){ this.ctx=null; this.enabled=true; }
    ensure(){ if(!this.ctx){ const AC=window.AudioContext||window.webkitAudioContext; if(AC) this.ctx=new AC(); } if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); }
    tone({freq=440,dur=0.08,type='sine',gain=0.06,attack=0.005,release=0.04}){
      if(!this.enabled) return; this.ensure(); if(!this.ctx) return;
      const t0=this.ctx.currentTime, osc=this.ctx.createOscillator(), g=this.ctx.createGain();
      osc.type=type; osc.frequency.value=freq;
      g.gain.setValueAtTime(0,t0);
      g.gain.linearRampToValueAtTime(gain,t0+attack);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+dur+release);
      osc.connect(g).connect(this.ctx.destination);
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

  /* [03] Firebase 初期化 */
  const {
    initializeApp, getDatabase, ref, onValue, off, set, update, get, child,
    serverTimestamp, remove, push, onDisconnect, query, orderByChild,
    limitToFirst, runTransaction, equalTo
  } = await ensureFirebaseAPI();

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
  const boardEl    = $("#board"); // ← 重複定義しない！
  const mePosEl    = $("#mePos");
  const opPosEl    = $("#opPos");
  const stateMsg   = $("#stateMsg");
  const meChoiceEl = $("#meChoice");
  const opChoiceEl = $("#opChoice");
  const btnPlay    = $("#btnPlay");
  const btnClear   = $("#btnClear");
  const btnExit    = $("#btnExit");
  const btnRandom  = $("#btnRandom");
  const cardBtns   = [...document.querySelectorAll(".cardBtn")];
  const cntG       = $("#cntG"), cntC=$("#cntC"), cntP=$("#cntP"), cntWIN=$("#cntWIN"), cntSWAP=$("#cntSWAP"), cntBARRIER=$("#cntBARRIER");

  /* [05] オーバーレイ（結果・カウントダウン・マッチング）＆ Match管理 */
  let resultOverlayEl = null, resultOverlayTimerId = null;
  function ensureResultOverlay(){
    if (resultOverlayEl) return resultOverlayEl;
    resultOverlayEl = document.createElement("div");
    Object.assign(resultOverlayEl.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.5)",
      display:"none", alignItems:"center", justifyContent:"center",
      zIndex:"9999", backdropFilter:"blur(2px)"
    });
    const inner = document.createElement("div");
    inner.id = "overlayResultInner";
    Object.assign(inner.style, {
      background:"#fff", borderRadius:"16px", padding:"24px 28px",
      fontSize:"22px", textAlign:"center", minWidth:"260px",
      boxShadow:"0 8px 24px rgba(0,0,0,.25)", fontWeight:"700",
      transform:"scale(.96)", opacity:"0", transition:"transform .18s ease, opacity .18s ease"
    });
    resultOverlayEl.appendChild(inner);
    document.body.appendChild(resultOverlayEl);
    return resultOverlayEl;
  }
  function showResultOverlay(text, ms){
    const el = ensureResultOverlay();
    const inner = el.querySelector("#overlayResultInner");
    inner.textContent = text;
    el.style.display = "flex";
    requestAnimationFrame(()=>{
      inner.style.transform = "scale(1)";
      inner.style.opacity = "1";
    });
    if (resultOverlayTimerId) clearTimeout(resultOverlayTimerId);
    resultOverlayTimerId = setTimeout(hideResultOverlay, ms);
  }
  function hideResultOverlay(){
    if (!resultOverlayEl) return;
    const inner = resultOverlayEl.querySelector("#overlayResultInner");
    inner.style.transform = "scale(.96)";
    inner.style.opacity = "0";
    setTimeout(()=>{ resultOverlayEl.style.display = "none"; }, 180);
    if (resultOverlayTimerId){ clearTimeout(resultOverlayTimerId); resultOverlayTimerId = null; }
  }

  let countdownOverlayEl = null;
  function ensureCountdownOverlay(){
    if (countdownOverlayEl) return countdownOverlayEl;
    countdownOverlayEl = document.createElement("div");
    Object.assign(countdownOverlayEl.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.45)",
      display:"none", alignItems:"center", justifyContent:"center",
      zIndex:"9998", backdropFilter:"blur(2px)"
    });
    const inner = document.createElement("div");
    inner.id = "overlayCountdownInner";
    Object.assign(inner.style, {
      background:"#fff", borderRadius:"16px", padding:"18px 24px",
      fontSize:"64px", textAlign:"center", minWidth:"160px",
      boxShadow:"0 8px 24px rgba(0,0,0,.25)", fontWeight:"900",
      transform:"scale(.94)", opacity:"0", transition:"transform .18s ease, opacity .18s ease"
    });
    countdownOverlayEl.appendChild(inner);
    document.body.appendChild(countdownOverlayEl);
    return countdownOverlayEl;
  }
  function showCountdownOverlay(n){
    const el = ensureCountdownOverlay();
    const inner = el.querySelector("#overlayCountdownInner");
    inner.textContent = String(n);
    if (el.style.display!=="flex"){
      el.style.display = "flex";
      requestAnimationFrame(()=>{ inner.style.transform="scale(1)"; inner.style.opacity="1"; });
    }
  }
  function hideCountdownOverlay(){
    if (!countdownOverlayEl) return;
    const inner = countdownOverlayEl.querySelector("#overlayCountdownInner");
    inner.style.transform = "scale(.94)";
    inner.style.opacity = "0";
    setTimeout(()=>{ countdownOverlayEl.style.display = "none"; }, 180);
  }

  let matchOverlayEl = null;
  function ensureMatchOverlay(){
    if (matchOverlayEl) return matchOverlayEl;
    matchOverlayEl = document.createElement("div");
    Object.assign(matchOverlayEl.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.45)",
      display:"none", alignItems:"center", justifyContent:"center",
      zIndex:"10000", backdropFilter:"blur(2px)"
    });
    const inner = document.createElement("div");
    inner.id = "overlayMatchInner";
    Object.assign(inner.style, {
      background:"#fff", borderRadius:"16px", padding:"18px 24px",
      fontSize:"18px", textAlign:"center", minWidth:"260px",
      boxShadow:"0 8px 24px rgba(0,0,0,.25)", fontWeight:"700",
      transform:"scale(.94)", opacity:"0", transition:"transform .18s ease, opacity .18s ease"
    });
    const msg = document.createElement("div"); msg.id="overlayMatchMsg"; msg.style.marginBottom="6px";
    const sub = document.createElement("div"); sub.id="overlayMatchSub"; sub.style.fontSize="12px"; sub.style.color="#666";
    const row = document.createElement("div");
    Object.assign(row.style, { marginTop:"12px", display:"flex", justifyContent:"center" });
    const cancel = document.createElement("button");
    cancel.textContent = "キャンセル";
    Object.assign(cancel.style, { padding:"8px 12px", border:"none", borderRadius:"8px", fontWeight:"700", background:"#f44336", color:"#fff" });
    cancel.onclick = async ()=>{ sfx.click(); await Match.cancel(); };
    inner.appendChild(msg); inner.appendChild(sub); inner.appendChild(row); row.appendChild(cancel);
    matchOverlayEl.appendChild(inner);
    document.body.appendChild(matchOverlayEl);
    return matchOverlayEl;
  }
  function showMatchOverlay(msg, sub){
    const el = ensureMatchOverlay();
    const inner = el.querySelector("#overlayMatchInner");
    setMatchOverlay(msg, sub);
    el.style.display = "flex";
    requestAnimationFrame(()=>{ inner.style.transform="scale(1)"; inner.style.opacity="1"; });
  }
  function setMatchOverlay(msg, sub){
    if (!matchOverlayEl) return;
    const m = matchOverlayEl.querySelector("#overlayMatchMsg");
    const s = matchOverlayEl.querySelector("#overlayMatchSub");
    if (msg != null) m.textContent = msg;
    if (sub != null) s.textContent = sub;
  }
  function hideMatchOverlay(){
    if (!matchOverlayEl) return;
    const inner = matchOverlayEl.querySelector("#overlayMatchInner");
    inner.style.transform = "scale(.94)";
    inner.style.opacity = "0";
    setTimeout(()=>{ matchOverlayEl.style.display = "none"; }, 180);
  }

  // Match管理（キャンセル・再実行可／残骸を必ず消す）
  const Match = {
    active:false, cancelled:false,
    ticketRef:null, onTicket:null, _onRef:null,
    timeoutId:null, tickCancel:null,
    async reset(){
      this.cancelled = false;
      if (this.timeoutId){ clearTimeout(this.timeoutId); this.timeoutId = null; }
      if (typeof this.tickCancel === "function"){ this.tickCancel(); this.tickCancel = null; }

      // チケットは status を cancelled にしてから削除（他端末奪取の対象外に）
      if (this.ticketRef){
        try{ await update(this.ticketRef, { status:"cancelled" }); }catch(_){}
        try{ await remove(this.ticketRef); }catch(_){}
        this.ticketRef = null;
      }
      if (this.onTicket && this._onRef){
        try{ off(this._onRef, 'value', this.onTicket); }catch(_){}
      }
      this.onTicket = null; this._onRef = null;

      hideMatchOverlay();
      this.active = false;
      guardNameButtons();
    },
    async cancel(){
      if (!this.active) return;
      this.cancelled = true;
      await this.reset();
    }
  };

  /* [06] 定数（ルール/時間） */
  const BOARD_SIZE = 20;
  const MIN_ROUNDS = 8;
  const TURN_TIME  = 10_000;
  const REVEAL_MS  = 3000;
  const RESULT_SHOW_MS = 3000;

  const BASIC_TOTAL = 15;
  const BASIC_MIN   = 2;

  /* [07] 状態 */
  let myId = rid(6);
  let myName = "";
  let roomId = "";
  let seat = ""; // "p1" or "p2"

  // onValue購読解除用（RTDBは off を使う）
  let roomRefObj = null;
  let roomListener = null;

  let selectedCard = null;
  let roundLocked = false;
  let lastBeepSec = null;

  let curRoom = null;
  let overlayShownRound = 0;
  let revealApplyPoller = null;
  let countdownTicker = null;

  // タイマー停止ハンドラ（精密タイマーは関数を返す）
  let localTimer = null;

  /* [08] 盤面生成 */
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
  makeBoard();

  /* [09] イベント */
  function guardNameButtons(){
    const ok = !!playerName?.value?.trim();
    const busy = Match.active === true;
    if (btnCreate) btnCreate.disabled = !ok || busy;
    if (btnJoin)   btnJoin.disabled   = !ok || busy;
    if (btnRandom) btnRandom.disabled = !ok || busy;
  }
  guardNameButtons();
  playerName?.addEventListener('input', guardNameButtons);

  if (btnCreate) btnCreate.onclick = async () => {
    sfx.click();
    const name = (playerName.value || "").trim();
    if (!name){ alert("名前を1文字以上入力してね"); playerName.focus(); return; }
    myName = name;
    roomId = rid(6);
    seat = "p1";
    try{ await createRoom(roomId, myName); enterLobby(); }
    catch(e){ console.error("createRoom failed:", e); alert("部屋作成に失敗しました：" + (e?.message || e)); }
  };

  if (btnJoin) btnJoin.onclick = async () => {
    sfx.click();
    const name = (playerName.value || "").trim();
    if (!name){ alert("名前を1文字以上入力してね"); playerName.focus(); return; }
    myName = name;
    roomId = (joinId.value || "").trim().toUpperCase();
    if (!roomId){ alert("部屋IDを入力してね"); joinId.focus(); return; }
    const res = await joinRoom(roomId, myName);
    if (!res.ok){
      if (res.reason === "NO_ROOM") alert("部屋番号が存在しません");
      else if (res.reason === "FULL") alert("その部屋は満席です");
      else if (res.reason === "NO_NAME") alert("名前を1文字以上入力してね");
      else alert("参加に失敗しました。時間をおいて再試行してください。");
      return;
    }
    seat = "p2";
    enterLobby();
  };

  if (btnCopy) btnCopy.onclick = () => {
    navigator.clipboard.writeText(roomIdLabel?.textContent || "");
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

  // ===== ランダム対戦（UIは常に「待機中… 残りXX秒」） =====
  if (btnRandom) btnRandom.onclick = async ()=>{
    try{
      sfx.click();
      const name = (playerName.value || "").trim();
      if (!name){ alert("名前を入力してね"); playerName.focus(); return; }
      myName = name;

      await Match.reset();
      Match.active = true;
      guardNameButtons();

      const TOTAL_MS = 40000;
      const endAt = Date.now() + TOTAL_MS;

      showMatchOverlay("待機中…", "残り 40 秒");
      Match.tickCancel = preciseSecCountdown(endAt, (sec)=>{
        setMatchOverlay("待機中…", `残り ${sec} 秒`);
      });

      await waitForConnected(db, 2000);
      if (Match.cancelled) return;

      // ① 最初の10秒だけ既存待機者を毎秒奪取（UIは変えない）
      const claimUntil = Date.now() + 10000;
      while(!Match.cancelled && Date.now() < claimUntil){
        const r = await tryClaimOne();
        if (r.ok){
          await Match.reset();
          roomId = r.roomId;
          const snap = await get(ref(db, `rooms/${roomId}`));
          if (!snap.exists()){ alert("部屋が見つかりませんでした"); return; }
          const d = snap.val();
          seat = (d.players?.p1?.id === myId) ? "p1" : "p2";
          enterLobby();
          return;
        }
        await sleep(1000);
      }
      if (Match.cancelled) return;

      // ② 残り時間で自分の待機票を作成して待機（UIはそのまま）
      const waitRes = await enqueueAndWait({ deadlineAt: endAt });
      await Match.reset();
      if (!waitRes.ok){ alert("いまは相手がいませんでした。また後でお試しください。"); return; }

      roomId = waitRes.roomId;
      const snap = await get(ref(db, `rooms/${roomId}`));
      if (!snap.exists()){ alert("部屋が見つかりませんでした"); return; }
      const d = snap.val();
      seat = (d.players?.p1?.id === myId) ? "p1" : "p2";
      enterLobby();
    }catch(err){
      await Match.reset();
      console.error("randomMatch error:", err);
      alert("マッチング中にエラー：" + (err?.message || err));
    }
  };

  /* [10] ルーム作成/参加/ロビー購読 */
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
    const check = await get(ref(db, `rooms/${id}/players/p2/id`));
    if (!check.exists()) return { ok:false, reason:"WRITE_FAIL" };
    return { ok:true };
  }

  function enterLobby(){
    auth?.classList.add("hidden");
    lobby?.classList.remove("hidden");
    if (roomIdLabel) roomIdLabel.textContent = roomId;

    // 既存購読を解除
    if (roomRefObj && roomListener){ try{ off(roomRefObj, 'value', roomListener); }catch(_){ } }
    roomRefObj = ref(db, `rooms/${roomId}`);
    roomListener = (snap)=>{
      if (!snap.exists()) return;
      const d = snap.val();
      curRoom = d;
      renderGame(d);
      ensurePollers();
    };
    onValue(roomRefObj, roomListener);
  }

  /* [11] レンダリング */
  function renderGame(d){
    if (d.state === "lobby"){
      auth?.classList.add("hidden");
      lobby?.classList.remove("hidden");
      game?.classList.add("hidden");
    } else {
      lobby?.classList.add("hidden");
      game?.classList.remove("hidden");
    }

    if (roundNo) roundNo.textContent = String(d.round ?? 0);
    if (minRoundsEl) minRoundsEl.textContent = String(d.minRounds ?? MIN_ROUNDS);

    const meSeat = seat;
    const opSeat = seat==="p1" ? "p2" : "p1";
    const me = d.players[meSeat];
    const op = d.players[opSeat];

    const iSubmitted     = !!me.choice;
    const opSubmitted    = !!op.choice;
    const bothSubmitted  = iSubmitted && opSubmitted;
    const endedThisRound = !!(d.lastResult && d.lastResult._round === d.round);
    const revealing      = (d.revealRound === d.round);

    if (p1Label) p1Label.textContent = d.players.p1?.name || "-";
    if (p2Label) p2Label.textContent = d.players.p2?.name || "-";
    if (btnStart) btnStart.disabled = !(seat==="p1" && d.players.p1?.id && d.players.p2?.id) || d.state!=="lobby";

    updateCounts(me.hand);
    placeTokens(d.players.p1.pos, d.players.p2.pos, d.boardSize);
    if (mePosEl) mePosEl.textContent = String(seat==="p1" ? d.players.p1.pos : d.players.p2.pos);
    if (opPosEl) opPosEl.textContent = String(seat==="p1" ? d.players.p2.pos : d.players.p1.pos);

    if (diffEl) diffEl.textContent = String(Math.abs(
      (seat==="p1"?d.players.p1.pos:d.players.p2.pos) -
      (seat==="p1"?d.players.p2.pos:d.players.p1.pos)
    ));

    if (meChoiceEl) meChoiceEl.textContent = toFace(me.choice) || "？";
    if (opChoiceEl) opChoiceEl.textContent = opSubmitted ? "⏳" : "？";

    const diff = Math.abs(d.players.p1.pos - d.players.p2.pos);
    const swapBtn = document.querySelector('.cardBtn[data-card="SWAP"]');

    roundLocked = iSubmitted;

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

    if (stateMsg){
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
    }

    setupTimer(d.roundStartMs, d.round, me.choice, op.choice, d);

    if (bothSubmitted && seat==="p1" && !revealing && !endedThisRound && d.state==="playing"){
      update(ref(db, `rooms/${roomId}`), {
        revealRound: d.round,
        revealUntilMs: Date.now() + REVEAL_MS
      });
    }

    if (endedThisRound && overlayShownRound !== d.round){
      showResultOverlay(makeRoundSummary(d.lastResult, meSeat), RESULT_SHOW_MS);
      overlayShownRound = d.round;
    }

    if (d.state === "ended"){ showRematchOverlay(d); } else { hideRematchOverlay(); }

    if (!endedThisRound && !revealing && overlayShownRound !== d.round){ hideResultOverlay(); }
  }

  /* [12] 精密10秒タイマー（秒飛び防止） */
  function setupTimer(roundStartMs, round, myChoice, opChoice, roomData){
    if (typeof localTimer === "function"){ localTimer(); } // 以前のタイマー停止
    lastBeepSec = null;

    if (roomData?.state !== "playing"){ if (timerEl) timerEl.textContent = "-"; return; }

    const ended = !!(roomData?.lastResult && roomData.lastResult._round === roomData.round);
    const revealing = (roomData?.revealRound === roomData?.round);
    if (roomData?.state==="ended" || ended || revealing || (myChoice && opChoice)){
      if (timerEl) timerEl.textContent = "OK";
      return;
    }

    const deadline = (roundStartMs || Date.now()) + TURN_TIME;
    localTimer = preciseSecCountdown(
      deadline,
      (sec)=>{
        if (timerEl) timerEl.textContent = String(sec);
        if (sec <= 3 && sec !== lastBeepSec && sec > 0){ sfx.tick(); lastBeepSec = sec; }
      },
      async ()=>{
        sfx.timesup();
        if (seat === "p1"){
          const dNowSnap = await get(ref(db, `rooms/${roomId}`)).catch(()=>null);
          if (dNowSnap?.exists()){ await settleTimeout(dNowSnap.val()); }
        }
        if (timerEl) timerEl.textContent = "OK";
      }
    );
  }

  /* [13] カード選択～提出 */
  function pickCard(code){
    if (roundLocked) return;
    const btn = document.querySelector(`.cardBtn[data-card="${code}"]`);
    if (btn?.disabled) return;
    selectedCard = code;
    cardBtns.forEach(b => b.classList.toggle("selected", b===btn));
    if (btnPlay) btnPlay.disabled = false;
    if (stateMsg) stateMsg.textContent = displayHint(code);
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

  async function submitCard(){
    if (!selectedCard) return;

    const meSnap = await get(ref(db, `rooms/${roomId}/players/${seat}`));
    const me = meSnap.val();
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
      const room = (await get(ref(db, `rooms/${roomId}`))).val();
      const diff = Math.abs(room.players.p1.pos - room.players.p2.pos);
      if (diff >= 8){ alert("差が8マス以上のため、位置交換カードは使えません"); return; }
    }

    await update(ref(db, `rooms/${roomId}/players/${seat}`), {
      choice: selectedCard,
      [`hand/${selectedCard}`]: (me.hand[selectedCard]||0) - 1
    });

    roundLocked = true;
    selectedCard = null;
    cardBtns.forEach(b => { b.classList.remove("selected"); b.disabled = true; });
    if (btnPlay) btnPlay.disabled = true;

    await tryStartRevealIfBothReady();
  }

  async function tryStartRevealIfBothReady(){
    const snap = await get(ref(db, `rooms/${roomId}`));
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

  /* [14] タイムアウト／判定／SFX */
  async function settleTimeout(roomData){
    const d = roomData ?? (await get(ref(db, `rooms/${roomId}`))).val();
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
    hideCountdownOverlay();
    showResultOverlay(makeRoundSummary(result, seat), RESULT_SHOW_MS);
    scheduleAutoNext(d, RESULT_SHOW_MS);
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
      return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0}, note:"SWAP不可(差>=8)" };
    }
    if (card==="BARRIER"){
      return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0}, note:"バリアは進まない" };
    }
    return { type:"timeout", winner:winnerSeat, delta:{p1:0,p2:0} };
  }

  function judgeRound(p1, p2){
    const a = p1.choice, b = p2.choice;
    if (a==="WIN" && b==="WIN") return { type:"win", winner:null, delta:{p1:0,p2:0}, note:"必勝同士" };
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
      return { type:"rps", winner:"p2", delta:{p1:0, p2: gain(b)} };
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
    }
  }

  /* [15] 結果適用→自動次R */
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

  function scheduleAutoNext(d, waitMs = RESULT_SHOW_MS){
    if (seat !== "p1") return;
    setTimeout(async ()=>{
      const snap = await get(ref(db, `rooms/${roomId}`));
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
    }, waitMs);
  }

  /* [16] 補助 */
  function randomBasicHand(){
    let rest = BASIC_TOTAL - BASIC_MIN*3;
    let g = BASIC_MIN, c = BASIC_MIN, p = BASIC_MIN;
    const add = [0,0,0];
    for(let i=0;i<rest;i++){ add[Math.floor(Math.random()*3)]++; }
    g += add[0]; c += add[1]; p += add[2];
    return { G:g, C:c, P:p };
  }
  function randomItems(total=4){
    const items = { WIN:0, SWAP:0, BARRIER:0 };
    const keys = ["WIN","SWAP","BARRIER"];
    for(let i=0;i<total;i++){ const k = keys[Math.floor(Math.random()*keys.length)]; items[k]++; }
    return items;
  }
  function randomHand(){ return { ...randomBasicHand(), ...randomItems(4) }; }
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
  function prettyResult(r, seatKey){
    switch(r.type){
      case "rps": {
        const myDelta = r.delta?.[seatKey] ?? 0;
        const opDelta = r.delta?.[seatKey==="p1"?"p2":"p1"] ?? 0;
        if (myDelta>0) return `あなたの勝ち！ +${myDelta} マス`;
        if (opDelta>0) return `相手の勝ち… 相手が +${opDelta} マス`;
        return "あいこ";
      }
      case "win": { if (r.winner===seatKey) return "あなたの必勝！ +4"; if (r.winner) return "相手の必勝！ +4"; return "必勝同士"; }
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
  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  // 秒飛びゼロの精密カウントダウン（次の秒境界に合わせて待つ）
  function preciseSecCountdown(deadlineMs, onTick, onZero){
    let stopped = false;
    function loop(){
      if (stopped) return;
      const now = Date.now();
      const remain = Math.max(0, deadlineMs - now);
      const sec = Math.floor((remain + 999) / 1000);
      onTick(sec);
      if (remain <= 0){
        if (onZero) onZero();
        return;
      }
      const next = remain % 1000 || 1000;
      setTimeout(loop, next);
    }
    loop();
    return ()=>{ stopped = true; };
  }

  // RTDB 接続（.info/connected）を最大timeoutMs待ってみる（未接続でも続行は可能）
  function waitForConnected(db, timeoutMs = 10000){
    return new Promise(resolve=>{
      const connectedRef = ref(db, ".info/connected");
      let settled = false;
      const to = setTimeout(()=>{
        if (!settled){ settled = true; try{ off(connectedRef); }catch(_){ } resolve(false); }
      }, timeoutMs);
      const cb = (snap)=>{
        const v = !!snap.val();
        if (v && !settled){
          settled = true;
          clearTimeout(to);
          try{ off(connectedRef, 'value', cb); }catch(_){}
          resolve(true);
        }
      };
      onValue(connectedRef, cb);
    });
  }

  // ラウンド結果の要約（自分視点テキスト）
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

  /* [17] ポーラー */
  function ensurePollers(){
    // カウントダウン数字表示（双方）
    if (!countdownTicker){
      countdownTicker = setInterval(()=>{
        if (!curRoom) return;
        if (curRoom.state!=="playing" || curRoom.revealRound !== curRoom.round){
          hideCountdownOverlay();
          return;
        }
        const remain = Math.max(0, Math.ceil((curRoom.revealUntilMs - Date.now())/1000));
        if (remain > 0) showCountdownOverlay(remain);
        else hideCountdownOverlay();
      }, 250);
    }

    // p1側：演出→結果→次R／再戦成立→自動新規
    if (seat === "p1" && !revealApplyPoller){
      revealApplyPoller = setInterval(async ()=>{
        if (!curRoom) return;

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
            hideCountdownOverlay();
            showResultOverlay(makeRoundSummary(result, seat), RESULT_SHOW_MS);
            scheduleAutoNext(d, RESULT_SHOW_MS);
          }
        }

        if (curRoom.state==="ended"){
          const v = curRoom.rematchVotes || {p1:false,p2:false};
          if (v.p1 && v.p2){ await startNewMatch(); }
        }
      }, 200);
    }
  }

  /* [18] 再戦UI */
  function showRematchOverlay(d){
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
    const key = seat;
    await update(ref(db, `rooms/${roomId}/rematchVotes`), { [key]: true });
  }
  async function startNewMatch(){
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
      "players/p2/hand": randomHand()
    });
    roundLocked = false;
    selectedCard = null;
    hideResultOverlay();
  }

  /* [19] ランダム対戦内部（奪取・待機票） */
  function isMissingIndexError(err){
    const s = String(err?.message || err || "");
    return /index\s*not\s*defined|\.indexOn/i.test(s);
  }

  async function enqueueAndWait({ deadlineAt } = {}){
    let myTicketRef = null;
    try{
      myTicketRef = push(ref(db, 'mm/queue'));
      await set(myTicketRef, {
        uid: myId,
        name: myName || "GUEST",
        ts: serverTimestamp(),
        claimedBy: null,
        roomId: null,
        status: "waiting"
      });
      try{ onDisconnect(myTicketRef).remove(); }catch(_){}
    }catch(err){
      return { ok:false, reason:"QUEUE_WRITE_DENIED: " + (err?.message || err) };
    }
    Match.ticketRef = myTicketRef;

    return await new Promise((resolve)=>{
      const msLeft = Math.max(0, (deadlineAt||0) - Date.now());
      Match.timeoutId = setTimeout(async ()=>{
        try{ await update(myTicketRef, { status:"timeout" }); }catch(_){}
        try{ await remove(myTicketRef); }catch(_){}
        resolve({ ok:false, reason:"TIMEOUT" });
      }, msLeft);

      const onTicket = async (snap)=>{
        const v = snap.val();
        if (!v){
          if (Match.timeoutId){ clearTimeout(Match.timeoutId); Match.timeoutId = null; }
          off(myTicketRef, 'value', onTicket);
          resolve({ ok:false, reason:"CANCELLED" });
          return;
        }
        if (v.roomId){
          if (Match.timeoutId){ clearTimeout(Match.timeoutId); Match.timeoutId = null; }
          off(myTicketRef, 'value', onTicket);
          try{ await remove(myTicketRef); }catch(_){}
          resolve({ ok:true, roomId: v.roomId });
        }
      };
      Match.onTicket = onTicket;
      Match._onRef = myTicketRef;
      onValue(myTicketRef, onTicket);
    });
  }

  async function tryClaimOne(){
    try{
      // status==='waiting' のみ対象（キャンセル済みを拾わない）
      const q = query(ref(db, 'mm/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(50));
      const list = await get(q);

      const arr = [];
      list.forEach(snap=>{
        const v = snap.val(); const k = snap.key;
        if (!v || v.uid === myId) return;
        if (v.claimedBy != null) return;
        arr.push({ k, v });
      });
      arr.sort((a,b)=> (a.v.ts||0) - (b.v.ts||0));
      if (!arr.length) return { ok:false, reason:"EMPTY" };

      const candKey = arr[0].k; const candVal = arr[0].v;
      const claimRef = ref(db, `mm/queue/${candKey}/claimedBy`);
      const tx = await runTransaction(claimRef, cur => (cur===null ? myId : cur));
      if (!(tx.committed && tx.snapshot.val() === myId)) return { ok:false, reason:"LOST_RACE" };

      const newRoomId = rid(6);
      await set(ref(db, `rooms/${newRoomId}`), {
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
          p1: { id: candVal.uid, name: candVal.name || "P1", pos:0, choice:null, hand: randomHand(), joinedAt: serverTimestamp(), ready:false },
          p2: { id: myId,       name: myName    || "P2", pos:0, choice:null, hand: randomHand(), joinedAt: serverTimestamp(), ready:false }
        }
      });
      await update(ref(db, `mm/queue/${candKey}`), { status:"paired", roomId: newRoomId });
      return { ok:true, roomId: newRoomId };

    }catch(err){
      // インデックス無し環境向けフォールバック
      try{
        const allSnap = await get(ref(db, 'mm/queue'));
        const all = allSnap.exists() ? allSnap.val() : {};
        const arr = Object.entries(all)
          .filter(([k,v])=> v && v.uid !== myId && v.claimedBy == null && v.status === 'waiting')
          .sort((a,b)=> ((a[1].ts||0) - (b[1].ts||0)));
        if (!arr.length) return { ok:false, reason:"EMPTY" };

        const [candKey, candVal] = arr[0];
        const claimRef = ref(db, `mm/queue/${candKey}/claimedBy`);
        const tx = await runTransaction(claimRef, cur => (cur===null ? myId : cur));
        if (!(tx.committed && tx.snapshot.val() === myId)) return { ok:false, reason:"LOST_RACE" };

        const newRoomId = rid(6);
        await set(ref(db, `rooms/${newRoomId}`), {
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
            p1: { id: candVal.uid, name: candVal.name || "P1", pos:0, choice:null, hand: randomHand(), joinedAt: serverTimestamp(), ready:false },
            p2: { id: myId,       name: myName    || "P2", pos:0, choice:null, hand: randomHand(), joinedAt: serverTimestamp(), ready:false }
          }
        });
        await update(ref(db, `mm/queue/${candKey}`), { status:"paired", roomId: newRoomId });
        return { ok:true, roomId: newRoomId };
      }catch(e2){
        return { ok:false, reason: isMissingIndexError(err) ? ("INDEX_FALLBACK_FAILED: " + (e2?.message || e2)) : ("QUERY_ERROR: " + (err?.message || err)) };
      }
    }
  }

  /* [20] ゲーム開始/退出/広告 */
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

  async function startGame(){
    const snap = await get(ref(db, `rooms/${roomId}`));
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
      "players/p2/hand": randomHand()
    });
  }

  async function leaveRoom(){
    try {
      if (btnLeave) btnLeave.disabled = true;
      if (btnExit)  btnExit.disabled  = true;

      if (!roomId){
        // ロビー購読解除
        if (roomRefObj && roomListener){ try{ off(roomRefObj, 'value', roomListener); }catch(_){ } }
        location.reload();
        return;
      }

      const snap = await get(ref(db, `rooms/${roomId}`));
      if (!snap.exists()) {
        if (roomRefObj && roomListener){ try{ off(roomRefObj, 'value', roomListener); }catch(_){ } }
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
      if (roomRefObj && roomListener){ try{ off(roomRefObj, 'value', roomListener); }catch(_){ } }
      setTimeout(()=>location.reload(), 150);
    }
  }
})();