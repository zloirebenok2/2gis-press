// 2пшы: переключатель стран, копирование ссылок, системное меню «Поделиться», цели Метрики.
(function () {
  var goal = function (name) { try { if (window.ym) window.ym(113834141, 'reachGoal', name); } catch (e) {} };

  document.querySelectorAll('[data-switch]').forEach(function (box) {
    var tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
    var show = function (i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j, panel = document.getElementById(t.getAttribute('aria-controls'));
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        if (panel) { panel.removeAttribute('data-hide'); panel.hidden = !on; }
      });
      if (focus) tabs[i].focus();
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(i); goal('world_tab'); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, n = tabs.length;
        if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); show((i + 1) % n, true); }
        if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); show((i - 1 + n) % n, true); }
      });
    });
    show(0);
  });

  var note = function (el, text) {
    var box = el.closest('[data-share]'); var out = box && box.querySelector('.share__note');
    if (out) { out.textContent = text; return; }
    var old = el.textContent; el.textContent = text; setTimeout(function () { el.textContent = old; }, 1600);
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (b) {
      var url = b.getAttribute('data-copy');
      var done = function () { note(b, 'Ссылка скопирована'); goal('share_copy'); };
      var fallback = function () { window.prompt ? window.prompt('Скопируйте ссылку', url) : null; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
      return;
    }
    var g = e.target.closest('[data-goal]');
    if (g) goal(g.getAttribute('data-goal'));
  });

  document.querySelectorAll('[data-share]').forEach(function (box) {
    var btn = box.querySelector('[data-native]');
    if (!btn || !navigator.share) return;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      navigator.share({ title: box.getAttribute('data-title'), url: box.getAttribute('data-url') }).then(function () { goal('share_native'); }, function () {});
    });
  });

  // Фото-слоты: убрать картинку, если она не загрузилась (останется подложка листа)
  document.querySelectorAll('[data-slot] img').forEach(function (i) {
    if (i.complete && !i.naturalWidth) i.remove(); else i.addEventListener('error', function () { i.remove(); }, { once: true });
  });
})();
