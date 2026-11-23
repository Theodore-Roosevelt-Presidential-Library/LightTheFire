/*
 * Light the Fire: the campfire and the night sky, drawn on one canvas.
 *
 *   var fire = new LTFFire(canvas);
 *   fire.setLevel(0..1);          // 0 = unlit logs, floor = embers, 1 = roaring
 *   fire.setStars(count, true);   // one star per gift; true sends the new ones up as sparks
 *   fire.celebrate();             // one large spark, for the thank-you moment
 *
 * No libraries. Pauses when the tab is hidden or the canvas is off screen. With "reduce motion"
 * turned on it draws a still picture and redraws only when the numbers change.
 */
(function () {
  "use strict";

  var NIGHT = "#092A4D", BUTTE = "#061D36", GROUND = "#04162A", LOG = "#25282A";
  var ORANGE = [231, 128, 93], MID = [242, 169, 143], CORE = [251, 227, 218];
  var MAX_STARS = 2600, MAX_FLYING = 14;

  // The butte skyline, as fractions of the canvas width (x) and of the skyline band's height (y, 0 = top).
  var SKYLINE = [[0, .62], [.05, .5], [.09, .56], [.13, .22], [.2, .26], [.24, .58], [.31, .5], [.36, .12],
    [.44, .16], [.48, .52], [.56, .46], [.61, .64], [.68, .3], [.74, .34], [.79, .6], [.86, .4], [.92, .46], [1, .2]];

  function hash(i) { // stable pseudo-random numbers from an index, so star i is always in the same place
    var t = (i + 1) * 0x6D2B79F5;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sprite(rgb) {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(" + rgb.join(",") + ",1)");
    g.addColorStop(.45, "rgba(" + rgb.join(",") + ",.45)");
    g.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return c;
  }

  function LTFFire(canvas, opts) {
    opts = opts || {};
    this.c = canvas;
    this.x = canvas.getContext("2d");
    this.fxFrac = opts.fireX || null;      // where the fire sits across the canvas (0..1); null = automatic
    this.level = 0;
    this.target = 0;
    this.parts = [];
    this.sparks = [];
    this.flying = [];
    this.shown = 0;                        // stars currently drawn
    this.t = 0;
    this.acc = 0;
    this.visible = true;
    this.reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.sp = { core: sprite(CORE), mid: sprite(MID), outer: sprite(ORANGE) };
    this.starLayer = document.createElement("canvas");
    this.resize();
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    else window.addEventListener("resize", function () { self.resize(); });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (e) { self.visible = e[0].isIntersecting; if (self.visible) self.kick(); }).observe(canvas);
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) self.kick(); });
    this.kick();
  }

  LTFFire.prototype.resize = function () {
    var r = this.c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.s = Math.max(.55, Math.min(1.25, Math.min(this.w / 900, this.h / 620)));
    var fx = this.fxFrac != null ? this.fxFrac : (this.w < 820 ? .34 : .56);
    this.fx = this.w * fx;
    this.groundH = Math.max(46, this.h * .1);
    this.fy = this.h - this.groundH * .62;
    this.drawStars();
    // Resizing a canvas wipes it, so redraw now even if the loop is paused (off screen or hidden tab).
    if (this.reduce) this.still(); else if (this.t) this.frame();
  };

  LTFFire.prototype.starAt = function (i) {
    var r = hash(i), x = r() * this.w, y = (.03 + r() * .62) * this.h, big = r(), warm = r(), a = .5 + r() * .5;
    return { x: x, y: y, size: big > .93 ? 2.3 : (big > .62 ? 1.5 : 1), warm: warm > .62, a: a };
  };

  LTFFire.prototype.drawStars = function () {
    var L = this.starLayer;
    L.width = this.c.width; L.height = this.c.height;
    var x = L.getContext("2d");
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var n = Math.min(this.shown, MAX_STARS);
    for (var i = 0; i < n; i++) {
      var st = this.starAt(i);
      x.globalAlpha = st.a;
      x.fillStyle = st.warm ? "rgb(" + ORANGE.join(",") + ")" : "#FFFFFF";
      x.beginPath();
      x.arc(st.x, st.y, st.size, 0, 6.2832);
      x.fill();
    }
  };

  LTFFire.prototype.setLevel = function (v) {
    this.target = Math.max(0, Math.min(1, v));
    if (this.reduce) { this.level = this.target; this.still(); }
    this.kick();
  };

  LTFFire.prototype.setStars = function (count, animate) {
    count = Math.max(0, Math.round(count));
    var add = count - this.shown;
    if (add <= 0 || !animate || this.reduce || this.target <= 0) {
      this.shown = count;
      this.drawStars();
      if (this.reduce) this.still();
      return;
    }
    var fly = Math.min(add, MAX_FLYING);
    this.shown = count - fly;              // the rest appear at once; these few rise from the fire
    this.drawStars();
    for (var i = 0; i < fly; i++) this.launch(this.shown + i, i * 22, false);
    this.kick();
  };

  LTFFire.prototype.launch = function (index, delay, big) {
    var st = this.starAt(Math.min(index, MAX_STARS - 1));
    this.flying.push({ i: index, d: delay, t: 0, len: big ? 210 : 150, big: big,
      x0: this.fx, y0: this.fy - 24 * this.s, x1: st.x, y1: st.y, bend: (Math.random() - .5) * this.w * .25 });
  };

  LTFFire.prototype.celebrate = function () {
    if (this.reduce) return;
    this.launch(this.shown, 0, true);
    this.kick();
  };

  LTFFire.prototype.kick = function () {
    if (this.reduce || this.running) return;
    this.running = true;
    var self = this;
    requestAnimationFrame(function loop() {
      if (document.hidden || !self.visible) { self.running = false; return; }
      self.frame();
      requestAnimationFrame(loop);
    });
  };

  LTFFire.prototype.spawn = function () {
    var L = this.level, s = this.s, sp = (10 + L * 42) * s;
    this.parts.push({
      x: this.fx + (Math.random() - .5) * sp * (.4 + Math.random() * .9), y: this.fy - 8 * s,
      vx: (Math.random() - .5) * .5 * s * (1 + L), vy: -(1.1 + L * 3.1 + Math.random() * .9) * s,
life: 0, max: 30 + L * 40 + Math.random() * 18, size: (20 + L * 34) * s * (.7 + Math.random() * .6), ph: Math.random() * 6.28
    });
  };

  LTFFire.prototype.scene = function () { // sky, stars, buttes, ground, logs
    var x = this.x, w = this.w, h = this.h, s = this.s, L = this.level;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.globalCompositeOperation = "source-over";
    x.globalAlpha = 1;
    x.fillStyle = NIGHT;
    x.fillRect(0, 0, w, h);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(this.starLayer, 0, 0);
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    var bandH = h * .2, top = h - this.groundH - bandH * .78;
    x.fillStyle = BUTTE;
    x.beginPath();
    x.moveTo(0, h);
    for (var i = 0; i < SKYLINE.length; i++) x.lineTo(SKYLINE[i][0] * w, top + SKYLINE[i][1] * bandH);
    x.lineTo(w, h);
    x.closePath();
    x.fill();
    x.fillStyle = GROUND;
    x.fillRect(0, h - this.groundH, w, this.groundH);

    if (L > 0) { // firelight on the ground and the air around the fire
      x.globalCompositeOperation = "lighter";
      var R = (110 + L * 360) * s, g = x.createRadialGradient(this.fx, this.fy - 30 * s, 0, this.fx, this.fy - 30 * s, R);
      var a = .08 + L * .24 + Math.sin(this.t * .09) * .015;
      g.addColorStop(0, "rgba(231,128,93," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(231,128,93,0)");
      x.fillStyle = g;
      x.fillRect(this.fx - R, this.fy - 30 * s - R, R * 2, R * 2);
      x.globalCompositeOperation = "source-over";
    }

    x.fillStyle = LOG; // two crossed logs
    for (var k = -1; k <= 1; k += 2) {
      x.save();
      x.translate(this.fx, this.fy);
      x.rotate(k * .16);
      var lw = 150 * s, lh = 17 * s;
      x.beginPath();
      if (x.roundRect) x.roundRect(-lw / 2, -lh / 2, lw, lh, lh / 2); else x.rect(-lw / 2, -lh / 2, lw, lh);
      x.fill();
      x.restore();
    }
  };

  LTFFire.prototype.embers = function () {
    var x = this.x, s = this.s, L = this.level;
    if (L <= 0) return;
    x.globalCompositeOperation = "lighter";
    for (var i = 0; i < 9; i++) {
      var r = hash(900 + i), ex = this.fx + (r() - .5) * 120 * s, ey = this.fy + (r() - .5) * 10 * s;
      var a = .35 + .3 * Math.sin(this.t * (.04 + r() * .05) + r() * 6), sz = (7 + r() * 9) * s;
      x.globalAlpha = Math.max(0, a);
      x.drawImage(this.sp.outer, ex - sz, ey - sz, sz * 2, sz * 2);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
  };

  LTFFire.prototype.frame = function () {
    this.t++;
    this.level += (this.target - this.level) * .025;
    if (Math.abs(this.target - this.level) < .001) this.level = this.target;
    var x = this.x, s = this.s, L = this.level, i, p;
    this.scene();
    this.embers();

    if (L > 0) {
      this.acc += 1.5 + L * 5;
      while (this.acc >= 1) { this.spawn(); this.acc--; }
      if (Math.random() < L * .22) {
        this.sparks.push({ x: this.fx + (Math.random() - .5) * 40 * s, y: this.fy - 40 * s, vy: -(1.4 + Math.random() * 2.2) * s,
          life: 0, max: 90 + Math.random() * 80, ph: Math.random() * 6.28 });
      }
    }

    x.globalCompositeOperation = "lighter";
    for (i = this.parts.length - 1; i >= 0; i--) {
      p = this.parts[i];
      p.life++;
      if (p.life >= p.max) { this.parts.splice(i, 1); continue; }
      p.x += p.vx + Math.sin(this.t * .11 + p.ph) * .5 * s + (this.fx - p.x) * .028;   // lean and taper toward the tip
      p.y += p.vy;
      p.vy *= .988;
      var f = p.life / p.max, sz = p.size * (1 - f * .86);
      // Low opacity on purpose: with additive drawing, the overlap at the base builds a pale core and the edges stay orange.
      x.globalAlpha = (1 - f) * (f < .15 ? .1 : .085);
      x.drawImage(f < .15 ? this.sp.core : (f < .45 ? this.sp.mid : this.sp.outer), p.x - sz * .8, p.y - sz * 1.15, sz * 1.6, sz * 2.3);
    }
    for (i = this.sparks.length - 1; i >= 0; i--) {
      p = this.sparks[i];
      p.life++;
      if (p.life >= p.max) { this.sparks.splice(i, 1); continue; }
      p.y += p.vy;
      p.x += Math.sin(this.t * .08 + p.ph) * .7 * s;
      x.globalAlpha = (1 - p.life / p.max) * .9;
      x.drawImage(this.sp.mid, p.x - 3 * s, p.y - 3 * s, 6 * s, 6 * s);
    }

    var landed = false;
    for (i = this.flying.length - 1; i >= 0; i--) {
      p = this.flying[i];
      if (p.d > 0) { p.d--; continue; }
      p.t++;
      var u = p.t / p.len, e = 1 - Math.pow(1 - u, 3);
      var mx = (p.x0 + p.x1) / 2 + p.bend, my = Math.min(p.y0, p.y1) - 60 * s;
      var px = (1 - e) * (1 - e) * p.x0 + 2 * (1 - e) * e * mx + e * e * p.x1;
      var py = (1 - e) * (1 - e) * p.y0 + 2 * (1 - e) * e * my + e * e * p.y1;
      var r = (p.big ? 26 : 12) * s * (1 - e * .6);
      x.globalAlpha = 1;
      x.drawImage(this.sp.outer, px - r, py - r, r * 2, r * 2);
      x.drawImage(this.sp.core, px - r * .45, py - r * .45, r * .9, r * .9);
      if (p.t >= p.len) { this.flying.splice(i, 1); this.shown = Math.max(this.shown, p.i + 1); landed = true; }
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
    if (landed) this.drawStars();
  };

  LTFFire.prototype.still = function () { // one picture, no motion
    if (!this.w) return;
    var x = this.x, s = this.s, L = this.level;
    this.scene();
    this.embers();
    if (L > 0) {
      x.globalCompositeOperation = "lighter";
      var hgt = (70 + L * 250) * s, wid = (50 + L * 90) * s;
      x.globalAlpha = .9;
      x.drawImage(this.sp.outer, this.fx - wid, this.fy - hgt * 1.05, wid * 2, hgt * 1.25);
      x.drawImage(this.sp.mid, this.fx - wid * .62, this.fy - hgt * .8, wid * 1.24, hgt);
      x.drawImage(this.sp.core, this.fx - wid * .3, this.fy - hgt * .5, wid * .6, hgt * .62);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
    }
  };

  window.LTFFire = LTFFire;
})();
