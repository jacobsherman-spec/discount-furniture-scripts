(() => {
  function playVideo() {
    const v = document.querySelector('.springair-product video');
    if (v && v.paused) {
      v.muted = true;
      v.play().catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', playVideo);

  if (window.Ecwid) {
    Ecwid.OnAPILoaded && Ecwid.OnAPILoaded.add(playVideo);
    Ecwid.OnPageLoaded && Ecwid.OnPageLoaded.add(function(page){
      var t = page && (page.type || page.pageType);
      if (t && String(t).toUpperCase() === 'PRODUCT') playVideo();
    });
  }

  const mo = new MutationObserver(() => {
    if (document.querySelector('.springair-product video')) {
      playVideo();
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList:true, subtree:true });
})();
