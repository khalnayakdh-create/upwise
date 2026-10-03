/* Storevine Bundles: bought together, quantity breaks and mix-and-match blocks for the product page. */
(function () {
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var EVENTS = root + "apps/storevine-bundles/events";
  var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "USD";
  var uid = 0;

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  /** Translations arrive HTML-escaped from the t filter (e.g. &#39;); textContent needs plain text. */
  function decode(s) { var t = document.createElement("textarea"); t.innerHTML = String(s); return t.value; }
  function fill(s, map) { return String(s).replace(/%[a-z]/g, function (k) { return map[k] != null ? map[k] : k; }); }
  function money(cents) {
    try { return new Intl.NumberFormat(document.documentElement.lang || undefined, { style: "currency", currency: currency }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2); }
  }
  function track(bundleId, type) {
    try { fetch(EVENTS, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ bundleId: bundleId, type: type }] }) }).catch(function () {}); } catch (e) {}
  }
  var cache = {};
  function product(handle) {
    if (!cache[handle]) cache[handle] = fetch(root + "products/" + encodeURIComponent(handle) + ".js").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return cache[handle];
  }
  function image(d, v) {
    var src = (v && v.featured_image && v.featured_image.src) || d.featured_image;
    if (!src) return null;
    var img = el("img"); img.alt = ""; img.width = 48; img.height = 48; img.loading = "lazy";
    img.src = src + (src.indexOf("?") > -1 ? "&" : "?") + "width=96";
    return img;
  }
  /** Variant picker for products with more than one available variant. */
  function picker(d, preferredId, T, onChange) {
    var avail = d.variants.filter(function (v) { return v.available; });
    var current = avail.filter(function (v) { return v.id === preferredId; })[0] || avail[0];
    var node = null;
    if (avail.length > 1) {
      node = el("select", "storevine-bundle__variant");
      node.setAttribute("aria-label", fill(T.optionFor || "Option for %t", { "%t": d.title }));
      avail.forEach(function (v) {
        var o = el("option", null, v.public_title || v.title); o.value = String(v.id);
        if (v.id === current.id) o.selected = true;
        node.appendChild(o);
      });
      node.addEventListener("change", function () {
        current = avail.filter(function (v) { return String(v.id) === node.value; })[0] || current;
        onChange();
      });
    }
    return { node: node, get: function () { return current; } };
  }
  function addToCart(items, bundleId, btn, label, T) {
    btn.disabled = true;
    return fetch(root + "cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items.map(function (i) { return { id: i.id, quantity: i.quantity, properties: { _storevine_bundle: bundleId } }; }) })
    }).then(function (r) {
      if (!r.ok) throw new Error();
      track(bundleId, "add");
      window.location.href = root + "cart";
    }).catch(function () { btn.disabled = false; btn.textContent = T.tryAgain || "Try again"; setTimeout(function () { btn.textContent = label; }, 3000); });
  }

  // ---------------------------------------------------------------- bought together
  function renderFixed(box, bundle, pid, T, buttonLabel) {
    var items = bundle.products.slice().sort(function (a, b) { return (b.productId === pid) - (a.productId === pid); });
    return Promise.all(items.map(function (p) { return product(p.handle).then(function (d) { return d && d.variants.some(function (v) { return v.available; }) ? { p: p, d: d } : null; }); }))
      .then(function (rows) {
        rows = rows.filter(Boolean);
        if (rows.length < 2) return false;
        // The discount needs every bundle product; if any is unavailable, don't promise it.
        var discount = rows.length === bundle.products.length ? bundle.discountPercent : 0;
        var wrap = el("section", "storevine-bundle__group");
        wrap.setAttribute("aria-label", bundle.title);
        wrap.appendChild(el("p", "storevine-bundle__title", bundle.title));
        var ul = el("ul", "storevine-bundle__list");
        var checks = [];
        rows.forEach(function (r) {
          var li = el("li", "storevine-bundle__item");
          var cb = el("input"); cb.type = "checkbox"; cb.checked = true;
          cb.setAttribute("aria-label", fill(T.include || "Include %t", { "%t": r.d.title }));
          var price = el("span", "storevine-bundle__price");
          var info = el("div", "storevine-bundle__info");
          info.appendChild(el("span", "storevine-bundle__name", r.d.title + (r.p.productId === pid ? " " + (T.thisItem || "(this item)") : "")));
          var pick = picker(r.d, r.p.variantId, T, update);
          if (pick.node) info.appendChild(pick.node);
          var img = image(r.d, pick.get());
          li.appendChild(cb); li.appendChild(img || el("span")); li.appendChild(info); li.appendChild(price);
          cb.addEventListener("change", update);
          checks.push({ cb: cb, pick: pick, price: price });
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
        var foot = el("div", "storevine-bundle__total");
        var total = el("span", "storevine-bundle__save"); total.setAttribute("aria-live", "polite");
        var btn = el("button", "storevine-bundle__btn", buttonLabel); btn.type = "button";
        foot.appendChild(total); foot.appendChild(btn); wrap.appendChild(foot);
        function update() {
          checks.forEach(function (c) { c.price.textContent = money(c.pick.get().price); });
          var sel = checks.filter(function (c) { return c.cb.checked; });
          var sum = sel.reduce(function (n, c) { return n + c.pick.get().price; }, 0);
          var all = sel.length === checks.length;
          var map = { "%p": discount, "%n": checks.length };
          if (all && discount > 0) {
            total.textContent = fill(T.total || "Total %a", { "%a": money(Math.round(sum * (100 - discount) / 100)) }) + " " + fill(T.saveWithAll || "(save %p% with all %n)", map);
          } else {
            total.textContent = fill(T.total || "Total %a", { "%a": money(sum) }) + (discount > 0 ? " " + fill(T.addAllToSave || "— add all %n to save %p%", map) : "");
          }
          btn.disabled = sel.length === 0;
        }
        update();
        btn.addEventListener("click", function () {
          var sel = checks.filter(function (c) { return c.cb.checked; });
          addToCart(sel.map(function (c) { return { id: c.pick.get().id, quantity: 1 }; }), bundle.id, btn, buttonLabel, T);
        });
        box.appendChild(wrap);
        return true;
      });
  }

  // ---------------------------------------------------------------- quantity breaks (one product)
  function renderBreaks(box, bundle, T) {
    var p = bundle.products[0];
    return product(p.handle).then(function (d) {
      if (!d || !d.variants.some(function (v) { return v.available; })) return false;
      var wrap = el("section", "storevine-bundle__group");
      var name = "storevine-breaks-" + (++uid);
      var fs = el("fieldset", "storevine-bundle__breaks");
      fs.appendChild(el("legend", "storevine-bundle__title", bundle.title));
      var options = [{ min: 1, percent: 0 }].concat(bundle.tiers);
      var chosen = options[1] || options[0];
      var pick = picker(d, p.variantId, T, update);
      var rows = options.map(function (o) {
        var label = el("label", "storevine-bundle__break");
        var radio = el("input"); radio.type = "radio"; radio.name = name; radio.value = String(o.min);
        if (o === chosen) radio.checked = true;
        radio.addEventListener("change", function () { chosen = o; update(); });
        var text = el("span", "storevine-bundle__break-text");
        text.appendChild(el("strong", null, o.min === 1 ? (T.buyOne || "Buy 1") : fill(T.buyN || "Buy %n", { "%n": o.min })));
        if (o.percent) text.appendChild(el("span", "storevine-bundle__badge", fill(T.savePercent || "Save %p%", { "%p": o.percent })));
        var each = el("span", "storevine-bundle__price");
        label.appendChild(radio); label.appendChild(text); label.appendChild(each);
        fs.appendChild(label);
        return { o: o, each: each };
      });
      wrap.appendChild(fs);
      if (pick.node) wrap.appendChild(pick.node);
      var foot = el("div", "storevine-bundle__total");
      var btn = el("button", "storevine-bundle__btn"); btn.type = "button";
      foot.appendChild(btn); wrap.appendChild(foot);
      function update() {
        var price = pick.get().price;
        rows.forEach(function (r) { r.each.textContent = fill(T.each || "%a each", { "%a": money(Math.round(price * (100 - r.o.percent) / 100)) }); });
        btn.textContent = fill(T.addN || "Add %n to cart", { "%n": chosen.min });
      }
      update();
      btn.addEventListener("click", function () {
        addToCart([{ id: pick.get().id, quantity: chosen.min }], bundle.id, btn, btn.textContent, T);
      });
      box.appendChild(wrap);
      return true;
    });
  }

  // ---------------------------------------------------------------- mix and match (several products)
  function renderMix(box, bundle, pid, T) {
    var items = bundle.products.slice().sort(function (a, b) { return (b.productId === pid) - (a.productId === pid); });
    return Promise.all(items.map(function (p) { return product(p.handle).then(function (d) { return d && d.variants.some(function (v) { return v.available; }) ? { p: p, d: d } : null; }); }))
      .then(function (list) {
        list = list.filter(Boolean);
        if (!list.length) return false;
        var wrap = el("section", "storevine-bundle__group");
        wrap.setAttribute("aria-label", bundle.title);
        wrap.appendChild(el("p", "storevine-bundle__title", bundle.title));
        var tiersText = el("p", "storevine-bundle__tiers", bundle.tiers.map(function (t) { return fill(T.buyN || "Buy %n", { "%n": t.min }) + ": " + fill(T.savePercent || "Save %p%", { "%p": t.percent }); }).join(" · "));
        wrap.appendChild(tiersText);
        var ul = el("ul", "storevine-bundle__list");
        var rows = list.map(function (r) {
          var li = el("li", "storevine-bundle__item storevine-bundle__item--mix");
          var info = el("div", "storevine-bundle__info");
          info.appendChild(el("span", "storevine-bundle__name", r.d.title));
          var pick = picker(r.d, r.p.variantId, T, update);
          if (pick.node) info.appendChild(pick.node);
          var price = el("span", "storevine-bundle__price");
          info.appendChild(price);
          var qty = el("input", "storevine-bundle__qty"); qty.type = "number"; qty.min = "0"; qty.max = "99"; qty.inputMode = "numeric";
          qty.value = r.p.productId === pid ? "1" : "0";
          qty.setAttribute("aria-label", fill(T.quantityFor || "Quantity for %t", { "%t": r.d.title }));
          qty.addEventListener("input", update);
          li.appendChild(image(r.d, pick.get()) || el("span")); li.appendChild(info); li.appendChild(qty);
          ul.appendChild(li);
          return { pick: pick, qty: qty, price: price };
        });
        wrap.appendChild(ul);
        var foot = el("div", "storevine-bundle__total");
        var status = el("span", "storevine-bundle__save"); status.setAttribute("aria-live", "polite");
        var label = T.addToCart || "Add to cart";
        var btn = el("button", "storevine-bundle__btn", label); btn.type = "button";
        foot.appendChild(status); foot.appendChild(btn); wrap.appendChild(foot);
        function count() { return rows.reduce(function (n, r) { return n + Math.max(0, Math.min(99, Math.floor(Number(r.qty.value) || 0))); }, 0); }
        function update() {
          rows.forEach(function (r) { r.price.textContent = money(r.pick.get().price); });
          var n = count();
          var reached = bundle.tiers.filter(function (t) { return n >= t.min; }).pop();
          var next = bundle.tiers.filter(function (t) { return n < t.min; })[0];
          var parts = [];
          if (reached) parts.push(fill(T.reached || "You're saving %p% on these items", { "%p": reached.percent }));
          if (next) parts.push(fill(T.progress || "Add %n more to save %p%", { "%n": next.min - n, "%p": next.percent }));
          status.textContent = parts.join(" · ");
          btn.disabled = n === 0;
        }
        update();
        btn.addEventListener("click", function () {
          var items = rows
            .map(function (r) { return { id: r.pick.get().id, quantity: Math.max(0, Math.min(99, Math.floor(Number(r.qty.value) || 0))) }; })
            .filter(function (i) { return i.quantity > 0; });
          if (items.length) addToCart(items, bundle.id, btn, label, T);
        });
        box.appendChild(wrap);
        return true;
      });
  }

  function init(box) {
    if (box.__storevine) return;
    box.__storevine = true;
    var parent = box.parentElement;
    var cfgEl = parent && parent.querySelector("[data-storevine-bundles-config]");
    if (!cfgEl) return;
    var cfg, T = {};
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
    try {
      var raw = JSON.parse(parent.querySelector("[data-storevine-bundle-strings]").textContent);
      Object.keys(raw).forEach(function (k) { T[k] = decode(raw[k]); });
    } catch (e) {}
    var pid = Number(box.getAttribute("data-product-id"));
    var buttonLabel = box.getAttribute("data-button") || "Add selected to cart";
    var matches = (cfg.bundles || []).filter(function (b) {
      return b.products.some(function (p) { return p.productId === pid; });
    }).slice(0, 2);
    // Render in order so the page layout is stable.
    matches.reduce(function (chain, b) {
      return chain.then(function () {
        var shown;
        if (b.type === "volume") shown = b.products.length === 1 ? renderBreaks(box, b, T) : renderMix(box, b, pid, T);
        else shown = renderFixed(box, b, pid, T, buttonLabel);
        return shown.then(function (ok) { if (ok) track(b.id, "impression"); });
      });
    }, Promise.resolve());
  }
  function scan() { document.querySelectorAll("[data-storevine-bundle]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  document.addEventListener("shopify:section:load", scan);
})();
