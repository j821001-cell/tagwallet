/* 내 태그 지갑 — 오프라인용 서비스 워커.
 * 페이지 파일은 「저장본 먼저 + 뒤에서 새로 받기」, 도구(CDN)는 「저장본 먼저」.
 * Firebase 자료 통신(firestore/auth)은 건드리지 않는다 — 그쪽은 Firebase 가 알아서 휴대폰에 사본을 둔다.
 * 페이지를 고쳐 올릴 때 CACHE 이름 숫자를 하나 올린다(build-web.ps1 이 자동으로 날짜를 넣는다). */
const CACHE = "tagwallet-20261119-162028";
const CORE = ["./", "index.html", "boot.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "tickets/changpa.jpg", "tickets/ttarakyu.jpg"];
const CDN = [
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE.map(u => new Request(u, { cache: "reload" })));
    // 도구를 못 받으면 예전 판 저장본에서 옮겨 온다 (새 판으로 바뀌어도 오프라인 로그인이 깨지지 않게)
    await Promise.all(CDN.map(u => c.add(u).catch(async () => {
      const m = await caches.match(u); if (m) await c.put(u, m);
    })));
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith("tagwallet-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function isCdn(u) {
  return (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) ||
    u.hostname === "cdn.jsdelivr.net" || u.hostname === "cdnjs.cloudflare.com" ||
    u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  const same = u.origin === self.location.origin;
  if (!same && !isCdn(u)) return;
  if (same && u.pathname.includes("/__/")) return;   // Firebase 로그인 도우미 주소는 건드리지 않음

  if (same) {
    // 페이지 파일은 이 판(CACHE)의 저장본만 쓴다 → 약한 신호에서도 바로 열리고, 옛 파일·새 파일이 섞이지 않음.
    // 새 판은 sw.js 가 바뀌면(build-web.ps1 이 날짜를 넣음) install 에서 통째로 다시 받는다.
    // firebase-config.js 만은 GitHub 에서 직접 고칠 수 있어 뒤에서 새로 받아 둔다(다음 실행부터 적용).
    const isCfg = u.pathname.endsWith("/firebase-config.js");
    e.respondWith(caches.open(CACHE).then(c => c.match(r, { ignoreSearch: true })
      .then(m => m || (r.mode === "navigate" ? c.match("index.html") : null))
      .then(m => {
        const net = () => fetch(r, isCfg ? { cache: "no-cache" } : undefined).then(res => {
          if (res && res.ok) { const cp = res.clone(); return c.put(r, cp).then(() => res); }
          return res;
        });
        if (m) { if (isCfg) e.waitUntil(net().catch(() => {})); return m; }
        return net().catch(() => Response.error());
      })));
    return;
  }
  // CDN: 버전이 박힌 주소라 저장본 먼저
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
    if (res && (res.ok || res.type === "opaque")) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  })));
});
