/* Fills the tour page's rating placeholder (spec 0005, AC-6). Plain script, no
   build step. Fails silently: the placeholder stays empty. */
(function () {
  try {
    var nodes = document.querySelectorAll("[data-tour-rating]:not([data-tour-rating-done])");
    Array.prototype.forEach.call(nodes, function (el) {
      var id = el.getAttribute("data-tour-rating");
      el.setAttribute("data-tour-rating-done", "");
      if (!id) return;
      fetch("/protected/tours/" + encodeURIComponent(id) + "/rating.json", {
        headers: { accept: "application/json" },
      })
        .then(function (res) {
          return res.status === 200 ? res.json() : null;
        })
        .then(function (d) {
          if (!d || typeof d.ratingAvg !== "number" || !isFinite(d.ratingAvg) || !(d.ratingCount > 0)) return;
          el.textContent =
            "★ " + d.ratingAvg.toFixed(1) + " (" + d.ratingCount.toLocaleString("en-US") + ")";
        })
        .catch(function () {});
    });
  } catch {}
})();
