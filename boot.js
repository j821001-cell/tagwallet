/* 내 태그 지갑 — Claude 없이 쓰는 판 (GitHub Pages + Firebase)
 * 페이지 본문(index.html)은 Claude 판과 같은 코드다. 그 코드가 부르는 claude.use("db"|"assets"|"user")를
 * 여기서 Firebase(구글 로그인 + Firestore)로 흉내 낸다.
 *   - 로그인 안 함 / 설정 없음 / 가족 아님 → use() 가 null(또는 읽기 거부) → 페이지는 「이 기기에만 보관」.
 *   - 가족 계정 → 카드 「family/wallet」, 도감·즐겨찾기 「family/collection」 (아빠·엄마 같은 문서).
 *   - 두 휴대폰이 동시에 바꿔도 서로 지우지 않게, 문서를 통째로 덮지 않고 「바뀐 칸만」 보낸다.
 *       wallet     = { cardsById: {<id>: 카드}, order: [id…], updatedAt }   (페이지에는 {cards:[…]} 로 바꿔 줌)
 *       collection = { counts: {<태그>: 수}, favStores: […], updatedAt }   (수는 increment, 즐겨찾기는 arrayUnion/Remove)
 *   - 사진은 작게 줄여 「photos/<id>」 문서에 넣고, 카드에는 "fbimg:<id>" 로 적는다.
 * 이 파일은 index.html 의 <head> 에서 본문 스크립트보다 먼저(동기) 읽혀야 한다.
 */
(function () {
  "use strict";
  var G = "https://www.gstatic.com/firebasejs/10.12.2/";
  var HINT = "tagwallet.signedIn";          // 이 휴대폰이 로그인해 있던 적이 있으면 "1" (느린 연결에서 로컬로 빠지지 않게)
  var cfg = window.FIREBASE_CONFIG;

  var done, settled = false;
  var ready = new Promise(function (r) { done = r; });
  function finish(api) { if (!settled) { settled = true; done(api); return true; } return false; }
  function hinted() { try { return localStorage.getItem(HINT) === "1"; } catch (e) { return false; } }
  function setHint(on) { try { if (on) localStorage.setItem(HINT, "1"); else localStorage.removeItem(HINT); } catch (e) {} }

  var imgCache = {}, imgWant = {};
  var tw = window.__tw = {
    ready: ready, user: null, denied: false, cloudLive: false, loadFailed: false, late: false,
    configured: !!(cfg && cfg.apiKey && cfg.projectId),
    // "fbimg:<id>" → 사진 dataURL (아직 없으면 "" 를 돌려주고, 받아 오면 「tw-img」 이벤트)
    img: function (s) {
      var id = String(s).slice(6);
      if (imgCache[id]) return imgCache[id];
      imgWant[id] = 1;
      if (tw._fetch) tw._fetch(id);
      return "";
    },
    login: function () { alert("아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요."); },
    logout: function () {}
  };
  window.claude = {
    use: function (name) { return ready.then(function (api) { return (api && api[name]) || null; }); }
  };

  // ---------- 앱 설치(PWA) ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  var installEvt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; drawUi(); });
  window.addEventListener("appinstalled", function () { installEvt = null; drawUi(); });

  // ---------- 화면 (머리글 로그인 단추 + 관리 탭 「가족 공유」 칸) ----------
  function whenDom(f) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", f); else f();
  }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var authKnown = false;
  function drawUi() {
    whenDom(function () {
      var btn = document.getElementById("loginBtn");
      if (btn) {
        btn.hidden = !(tw.configured && authKnown && !tw.user && !tw.loadFailed);
        btn.onclick = function () { tw.login(); };
      }
      var st = document.getElementById("status");
      if (st && tw.denied) st.textContent = "⚠️ 가족 계정이 아니에요 · 이 기기에만 보관";
      else if (st && (tw.late || tw.loadFailed)) st.textContent = "⚠️ 연결 못 함 · 이 기기에만 보관";
      var view = document.getElementById("view-manage");
      if (!view) return;
      var box = document.getElementById("familyBox");
      if (!box) { box = mk("div", "section"); box.id = "familyBox"; view.appendChild(box); }
      box.textContent = "";
      var head = mk("div", "section-head"); head.appendChild(mk("h3", null, "👨‍👩‍👧 가족 공유")); box.appendChild(head);
      var p = mk("p", "fam-p");
      var row = mk("div", "fam-row");
      var reloadBtn = function () { var b = mk("button", "fam-btn main", "🔄 다시 연결"); b.type = "button"; b.onclick = function () { location.reload(); }; return b; };
      if (!tw.configured) {
        p.textContent = "아직 Firebase 설정이 없어요. 지금은 이 휴대폰에만 저장돼요. (안내서의 「Firebase 설정값」을 넣어 주세요)";
      } else if (tw.loadFailed || tw.late) {
        p.textContent = "가족 지갑에 연결하지 못했어요. 지금 바꾼 것은 이 휴대폰에만 저장되고 가족 지갑에는 안 올라가요. 인터넷이 되는 곳에서 「다시 연결」을 눌러 주세요.";
        row.appendChild(reloadBtn());
      } else if (!authKnown) {
        p.textContent = "연결하는 중…";
      } else if (!tw.user) {
        p.textContent = "아빠·엄마 구글 계정으로 로그인하면 두 휴대폰이 같은 지갑을 같이 써요. 로그인 안 하면 이 휴대폰에만 저장돼요.";
        var b1 = mk("button", "fam-btn main", "구글로 로그인"); b1.type = "button"; b1.onclick = function () { tw.login(); }; row.appendChild(b1);
      } else {
        p.textContent = (tw.denied ? "이 계정은 가족으로 등록되지 않았어요: "
          : tw.cloudLive ? "가족 지갑에 연결됨: " : "가족 지갑에 연결하는 중… ") + (tw.user.email || "");
        var b2 = mk("button", "fam-btn", "로그아웃"); b2.type = "button";
        b2.onclick = function () { if (confirm("로그아웃할까요? 이 휴대폰에서는 가족 지갑이 안 보이게 돼요.")) tw.logout(); };
        row.appendChild(b2);
      }
      if (installEvt) {
        var b3 = mk("button", "fam-btn main", "📲 앱으로 설치"); b3.type = "button";
        b3.onclick = function () { var e = installEvt; installEvt = null; e.prompt(); e.userChoice.finally(drawUi); };
        row.appendChild(b3);
      }
      box.appendChild(p); if (row.childNodes.length) box.appendChild(row);
    });
  }
  drawUi();

  if (!tw.configured) { authKnown = true; finish(null); drawUi(); return; }

  // ---------- 사진 줄이기 (Firestore 문서 한 개는 1MB 까지) ----------
  function shrink(blob) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(u);
        var max = 1000, q = 0.72, out = "";
        for (var i = 0; i < 6; i++) {
          var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
          out = cv.toDataURL("image/jpeg", q);
          if (out.length < 700000) return res(out);
          max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.06);
        }
        rej(new Error("사진이 너무 커요"));
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error("사진을 읽지 못했어요")); };
      img.src = u;
    });
  }
  function timeout(ms, v) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms); }); }
  function clone(v) { return JSON.parse(JSON.stringify(v == null ? null : v)); }

  (async function () {
    var F, fs;
    try {
      // 1) 도구 받기 — 12초 넘게 못 받으면 로컬로 (설치한 앱은 서비스 워커 저장본이라 보통 바로 됨)
      var mods = await Promise.race([
        Promise.all([import(G + "firebase-app.js"), import(G + "firebase-auth.js"), import(G + "firebase-firestore.js")]),
        timeout(12000, null)
      ]);
      if (!mods) throw new Error("load-timeout");
      var A = mods[0], U = mods[1]; F = mods[2];
      var app = A.initializeApp(cfg);
      var auth = U.getAuth(app);
      try {
        fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({
          cacheSizeBytes: F.CACHE_SIZE_UNLIMITED, tabManager: F.persistentMultipleTabManager() }) });
      } catch (e) { fs = F.getFirestore(app); }

      tw.login = async function () {
        var p = new U.GoogleAuthProvider();
        p.setCustomParameters({ prompt: "select_account" });
        try { await U.signInWithPopup(auth, p); setHint(true); location.reload(); }
        catch (e) {
          var c = e && e.code || "";
          if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
          alert("로그인하지 못했어요: " + (c || e.message) +
            (c === "auth/unauthorized-domain" ? "\n(Firebase 「승인된 도메인」에 이 주소를 넣어 주세요)"
              : c === "auth/popup-blocked" ? "\n(크롬 설정에서 이 사이트의 팝업을 허용해 주세요)" : ""));
        }
      };
      tw.logout = async function () {
        // 아직 서버에 안 올라간 변경이 있으면 먼저 묻는다 (로그아웃하면 휴대폰 사본을 지우므로)
        var synced = await Promise.race([F.waitForPendingWrites(fs).then(function () { return true; }, function () { return false; }),
          timeout(navigator.onLine ? 6000 : 500, false)]);
        if (!synced && !confirm("아직 가족 지갑에 올라가지 않은 변경이 있어요. 지금 로그아웃하면 그 변경은 사라져요.\n그래도 로그아웃할까요? (취소 → 인터넷 되는 곳에서 다시)")) return;
        try { await F.terminate(fs); } catch (e) {}
        try { await F.clearIndexedDbPersistence(fs); }
        catch (e) { alert("다른 창(탭)에 이 앱이 열려 있어서 휴대폰에 남은 가족 자료를 다 지우지 못했어요. 다른 창을 닫고 다시 로그아웃해 주세요."); }
        try { await U.signOut(auth); } catch (e) {}
        setHint(false);
        location.reload();
      };

      // 2) 로그인 상태 — 로그인해 있던 휴대폰이면 느려도 기다린다(그동안 페이지는 카드 저장을 막아 둠)
      var user = await Promise.race([
        new Promise(function (r) { var un = U.onAuthStateChanged(auth, function (u) { un(); r(u || null); }); }),
        timeout(hinted() ? 60000 : 15000, undefined)
      ]);
      if (user === undefined) throw new Error("auth-timeout");
      tw.user = user; authKnown = true;
      setHint(!!user);
      if (!user) { finish(null); drawUi(); return; }

      // ---------- Firestore 흉내 ----------
      // "data/users/<누구든>/wallet" → "family/wallet"
      function mapPath(p) { var m = /^data\/users\/[^/]+\/([^/]+)$/.exec(p); return m ? "family/" + m[1] : p; }
      // 서버 모양 → 페이지가 아는 모양
      function toPage(path, d) {
        if (!d) return d;
        if (path === "family/wallet" && !Array.isArray(d.cards)) {
          // 한 휴대폰이 지우는 사이 다른 휴대폰이 고치면 반쪽 카드가 남을 수 있어, 종류가 없는 카드는 보이지 않게 한다
          var raw = (d.cardsById && typeof d.cardsById === "object") ? d.cardsById : {}, by = {};
          Object.keys(raw).forEach(function (id) { var v = raw[id]; if (v && (v.type === "trainer" || v.type === "support")) by[id] = v; });
          var order = Array.isArray(d.order) ? d.order.filter(function (id) { return by[id]; }) : [];
          Object.keys(by).sort().forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
          var seen = {};
          return { cards: order.filter(function (id) { if (seen[id]) return false; seen[id] = 1; return true; })
                     .map(function (id) { return Object.assign({}, by[id], { id: id }); }), updatedAt: d.updatedAt || "" };
        }
        return d;
      }
      // 바뀐 칸만 보내기 (setDoc merge:true — 문서가 없어도 됨, 다른 휴대폰이 바꾼 칸은 그대로)
      var CARD_KEYS = ["type", "name", "note", "src", "assetId", "qr", "qrText"];
      function walletPatch(base, body) {
        var old = {}, now = {}, patch = { cardsById: {}, updatedAt: body.updatedAt || new Date().toISOString() };
        ((base && base.cards) || []).forEach(function (c) { old[c.id] = c; });
        (body.cards || []).forEach(function (c) { now[c.id] = c; });
        Object.keys(now).forEach(function (id) {
          var c = Object.assign({}, now[id]); delete c.id;
          var o = old[id];
          if (!o) { patch.cardsById[id] = c; return; }
          // 바뀐 칸만 (두 휴대폰이 같은 카드의 다른 칸을 고쳐도 합쳐짐)
          var ch = {}, n = 0;
          CARD_KEYS.forEach(function (k) { var a = o[k] == null ? "" : String(o[k]), b = c[k] == null ? "" : String(c[k]); if (a !== b) { ch[k] = c[k] == null ? "" : c[k]; n++; } });
          if (n) { if (!("type" in ch)) ch.type = c.type; patch.cardsById[id] = ch; }
        });
        Object.keys(old).forEach(function (id) { if (!now[id]) patch.cardsById[id] = F.deleteField(); });
        patch.order = (body.cards || []).map(function (c) { return c.id; });
        return patch;
      }
      function collPatch(base, body) {
        var bc = (base && base.counts) || {}, nc = body.counts || {}, counts = {}, keys = {};
        Object.keys(bc).concat(Object.keys(nc)).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).forEach(function (k) {
          var a = Math.max(0, Math.floor(Number(bc[k]) || 0)), b = Math.max(0, Math.floor(Number(nc[k]) || 0));
          // 늘 더하기·빼기로만 보낸다 (0 으로 지우면 다른 휴대폰이 동시에 더한 것까지 지워짐)
          if (a !== b) counts[k] = F.increment(b - a);
        });
        var patch = { counts: counts, updatedAt: body.updatedAt || new Date().toISOString() };
        var bf = (base && base.favStores) || [], nf = body.favStores || [];
        var add = nf.filter(function (x) { return bf.indexOf(x) < 0; }), rem = bf.filter(function (x) { return nf.indexOf(x) < 0; });
        // arrayUnion 과 arrayRemove 는 한 번에 같은 칸에 못 쓰므로 나눠 보낸다
        return { first: add.length ? Object.assign(patch, { favStores: F.arrayUnion.apply(null, add) }) : patch,
                 second: rem.length ? { favStores: F.arrayRemove.apply(null, rem) } : null };
      }
      // 인터넷이 없으면 서버 확인을 끝없이 기다리지 않는다 (휴대폰에 먼저 저장되고 연결되면 올라감)
      function settle(p) {
        return new Promise(function (res, rej) {
          var t = setTimeout(res, navigator.onLine ? 8000 : 300);
          p.then(function () { clearTimeout(t); res(); }, function (e) { clearTimeout(t); rej(e); });
        });
      }
      function onDenied(e) {
        if (e && e.code === "permission-denied" && !tw.denied) { tw.denied = true; tw.cloudLive = false; drawUi(); }
      }
      var lastSeen = {};   // 경로별: 페이지에 마지막으로 넘긴 자료 (바뀐 칸 계산의 기준)
      var fixing = false;
      var db = {
        doc: function (path0) {
          var path = mapPath(path0), r = F.doc(fs, path);
          return {
            // base(선택): 페이지가 「바꾸기 전」이라고 아는 값. 없으면 마지막으로 넘긴 자료.
            set: function (body, base) {
              var b = base !== undefined && base !== null ? base : lastSeen[path];
              var p;
              if (path === "family/wallet") p = F.setDoc(r, walletPatch(b, body), { merge: true });
              else if (path === "family/collection") {
                var cp = collPatch(b, body);
                p = F.setDoc(r, cp.first, { merge: true });
                if (cp.second) p = Promise.all([p, F.setDoc(r, cp.second, { merge: true })]);
              } else p = F.setDoc(r, body);
              lastSeen[path] = clone(body);
              return settle(p).catch(function (e) { onDenied(e); throw e; });
            },
            onSnapshot: function (cb, err) {
              var prev = null;
              return F.onSnapshot(r, { includeMetadataChanges: true }, function (s) {
                // 처음 켤 때 휴대폰 사본이 비어 있으면(아직 못 받음) 「빈 지갑」으로 알리지 않고 서버를 기다린다
                if (!s.exists() && s.metadata.fromCache) return;
                var data = s.exists() ? toPage(path, s.data()) : null;
                var key = JSON.stringify(data) + "|" + s.metadata.fromCache;
                if (key === prev) return;           // 같은 내용이면 다시 그리지 않음 (카드 넘김 위치 유지)
                prev = key;
                lastSeen[path] = clone(data);
                // 두 휴대폰이 동시에 빼서 0 아래로 내려간 개수는 서버 기준으로 0 으로 되돌린다 (동시에 더한 것은 남음)
                // (서버에서 다시 읽어 아직 음수일 때만 0 으로 — 두 휴대폰이 같이 고쳐도 한 번만 적용)
                if (path === "family/collection" && data && data.counts && !s.metadata.fromCache && !s.metadata.hasPendingWrites
                    && !fixing && typeof F.runTransaction === "function"
                    && Object.keys(data.counts).some(function (k) { return Number(data.counts[k]) < 0; })) {
                  fixing = true;
                  F.runTransaction(fs, async function (t) {
                    var d = (await t.get(r)).data() || {}, c = d.counts || {}, fx = {}, n = 0;
                    Object.keys(c).forEach(function (k) { if (Number(c[k]) < 0) { fx[k] = 0; n++; } });
                    if (n) t.set(r, { counts: fx }, { merge: true });
                  }).catch(function () {}).then(function () { fixing = false; });
                }
                if (!tw.cloudLive) { tw.cloudLive = true; drawUi(); }
                cb({ exists: s.exists(), id: s.id, metadata: s.metadata, data: function () { return clone(data); } });
              }, function (e) { onDenied(e); if (err) err(e); });
            }
          };
        }
      };
      var assets = {
        upload: async function (blob) {
          var url = await shrink(blob);
          var id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          await settle(F.setDoc(F.doc(fs, "photos/" + id), { data: url, at: new Date().toISOString() }));
          imgCache[id] = url;
          return { id: id, url: "fbimg:" + id };
        },
        "delete": function (id) { return settle(F.deleteDoc(F.doc(fs, "photos/" + String(id)))); }
      };
      var fetching = {};
      function gotImg(id, s) {
        var d = s && s.exists() && s.data();
        if (d && typeof d.data === "string" && d.data.indexOf("data:image/") === 0) {
          imgCache[id] = d.data;
          window.dispatchEvent(new CustomEvent("tw-img", { detail: id }));
          return true;
        }
        return false;
      }
      tw._fetch = function (id) {
        if (fetching[id] || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
        fetching[id] = 1;
        var ref = F.doc(fs, "photos/" + id);
        // 사진은 한 번 쓰면 안 바뀌므로 휴대폰 사본 먼저, 없을 때만 서버
        F.getDocFromCache(ref).then(function (s) { if (!gotImg(id, s)) throw 0; })
          .catch(function () { return F.getDoc(ref).then(function (s) { if (!gotImg(id, s)) throw 0; }); })
          .catch(function () { setTimeout(function () { delete fetching[id]; }, 15000); });
      };
      Object.keys(imgWant).forEach(tw._fetch);
      var userApi = {
        id: async function () { return "family"; },
        me: async function () { return { id: "family", name: user.displayName || "" }; },
        isOwner: function () { return true; },
        canEdit: function () { return true; },
        can: function () { return true; }
      };
      var api = { db: db, assets: assets, user: userApi };
      if (!finish(api)) { tw.late = true; }   // (지금 구조에서는 일어나지 않지만) 늦게 왔으면 연결됨이라고 하지 않음
      drawUi();
    } catch (e) {
      authKnown = true;
      if (!finish(null) || hinted() || String(e && e.message).indexOf("timeout") >= 0) tw.loadFailed = true;
      tw.login = function () { location.reload(); };
      drawUi();
      if (tw.loadFailed) window.addEventListener("online", function () { location.reload(); }, { once: true });
    }
  })();
})();
