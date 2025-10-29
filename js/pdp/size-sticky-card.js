(() => {
  var DESKTOP_BP = 1025;
  var SIDEBAR_SEL = '.ec-store .product-details__sidebar';
  var GALLERY_SEL = '.ec-store .product-details__gallery';

  const raf = (fn) => requestAnimationFrame(fn);
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  function sizeCard() {
    const card = document.querySelector(SIDEBAR_SEL);
    const gal  = document.querySelector(GALLERY_SEL);
    if (!card || !gal) return;

    if (window.innerWidth < DESKTOP_BP) {
      card.style.height = '';
      card.style.maxHeight = '';
      card.style.overflowY = '';
      card.style.webkitOverflowScrolling = '';
      card.style.overscrollBehavior = '';
      return;
    }

    const gH = Math.max(gal.offsetHeight || 0, (gal.getBoundingClientRect?.().height) || 0);
    const viewportCap = Math.max(320, window.innerHeight - 24);
    const cap = Math.max(320, Math.min(viewportCap, gH));

    // Reserve space equal to cap so the sidebar NEVER overlaps description
    card.style.height = cap + 'px';
    card.style.maxHeight = cap + 'px';
    card.style.overflowY = 'auto';            // INNER SCROLL
    card.style.webkitOverflowScrolling = 'touch';
    card.style.overscrollBehavior = 'contain';
  }

  function whenPdpReady(cb, tries) {
    tries = tries || 0;
    const card = document.querySelector(SIDEBAR_SEL);
    const gal  = document.querySelector(GALLERY_SEL);
    if (card && gal) return cb();
    if (tries > 120) return; // ~6s guard
    setTimeout(() => whenPdpReady(cb, tries + 1), 50);
  }

  let ro;
  function hookGalleryObserver() {
    const gal = document.querySelector(GALLERY_SEL);
    if (!gal || !window.ResizeObserver) return;
    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => raf(sizeCard));
    ro.observe(gal);
  }

  function initOnce() {
    whenPdpReady(() => {
      hookGalleryObserver();
      raf(sizeCard);
      setTimeout(sizeCard, 250);   // async image load
      setTimeout(sizeCard, 1000);  // late injections
    });
  }

  const debouncedSize = debounce(() => raf(sizeCard), 50);
  window.addEventListener('resize', debouncedSize);
  window.addEventListener('orientationchange', debouncedSize);

  // Ecwid lifecycle
  if (window.Ecwid) {
    Ecwid.OnAPILoaded && Ecwid.OnAPILoaded.add(initOnce);
    Ecwid.OnPageLoaded && Ecwid.OnPageLoaded.add((page) => {
      const t = page && (page.type || page.pageType);
      if (String(t).toUpperCase() === 'PRODUCT') initOnce();
    });
  }

  // Fallback: DOM watcher
  const mo = new MutationObserver(() => {
    if (document.querySelector(SIDEBAR_SEL) && document.querySelector(GALLERY_SEL)) initOnce();
  });
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

  // First load
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initOnce);
  else initOnce();
})();

