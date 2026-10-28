(function () {
  const cfg = window.NOCK_PWA || {};
  const client = (cfg.adsenseClient || "").trim();
  if (!client) return;

  const slot = document.createElement("ins");
  slot.className = "adsbygoogle";
  slot.style.display = "block";
  slot.dataset.adClient = client;
  slot.dataset.adSlot = cfg.adsenseSlot || "";
  slot.dataset.adFormat = "auto";
  slot.dataset.fullWidthResponsive = "true";

  const bar = document.createElement("div");
  bar.id = "nock-ad-bar";
  bar.appendChild(slot);
  document.body.appendChild(bar);
  document.body.classList.add("has-ads");

  const run = () => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (_) {}
  };
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) {
    run();
    return;
  }
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
  s.crossOrigin = "anonymous";
  s.onload = run;
  document.head.appendChild(s);
})();
