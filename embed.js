/*
 * Light the Fire embed: lightthefire.labs.trlibrary.com
 *
 * Paste where it should appear:
 *   <div data-lightthefire="full"></div>
 *   <script src="https://lightthefire.labs.trlibrary.com/embed.js" async></script>
 *
 * Views: full (fire, give, progress, map), fire, counter, progress, map, screen (lobby displays).
 * Add data-demo="1" to preview with sample numbers and controls.
 *
 * The page loads in an iframe that grows to fit. After a gift, send people back to the page that
 * holds the embed with ?ltf=thanks on the address and the fire sends up their spark.
 */
(function () {
  "use strict";
  var me = document.currentScript;
  var base = (me && me.src ? me.src : "https://lightthefire.labs.trlibrary.com/embed.js").replace(/embed\.js(\?.*)?$/, "");
  var START = { full: 1900, fire: 700, screen: 700, counter: 300, progress: 300, map: 620 };
  function mount(el) {
    if (el.getAttribute("data-lightthefire-ready")) return;
    el.setAttribute("data-lightthefire-ready", "1");
    var view = (el.getAttribute("data-lightthefire") || "full").toLowerCase();
    var q = "?embed=1&view=" + encodeURIComponent(view);
    if (el.getAttribute("data-demo") === "1") q += "&demo=1";
    if (/[?&]ltf=thanks\b/.test(location.search)) q += "&thanks=1";
    var f = document.createElement("iframe");
    f.src = base + "app/" + q;
    f.title = el.getAttribute("data-title") || "Light the Fire";
    f.loading = view === "full" || view === "fire" ? "eager" : "lazy";
    f.style.cssText = "display:block;width:100%;border:0;overflow:hidden;background:transparent;height:" + (view === "screen" ? "100vh" : (START[view] || 700) + "px");
    f.setAttribute("scrolling", "no");
    el.appendChild(f);
    window.addEventListener("message", function (e) {
      if (e.source !== f.contentWindow || !e.data || typeof e.data !== "object") return;
      if (e.data.type === "lightthefire:height" && e.data.height > 80 && view !== "screen") f.style.height = e.data.height + "px";
      if (e.data.type === "lightthefire:give" && window.dataLayer) window.dataLayer.push({ event: "lightthefire_give", lightthefire_amount: e.data.amount || null, lightthefire_view: view });
    });
  }
  function run() { Array.prototype.forEach.call(document.querySelectorAll("[data-lightthefire]"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
