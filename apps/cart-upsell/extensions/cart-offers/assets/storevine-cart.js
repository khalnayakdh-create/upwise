/* Storevine Cart Upsell storefront widget. No dependencies; loaded deferred by Shopify. */
(function () {
  if (window.__storevineCartLoaded) return;
  window.__storevineCartLoaded = true;

  var cfgEl = document.getElementById("storevine-cart-config") || document.querySelector("[data-storevine-cart-config]");
  if (!cfgEl) return;
  var cfg;
  try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  if (!cfg || !cfg.offers || !cfg.offers.length) return;

  var S = (window.StorevineCart && window.StorevineCart.settings) || {};
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var EVENTS_URL = root + "apps/storevine-cart/events";
  var MAX = Math.min(3, Math.max(1, Number(S.maxProducts) || 3));
  var LABEL = S.buttonLabel || "Add";
  var DRAWER = ["cart-drawer .drawer__footer", "#CartDrawer .drawer__footer", ".cart-drawer__footer", "#cart-drawer .cart-drawer__footer", ".drawer--cart .drawer__footer"];
  var PAGE = [".cart__footer", ".cart-footer", "#main-cart-footer", "form[action$='/cart'] .cart__blocks"];
  var isCartPage = /\/cart\/?$/.test(location.pathname);

  /* ---------- analytics (aggregated counts only) ---------- */
  var queue = [], seen = {}, timer;
  function flush() {
    if (!queue.length) return;
    var body = JSON.stringify({ events: queue.splice(0, 25) });
    try { fetch(EVENTS_URL, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function () {}); } catch (e) {}
  }
  function track(offerId, type) {
    queue.push({ offerId: offerId, type: type });
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }
  addEventListener("pagehide", flush);

  /* ---------- data ---------- */
  var productCache = {};
  function getProduct(handle) {
    if (!productCache[handle]) {
      productCache[handle] = fetch(root + "products/" + encodeURIComponent(handle) + ".js")
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return productCache[handle];
  }
  function getCart() {
    return fetch(root + "cart.js", { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); });
  }
  function match(cart) {
    var inCart = {};
    cart.items.forEach(function (i) { inCart[i.product_id] = 1; });
    if (!cart.items.length) return null;
    for (var i = 0; i < cfg.offers.length; i++) {
      var o = cfg.offers[i];
      if (o.trigger === "products" && !o.triggerProductIds.some(function (id) { return inCart[id]; })) continue;
      var ps = o.products.filter(function (p) { return !inCart[p.productId]; });
      if (ps.length) return { offer: o, products: ps.slice(0, MAX) };
    }
    return null;
  }

  /* ---------- placement ---------- */
  function slotBefore(target, kind) {
    var parent = target.parentElement;
    if (!parent) return null;
    var existing = parent.querySelector(":scope > .storevine-cart[data-storevine-cart-offers='" + kind + "']");
    if (existing) return existing;
    var c = document.createElement("div");
    c.className = "storevine-cart";
    c.setAttribute("data-storevine-cart-offers", kind);
    parent.insertBefore(c, target);
    return c;
  }
  function first(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }
  function containers() {
    var hasBlock = !!document.querySelector("[data-storevine-cart-offers='block']");
    if (S.drawer !== false) { var d = first(DRAWER); if (d) slotBefore(d, "drawer"); }
    if (S.cartPage !== false && isCartPage && !hasBlock) { var p = first(PAGE); if (p) slotBefore(p, "page"); }
    return Array.prototype.slice.call(document.querySelectorAll("[data-storevine-cart-offers]"));
  }

  /* ---------- rendering ---------- */
  function money(cents, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, { style: "currency", currency: currency }).format(cents / 100);
    } catch (e) { return (cents / 100).toFixed(2) + " " + currency; }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function draw(c, offer, items, currency) {
    var key = offer.id + ":" + items.map(function (i) { return i.v.id; }).join(",");
    if (c.getAttribute("data-key") === key) return;
    c.setAttribute("data-key", key);
    c.replaceChildren();
    c.appendChild(el("p", "storevine-cart__title", offer.headline));
    var ul = el("ul", "storevine-cart__list");
    items.forEach(function (it) {
      var li = el("li", "storevine-cart__item");
      var img = el("img", "storevine-cart__img");
      img.alt = "";
      img.loading = "lazy";
      img.width = 48;
      img.height = 48;
      var src = (it.v.featured_image && it.v.featured_image.src) || it.d.featured_image;
      if (src) img.src = src + (src.indexOf("?") > -1 ? "&" : "?") + "width=96";
      var info = el("div");
      var name = it.d.title + (it.d.variants.length > 1 && it.v.title ? " – " + it.v.title : "");
      info.appendChild(el("p", "storevine-cart__name", name));
      var pct = Number(offer.discountPercent) || 0;
      var priceP = el("p", "storevine-cart__price");
      if (pct > 0) {
        var was = el("s", "storevine-cart__was", money(it.v.price, currency));
        priceP.appendChild(was);
        priceP.appendChild(document.createTextNode(" " + money(Math.round(it.v.price * (100 - pct) / 100), currency) + " "));
        priceP.appendChild(el("span", "storevine-cart__badge", pct + "% off"));
      } else {
        priceP.textContent = money(it.v.price, currency);
      }
      info.appendChild(priceP);
      var btn = el("button", "storevine-cart__btn", LABEL);
      btn.type = "button";
      btn.setAttribute("aria-label", LABEL + " " + name);
      btn.addEventListener("click", function () { add(it.v.id, offer.id, btn); });
      li.appendChild(img); li.appendChild(info); li.appendChild(btn);
      ul.appendChild(li);
    });
    c.appendChild(ul);
  }
  var busy = false, again = false;
  function render() {
    if (busy) { again = true; return; }
    busy = true;
    getCart().then(function (cart) {
      var m = match(cart);
      var cs = containers();
      if (!m) { cs.forEach(function (c) { c.replaceChildren(); c.removeAttribute("data-key"); }); return; }
      return Promise.all(m.products.map(function (p) {
        return getProduct(p.handle).then(function (d) {
          if (!d) return null;
          var v = d.variants.filter(function (x) { return x.id === p.variantId && x.available; })[0] ||
                  d.variants.filter(function (x) { return x.available; })[0];
          return v ? { d: d, v: v } : null;
        });
      })).then(function (items) {
        items = items.filter(Boolean);
        if (!items.length) { cs.forEach(function (c) { c.replaceChildren(); }); return; }
        cs.forEach(function (c) { draw(c, m.offer, items, cart.currency); });
        if (cs.length && !seen[m.offer.id]) { seen[m.offer.id] = 1; track(m.offer.id, "impression"); }
      });
    }).catch(function () {}).then(function () {
      busy = false;
      if (again) { again = false; render(); }
    });
  }

  /* ---------- add to cart ---------- */
  function add(variantId, offerId, btn) {
    track(offerId, "click");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    var drawer = document.querySelector("cart-drawer");
    var sections = drawer && typeof drawer.renderContents === "function" && typeof drawer.getSectionsToRender === "function"
      ? drawer.getSectionsToRender().map(function (s) { return s.id; }) : [];
    fetch(root + "cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: variantId, quantity: 1, properties: { _storevine_offer: offerId }, sections: sections, sections_url: location.pathname })
    }).then(function (r) {
      if (!r.ok) throw new Error("add failed");
      return r.json();
    }).then(function (data) {
      track(offerId, "add");
      flush();
      if (isCartPage) { location.reload(); return; }
      if (sections.length) {
        drawer.classList.remove("is-empty");
        drawer.renderContents(data);
      }
      document.dispatchEvent(new CustomEvent("storevine:cart:added", { detail: data }));
      document.documentElement.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
      setTimeout(render, 300);
    }).catch(function () {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = "Try again";
    });
  }

  /* ---------- keep in sync with theme cart updates ---------- */
  var nativeFetch = window.fetch;
  window.fetch = function (input) {
    var p = nativeFetch.apply(this, arguments);
    try {
      var url = String((input && input.url) || input);
      if (/\/cart\/(add|change|update|clear)/.test(url) && url.indexOf("apps/storevine") === -1) {
        p.then(function () { setTimeout(render, 250); }, function () {});
      }
    } catch (e) {}
    return p;
  };
  var moTimer;
  new MutationObserver(function () {
    clearTimeout(moTimer);
    moTimer = setTimeout(function () {
      var d = S.drawer !== false && first(DRAWER);
      if (d && !(d.previousElementSibling && d.previousElementSibling.matches(".storevine-cart[data-storevine-cart-offers='drawer']"))) render();
    }, 200);
  }).observe(document.body, { childList: true, subtree: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
