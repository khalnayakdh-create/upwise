/* Storevine Reviews storefront widget. */
(function () {
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var API = root + "apps/storevine-reviews/reviews";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function stars(n) {
    var s = el("span", "storevine-stars");
    s.style.setProperty("--rating", n);
    s.setAttribute("aria-label", n + " out of 5 stars");
    s.setAttribute("role", "img");
    return s;
  }

  function init(box) {
    if (box.__storevine) return;
    box.__storevine = true;
    box.id = box.id || "storevine-reviews";
    var productId = box.getAttribute("data-product-id");
    var list = box.querySelector("[data-storevine-list]");
    var page = 1;

    function render(data, append) {
      if (!append) list.replaceChildren();
      if (!data.reviews.length && !append) list.appendChild(el("p", "storevine-reviews__empty", "No reviews yet. Be the first to share your thoughts."));
      data.reviews.forEach(function (r) {
        var item = el("article", "storevine-review");
        item.appendChild(stars(r.rating));
        if (r.title) item.appendChild(el("p", "storevine-review__title", r.title));
        item.appendChild(el("p", "storevine-review__body", r.body));
        item.appendChild(el("p", "storevine-review__meta", r.author + " · " + new Date(r.createdAt).toLocaleDateString()));
        if (r.reply) {
          var rep = el("div", "storevine-review__reply");
          rep.appendChild(el("strong", null, "Store reply: "));
          rep.appendChild(document.createTextNode(r.reply));
          item.appendChild(rep);
        }
        list.appendChild(item);
      });
      var old = box.querySelector(".storevine-reviews__more");
      if (old) old.remove();
      if (data.hasMore) {
        var more = el("button", "storevine-reviews__more", "Show more reviews");
        more.type = "button";
        more.addEventListener("click", function () { page++; load(true); });
        list.after(more);
      }
    }
    function load(append) {
      fetch(API + "?product_id=" + encodeURIComponent(productId) + "&page=" + page, { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.reviews) render(d, append); })
        .catch(function () {});
    }
    load(false);

    if (box.getAttribute("data-allow-form") !== "false") {
      var write = el("button", "storevine-reviews__write", "Write a review");
      write.type = "button";
      write.setAttribute("aria-expanded", "false");
      box.appendChild(write);
      var form;
      write.addEventListener("click", function () {
        if (!form) { form = buildForm(); write.after(form); }
        var open = form.hidden;
        form.hidden = !open;
        write.setAttribute("aria-expanded", String(open));
        if (open) form.querySelector("input[type=radio]").focus();
      });
    }

    function buildForm() {
      var f = el("form", "storevine-form");
      f.hidden = true;
      f.noValidate = true;
      var started = Date.now();
      var fs = el("fieldset", "storevine-form__stars");
      fs.appendChild(el("legend", null, "Your rating"));
      var labels = [];
      for (var i = 1; i <= 5; i++) {
        var lab = el("label");
        var input = el("input");
        input.type = "radio"; input.name = "rating"; input.value = String(i); input.required = true;
        input.setAttribute("aria-label", i + " star" + (i > 1 ? "s" : ""));
        lab.appendChild(input);
        lab.appendChild(el("span", null, "★"));
        (function (n) {
          input.addEventListener("change", function () { labels.forEach(function (l, j) { l.classList.toggle("is-on", j < n); }); });
        })(i);
        labels.push(lab);
        fs.appendChild(lab);
      }
      f.appendChild(fs);
      function field(label, name, tag, max) {
        var l = el("label", null, label);
        var input = el(tag);
        input.name = name;
        input.maxLength = max;
        if (tag === "textarea") input.rows = 4;
        l.appendChild(input);
        f.appendChild(l);
        return input;
      }
      field("Name shown with your review", "author", "input", 60).required = true;
      field("Title (optional)", "title", "input", 120);
      field("Your review", "body", "textarea", 2000).required = true;
      var hp = el("input", "storevine-form__hp");
      hp.name = "website"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true");
      f.appendChild(hp);
      var msg = el("p", "storevine-form__msg");
      msg.setAttribute("role", "status");
      var submit = el("button", "storevine-reviews__write", "Submit review");
      submit.type = "submit";
      f.appendChild(submit);
      f.appendChild(msg);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var data = new FormData(f);
        data.append("productId", productId);
        data.append("startedAt", String(started));
        if (!data.get("rating")) { msg.textContent = "Choose a star rating."; return; }
        submit.disabled = true;
        msg.textContent = "Sending…";
        fetch(API, { method: "POST", body: data, headers: { Accept: "application/json" } })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) {
              f.replaceChildren(el("p", "storevine-form__msg", d.status === "published" ? "Thanks! Your review is live." : "Thanks! Your review will appear after a quick check."));
              if (d.status === "published") { page = 1; load(false); }
            } else {
              submit.disabled = false;
              msg.textContent = (d && d.error) || "Something went wrong. Please try again.";
            }
          })
          .catch(function () { submit.disabled = false; msg.textContent = "Something went wrong. Please try again."; });
      });
      return f;
    }
  }

  function scan() { document.querySelectorAll("[data-storevine-reviews]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  document.addEventListener("shopify:section:load", scan);
})();
