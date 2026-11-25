(function () {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("restaurant") || "nosh-webar").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Invalid restaurant URL");
  window.NOSH_RESTAURANT = {slug};
})();
