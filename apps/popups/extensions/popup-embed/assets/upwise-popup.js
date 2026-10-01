/* Upwise Pop-ups storefront script. */
(function () {
  if (window.__upwisePopup) return;
  window.__upwisePopup = true;
  var cfgEl = document.getElementById("upwise-popup-config");
  if (!cfgEl) return;
  var c;
  try { c = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  if (!c || !c.enabled) return;
  if (window.Shopify && window.Shopify.designMode) return; // not in theme editor

  var KEY = "upwise_popup_until";
  try {
    var until = Number(localStorage.getItem(KEY) || 0);
    if (until && Date.now() < until) return;
  } catch (e) {}
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var API = root + "apps/upwise-popups/";

  function snooze() {
    try {
      if (c.frequencyDays > 0) localStorage.setItem(KEY, String(Date.now() + c.frequencyDays * 86400000));
    } catch (e) {}
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var shown = false, lastFocus = null, overlay;
  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    snooze();
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "Tab" && overlay) {
      var f = overlay.querySelectorAll("button, input, a[href]");
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function show() {
    if (shown) return;
    shown = true;
    lastFocus = document.activeElement;
    overlay = el("div", "upwise-popup");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "upwise-popup-title");
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    var card = el("div", "upwise-popup__card");
    var x = el("button", "upwise-popup__close", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    var title = el("p", "upwise-popup__title", c.headline);
    title.id = "upwise-popup-title";
    card.appendChild(x);
    card.appendChild(title);
    if (c.body) card.appendChild(el("p", "upwise-popup__body", c.body));

    var form = el("form", "upwise-popup__form");
    form.noValidate = true;
    var input = el("input", "upwise-popup__input");
    input.type = "email"; input.name = "email"; input.required = true; input.autocomplete = "email";
    input.placeholder = "Email address"; input.setAttribute("aria-label", "Email address");
    var hp = el("input", "upwise-popup__hp");
    hp.name = "website"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true");
    var btn = el("button", "upwise-popup__btn", c.buttonLabel);
    btn.type = "submit";
    btn.style.background = c.accentColor || "#111";
    var consent = el("label", "upwise-popup__consent");
    var box = el("input");
    box.type = "checkbox"; box.name = "consent"; box.required = true;
    consent.appendChild(box);
    consent.appendChild(el("span", null, c.consentText));
    var msg = el("p", "upwise-popup__msg");
    msg.setAttribute("role", "status");
    form.appendChild(input); form.appendChild(hp); form.appendChild(btn); form.appendChild(consent); form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!box.checked) { msg.textContent = "Please tick the box to agree to receive emails."; box.focus(); return; }
      if (!input.value || input.value.indexOf("@") < 1) { msg.textContent = "Enter a valid email address."; input.focus(); return; }
      btn.disabled = true;
      msg.textContent = "";
      fetch(API + "subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: input.value, consent: true, website: hp.value })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) {
          try { localStorage.setItem(KEY, String(Date.now() + 365 * 86400000)); } catch (e) {}
          form.replaceChildren(el("p", "upwise-popup__body", c.successMessage));
          if (d.discountCode) form.appendChild(el("span", "upwise-popup__code", d.discountCode));
        } else {
          btn.disabled = false;
          msg.textContent = (d && d.error) || "Something went wrong. Please try again.";
        }
      }).catch(function () { btn.disabled = false; msg.textContent = "Something went wrong. Please try again."; });
    });
    card.appendChild(form);
    if (c.branding) card.appendChild(el("span", "upwise-popup__brand", "Powered by Upwise"));
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    input.focus();
    try { fetch(API + "events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "impression" }) }).catch(function () {}); } catch (e) {}
  }

  if (c.trigger === "exit") {
    document.addEventListener("mouseout", function (e) { if (!e.relatedTarget && e.clientY <= 0) show(); });
    // Touch devices have no exit intent; fall back to a longer delay.
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) setTimeout(show, 20000);
  } else if (c.trigger === "scroll") {
    var onScroll = function () {
      var h = document.documentElement;
      var pct = ((h.scrollTop || document.body.scrollTop) / Math.max(1, h.scrollHeight - h.clientHeight)) * 100;
      if (pct >= c.scrollPercent) { window.removeEventListener("scroll", onScroll); show(); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  } else {
    setTimeout(show, Math.max(0, c.delaySeconds) * 1000);
  }
})();
