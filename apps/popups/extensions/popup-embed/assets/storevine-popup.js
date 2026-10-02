/* Storevine Pop-ups storefront script. */
(function () {
  if (window.__storevinePopup) return;
  window.__storevinePopup = true;
  var cfgEl = document.getElementById("storevine-popup-config");
  if (!cfgEl) return;
  var c;
  try { c = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  if (!c || !c.enabled) return;
  if (window.Shopify && window.Shopify.designMode) return; // not in theme editor
  var T = {};
  try {
    var raw = JSON.parse(document.getElementById("storevine-popup-strings").textContent);
    var ta = document.createElement("textarea");
    Object.keys(raw).forEach(function (k) { ta.innerHTML = String(raw[k]); T[k] = ta.value; });
  } catch (e) {}
  /** Black or white text, whichever reads better on the merchant's button colour (WCAG contrast). */
  function textOn(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return "#fff";
    var n = parseInt(m[1], 16);
    var lin = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#111" : "#fff";
  }

  var KEY = "storevine_popup_until";
  try {
    var until = Number(localStorage.getItem(KEY) || 0);
    if (until && Date.now() < until) return;
  } catch (e) {}
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var API = root + "apps/storevine-popups/";

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
    overlay = el("div", "storevine-popup");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "storevine-popup-title");
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    var card = el("div", "storevine-popup__card");
    var x = el("button", "storevine-popup__close", "×");
    x.type = "button";
    x.setAttribute("aria-label", T.close || "Close");
    x.addEventListener("click", close);
    var title = el("p", "storevine-popup__title", c.headline);
    title.id = "storevine-popup-title";
    card.appendChild(x);
    card.appendChild(title);
    if (c.body) card.appendChild(el("p", "storevine-popup__body", c.body));

    var form = el("form", "storevine-popup__form");
    form.noValidate = true;
    var input = el("input", "storevine-popup__input");
    input.type = "email"; input.name = "email"; input.required = true; input.autocomplete = "email";
    input.id = "storevine-popup-email";
    input.placeholder = T.emailLabel || "Email address";
    var emailLabel = el("label", "storevine-popup__sr", T.emailLabel || "Email address");
    emailLabel.htmlFor = input.id;
    var hp = el("input", "storevine-popup__hp");
    hp.name = "website"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true");
    var btn = el("button", "storevine-popup__btn", c.buttonLabel);
    btn.type = "submit";
    btn.style.background = c.accentColor || "#111";
    btn.style.color = textOn(c.accentColor || "#111");
    var consent = el("label", "storevine-popup__consent");
    var box = el("input");
    box.type = "checkbox"; box.name = "consent"; box.required = true;
    consent.appendChild(box);
    consent.appendChild(el("span", null, c.consentText));
    var msg = el("p", "storevine-popup__msg");
    msg.id = "storevine-popup-msg";
    msg.setAttribute("role", "status");
    input.setAttribute("aria-describedby", msg.id);
    form.appendChild(emailLabel);
    form.appendChild(input); form.appendChild(hp); form.appendChild(btn); form.appendChild(consent); form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      input.removeAttribute("aria-invalid");
      if (!input.value || input.value.indexOf("@") < 1) { input.setAttribute("aria-invalid", "true"); msg.textContent = T.invalidEmail || "Enter a valid email address."; input.focus(); return; }
      if (!box.checked) { msg.textContent = T.consentRequired || "Please tick the box to agree to receive emails."; box.focus(); return; }
      btn.disabled = true;
      msg.textContent = "";
      fetch(API + "subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: input.value, consent: true, website: hp.value })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) {
          try { localStorage.setItem(KEY, String(Date.now() + 365 * 86400000)); } catch (e) {}
          form.replaceChildren(el("p", "storevine-popup__body", c.successMessage));
          if (d.discountCode) {
            var code = el("span", "storevine-popup__code", d.discountCode);
            code.setAttribute("aria-label", (T.codeLabel || "Your discount code") + ": " + d.discountCode);
            form.appendChild(code);
          }
        } else {
          btn.disabled = false;
          msg.textContent = (d && d.error) || T.error || "Something went wrong. Please try again.";
        }
      }).catch(function () { btn.disabled = false; msg.textContent = T.error || "Something went wrong. Please try again."; });
    });
    card.appendChild(form);
    if (c.branding) card.appendChild(el("span", "storevine-popup__brand", T.poweredBy || "Powered by Storevine"));
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
