#!/usr/bin/env node
// Собирает готовый сайт из public/ в один самодостаточный файл public/2pshy.html:
// стили, скрипты, шрифты и логотип встроены, страницы новостей, выпусков и рубрик
// становятся разделами файла с адресами вида #n-<код>, #day-ГГГГ-ММ-ДД, #r-<рубрика>.
//   node scripts/single.mjs            после node scripts/build.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, process.env.OUT_DIR || 'public');
const OUT = path.join(PUB, process.env.SINGLE_NAME || '2pshy.html');
const read = (p) => fs.readFile(path.join(PUB, p), 'utf8');
const b64 = async (p) => (await fs.readFile(path.join(PUB, p))).toString('base64');

const mainOf = (html) => (html.match(/<main id="main">([\s\S]*?)<\/main>/) || [])[1] || '';
const titleOf = (html) => (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
const descOf = (html) => (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';

const SITE = (process.env.SITE_URL || 'https://2gis.press').replace(/\/$/, '');
const enc = (s) => encodeURIComponent(s);

function routeOf(p) { // путь страницы -> имя раздела
  let m;
  if ((m = p.match(/^\/n\/([^/]+)\/$/))) return 'n-' + m[1];
  if ((m = p.match(/^\/day\/([^/]+)\/$/))) return 'day-' + m[1];
  if ((m = p.match(/^\/r\/([^/]+)\/$/))) return 'r-' + m[1];
  if ((m = p.match(/^\/gid\/([^/]+)\/$/))) return 'gid-' + m[1];
  return null;
}
function rewrite(html) {
  // абсолютные ссылки на страницы сайта, обычные и закодированные (в кнопках «Поделиться»)
  html = html.replace(new RegExp(SITE.replace(/[.]/g, '\\.') + '(/(?:n|day|r|gid)/[^/"&\\s]+/)', 'g'), (all, p) => SITE + '/#' + routeOf(p));
  html = html.replace(new RegExp(enc(SITE).replace(/[.%]/g, (c) => (c === '.' ? '\\.' : c)) + '((?:%2F(?:n|day|r|gid)%2F)[^%"&]+%2F)', 'g'), (all, p) => enc(SITE + '/#' + routeOf(decodeURIComponent(p))));
  // относительные ссылки
  html = html.replace(/href="(\/(?:n|day|r|gid)\/[^"]+\/)"/g, (all, p) => `href="#${routeOf(p)}"`);
  html = html.replace(/href="\/#([^"]+)"/g, 'href="#$1"').replace(/href="\/"/g, 'href="#"');
  html = html.replace(/href="\/llms\.txt"/g, `href="${SITE}/llms.txt"`);
  html = html.replace(/href="\/rss\.xml"/g, `href="${SITE}/rss.xml"`).replace(/href="\/sitemap\.xml"/g, `href="${SITE}/sitemap.xml"`);
  return html;
}
function scopeIds(html, view) { // уникальные id внутри каждого раздела
  return html.replace(/\b(id|aria-labelledby|aria-controls)="(h-[^"]+|t-\d+|p-\d+)"/g, (all, a, v) => `${a}="${view}--${v}"`);
}
const stripTickets = (html) => html.replace(/<section class="tickets[\s\S]*?<\/section>/g, '');

async function listDirs(rel) { try { return (await fs.readdir(path.join(PUB, rel), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } }

async function main() {
  let home = await read('index.html');

  // ---- разделы: новости, выпуски, рубрики
  const views = [];
  for (const [dir, prefix] of [['n', 'n-'], ['day', 'day-'], ['r', 'r-'], ['gid', 'gid-']]) {
    for (const name of await listDirs(dir)) {
      const html = await read(`${dir}/${name}/index.html`);
      const view = prefix + name;
      const body = scopeIds(stripTickets(mainOf(html)), view);
      views.push(`<div class="view" data-view="${view}" data-title="${titleOf(html)}" data-desc="${descOf(html)}" hidden>${body}\n<div class="container view__back"><a class="btn" href="#">К выпуску дня</a> <a class="btn" href="#bilety">Билеты</a></div></div>`);
    }
  }
  const homeMain = mainOf(home);
  home = home.replace(/<main id="main">[\s\S]*?<\/main>/, () => `<main id="main">\n<div class="view" data-view="home">${homeMain}</div>\n${views.join('\n')}\n</main>`);

  // ---- стили со встроенными шрифтами
  let css = await read('assets/site.css');
  for (const m of [...new Set(css.match(/\/assets\/fonts\/[a-z0-9-]+\.woff2/g) || [])]) css = css.split(m).join(`data:font/woff2;base64,${await b64(m.slice(1))}`);
  css += '\n.view__back { display: flex; flex-wrap: wrap; gap: var(--space-md); padding-top: var(--space-xl); }\n';
  home = home.replace(/<link rel="preload"[^>]*>\n?/g, '');
  home = home.replace(/<link rel="stylesheet" href="\/assets\/site\.css[^"]*">/, () => `<style>\n${css}\n</style>`);

  // ---- логотипы и иконки
  const logo = `data:image/svg+xml;base64,${await b64('assets/logo.svg')}`;
  const logoW = `data:image/svg+xml;base64,${await b64('assets/logo-white.svg')}`;
  home = home.split('src="/assets/logo.svg"').join(`src="${logo}"`).split('src="/assets/logo-white.svg"').join(`src="${logoW}"`);
  home = home.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${await b64('favicon.svg')}"`);
  home = home.replace('href="/assets/apple-touch-icon.png"', `href="data:image/png;base64,${await b64('assets/apple-touch-icon.png')}"`);
  home = home.replace('href="/rss.xml"', `href="${SITE}/rss.xml"`);

  // ---- скрипты
  const js = await read('assets/site.js');
  const router = `
// Разделы внутри одного файла: #n-..., #day-..., #r-...; всё остальное ведёт на главную.
(function () {
  var views = document.querySelectorAll('[data-view]');
  var baseTitle = document.title, metaDesc = document.querySelector('meta[name="description"]'), baseDesc = metaDesc && metaDesc.content;
  var current = 'home';
  function route() {
    var id = decodeURIComponent(location.hash.slice(1));
    var target = /^(n|day|r|gid)-/.test(id) && document.querySelector('[data-view="' + id + '"]') ? id : 'home';
    var changed = target !== current;
    views.forEach(function (v) { v.hidden = v.getAttribute('data-view') !== target; });
    var v = document.querySelector('[data-view="' + target + '"]');
    document.title = target === 'home' ? baseTitle : v.getAttribute('data-title');
    if (metaDesc) metaDesc.content = target === 'home' ? baseDesc : v.getAttribute('data-desc');
    if (target === 'home') {
      var anchor = id && document.getElementById(id);
      if (anchor) anchor.scrollIntoView(); else if (changed || !id) window.scrollTo(0, 0);
    } else { window.scrollTo(0, 0); var h = v.querySelector('h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
    if (changed && window.ym) { try { window.ym(113834141, 'hit', location.href, { title: document.title }); } catch (e) {} }
    current = target;
  }
  window.addEventListener('hashchange', route);
  route();
})();`;
  home = home.replace(/<script src="\/assets\/site\.js[^"]*" defer><\/script>/, () => `<script>\n${js}\n${router}\n</script>`);

  home = rewrite(home);
  const left = home.match(/(?:src|href)="\/(?!\/)[^"]*"/g);
  if (left) console.warn('Остались ссылки на файлы сайта:', [...new Set(left)].slice(0, 10).join(', '));
  await fs.writeFile(OUT, home);
  console.log(`Один файл: ${path.relative(ROOT, OUT)}, ${(home.length / 1024).toFixed(0)} КБ, разделов: ${views.length + 1}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
