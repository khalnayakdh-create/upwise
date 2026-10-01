/* Upwise Bundles: "Frequently bought together" product block. */
(function () {
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var EVENTS = root + "apps/upwise-bundles/events";
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function money(cents, cur) {
    try { return new Intl.NumberFormat(document.documentElement.lang || undefined, { style: "currency", currency: cur }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2); }
  }
  function track(bundleId, type) {
    try { fetch(EVENTS, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ bundleId: bundleId, type: type }] }) }).catch(function () {}); } catch (e) {}
  }
  var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "USD";

  function init(box) {
    if (box.__upwise) return;
    box.__upwise = true;
    var cfgEl = box.parentElement && box.parentElement.querySelector("[data-upwise-bundles-config]");
    if (!cfgEl) return;
    var cfg; try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
    var pid = Number(box.getAttribute("data-product-id"));
    var bundle = (cfg.bundles || []).filter(function (b) { return b.products.some(function (p) { return p.productId === pid; }); })[0];
    if (!bundle) return;
    // Current product first.
    var items = bundle.products.slice().sort(function (a, b) { return (b.productId === pid) - (a.productId === pid); });
    Promise.all(items.map(function (p) {
      return fetch(root + "products/" + encodeURIComponent(p.handle) + ".js").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return null;
        var v = d.variants.filter(function (x) { return x.id === p.variantId && x.available; })[0] || d.variants.filter(function (x) { return x.available; })[0];
        return v ? { p: p, d: d, v: v } : null;
      }).catch(function () { return null; });
    })).then(function (rows) {
      rows = rows.filter(Boolean);
      if (rows.length < 2) return;
      // The discount needs every bundle product; if any is unavailable, don't promise it.
      var discount = rows.length === bundle.products.length ? bundle.discountPercent : 0;
      box.appendChild(el("p", "upwise-bundle__title", bundle.title));
      var ul = el("ul", "upwise-bundle__list");
      var checks = [];
      rows.forEach(function (r) {
        var li = el("li", "upwise-bundle__item");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = true; cb.setAttribute("aria-label", "Include " + r.d.title);
        cb.addEventListener("change", update);
        checks.push({ cb: cb, r: r });
        var img = el("img"); img.alt = ""; img.width = 48; img.height = 48; img.loading = "lazy";
        var src = (r.v.featured_image && r.v.featured_image.src) || r.d.featured_image;
        if (src) img.src = src + (src.indexOf("?") > -1 ? "&" : "?") + "width=96";
        var name = el("span", "upwise-bundle__name", r.d.title + (r.p.productId === pid ? " (this item)" : ""));
        var price = el("span", "upwise-bundle__price", money(r.v.price, currency));
        li.appendChild(cb); li.appendChild(img); li.appendChild(name); li.appendChild(price);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      var foot = el("div", "upwise-bundle__total");
      var total = el("span", "upwise-bundle__save");
      total.setAttribute("aria-live", "polite");
      var btn = el("button", "upwise-bundle__btn", box.getAttribute("data-button") || "Add selected to cart");
      btn.type = "button";
      foot.appendChild(total); foot.appendChild(btn);
      box.appendChild(foot);
      function update() {
        var sel = checks.filter(function (c) { return c.cb.checked; });
        var sum = sel.reduce(function (n, c) { return n + c.r.v.price; }, 0);
        var all = sel.length === checks.length;
        if (all && discount > 0) {
          var disc = Math.round(sum * (100 - discount) / 100);
          total.textContent = "Total " + money(disc, currency) + " (save " + discount + "% with all " + checks.length + ")";
        } else {
          total.textContent = "Total " + money(sum, currency) + (discount > 0 ? " — add all " + checks.length + " to save " + discount + "%" : "");
        }
        btn.disabled = sel.length === 0;
      }
      update();
      track(bundle.id, "impression");
      btn.addEventListener("click", function () {
        var sel = checks.filter(function (c) { return c.cb.checked; });
        btn.disabled = true;
        fetch(root + "cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items: sel.map(function (c) { return { id: c.r.v.id, quantity: 1, properties: { _upwise_bundle: bundle.id } }; }) })
        }).then(function (r) {
          if (!r.ok) throw new Error();
          if (sel.length === checks.length) track(bundle.id, "add");
          window.location.href = root + "cart";
        }).catch(function () { btn.disabled = false; btn.textContent = "Try again"; });
      });
    });
  }
  function scan() { document.querySelectorAll("[data-upwise-bundle]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  document.addEventListener("shopify:section:load", scan);
})();
