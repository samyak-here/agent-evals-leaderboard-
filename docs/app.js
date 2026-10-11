/* ============================================================
   AGENT//EVALS front-end.
   Motion implements Apple-style fluid-interface principles (from the
   apple-design skill): springs are critically damped by default and
   interruptible — every entrance below re-targets from its live value.
   ============================================================ */
(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");

  var DATA_URL = "data/leaderboard.json";
  var CORAL = "#ff5c39", AMBER = "#ffb224", ICE = "#7dd7ff",
      INK = "#eef3fa", MUTED = "#93a1b8", HAIR = "rgba(148,184,255,0.10)";
  var REDUCED = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var metric = "latency";
  var chart = null;
  var leaderboard = null;

  /* ---------- spring physics ----------
     Apple-style: damping ratio (1.0 = critically damped, no bounce)
     + response (seconds to settle). Semi-implicit Euler w/ substeps. */
  function spring(opts) {
    var from = opts.from != null ? opts.from : 0;
    var to = opts.to != null ? opts.to : 1;
    var zeta = opts.damping != null ? opts.damping : 1.0;
    var resp = opts.response != null ? opts.response : 0.35;
    var onU = opts.onUpdate || function () {};
    var onD = opts.onDone || function () {};
    if (REDUCED) { onU(to); onD(); return function () {}; }
    var w = 2 * Math.PI / resp, k = w * w, c = 2 * zeta * w;
    var x = from, v = opts.velocity || 0, last = null, raf = 0;
    function frame(now) {
      /* NOTE: dt comes from the rAF timestamp, not performance.now() —
         the two agree in real browsers, but only the rAF timestamp
         advances under virtual time (headless screenshots). */
      if (last == null) last = now;
      var dt = Math.min((now - last) / 1000, 0.05); last = now;
      var h = dt / 3;
      for (var i = 0; i < 3; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
      onU(x);
      if (Math.abs(x - to) < 0.0008 && Math.abs(v) < 0.0008) { onU(to); onD(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return function () { cancelAnimationFrame(raf); };
  }

  /* ---------- helpers ---------- */
  function fmtPct(x) { return x == null ? "–" : (x * 100).toFixed(1) + "%"; }
  function fmtLat(s) { return s == null ? "–" : s.toFixed(1) + "s"; }
  function fmtCost(c) { return c == null ? "–" : "$" + c.toFixed(2); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function badge(kind) { return '<span class="badge ' + kind + '">' + kind + "</span>"; }
  function archLabel(a) {
    return { "single-agent": "Single agent", "mixture-of-agents": "Mixture-of-Agents",
             "refine": "Refine", "graph-of-agents": "Graph-of-Agents" }[a] || a;
  }
  function xVal(r) { return metric === "latency" ? r.mean_latency_s : r.cost_usd; }
  function xLabel() {
    return metric === "latency" ? "mean latency / question (s)" : "total cost / run (USD)";
  }

  /* ---------- live UTC clock ---------- */
  function tickClock() {
    var el = document.getElementById("clock");
    if (el) el.textContent = new Date().toISOString().substr(11, 8) + " UTC";
  }
  tickClock(); setInterval(tickClock, 1000);

  /* ---------- spring-driven reveals ---------- */
  function revealEl(el, delayMs) {
    if (REDUCED) { el.style.setProperty("--p", 1); return; }
    setTimeout(function () {
      spring({ from: 0, to: 1, damping: 1.0, response: 0.45,
        onUpdate: function (v) { el.style.setProperty("--p", v.toFixed(3)); } });
    }, delayMs || 0);
  }
  function observeReveals(scope) {
    var els = Array.prototype.slice.call((scope || document).querySelectorAll(".reveal:not([data-rv])"));
    els.forEach(function (el) { el.setAttribute("data-rv", "1"); });
    if (!("IntersectionObserver" in window) || REDUCED) {
      els.forEach(function (el) { revealEl(el, 0); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          io.unobserve(e.target);
          var sibs = Array.prototype.slice.call(e.target.parentNode.querySelectorAll(".reveal"));
          revealEl(e.target, sibs.indexOf(e.target) * 55);
        }
      });
    }, { threshold: 0.08 });
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.96 && r.bottom > 0) revealEl(el, 0);
      else io.observe(el);
    });
    window.addEventListener("scroll", function () {
      els.forEach(function (el) {
        if (!el.style.getPropertyValue("--p") || el.style.getPropertyValue("--p") === "0") {
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.96 && r.bottom > 0) revealEl(el, 0);
        }
      });
    }, { passive: true });
  }

  /* ---------- spring count-up numerals ---------- */
  function countUp(el, target, fmt) {
    function render(v) {
      el.textContent = fmt === "pct" ? (v * 100).toFixed(1) + "%"
        : fmt === "int" ? Math.round(v).toLocaleString() : v;
    }
    if (REDUCED) { render(target); return; }
    spring({ from: 0, to: target, damping: 1.0, response: 0.9, onUpdate: render });
  }

  /* ---------- KPIs ---------- */
  function renderKPIs(rows) {
    var measured = rows.filter(function (r) { return r.kind === "measured"; });
    var paper = rows.filter(function (r) { return r.kind === "paper"; });
    var best = measured.reduce(function (m, r) { return r.accuracy > m ? r.accuracy : m; }, 0);
    var sota = paper.filter(function (r) { return r.architecture === "graph-of-agents"; })[0];
    var maxN = rows.reduce(function (m, r) { return Math.max(m, r.n || 0); }, 0);
    countUp(document.getElementById("kpi-arch"), measured.length + paper.length, "int");
    countUp(document.getElementById("kpi-q"), maxN, "int");
    var bestEl = document.getElementById("kpi-best");
    if (measured.length) countUp(bestEl, best, "pct");
    else bestEl.textContent = "pending";
    if (sota) countUp(document.getElementById("kpi-sota"), sota.accuracy, "pct");
  }

  /* ---------- Pareto chart ---------- */
  function renderChart(rows) {
    var el = document.getElementById("pareto-chart");
    var emptyEl = document.getElementById("chart-empty");
    if (typeof echarts === "undefined") {
      if (!renderChart._retried) {
        renderChart._retried = true;
        window.addEventListener("load", function () { renderChart(rows); });
        return;
      }
      el.innerHTML = '<p class="muted mono" style="padding:40px">chart library failed to load.</p>';
      return;
    }
    var measured = rows.filter(function (r) {
      return r.kind === "measured" && xVal(r) != null && r.accuracy != null;
    });
    var paper = rows.filter(function (r) { return r.kind === "paper"; });
    emptyEl.hidden = measured.length > 0;

    if (chart) chart.dispose();
    chart = echarts.init(el);
    var maxTok = measured.reduce(function (m, r) { return Math.max(m, r.total_tokens || 0); }, 1);
    var data = measured.map(function (r) {
      return {
        value: [xVal(r), +(r.accuracy * 100).toFixed(2)],
        symbolSize: 16 + 36 * Math.sqrt((r.total_tokens || 0) / maxTok),
        name: archLabel(r.architecture) + (r.variant ? " — " + r.variant : ""),
        itemStyle: { color: CORAL, shadowBlur: 18, shadowColor: "rgba(255,92,57,0.55)" }
      };
    });
    var markLines = paper.filter(function (r) { return r.accuracy != null; }).map(function (r) {
      return {
        yAxis: +(r.accuracy * 100).toFixed(2),
        lineStyle: { color: AMBER, type: "dashed", width: 1.5 },
        label: { formatter: archLabel(r.architecture) + " (paper) " + fmtPct(r.accuracy),
                 color: AMBER, fontFamily: "IBM Plex Mono", fontSize: 11, position: "insideEndTop" }
      };
    });
    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 54, right: 26, top: 30, bottom: 50 },
      xAxis: {
        type: "value", name: xLabel(), nameLocation: "middle", nameGap: 36,
        nameTextStyle: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11 },
        axisLabel: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11 },
        axisLine: { lineStyle: { color: HAIR } }, splitLine: { lineStyle: { color: HAIR } }
      },
      yAxis: {
        type: "value", name: "accuracy (%)", min: 0, max: 100,
        nameTextStyle: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11 },
        axisLabel: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11, formatter: "{value}%" },
        axisLine: { lineStyle: { color: HAIR } }, splitLine: { lineStyle: { color: HAIR } }
      },
      tooltip: {
        trigger: "item", backgroundColor: "#0d1421", borderColor: HAIR,
        textStyle: { color: INK, fontSize: 12, fontFamily: "IBM Plex Mono" },
        formatter: function (p) {
          var r = measured[p.dataIndex];
          return "<b>" + esc(p.name) + "</b><br>" + xLabel() + ": <b>" + p.value[0] +
            "</b><br>accuracy: <b>" + p.value[1] + "%</b><br>tokens: " +
            (r.total_tokens || "–").toLocaleString() + "<br>n = " + r.n + " · " + esc(r.date || "");
        }
      },
      series: [{
        type: "scatter", data: data, emphasis: { scale: 1.3 },
        markLine: markLines.length ? { silent: true, symbol: "none", data: markLines } : undefined
      }],
      animationDuration: REDUCED ? 0 : 900,
      animationEasing: "cubicOut"
    });
    window.addEventListener("resize", function () { chart.resize(); });
  }

  /* ---------- instrument cards ---------- */
  function cardHTML(r, isTop) {
    var led = r.kind === "measured" ? "led-coral" : r.kind === "paper" ? "led-amber" : "led-ice";
    var chips = (r.models || []).map(function (m) {
      return '<span class="chip">' + esc(m) + "</span>";
    }).join("");
    return '<article class="inst reveal' + (isTop ? " top" : "") + '">' +
      '<div class="inst-head"><span class="led ' + led + '"></span><div>' +
      '<div class="inst-title">' + esc(archLabel(r.architecture)) + "</div>" +
      (r.variant ? '<div class="inst-variant">' + esc(r.variant) + "</div>" : "") +
      "</div>" + badge(r.kind) + "</div>" +
      '<div class="inst-acc"><span class="acc-num" data-v="' + r.accuracy + '">0.0%</span>' +
      '<span class="acc-cap">accuracy</span></div>' +
      '<div class="ro-grid">' +
      "<div class='ro-cell'><b>" + fmtLat(r.mean_latency_s) + "</b><span>latency / q</span></div>" +
      "<div class='ro-cell'><b>" + fmtCost(r.cost_usd) + "</b><span>cost / run</span></div>" +
      "<div class='ro-cell'><b>" + (r.total_tokens != null ? r.total_tokens.toLocaleString() : "–") + "</b><span>tokens</span></div>" +
      "<div class='ro-cell'><b>n=" + r.n + "</b><span>questions</span></div>" +
      "</div>" +
      (chips ? '<div class="model-chips">' + chips + "</div>" : "") +
      (r.notes ? '<p class="inst-notes">' + esc(r.notes) + "</p>" : "") +
      '<p class="inst-src">' + esc(r.source || "") + (r.date ? " · " + esc(r.date) : "") + "</p>" +
      "</article>";
  }
  function renderCards(rows) {
    var best = -1;
    rows.forEach(function (r) {
      if (r.kind === "measured" && r.accuracy != null && r.accuracy > best) best = r.accuracy;
    });
    document.getElementById("cards").innerHTML = rows.map(function (r) {
      return cardHTML(r, r.kind === "measured" && r.accuracy === best && best >= 0);
    }).join("");
    document.querySelectorAll("#cards .acc-num").forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-v"));
      if (!isNaN(target)) {
        new IntersectionObserver(function (entries, io) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { io.disconnect(); countUp(el, target, "pct"); }
          });
        }, { threshold: 0.4 }).observe(el);
      }
    });
    observeReveals(document.getElementById("cards"));
  }
  function renderPending(pending) {
    var sec = document.getElementById("bench");
    if (!pending || !pending.length) { sec.hidden = true; return; }
    sec.hidden = false;
    document.getElementById("pending-cards").innerHTML = pending.map(function (p) {
      return '<article class="inst pending reveal"><div class="inst-head">' +
        '<span class="led led-ice"></span><div>' +
        '<div class="inst-title">' + esc(archLabel(p.architecture)) + "</div>" +
        '<div class="inst-variant">' + esc(p.variant || "") + "</div></div>" +
        badge("pending") + "</div>" +
        '<p class="inst-notes">' + esc(p.detail || "") + "</p></article>";
    }).join("");
    observeReveals(document.getElementById("pending-cards"));
  }

  /* ---------- run table ---------- */
  function renderTable(rows) {
    document.querySelector("#runs-table tbody").innerHTML = rows.map(function (r) {
      return "<tr><td><span class='mono'>" + esc(r.id) + "</span></td>" +
        "<td>" + esc(archLabel(r.architecture)) + "</td>" +
        "<td class='num'>" + r.n + "</td>" +
        "<td class='num'>" + fmtPct(r.accuracy) + "</td>" +
        "<td class='num'>" + fmtLat(r.mean_latency_s) + "</td>" +
        "<td class='num'>" + fmtCost(r.cost_usd) + "</td>" +
        "<td>" + badge(r.kind) + "</td></tr>";
    }).join("");
  }

  /* ---------- segmented control: spring-driven indicator ---------- */
  function moveSegInd(btn, instant) {
    var seg = document.getElementById("metric-seg");
    var ind = document.getElementById("seg-ind");
    var targetX = btn.offsetLeft, targetW = btn.offsetWidth;
    function apply(x, w) {
      ind.style.transform = "translateX(" + x + "px)";
      ind.style.width = w + "px";
    }
    if (instant || REDUCED) {
      ind.style.transform = "translateX(" + targetX + "px)";
      ind.style.width = targetW + "px";
      return;
    }
    var cur = { x: parseFloat(ind.style.transform.replace(/[^0-9.\-]/g, "")) || 0,
                w: parseFloat(ind.style.width) || targetW };
    var sx = spring({ from: cur.x, to: targetX, damping: 1.0, response: 0.3,
      onUpdate: function (v) { ind.setAttribute("data-x", v); paint(); } });
    var sw = spring({ from: cur.w, to: targetW, damping: 1.0, response: 0.3,
      onUpdate: function (v) { ind.setAttribute("data-w", v); paint(); } });
    function paint() {
      var x = parseFloat(ind.getAttribute("data-x") || cur.x);
      var w = parseFloat(ind.getAttribute("data-w") || cur.w);
      apply(x, w);
    }
    void sx; void sw;
  }
  function initSeg() {
    var seg = document.getElementById("metric-seg");
    var btns = seg.querySelectorAll(".seg-btn");
    function select(btn, instant) {
      btns.forEach(function (b) { b.classList.remove("on"); });
      btn.classList.add("on");
      metric = btn.getAttribute("data-m");
      document.getElementById("pareto-metric-word").textContent = metric;
      moveSegInd(btn, instant);
      if (leaderboard && !instant) renderChart(leaderboard.rows);
    }
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () { select(btn, false); });
    });
    moveSegInd(seg.querySelector(".seg-btn.on"), true);
    window.addEventListener("resize", function () {
      moveSegInd(seg.querySelector(".seg-btn.on"), true);
    });
  }

  /* ---------- boot ---------- */
  initSeg();
  observeReveals(document);
  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      leaderboard = data;
      renderKPIs(data.rows);
      renderChart(data.rows);
      renderCards(data.rows);
      renderPending(data.pending);
      renderTable(data.rows);
      if (data.generated_utc) {
        document.getElementById("generated").textContent =
          "data compiled " + data.generated_utc.slice(0, 10);
      }
    })
    .catch(function (err) {
      document.getElementById("cards").innerHTML =
        '<p class="muted mono">Could not load leaderboard data (' + esc(err.message) + ").</p>";
    });
})();
