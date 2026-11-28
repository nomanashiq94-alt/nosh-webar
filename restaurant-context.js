(function () {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("restaurant") || "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { window.NOSH_RESTAURANT = {slug:null}; return; }
  window.NOSH_RESTAURANT = {slug};
})();
