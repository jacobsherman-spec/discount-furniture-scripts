(() => {
  var DESKTOP_BP = 1025;
  var SIDEBAR_SEL = '.ec-store .product-details__sidebar';
  var GALLERY_SEL = '.ec-store .product-details__gallery';

  function raf(fn){ return requestAnimationFrame(fn); }
  function debounce(fn, ms){ var t; return function(){ clearTimeout(t); t=setTimeout(fn, ms); }; }

  function sizeCard() {
    var card = document.querySelector(SIDEBAR_SEL);
    var gal  = document.querySelector(GALLERY_SEL);
    if (!card || !gal) return;

    if (window.innerWidth < DESKTOP_BP) {
      card.style.maxHeight = '';
      card.style.overflowY = '';
      card.style.overscrollBehavior = '';
      return;
    }

    var gH = Math.max(gal.offsetHeight || 0, (gal.getBoundingClientRect && gal.getBoundingClientRect().height) || 0);
    var viewportCap = Math.max(320, window.innerHeight - 24);
    var cap = Math.max(320, Math.min(viewportCap, gH));

    card.style.maxHeight = cap + 'px';
    card.style.overflowY = 'auto';
    card.style.webkitOverflowScrolling = 'touch';
    card.style.overscrollBehavior = 'contain';
  }

  function whenPdpReady(cb, tries){
    tries = tries || 0;
    var card = document.querySelector(SIDEBAR_SEL);
    var gal  = document.querySelector(GALLERY_SEL);
    if (card && gal) return cb();
    if (tries > 100) return;
    setTimeout(function(){ whenPdpReady(cb, tries+1); }, 50);
  }

  var ro;
  function hookGalleryObserver(){
    var gal = document.querySelector(GALLERY_SEL);
    if (!gal || !window.ResizeObserver) return;
    if (ro) ro.disconnect();
    ro = new ResizeObserver(function(){ raf(sizeCard); });
    ro.observe(gal);
  }

  function initOnce() {
    whenPdpReady(function(){
      hookGalleryObserver();
      raf(sizeCard);
      setTimeout(sizeCard, 250);
      setTimeout(sizeCard, 1000);
    });
  }

  var debouncedSize = debounce(function(){ raf(sizeCard); }, 50);
  window.addEventListener('resize', debouncedSize);
  window.addEventListener('orientationchange', debouncedSize);

  function onProductPageLoaded(page){
    var t = page && (page.type || page.pageType); // Ecwid sometimes uses uppercase
    if (t && String(t).toUpperCase() === 'PRODUCT') initOnce();
  }

  if (window.Ecwid) {
    Ecwid.OnAPILoaded && Ecwid.OnAPILoaded.add(function(){ initOnce(); });
    Ecwid.OnPageLoaded && Ecwid.OnPageLoaded.add(onProductPageLoaded);
  }

  var mo = new MutationObserver(function(){
    if (document.querySelector(SIDEBAR_SEL) && document.querySelector(GALLERY_SEL)) {
      initOnce();
    }
  });
  mo.observe(document.documentElement || document.body, { childList:true, subtree:true });

  if (document.readyState === 'loading') document.addEventListener(
