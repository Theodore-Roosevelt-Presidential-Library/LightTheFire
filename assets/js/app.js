/*
 * Light the Fire: the page inside the embed.
 *
 * Reads three files and nothing else:
 *   config/campaign.json     settings a person edits (dates, give link, fire tuning, DonorPerfect campaign)
 *   data/live.json           public totals written by scripts/sync_donorperfect.py (no names, no gift amounts)
 *   data/sample.json         stand-in numbers, used until live.json exists or when ?demo=1 is on the address
 *
 * Address options:  ?view=full|fire|counter|progress|map|screen   &embed=1   &demo=1   &thanks=1
 */
(function () {
  "use strict";

  var Q = new URLSearchParams(location.search);
  var VIEW = (Q.get("view") || "full").toLowerCase();
  var EMBED = Q.get("embed") === "1";
  var DEMO = Q.get("demo") === "1";
  var THANKS = Q.get("thanks") === "1";
  var BASE = "../";
  var POLL_MS = 60000;
  var VIEWS = { full: 1, fire: 1, counter: 1, progress: 1, map: 1, screen: 1 };
  if (!VIEWS[VIEW]) VIEW = "full";

  var root = document.getElementById("ltf");
  var cfg, shapes, model, fire, sample = false, picked = null;
  var demo = { extra: 0, times: [], sparks: [], shift: 0, match: null, clock: 0 };
  var DEMO_NAMES = ["Anna K.", "Ben T.", "Carla M.", "Dev P.", "Elena R.", "m|Ruth Olson", "Frank W.", "Grace L.", "h|Coach Dan Reyes", "Hank S."];
  var el = {};

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(n) { return Math.round(n).toLocaleString("en-US"); }
  function now() { return Date.now() + demo.clock; }
  function get(url) {
    return fetch(BASE + url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Math.floor(Date.now() / 30000), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }
  function dayIn(tz, ms) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function when(ms) {
    var text = new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
    return text.replace(/\s?AM\b/, " a.m.").replace(/\s?PM\b/, " p.m.") + " " + (cfg.timezoneLabel || "");
  }
  function clock(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
    if (d >= 2) return d + " days";
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function tell(type, extra) {
    if (window.parent === window) return;
    var m = { type: "lightthefire:" + type };
    for (var k in extra) m[k] = extra[k];
    window.parent.postMessage(m, "*");
  }

  /* ---------- the numbers ---------- */
  function normalize(d) {
    var times = [], offsets = [];
    if (Array.isArray(d.recentGiftTimes)) times = d.recentGiftTimes.map(function (s) { return Date.parse(s); }).filter(isFinite);
    else if (Array.isArray(d.recentOffsetsMinutes)) offsets = d.recentOffsetsMinutes; // sample data: "minutes ago", whatever the clock says
    return {
      gifts: +d.gifts || 0, progress: d.progress == null ? null : Math.max(0, +d.progress), goal: d.goal, raised: d.raised,
      goalUnit: d.goalUnit || "dollars", states: d.states || {}, order: d.stateOrder || [], times: times, offsets: offsets,
      generatedAt: d.generatedAt, source: d.source || "", name: (d.campaign && d.campaign.name) || "",
      sparks: Array.isArray(d.sparks) ? d.sparks : []   // the newest gifts, oldest first: {n: "First L.", c: "Bismarck", s: "ND"}; k: "m" or "h" when n is a memorial or honor name
    };
  }
  function loadData() {
    var live = DEMO ? Promise.reject(new Error("demo")) : get("data/live.json").then(function (d) {
      if (!d || typeof d.gifts !== "number") throw new Error("live.json has no gift count");
      sample = false;
      return d;
    });
    return live.catch(function () {
      // "mode": "live" in the config means never show sample numbers to the public: start from zero instead.
      if (!DEMO && cfg.mode === "live") { sample = false; return { gifts: 0, progress: 0, states: {}, stateOrder: [], recentGiftTimes: [], source: "none" }; }
      sample = true;
      return get("data/sample.json");
    }).then(normalize);
  }
  function gifts() { return model.gifts + demo.extra; }
  function sparks() { return (cfg.display || {}).showNames === false ? [] : model.sparks.concat(demo.sparks); }
  function stateName(id) {
    for (var i = 0; i < shapes.states.length; i++) if (shapes.states[i].id === id) return shapes.states[i].name;
    return "";
  }
  function sparkText(sp) {
    var who = sp && sp.n ? sp.n : "A friend", where = sp && sp.s ? stateName(sp.s) : "";
    if (sp && sp.c && (cfg.display || {}).showCity !== false) where = sp.c + (where ? ", " + where : "");
    // A gift made for someone shows that person, not the giver: k is "m" (memory), "h" (honor) or "t" (tribute).
    if (sp && sp.k && sp.n) return (sp.k === "m" ? "In memory of " : sp.k === "h" ? "In honor of " : "For ") + sp.n + (where ? " · from " + where : "");
    return who + (where ? ", " + where : "");
  }
  function times() {
    var t0 = now(), all = model.times.concat(model.offsets.map(function (m) { return t0 - m * 60000; }), demo.times);
    return all.map(function (t) { return t - demo.shift; });
  }
  function statesLit() {
    var n = 0;
    for (var i = 0; i < shapes.states.length; i++) if (model.states[shapes.states[i].id] > 0) n++;
    return n;
  }

  /* ---------- where the campaign stands in time ---------- */
  function phaseAt(t) {
    var p = cfg.phases || [], i, cur = null, next = null;
    for (i = 0; i < p.length; i++) {
      var a = Date.parse(p[i].start), b = Date.parse(p[i].end);
      if (t >= a && t < b) cur = p[i];
      else if (t < a && (!next || a < Date.parse(next.start))) next = p[i];
    }
    return { cur: cur, next: next, over: !cur && !next };
  }
  function matchAt(t) {
    if (demo.match && t < demo.match.end) return demo.match;
    var m = cfg.matches || [];
    for (var i = 0; i < m.length; i++) if (t >= Date.parse(m[i].start) && t < Date.parse(m[i].end)) return { label: m[i].label, sponsor: m[i].sponsor, end: Date.parse(m[i].end) };
    return null;
  }
  function fireState(t) {
    var ph = phaseAt(t), f = cfg.fire || {}, floor = f.floor == null ? .12 : f.floor;
    if (!ph.cur) {
      if (ph.over) return { level: floor, word: "Embers", line: "The sky is complete. Every spark in it stays." };
      var first = (cfg.phases || []).every(function (p) { return t < Date.parse(p.start); });
      if (first) return { level: 0, word: "Laid and waiting", line: "The fire lights " + when(Date.parse(ph.next.start)) + "." };
      return { level: floor, word: "Banked", line: "The fire is banked. It burns again " + when(Date.parse(ph.next.start)) + "." };
    }
    var peak = (f.peakDays || []).indexOf(dayIn(cfg.timezone, t)) >= 0 || !!matchAt(t);
    var set = (peak ? f.peak : f.normal) || { windowMinutes: 60, giftsForFullFire: 40 };
    var since = t - set.windowMinutes * 60000, n = 0, all = times();
    for (var i = 0; i < all.length; i++) if (all[i] >= since && all[i] <= t + 60000) n++;
    var level = floor + (1 - floor) * Math.min(1, n / Math.max(1, set.giftsForFullFire));
    var word = level < .22 ? "Embers" : level < .5 ? "Burning steady" : level < .8 ? "Burning bright" : "Roaring";
    var span = set.windowMinutes === 60 ? "the last hour" : set.windowMinutes === 1440 ? "the last 24 hours" : "the last " + set.windowMinutes + " minutes";
    return { level: level, word: word, line: num(n) + (n === 1 ? " gift in " : " gifts in ") + span, lit: true, n: n };
  }

  /* ---------- give link ---------- */
  function giveUrl(amount) {
    var g = cfg.give || {}, url = g.formUrl || g.fallbackUrl || "https://www.trlibrary.com/support";
    var add = [];
    if (g.formUrl && g.amountParam && amount) add.push(encodeURIComponent(g.amountParam) + "=" + encodeURIComponent(amount));
    for (var k in (g.utm || {})) add.push(encodeURIComponent(k) + "=" + encodeURIComponent(g.utm[k]));
    return add.length ? url + (url.indexOf("?") < 0 ? "?" : "&") + add.join("&") : url;
  }

  /* ---------- building the page ---------- */
  function heroHTML(withCopy) {
    var d = cfg.display || {};
    return '<section class="ltf-hero' + (VIEW === "screen" ? " is-screen" : "") + '">' +
      '<div class="ltf-bar" id="bar" hidden></div>' +
      '<canvas class="ltf-canvas" id="canvas" role="img" aria-label="A campfire under the night sky of the Badlands"></canvas>' +
      (d.photo ? '<img class="ltf-tr" src="' + BASE + esc(d.photo) + '" alt="' + esc(d.photoAlt || "") + '">' : "") +
      (withCopy ? '<div class="ltf-copy">' +
        '<p class="ltf-kicker">' + esc(cfg.kicker || "") + "</p>" +
        '<h1 class="ltf-title">' + esc(cfg.title || "Light the Fire") + "</h1>" +
        '<p class="ltf-intro">' + esc(cfg.intro || "") + "</p>" +
        (VIEW === "screen" ? "" : '<p><a class="ltf-btn" id="heroGive" target="_top" rel="noopener" href="#">' + esc((cfg.give && cfg.give.buttonLabel) || "Add a log") + "</a></p>") +
        "</div>" : "") +
      '<div class="ltf-meter" aria-live="polite">' +
        '<p class="ltf-count"><span id="count">0</span> <span class="ltf-count-label">sparks in the sky</span></p>' +
        '<div class="ltf-meter-state"><p class="ltf-word" id="word"></p><p class="ltf-line" id="line"></p></div>' +
        '<p class="ltf-latest" id="latest"></p>' +
      "</div>" +
      '<div class="ltf-tip" id="tip" hidden></div>' +
      (d.photoCredit ? '<p class="ltf-credit">Photo: ' + esc(d.photoCredit) + "</p>" : "") +
      '<div class="ltf-toast" id="toast" role="status" hidden></div>' +
      "</section>";
  }
  function giveHTML() {
    var g = cfg.give || {}, a = g.amounts || [], pills = "";
    for (var i = 0; i < a.length; i++) {
      pills += '<button type="button" class="ltf-pill" data-amount="' + esc(a[i].value) + '" aria-pressed="false">' +
        '<span class="ltf-pill-amt">$' + esc(a[i].value) + '</span><span class="ltf-pill-note">' + esc(a[i].note || "") + "</span></button>";
    }
    return '<section class="ltf-give"><div class="ltf-wrap ltf-give-grid">' +
      '<div><h2 class="ltf-h2">Add your log</h2>' +
      '<p class="ltf-p">' + esc(cfg.purpose ? "Gifts support " + cfg.purpose + "." : "Every gift adds a log to the fire and a spark to the sky.") + "</p></div>" +
      '<div><div class="ltf-pills" role="group" aria-label="Choose a gift amount">' + pills + "</div>" +
      '<p><a class="ltf-btn ltf-btn-wide" id="give" target="_top" rel="noopener" href="#"></a></p></div>' +
      "</div></section>";
  }
  function progressHTML() {
    var t = cfg.trail || {}, stops = t.stops || [], marks = "";
    for (var i = 0; i < stops.length; i++) {
      marks += '<span class="ltf-stop" style="left:' + (stops[i].at * 100) + '%"><span class="ltf-stop-label">' + esc(stops[i].label) + "</span></span>";
    }
    return '<section class="ltf-progress" id="progressBox" hidden><div class="ltf-wrap">' +
      '<div class="ltf-progress-head"><h2 class="ltf-h2">Ride to the Elkhorn</h2><p class="ltf-p" id="progressText"></p></div>' +
      '<div class="ltf-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="track" aria-label="Progress toward the goal">' +
      '<span class="ltf-fill" id="fill"></span>' + marks + '<span class="ltf-rider" id="rider"></span></div>' +
      '<div class="ltf-ends"><span>' + esc(t.start || "Start") + "</span><span>" + esc(t.end || "Goal") + "</span></div>" +
      "</div></section>";
  }
  function mapHTML() {
    var p = "";
    for (var i = 0; i < shapes.states.length; i++) {
      var s = shapes.states[i];
      p += '<path id="st-' + s.id + '" class="ltf-state" data-id="' + s.id + '" data-name="' + esc(s.name) + '" d="' + s.d + '" tabindex="0"><title></title></path>';
    }
    return '<section class="ltf-map"><div class="ltf-wrap ltf-map-grid">' +
      '<div><h2 class="ltf-h2">The 50-state race</h2>' +
      '<p class="ltf-p">A state lights up with its first gift. Which will be last?</p>' +
      '<p class="ltf-big"><span id="lit">0</span> of 50</p>' +
      '<ul class="ltf-key"><li><span class="k k-lit"></span>Lit</li><li><span class="k k-new"></span>Newest</li><li><span class="k k-wait"></span>Waiting for a first gift</li></ul>' +
      '<p class="ltf-hover" id="hover" aria-live="polite">Point to a state to see where it stands.</p></div>' +
      '<div><svg class="ltf-svg" viewBox="' + shapes.viewBox + '" role="group" aria-label="Map of the United States showing which states have sent a gift">' + p + "</svg></div>" +
      "</div></section>";
  }
  function counterHTML() {
    return '<section class="ltf-counter"><p class="ltf-kicker">' + esc(cfg.title || "Light the Fire") + "</p>" +
      '<p class="ltf-count"><span id="count">0</span> <span class="ltf-count-label">sparks in the sky</span></p>' +
      '<p class="ltf-word" id="word"></p><p class="ltf-line" id="line"></p>' +
      '<p><a class="ltf-btn" id="heroGive" target="_top" rel="noopener" href="#">' + esc((cfg.give && cfg.give.buttonLabel) || "Add a log") + "</a></p></section>";
  }
  function demoHTML() {
    return '<aside class="ltf-demo" aria-label="Preview controls"><strong>Preview controls</strong>' +
      '<button type="button" data-demo="gift">Add a gift</button><button type="button" data-demo="ten">Add 10 gifts</button>' +
      '<button type="button" data-demo="hour">An hour passes</button><button type="button" data-demo="match">Start a match hour</button>' +
      '<button type="button" data-demo="before">Jump to before opening</button><button type="button" data-demo="live">Jump to Giving Tuesday</button>' +
      '<button type="button" data-demo="thanks">Show the thank-you</button></aside>';
  }

  function build() {
    var h = "";
    if (VIEW === "full") h = heroHTML(true) + giveHTML() + progressHTML() + mapHTML();
    else if (VIEW === "fire") h = heroHTML(true);
    else if (VIEW === "screen") h = heroHTML(true);
    else if (VIEW === "counter") h = counterHTML();
    else if (VIEW === "progress") h = progressHTML();
    else if (VIEW === "map") h = mapHTML();
    if (sample) h += '<p class="ltf-sample">Sample numbers. Live totals appear here once DonorPerfect is connected.</p>';
    if (DEMO) h += demoHTML();
    root.innerHTML = h;
    root.className = "ltf ltf-view-" + VIEW + (EMBED ? " is-embed" : "");
    ["bar", "canvas", "word", "line", "count", "toast", "give", "heroGive", "progressBox", "progressText", "track", "fill", "rider", "lit", "hover", "latest", "tip"]
      .forEach(function (id) { el[id] = document.getElementById(id); });

    if (el.canvas) {
      fire = new window.LTFFire(el.canvas, VIEW === "screen" ? { fireX: .5 } : null);
      var point = function (e) { // a spark near the pointer shows who lit it
        var r = el.canvas.getBoundingClientRect(), hit = nearSpark(e.clientX - r.left, e.clientY - r.top);
        if (!hit) { el.tip.hidden = true; return; }
        el.tip.textContent = sparkText(hit.spark);
        el.tip.style.left = Math.max(8, Math.min(r.width - 8, hit.x)) + "px";
        el.tip.style.top = hit.y + "px";
        el.tip.hidden = false;
      };
      el.canvas.addEventListener("pointermove", point);
      el.canvas.addEventListener("pointerdown", point);
      el.canvas.addEventListener("pointerleave", function () { el.tip.hidden = true; });
    }

    var pills = root.querySelectorAll(".ltf-pill");
    Array.prototype.forEach.call(pills, function (b) {
      b.addEventListener("click", function () { picked = +b.getAttribute("data-amount"); paintGive(); });
    });
    if (pills.length) picked = +pills[0].getAttribute("data-amount");
    [el.give, el.heroGive].forEach(function (a) {
      if (a) a.addEventListener("click", function () { tell("give", { amount: a === el.give ? picked : null }); });
    });
    Array.prototype.forEach.call(root.querySelectorAll(".ltf-state"), function (p) {
      var show = function () {
        var n = model.states[p.getAttribute("data-id")] || 0;
        el.hover.textContent = p.getAttribute("data-name") + ": " + (n ? num(n) + (n === 1 ? " gift" : " gifts") : "waiting for a first gift");
      };
      p.addEventListener("mouseenter", show);
      p.addEventListener("focus", show);
      p.addEventListener("click", show);
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-demo]"), function (b) {
      b.addEventListener("click", function () { demoDo(b.getAttribute("data-demo")); });
    });
    paintGive();
  }

  function nearSpark(x, y) {
    var list = sparks(), total = gifts(), start = total - list.length, best = null, bd = 18 * 18;
    for (var i = Math.max(0, list.length - 2600); i < list.length; i++) {
      var idx = start + i;
      if (idx < 0 || idx >= fire.shown) continue;
      var st = fire.starAt(idx), d2 = (st.x - x) * (st.x - x) + (st.y - y) * (st.y - y);
      if (d2 < bd) { bd = d2; best = { spark: list[i], x: st.x, y: st.y }; }
    }
    return best;
  }
  var latestAt = 0;
  function paintLatest() {
    if (!el.latest) return;
    var list = sparks();
    if (!list.length) { el.latest.textContent = ""; return; }
    var recent = list.slice(-6).reverse(), pick = recent[latestAt % recent.length];
    el.latest.innerHTML = '<span>' + (latestAt % recent.length === 0 ? "Latest spark" : "Recent spark") + "</span> " + esc(sparkText(pick));
    latestAt++;
  }

  /* ---------- keeping the page current ---------- */
  function paintGive() {
    if (el.heroGive) el.heroGive.href = giveUrl(null);
    if (!el.give) return;
    el.give.href = giveUrl(picked);
    el.give.textContent = ((cfg.give && cfg.give.buttonLabel) || "Add a log") + (picked ? " · $" + picked : "");
    Array.prototype.forEach.call(root.querySelectorAll(".ltf-pill"), function (b) {
      b.setAttribute("aria-pressed", String(+b.getAttribute("data-amount") === picked));
    });
  }
  function paintNumbers(animate) {
    if (el.count) el.count.textContent = num(gifts());
    if (fire) fire.setStars(gifts(), animate);
    if (el.lit) {
      el.lit.textContent = statesLit();
      var newest = model.order.length ? model.order[model.order.length - 1] : null;
      Array.prototype.forEach.call(root.querySelectorAll(".ltf-state"), function (p) {
        var id = p.getAttribute("data-id"), n = model.states[id] || 0;
        p.setAttribute("class", "ltf-state" + (id === newest && n ? " is-new" : n ? " is-lit" : ""));
        p.firstChild.textContent = p.getAttribute("data-name") + ": " + (n ? n + (n === 1 ? " gift" : " gifts") : "waiting for a first gift");
      });
    }
    if (el.progressBox) {
      var pr = model.progress;
      if (pr == null) { el.progressBox.hidden = true; }
      else {
        el.progressBox.hidden = false;
        var pct = Math.min(100, Math.round(pr * 100));
        el.fill.style.width = el.rider.style.left = pct + "%";
        el.track.setAttribute("aria-valuenow", pct);
        var txt = pct >= 100 ? "The ride has reached the Elkhorn. Every gift now goes past the goal." : pct + "% of the way from Medora to T.R.'s Elkhorn Ranch.";
        if ((cfg.display || {}).showDollars && model.raised != null && model.goal) txt += " $" + num(model.raised) + " of $" + num(model.goal) + ".";
        else if (model.goalUnit === "gifts" && model.goal) txt += " " + num(gifts()) + " of " + num(model.goal) + " gifts.";
        el.progressText.textContent = txt;
      }
    }
    tellHeight();
  }
  var lastHeight = 0;
  function tellHeight() {
    var hgt = Math.ceil(root.getBoundingClientRect().height);
    if (hgt && hgt !== lastHeight) { lastHeight = hgt; tell("height", { height: hgt }); }
  }
  function tick() {
    var t = now(), st = fireState(t), ph = phaseAt(t), m = matchAt(t);
    if (fire) {
      fire.setLevel(st.level);
      el.canvas.setAttribute("aria-label", "A campfire under the night sky of the Badlands. " + st.word + ". " + num(gifts()) + " sparks in the sky.");
    }
    if (el.word && el.word.textContent !== st.word) el.word.textContent = st.word;
    if (el.line && el.line.textContent !== st.line) el.line.textContent = st.line;
    if (el.bar) {
      var text = "";
      if (m) text = "<strong>" + esc(m.label || "Bull Moose Hour") + "</strong> " + (m.sponsor ? "Every gift matched by " + esc(m.sponsor) + ". " : "Every gift matched. ") + 'Ends in <span class="ltf-clock">' + clock(m.end - t) + "</span>";
      else if (ph.cur) text = "<strong>" + esc(ph.cur.name) + "</strong> ends in <span class=\"ltf-clock\">" + clock(Date.parse(ph.cur.end) - t) + "</span>";
      else if (ph.next) text = "<strong>" + esc(ph.next.name) + "</strong> starts in <span class=\"ltf-clock\">" + clock(Date.parse(ph.next.start) - t) + "</span>";
      el.bar.hidden = !text;
      if (text && el.bar.innerHTML !== text) el.bar.innerHTML = text;
    }
  }
  function thanks() {
    if (!el.toast) return;
    el.toast.hidden = false;
    el.toast.innerHTML = "<strong>Thank you.</strong> Your spark is rising. It joins the count within a few minutes.";
    if (fire) fire.celebrate();
    setTimeout(function () { el.toast.hidden = true; }, 12000);
  }
  function demoDo(what) {
    if (what === "gift" || what === "ten") {
      var k = what === "ten" ? 10 : 1;
      for (var i = 0; i < k; i++) {
        demo.times.push(now() + demo.shift);
        var dn = DEMO_NAMES[(demo.extra + i) % DEMO_NAMES.length];
        demo.sparks.push(dn.indexOf("|") > 0 ? { n: dn.split("|")[1], k: dn.split("|")[0], c: "Medora", s: "ND" } : { n: dn, c: "Medora", s: "ND" });
      }
      latestAt = 0;
      demo.extra += k;
      paintNumbers(true);
      paintLatest();
    } else if (what === "hour") demo.shift += 3600000;
    else if (what === "match") demo.match = { label: "Bull Moose Hour", sponsor: "[Match Benefactor]", end: now() + 3600000 };
    else if (what === "before") demo.clock = Date.parse(cfg.phases[0].start) - 3 * 86400000 - Date.now();
    else if (what === "live") demo.clock = Date.parse(cfg.phases[0].start) + 5 * 3600000 - Date.now();
    else if (what === "thanks") thanks();
    tick();
  }

  /* ---------- start ---------- */
  Promise.all([get("config/campaign.json"), get("assets/data/us-states.json")]).then(function (r) {
    cfg = r[0]; shapes = r[1];
    return loadData();
  }).then(function (m) {
    model = m;
    if (DEMO && phaseAt(now()).cur == null) demo.clock = Date.parse(cfg.phases[0].start) + 5 * 3600000 - Date.now(); // previews open mid-Giving Tuesday
    build();
    paintNumbers(false);
    tick();
    setInterval(tick, 1000);
    paintLatest();
    setInterval(paintLatest, 4000);
    setInterval(function () {
      loadData().then(function (m2) {
        var grew = m2.gifts > model.gifts;
        model = m2;
        if (grew) latestAt = 0;
        paintNumbers(grew);
      }).catch(function () {});
    }, POLL_MS);
    if (window.ResizeObserver) new ResizeObserver(tellHeight).observe(root);
    window.addEventListener("load", tellHeight);
    if (THANKS) setTimeout(thanks, 900);
  }).catch(function (e) {
    root.innerHTML = '<p class="ltf-loading">The fire could not be loaded. Please refresh the page.</p>';
    if (window.console) console.error("Light the Fire:", e);
  });
})();
