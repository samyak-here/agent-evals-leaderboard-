/* ============================================================
   REPO ATLAS — in-browser semantic search.
   Corpus vectors are precomputed (all-MiniLM-L6-v2); the query is
   embedded live in this tab via Transformers.js (same weights).
   Falls back to keyword search if the model can't load.
   ============================================================ */

document.documentElement.classList.remove("no-js");

var DATA_URL = "data/index.json";
var REDUCED = window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

var index = null;      // {repos, chunks, chunkVecs: Float32Array}
var extractor = null;  // transformers.js pipeline (or null -> keyword mode)
var activeCat = "All";
var activeIdx = -1;
var rendered = [];

/* ---------- spring (critically damped default) ---------- */
function spring(opts) {
  var from = opts.from != null ? opts.from : 0,
      to = opts.to != null ? opts.to : 1,
      zeta = opts.damping != null ? opts.damping : 1.0,
      resp = opts.response != null ? opts.response : 0.4,
      onU = opts.onUpdate || function () {},
      onD = opts.onDone || function () {};
  if (REDUCED) { onU(to); onD(); return function () {}; }
  var w = 2 * Math.PI / resp, k = w * w, c = 2 * zeta * w;
  var x = from, v = 0, last = null, raf = 0;
  function frame(now) {
    if (last == null) last = now;
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    var h = dt / 3;
    for (var i = 0; i < 3; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
    onU(x);
    if (Math.abs(x - to) < 0.001 && Math.abs(v) < 0.001) { onU(to); onD(); return; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return function () { cancelAnimationFrame(raf); };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmtStars(n) {
  if (n == null) return "";
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}

/* ---------- status ---------- */
function setStatus(mode, text) {
  var el = document.getElementById("engine-status");
  el.className = "status mono " + mode;
  document.getElementById("engine-text").textContent = text;
}

/* ---------- boot ---------- */
async function boot() {
  setStatus("working", "loading index");
  var base = await (await fetch(DATA_URL)).json();
  var parts = await Promise.all(
    base.chunk_parts.concat(base.vec_parts).map(function (p) {
      return fetch("data/" + p).then(function (r) { return r.json(); });
    })
  );
  var nChunks = base.chunk_parts.length;
  var chunks = [];
  for (var pi = 0; pi < nChunks; pi++) chunks = chunks.concat(parts[pi]);
  var b64 = "";
  for (var pj = nChunks; pj < parts.length; pj++) b64 += parts[pj].data;
  index = { model: base.model, dim: base.dim, quant: base.quant,
            repos: base.repos, chunks: chunks };
  var dim = index.dim, n = index.chunks.length;
  var vecs = new Float32Array(n * dim);
  if (index.quant === "int8") {
    // compact shipping format: base64 int8, dequantize to float
    var raw = atob(b64);
    var i8 = new Int8Array(raw.length);
    for (var k = 0; k < raw.length; k++) i8[k] = raw.charCodeAt(k);
    for (var k2 = 0; k2 < n * dim; k2++) vecs[k2] = i8[k2] / 127;
  } else {
    index.chunks.forEach(function (c, i) {
      for (var j = 0; j < dim; j++) vecs[i * dim + j] = c.v[j];
    });
  }
  index.chunkVecs = vecs;

  document.getElementById("corpus-tag").textContent =
    index.repos.length + " repos · " + n + " chunks";
  document.getElementById("index-stats").textContent =
    index.repos.length + " repos · " + n + " chunks · " +
    index.model + " · " + dim + "d vectors, precomputed once, served static";
  document.getElementById("generated").textContent =
    "index built " + new Date().toISOString().slice(0, 10);

  buildFilters();
  buildSuggest();

  // shareable searches: ?q=logo+designer&cat=Design+%26+UI
  var params = new URLSearchParams(location.search);
  var pq = params.get("q"), pcat = params.get("cat");
  if (pcat) {
    var pill = document.querySelector('.pill[data-c="' + pcat.replace(/"/g, "") + '"]');
    if (pill) pill.click();
  }
  if (pq) document.getElementById("q").value = pq;
  renderAll(document.getElementById("q").value);

  setStatus("working", "loading model");
  try {
    var mod = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js");
    extractor = await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    setStatus("ready", "semantic search live");
  } catch (e) {
    extractor = null;
    setStatus("ready", "keyword mode");
  }
  var q = document.getElementById("q");
  q.addEventListener("input", debounce(onQuery, 160));
  q.addEventListener("keydown", onKey);
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });
}

function debounce(fn, ms) {
  var t = 0;
  return function () {
    clearTimeout(t);
    var a = arguments, s = this;
    t = setTimeout(function () { fn.apply(s, a); }, ms);
  };
}

/* ---------- search ---------- */
async function embedQuery(q) {
  var out = await extractor(q, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data);
}

function keywordScore(q, text) {
  var words = q.toLowerCase().split(/[^a-z0-9+]+/).filter(function (w) { return w.length > 2; });
  if (!words.length) return 0;
  var t = text.toLowerCase(), hit = 0;
  words.forEach(function (w) { if (t.indexOf(w) !== -1) hit++; });
  return hit / words.length;
}

async function search(q) {
  var chunks = index.chunks, vecs = index.chunkVecs, dim = index.dim;
  var perRepo = new Map(); // repoIdx -> {score, chunk}
  if (extractor && q.trim()) {
    var qv;
    try { qv = await embedQuery(q); }
    catch (e) { extractor = null; setStatus("ready", "keyword mode"); }
    if (qv) {
      for (var i = 0; i < chunks.length; i++) {
        var s = 0;
        for (var j = 0; j < dim; j++) s += vecs[i * dim + j] * qv[j];
        var r = chunks[i].r;
        var cur = perRepo.get(r);
        if (!cur || s > cur.score) perRepo.set(r, { score: s, chunk: chunks[i].t });
      }
    }
  }
  if (!extractor) {
    chunks.forEach(function (c) {
      var s = keywordScore(q, c.t);
      var cur = perRepo.get(c.r);
      if (s > 0 && (!cur || s > cur.score)) perRepo.set(c.r, { score: s, chunk: c.t });
    });
  }
  var out = [];
  perRepo.forEach(function (v, r) {
    var repo = index.repos[r];
    if (activeCat !== "All" && repo.category !== activeCat) return;
    out.push({ repo: repo, score: v.score, snippet: v.chunk });
  });
  out.sort(function (a, b) { return b.score - a.score; });
  return out.slice(0, 12);
}

function highlight(text, q) {
  var words = q.toLowerCase().split(/[^a-z0-9+]+/).filter(function (w) { return w.length > 2; });
  var e = esc(text.length > 260 ? text.slice(0, 260).trim() + "…" : text);
  words.forEach(function (w) {
    try {
      e = e.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
    } catch (err) {}
  });
  return e;
}

function onQuery() {
  var q = document.getElementById("q").value;
  renderAll(q);
  activeIdx = -1;
}

async function renderAll(q) {
  var meta = document.getElementById("results-meta");
  var cards = document.getElementById("cards");
  var empty = document.getElementById("empty");
  if (!q.trim()) {
    // browse mode: show highest-starred in category
    var repos = index.repos
      .map(function (r, i) { return { repo: r, i: i }; })
      .filter(function (x) { return activeCat === "All" || x.repo.category === activeCat; })
      .sort(function (a, b) { return (b.repo.stars || 0) - (a.repo.stars || 0); })
      .slice(0, 12);
    rendered = repos.map(function (x) {
      return { repo: x.repo, score: null, snippet: x.repo.summary || "" };
    });
    meta.innerHTML = "browsing · <b>" + rendered.length + "</b> repos" +
      (activeCat !== "All" ? " in " + esc(activeCat) : "");
  } else {
    meta.innerHTML = "searching…";
    var results = await search(q);
    // stale guard: query changed while embedding
    if (q !== document.getElementById("q").value) return;
    rendered = results;
    meta.innerHTML = results.length
      ? "<b>" + results.length + "</b> results · ranked by meaning" + (extractor ? "" : " (keyword mode)")
      : "no matches";
  }
  empty.hidden = rendered.length > 0;
  cards.innerHTML = rendered.map(cardHTML).join("");
  cards.querySelectorAll(".card").forEach(function (el, i) {
    setTimeout(function () {
      spring({ from: 0, to: 1, damping: 1.0, response: 0.4,
        onUpdate: function (v) { el.style.setProperty("--p", v.toFixed(3)); } });
    }, REDUCED ? 0 : i * 45);
  });
}

function cardHTML(x, i) {
  var r = x.repo;
  return '<a class="card" data-i="' + i + '" href="https://github.com/' + esc(r.repo) + '" target="_blank" rel="noopener">' +
    '<div class="card-top"><span class="card-repo">' + esc(r.repo) + "</span>" +
    (r.stars ? '<span class="card-stars">★ ' + fmtStars(r.stars) + "</span>" : "") + "</div>" +
    (r.summary ? '<p class="card-sum">' + esc(r.summary) + "</p>" : "") +
    (x.snippet ? '<p class="card-snip">' + highlight(x.snippet, document.getElementById("q").value) + "</p>" : "") +
    '<div class="card-foot">' +
    (r.category ? '<span class="cat">' + esc(r.category) + "</span>" : "") +
    (x.score != null ? '<span class="score">' + x.score.toFixed(3) + "</span>" : "") +
    '<span class="open">open ↗</span>' +
    "</div></a>";
}

/* ---------- filters + suggestions ---------- */
function buildFilters() {
  var cats = ["All"];
  index.repos.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
  });
  var box = document.getElementById("filters");
  box.innerHTML = cats.map(function (c) {
    return '<button class="pill' + (c === "All" ? " on" : "") + '" data-c="' + esc(c) + '">' + esc(c) + "</button>";
  }).join("");
  box.querySelectorAll(".pill").forEach(function (b) {
    b.addEventListener("click", function () {
      box.querySelectorAll(".pill").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      activeCat = b.getAttribute("data-c");
      renderAll(document.getElementById("q").value);
    });
  });
}

function buildSuggest() {
  var qs = ["logo designer", "screen recorder", "design system", "browser automation", "claude skill for motion"];
  var box = document.getElementById("suggest");
  qs.forEach(function (s) {
    var b = document.createElement("button");
    b.className = "sug"; b.textContent = s;
    b.addEventListener("click", function () {
      var q = document.getElementById("q");
      q.value = s; q.focus(); onQuery();
    });
    box.appendChild(b);
  });
}

/* ---------- keyboard ---------- */
function onKey(e) {
  var cards = document.querySelectorAll("#cards .card");
  if (e.key === "Escape") { e.target.value = ""; onQuery(); e.target.blur(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx = e.key === "ArrowDown"
      ? Math.min(activeIdx + 1, cards.length - 1)
      : Math.max(activeIdx - 1, 0);
    cards.forEach(function (c) { c.classList.remove("active"); });
    if (cards[activeIdx]) { cards[activeIdx].classList.add("active"); cards[activeIdx].scrollIntoView({ block: "nearest" }); }
  } else if (e.key === "Enter" && cards[activeIdx]) {
    window.open(cards[activeIdx].href, "_blank");
  }
}

boot().catch(function (err) {
  setStatus("working", "failed to load");
  document.getElementById("results-meta").textContent = "Could not load the index: " + err.message;
});
