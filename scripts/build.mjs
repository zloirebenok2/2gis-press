#!/usr/bin/env node
// 2пшы: сборщик сайта. Без внешних зависимостей, Node 20+.
//   node scripts/build.mjs              собрать новости из sources.json и пересобрать сайт в public/
//   node scripts/build.mjs --no-fetch   только пересобрать сайт из data/items.json
//   node scripts/build.mjs --fixtures   демо-сборка на тестовых файлах из test/fixtures (без сети)
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const FIXTURES = args.has('--fixtures');
const NO_FETCH = args.has('--no-fetch');
const NOW = process.env.BUILD_NOW ? new Date(process.env.BUILD_NOW) : new Date();
const OUT = path.join(ROOT, process.env.OUT_DIR || 'public');
const DATA_FILE = path.join(ROOT, FIXTURES ? 'data/items.demo.json' : 'data/items.json');

const SITE = {
  name: '2пшы',
  url: (process.env.SITE_URL || 'https://2gis.press').replace(/\/$/, ''),
  tz: 'Europe/Moscow',
  description: 'Дорожные конфузы, новости в пути и юмор со всего мира. Новый выпуск каждый день.',
};

// ---------- Код Яндекс Метрики и виджета билетов: ровно как передал владелец сайта ----------
const METRIKA_HEAD = `<!-- Yandex.Metrika counter -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=113834141', 'ym');

    ym(113834141, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
</script>`;
const METRIKA_NOSCRIPT = `<noscript><div><img src="https://mc.yandex.ru/watch/113834141" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
<!-- /Yandex.Metrika counter -->`;
const TICKETS_WIDGET = `<script nowprocket data-noptimize="1" data-cfasync="false" data-wpfc-render="false" seraph-accel-crit="1" data-no-defer="1" data-cmp-ab="2">
  (function () {
      var script = document.createElement("script");
      script.async = 1;
      script.setAttribute("data-cmp-ab","2");
      script.src = 'https://tp-em.com/NTkyMTE2.js?t=592116';
      document.head.appendChild(script);
  })();
</script>`;
// Форма поиска авиабилетов и отелей (Travelpayouts, программа Aviasales, виджет 7879).
// Код получен в кабинете: Tools, Widgets, Flights Search Form; язык ru, валюта RUB, aviasales.ru.
const SEARCH_FORM_WIDGET = '<script async src="https://tpemb.com/content?currency=rub&trs=592116&shmarker=796696&show_hotels=true&powered_by=true&locale=ru&searchUrl=www.aviasales.ru%2Fsearch&primary_override=%230F285A&color_button=%230F285A&color_icons=%23FE6A00&dark=%23262626&light=%23FFFFFF&secondary=%23FFFFFF&special=%23C4C4C4&color_focused=%23FE6A00&border_radius=0&plain=false&promo_id=7879&campaign_id=100" charset="utf-8"></script>';
const HAS_ANALYTICS = !FIXTURES && process.env.NO_ANALYTICS !== '1';

// ---------- Рубрики ----------
const RUBRICS = [
  { slug: 'kak-dobratsya', name: 'Как добраться', day: 1, desc: 'Маршруты, которые пошли не туда', re: /маршрут|добрат|доехать|доберёт|рейс|перел[её]т|пересадк|аэропорт|вокзал|трансфер|flight|airport|layover|route/i },
  { slug: 'bez-seti', name: 'Без сети', day: 2, desc: 'Роуминг, офлайн-карты и связь', re: /роуминг|интернет|сим-?карт|esim|связ[ьи]|офлайн|wi-?fi|переводчик|приложени|roaming|offline|sim card/i },
  { slug: 'road-trip', name: 'Роуд-трип', day: 3, desc: 'Трассы, заправки и остановки', re: /бензин|заправк|\bазс\b|трасс|автомоб|машин|пробк|автопут|прокат авто|road ?trip|rental car|highway|gas station/i },
  { slug: 'tri-minuty', name: 'Через 3 минуты', day: 4, desc: 'Автобусы, поезда и метро', re: /автобус|поезд|электричк|метро|трамва|\bржд\b|сапсан|ласточк|расписани|задержк|опозда|train|\bbus\b|subway|metro|delay/i },
  { slug: 'gde-ya', name: 'Где я?', day: 5, desc: 'Визы, границы и потерянное', re: /виз[аыу]|границ|въезд|паспорт|потерял|заблуд|багаж|чемодан|таможн|visa|border|passport|lost|luggage/i },
  { slug: 'poest', name: 'Поесть рядом', day: 6, desc: 'Кафе, ловушки для туристов и находки', re: /\bеда\b|еды|ресторан|кафе|\bбар\b|ужин|завтрак|обед|кухн|гастро|food|restaurant|dinner|breakfast|\beat/i },
  { slug: 'yumor-mira', name: 'Юмор мира', day: 7, desc: 'Шутки и истории на других языках', re: null },
];
const FALLBACK_RUBRIC = { slug: 'v-doroge', name: 'В дороге', day: 0, desc: 'Всё остальное, что случается в поездках' };
const ALL_RUBRICS = [...RUBRICS, FALLBACK_RUBRIC];
const rubricBySlug = Object.fromEntries(ALL_RUBRICS.map((r) => [r.slug, r]));
const FUNNY = /смешн|ржу|мем\b|мемы|конфуз|забыл|потерял|опоздал|перепутал|случайно|казус|курь[её]з|абсурд|\blol\b|funny|hilarious|😂|🤣|😅|🙃/i;

// ---------- Утилиты ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = (s = '') => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const cdata = (s = '') => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const htmlToText = (h = '') => decode(h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|blockquote|h\d)>/gi, '\n').replace(/<[^>]+>/g, ''))
  .replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
// Тире в цитатах заменяем дефисом: на сайте единая типографика без длинных тире.
const tidy = (s = '') => s.replace(/\s+[—–]\s+/g, ' - ').replace(/[—–]/g, '-');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 6);
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => s.toLowerCase().split('').map((c) => TR[c] ?? c).join('')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 7).join('-');

const fmt = (d, o) => new Intl.DateTimeFormat('ru-RU', { timeZone: SITE.tz, ...o }).format(d);
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: SITE.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hhmm = (d) => fmt(d, { hour: '2-digit', minute: '2-digit' });
const ruDay = (key) => fmt(new Date(key + 'T12:00:00+03:00'), { day: 'numeric', month: 'long' });
const ruWeekday = (key) => fmt(new Date(key + 'T12:00:00+03:00'), { weekday: 'long' });
const isoDow = (key) => { const d = new Date(key + 'T12:00:00+03:00').getUTCDay(); return d === 0 ? 7 : d; };
const dayOfYear = (key) => { const d = new Date(key + 'T00:00:00Z'); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function cut(s, n) {
  if (s.length <= n) return s;
  const c = s.slice(0, n); const i = c.lastIndexOf(' ');
  return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[\s,.;:!?-]+$/, '') + '…';
}
function deriveTitle(text) {
  const first = text.split('\n').map((l) => l.trim()).find((l) => l.replace(/[^\p{L}\p{N}]/gu, '').length > 3) || text;
  const sentence = first.match(/^(.{20,140}?[.!?…])(\s|$)/u);
  return cut((sentence ? sentence[1] : first).replace(/[.]$/, ''), 110);
}

// ---------- Загрузка ----------
async function fetchText(url, { tries = 2, timeout = 20000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; 2pshy-bot/1.0; +' + SITE.url + ')', 'accept-language': 'ru,en;q=0.8' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); } finally { clearTimeout(t); }
  }
  throw last;
}
async function fixture(name) { return fs.readFile(path.join(ROOT, 'test/fixtures', name), 'utf8'); }

// ---------- Разбор источников ----------
function parseTelegram(html, src) {
  const out = [];
  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const post = (block.match(/data-post="([^"]+)"/) || [])[1];
    if (!post) continue;
    const m = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = m ? htmlToText(m[1]) : '';
    const date = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    if (!text || text.length < 25 || !date) continue;
    out.push({ src, nativeId: post, url: 'https://t.me/' + post, text, date, tgPost: post });
  }
  return out;
}
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return m ? cdata(m[1]).trim() : ''; };
function parseFeed(xml, src) {
  const out = [];
  for (const [b] of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)) {
    const title = htmlToText(decode(tag(b, 'title')));
    const link = decode(tag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '');
    const guid = tag(b, 'guid') || tag(b, 'id') || link;
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const body = htmlToText(decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content')))
      .replace(/submitted by[\s\S]*$/i, '').trim();
    if (!title || !link) continue;
    out.push({ src, nativeId: guid, url: link, title, text: body ? title + '\n\n' + body : title, date });
  }
  return out;
}
function parseReddit(json, src) {
  const data = JSON.parse(json);
  return (data?.data?.children || []).map((c) => c.data).filter((d) => d && !d.over_18 && !d.stickied && (d.score || 0) >= (src.minScore || 0))
    .map((d) => ({ src, nativeId: d.id, url: 'https://www.reddit.com' + d.permalink, title: decode(d.title || ''), text: decode(d.title || '') + (d.selftext ? '\n\n' + d.selftext : ''), date: new Date(d.created_utc * 1000).toISOString(), extScore: d.score }));
}
async function collect(src) {
  if (src.type === 'telegram') return parseTelegram(FIXTURES ? await fixture(`tg-${src.channel}.html`) : await fetchText(`https://t.me/s/${src.channel}`), src);
  if (src.type === 'rss') return parseFeed(FIXTURES ? await fixture(`rss-${src.id}.xml`) : await fetchText(src.url), src);
  if (src.type === 'reddit') {
    if (FIXTURES) return parseReddit(await fixture(`reddit-${src.sub}.json`), src);
    try { return parseReddit(await fetchText(`https://www.reddit.com/r/${src.sub}/top.json?t=day&limit=25&raw_json=1`), src); }
    catch { return parseFeed(await fetchText(`https://www.reddit.com/r/${src.sub}/top/.rss?t=day`), src).slice(0, src.limit || 5); }
  }
  throw new Error('неизвестный тип источника ' + src.type);
}

// ---------- Нормализация ----------
function classify(text, lang) {
  if (lang && lang !== 'ru') return 'yumor-mira';
  let best = null, bestN = 0;
  for (const r of RUBRICS) { if (!r.re) continue; const n = (text.match(new RegExp(r.re.source, 'gi')) || []).length; if (n > bestN) { best = r.slug; bestN = n; } }
  return best || FALLBACK_RUBRIC.slug;
}
function makeItem(raw) {
  const { src } = raw;
  const text = tidy(raw.text).slice(0, 4000);
  const title = tidy(raw.title ? cut(raw.title, 110) : deriveTitle(text));
  const d = new Date(raw.date); const date = isNaN(d) ? NOW : d;
  const lang = raw.lang || src.lang || 'ru';
  const rubric = raw.rubric || classify(text, lang);
  const id = src.id + ':' + raw.nativeId;
  const hoursOld = Math.max(0, (NOW - date) / 36e5);
  const score = (src.weight || 1) * 10 + (src.fun ? 8 : 0) + (FUNNY.test(text) ? 12 : 0)
    + (raw.extScore ? Math.log10(raw.extScore + 1) * 4 : 0) + (text.length > 80 && text.length < 900 ? 4 : 0) - hoursOld * 0.2 + (raw.lead ? 1000 : 0);
  return {
    id, slug: `${dayKey(date)}-${slugify(title) || 'post'}-${hash(id)}`, source: src.id, sourceName: src.name, sourceHome: src.home,
    url: raw.url, title, text, lang, rubric, date: date.toISOString(), day: dayKey(date), tgPost: raw.tgPost || null,
    fun: !!src.fun, score: Math.round(score * 10) / 10, editorial: !!raw.editorial, lead: !!raw.lead,
  };
}

// ---------- Шаблоны ----------
let CSS_VER = '0';
let GUIDES = [];
const ORG_LD = { '@context': 'https://schema.org', '@type': 'Organization', '@id': SITE.url + '/#org', name: '2пшы', url: SITE.url + '/', logo: SITE.url + '/assets/og.png', description: 'Независимый развлекательный проект о путешествиях: дорожные конфузы, советы, как добраться, и юмор со всего мира.' };
const crumbsLd = (list) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(url) })) });
const guideFor = (rubric) => GUIDES.find((g) => g.rubric === rubric);
const itemUrl = (it) => `/n/${it.slug}/`;
const abs = (p) => SITE.url + p;
const LOGO = (w = 112, white = false) => `<img src="/assets/${white ? 'logo-white' : 'logo'}.svg" width="${w}" height="${Math.round(w * 417 / 1308)}" alt="2пшы">`;

function layout({ title, desc, canonical, type = 'website', body, jsonld, active = '', ogImage = '/assets/og.png', noindex = false, crumbs = null, published = null }) {
  const full = title === SITE.name ? `${SITE.name}: дорожные конфузы, как добраться и юмор о путешествиях` : `${title} | ${SITE.name}`;
  const ld = [ORG_LD, ...(Array.isArray(jsonld) ? jsonld : jsonld ? [jsonld] : []), ...(crumbs ? [crumbsLd(crumbs)] : [])];
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${noindex ? 'noindex' : 'index, follow, max-snippet:-1, max-image-preview:large'}">
${published ? `<meta property="article:published_time" content="${published}">` : ''}
${noindex ? '' : `<link rel="canonical" href="${esc(abs(canonical))}">`}
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(abs(canonical))}">
<meta property="og:image" content="${esc(abs(ogImage))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${SITE.name}" href="/rss.xml">
<link rel="preload" href="/assets/fonts/oswald-cyrillic-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/literata-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=${CSS_VER}">
<script>document.documentElement.classList.add('js');</script>
<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : { '@context': 'https://schema.org', '@graph': ld.map(({ ['@context']: _, ...x }) => x) }).replace(/</g, '\\u003c')}</script>
<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">
${HAS_ANALYTICS ? METRIKA_HEAD + '\n' + TICKETS_WIDGET : '<!-- Метрика и виджет билетов отключены в демо-сборке -->'}
</head>
<body>
${HAS_ANALYTICS ? METRIKA_NOSCRIPT : ''}
<a class="skip" href="#main">Перейти к содержанию</a>
${chrome(active)}
<main id="main">
${body}
</main>
${footer()}
<script src="/assets/site.js?v=${CSS_VER}" defer></script>
</body>
</html>`;
}

let BUILT_LABEL = '';
function chrome(active) {
  const a = (k) => (active === k ? ' aria-current="page"' : '');
  return `<div class="banner"><div class="container"><span>${esc(BUILT_LABEL)}</span><a href="/rss.xml">RSS-лента</a></div></div>
<header class="bar"><div class="container">
<a class="bar__logo" href="/" aria-label="2пшы, на главную">${LOGO(112)}</a>
<nav aria-label="Разделы"><ul class="bar__links">
<li><a href="/#vypusk"${a('home')}>Выпуск дня</a></li>
<li class="opt2"><a href="/#rubriki"${a('rubric')}>Рубрики</a></li>
<li class="opt2"><a href="/#gidy"${a('guide')}>Гиды</a></li>
<li class="opt"><a href="/#mir">Юмор мира</a></li>
<li class="opt2"><a href="/#arhiv"${a('day')}>Архив</a></li>
<li><a href="/#bilety">Билеты</a></li>
</ul></nav>
</div></header>`;
}

let FOOTER_SOURCES = [];
function footer() {
  return `<footer class="foot"><div class="container">
<div class="foot__grid">
<div class="foot__brand">${LOGO(168, true)}<p>Независимый развлекательный проект о путешествиях. Новости из открытых источников публикуются фрагментом со ссылкой на оригинал.</p></div>
<div><h2>Рубрики</h2><ul>${ALL_RUBRICS.map((r) => `<li><a href="/r/${r.slug}/">${esc(r.name)}</a></li>`).join('')}</ul></div>
<div><h2>Источники</h2><ul>${FOOTER_SOURCES.map((s) => `<li><a href="${esc(s.home)}" rel="noopener" target="_blank">${esc(s.name)}</a></li>`).join('')}</ul></div>
<div><h2>Гиды</h2><ul>${GUIDES.map((g) => `<li><a href="/gid/${g.slug}/">${esc(g.h1)}</a></li>`).join('')}</ul></div>
<div><h2>Проект</h2><ul><li><a href="/#vypusk">Выпуск дня</a></li><li><a href="/#arhiv">Прошлые выпуски</a></li><li><a href="/rss.xml">RSS-лента</a></li><li><a href="/sitemap.xml">Карта сайта</a></li></ul></div>
</div>
<div class="foot__legal"><small>© ${NOW.getUTCFullYear()} 2пшы. Тексты новостей принадлежат их авторам.</small>
<small data-credits>Фотография: <a href="https://commons.wikimedia.org/wiki/File:Tocumen_International_Airport_alt.jpg" rel="noopener" target="_blank">Wilfredor</a> (CC0, Wikimedia Commons).</small></div>
</div></footer>`;
}

const rubricLink = (it) => { const r = rubricBySlug[it.rubric] || FALLBACK_RUBRIC; return `<a class="tag" href="/r/${r.slug}/">${esc(r.name)}</a>`; };
const langNote = (it) => (it.lang && it.lang !== 'ru' ? ` <span class="lang" lang="ru">(${esc(it.lang.toUpperCase())})</span>` : '');

function rows(list, { issueDay } = {}) {
  if (!list.length) return `<div class="sheet empty"><p>Здесь пока пусто. Новые истории появятся после следующего обновления.</p></div>`;
  return `<ol class="rows">${list.map((it) => {
    const d = new Date(it.date);
    const label = it.day === issueDay ? hhmm(d) : fmt(d, { day: '2-digit', month: '2-digit' });
    return `<li><time datetime="${it.date}">${label}</time><a class="t" href="${itemUrl(it)}" lang="${esc(it.lang)}">${esc(cut(it.title, 90))}</a><span class="src">${esc(it.sourceName)}${langNote(it)}</span><button class="btn btn--small share-mini" type="button" data-copy="${esc(abs(itemUrl(it)))}" aria-label="Скопировать ссылку на новость">Ссылка</button></li>`;
  }).join('')}</ol>`;
}

function pickLead(list, dow) {
  const ed = list.find((i) => i.lead);
  if (ed) return ed;
  const todays = RUBRICS.find((r) => r.day === dow)?.slug;
  return [...list].sort((a, b) => (b.score + (b.rubric === todays ? 15 : 0)) - (a.score + (a.rubric === todays ? 15 : 0)))[0];
}

function homePage({ items, issueDay, days, jokes, world }) {
  const dow = isoDow(issueDay);
  const todayRubric = RUBRICS.find((r) => r.day === dow);
  const dayItems = items.filter((i) => i.day === issueDay);
  const lead = pickLead(dayItems.length ? dayItems : items, dow);
  const rest = (dayItems.length >= 4 ? dayItems : items).filter((i) => i !== lead).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const joke = jokes[dayOfYear(issueDay) % jokes.length];
  const abroad = items.filter((i) => i.lang !== 'ru' && !i.editorial).slice(0, 3);
  const past = days.filter((d) => d < issueDay).slice(0, 10);

  const leadBlock = lead ? `<article class="sheet lead-story">
<div class="body">
<p class="meta">${rubricLink(lead)}, ${esc(lead.sourceName)}, <time datetime="${lead.date}">${hhmm(new Date(lead.date))}</time></p>
<h3 lang="${esc(lead.lang)}">${esc(lead.title)}</h3>
<p>${esc(cut(lead.text.replace(lead.title, '').replace(/^[\s.…]+/, '') || lead.text, 150))}</p>
<div class="actions"><a class="btn btn--small" href="${itemUrl(lead)}">Читать и поделиться</a></div>
</div></article>` : '';

  const body = `
<section class="hero fibre" aria-labelledby="h-hero"><div class="container">
<div class="hero__text">
<h1 id="h-hero">Как я сюда добрался?</h1>
<p class="lead">Каждый день: дорожные конфузы, новости в пути и юмор со всего мира.</p>
<div class="actions"><a class="btn btn--primary" href="#vypusk">Читать выпуск дня</a><a class="btn" href="#bilety">Найти билеты</a></div>
</div>
<div class="sheet sheet--fluoro dateslip"><b>${esc(ruDay(issueDay))}</b><span>${esc(cap(ruWeekday(issueDay)))}, рубрика <span class="nowrap">«${esc(todayRubric.name)}»</span></span></div>
</div></section>

<section class="sec" id="vypusk" aria-labelledby="h-issue"><div class="container">
<div class="head"><h2 id="h-issue">Выпуск дня</h2><p class="lead">У каждой истории своя ссылка: её удобно переслать в чат.</p></div>
<div class="issue">${leadBlock}<div>${rows(rest, { issueDay })}
<p class="meta more-link"><a href="/day/${issueDay}/">Весь выпуск: ${dayItems.length} ${plural(dayItems.length, 'история', 'истории', 'историй')}</a></p></div></div>
</div></section>

<section class="sec--gap" id="rubriki" aria-labelledby="h-week"><div class="container">
<div class="head"><h2 id="h-week">Рубрики по дням</h2><p class="lead">У каждого дня недели своя тема.</p></div>
<ol class="week">${RUBRICS.map((r) => `<li class="sheet${r.day === dow ? ' sheet--fluoro is-today' : ''}"${r.day === dow ? ' aria-current="date"' : ''}><b>${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][r.day - 1]}</b><a href="/r/${r.slug}/">${esc(r.name)}</a><p>${esc(r.desc)}</p></li>`).join('')}</ol>
</div></section>

<section class="band fibre" aria-label="Шутка дня"><div class="container">
<blockquote>${esc(joke)}</blockquote>
<p>Шутка дня от редакции.</p>
</div></section>

<section class="sec--gap" id="mir" aria-labelledby="h-world"><div class="container">
<div class="head"><h2 id="h-world">Юмор со всего мира</h2><p class="lead">На языке оригинала, с переводом.</p></div>
<div class="switch" data-switch>
<div class="tabs" role="tablist" aria-label="Страны">${world.map((w, i) => `<button type="button" role="tab" id="t-${i}" aria-controls="p-${i}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ''}>${esc(w.country)}</button>`).join('')}</div>
<div>${world.map((w, i) => `<div class="sheet panel" role="tabpanel" id="p-${i}" aria-labelledby="t-${i}"${i ? ' data-hide' : ''}><p class="orig" lang="${esc(w.lang)}">${esc(w.orig)}</p><p class="tr">${esc(w.tr)}</p></div>`).join('')}</div>
</div>
${abroad.length ? `<div class="abroad">${rows(abroad, { issueDay })}</div>` : ''}
</div></section>

<section class="sec--gap" id="gidy" aria-labelledby="h-guides"><div class="container">
<div class="head"><h2 id="h-guides">Гиды в дорогу</h2><p class="lead">Короткие ответы на частые вопросы в пути.</p></div>
<ul class="guides">${GUIDES.map((g) => `<li><a class="sheet guide-card" href="/gid/${g.slug}/"><b>${esc(g.h1)}</b><span>${esc(cut(g.description, 90))}</span></a></li>`).join('')}</ul>
</div></section>

${ticketsBand()}

<section class="sec--gap" id="arhiv" aria-labelledby="h-arch">
<div class="container"><div class="head"><h2 id="h-arch">Прошлые выпуски</h2><p class="lead">Неделя дорожных историй, по листу на день.</p></div></div>
${past.length ? `<ul class="rail" tabindex="0" aria-label="Прошлые выпуски">${past.map((k) => {
    const list = items.filter((i) => i.day === k); const l = pickLead(list, isoDow(k));
    return `<li><a class="sheet cover" href="/day/${k}/"><b>${esc(ruDay(k))}</b><span>${esc(cap(ruWeekday(k)))}, ${list.length} ${plural(list.length, 'история', 'истории', 'историй')}</span><p lang="${esc(l.lang)}">${esc(cut(l.title, 80))}</p></a></li>`;
  }).join('')}</ul>` : `<div class="container"><div class="sheet empty"><p>Архив начнёт собираться со следующего дня.</p></div></div>`}
</section>`;

  return layout({
    title: SITE.name, desc: SITE.description, canonical: '/', body, active: 'home',
    jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: SITE.url + '/', description: SITE.description, inLanguage: 'ru', publisher: { '@id': SITE.url + '/#org' } },
  });
}

function ticketsBand() {
  return `<section class="tickets fibre" id="bilety" aria-labelledby="h-tix"><div class="container">
<figure class="photo" data-slot="tickets" data-alt="Путешественник с чемоданом идёт по телетрапу к самолёту">
<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Tocumen_International_Airport_alt.jpg/960px-Tocumen_International_Airport_alt.jpg" srcset="https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Tocumen_International_Airport_alt.jpg/960px-Tocumen_International_Airport_alt.jpg 960w, https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Tocumen_International_Airport_alt.jpg/1280px-Tocumen_International_Airport_alt.jpg 1280w" sizes="(min-width: 60rem) 40vw, 100vw" width="3070" height="4011" alt="Путешественник с чемоданом в телетрапе" loading="lazy" style="object-position: 55% 55%">
</figure>
<div class="tickets__side">
<h2 id="h-tix">Билеты на следующий конфуз</h2>
<p class="lead">Авиабилеты и отели через поиск партнёра.</p>
<!-- Форма поиска Авиасейлс из кабинета Travelpayouts (проект 2gis, trs=592116, partner 796696), цвета под сайт. Рисуется на месте своего тега script -->
<div class="sheet tp-slot" id="tp-widget">${HAS_ANALYTICS ? SEARCH_FORM_WIDGET : '<p>Форма поиска билетов появится на опубликованном сайте.</p>'}</div>
</div>
</div></section>`;
}

const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };

function itemPage(it, sameDay) {
  const paras = it.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const bodyParas = (paras[0] && paras[0].startsWith(it.title.replace(/…$/, '')) && paras.length > 1 ? paras.slice(1) : paras);
  const shown = it.editorial ? bodyParas : [cut(bodyParas.join(' '), 420)];
  const pageUrl = abs(itemUrl(it));
  const enc = encodeURIComponent;
  const more = sameDay.filter((x) => x.id !== it.id).slice(0, 5);
  const body = `
<article class="article" aria-labelledby="h-item"><div class="container">
<div class="sheet article__sheet">
<p class="meta">${rubricLink(it)}, <time datetime="${it.date}">${esc(ruDay(it.day))}, ${hhmm(new Date(it.date))}</time></p>
<h1 id="h-item" lang="${esc(it.lang)}">${esc(it.title)}</h1>
<div class="text" lang="${esc(it.lang)}">${shown.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>
<p class="meta">${it.editorial ? 'Текст редакции 2пшы.' : `Источник: <a href="${esc(it.sourceHome)}" rel="noopener" target="_blank">${esc(it.sourceName)}</a>. Фрагмент публикации, полный текст у автора.`}</p>
${it.editorial ? '' : `<div class="actions"><a class="btn btn--primary" href="${esc(it.url)}" rel="noopener" target="_blank" data-goal="source">Открыть оригинал</a></div>`}
${it.tgPost ? `<div class="embed"><script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-post="${esc(it.tgPost)}" data-width="100%" data-userpic="false"></script></div>` : ''}
<div class="share" data-share data-url="${esc(pageUrl)}" data-title="${esc(it.title)}">
<button class="btn btn--small" type="button" data-copy="${esc(pageUrl)}">Скопировать ссылку</button>
<a class="btn btn--small" href="https://t.me/share/url?url=${enc(pageUrl)}&amp;text=${enc(it.title)}" target="_blank" rel="noopener" data-goal="share_tg">Telegram</a>
<a class="btn btn--small" href="https://vk.com/share.php?url=${enc(pageUrl)}&amp;title=${enc(it.title)}" target="_blank" rel="noopener" data-goal="share_vk">ВКонтакте</a>
<a class="btn btn--small" href="https://wa.me/?text=${enc(it.title + ' ' + pageUrl)}" target="_blank" rel="noopener" data-goal="share_wa">WhatsApp</a>
<button class="btn btn--small" type="button" data-native hidden>Другое приложение</button>
<p class="share__note" aria-live="polite"></p>
</div>
</div>
</div></article>
${more.length ? `<section class="sec" aria-labelledby="h-more"><div class="container"><div class="head"><h2 id="h-more">Ещё из этого выпуска</h2><p class="lead"><a href="/day/${it.day}/">Весь выпуск за ${esc(ruDay(it.day))}</a></p></div>${rows(more, { issueDay: it.day })}</div></section>` : ''}
${guideFor(it.rubric) ? `<section class="sec" aria-labelledby="h-g"><div class="container"><div class="head"><h2 id="h-g">Полезно по теме</h2><p class="lead"><a href="/gid/${guideFor(it.rubric).slug}/">${esc(guideFor(it.rubric).h1)}</a>: ${esc(cut(guideFor(it.rubric).description, 120))}</p></div></div></section>` : ''}
${ticketsBand()}`;
  const desc = cut(shown.join(' ').replace(/\s+/g, ' '), 180);
  const rb = rubricBySlug[it.rubric] || FALLBACK_RUBRIC;
  return layout({
    title: it.title, desc, canonical: itemUrl(it), type: 'article', body, published: it.date,
    crumbs: [['2пшы', '/'], [rb.name, `/r/${rb.slug}/`], [cut(it.title, 60), itemUrl(it)]],
    jsonld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: cut(it.title, 110), datePublished: it.date, dateModified: it.date, inLanguage: it.lang, mainEntityOfPage: pageUrl, articleSection: (rubricBySlug[it.rubric] || FALLBACK_RUBRIC).name, description: desc, publisher: { '@id': SITE.url + '/#org' }, ...(it.editorial ? {} : { isBasedOn: it.url }) },
  });
}

function listPage({ title, desc, canonical, lead, list, pager = '', active, extra = '' }) {
  const body = `<section class="sec" aria-labelledby="h-list"><div class="container">
<div class="head"><h1 id="h-list" class="list-h1">${esc(title)}</h1><p class="lead">${esc(lead)}</p></div>
${extra}${rows(list, {})}${pager}
</div></section>`;
  return layout({ title, desc, canonical, body, active, crumbs: [['2пшы', '/'], [title, canonical]] });
}

function guidePage(g, items) {
  const related = items.filter((i) => i.rubric === g.rubric).slice(0, 6);
  const others = GUIDES.filter((x) => x.slug !== g.slug);
  const body = `
<article class="article guide" aria-labelledby="h-guide"><div class="container">
<div class="sheet article__sheet">
<p class="meta"><a href="/#gidy">Гиды в дорогу</a></p>
<h1 id="h-guide">${esc(g.h1)}</h1>
<p class="answer">${esc(g.lead)}</p>
${g.sections.map((sec) => `<section class="guide__sec"><h2>${esc(sec.h)}</h2><ul>${sec.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`).join('')}
<section class="guide__sec faq" aria-labelledby="h-faq"><h2 id="h-faq">Частые вопросы</h2>
${g.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
</section>
<div class="share" data-share data-url="${esc(abs(`/gid/${g.slug}/`))}" data-title="${esc(g.h1)}">
<button class="btn btn--small" type="button" data-copy="${esc(abs(`/gid/${g.slug}/`))}">Скопировать ссылку</button>
<a class="btn btn--small" href="https://t.me/share/url?url=${encodeURIComponent(abs(`/gid/${g.slug}/`))}&amp;text=${encodeURIComponent(g.h1)}" target="_blank" rel="noopener" data-goal="share_tg">Telegram</a>
<button class="btn btn--small" type="button" data-native hidden>Другое приложение</button>
<p class="share__note" aria-live="polite"></p>
</div>
</div>
</div></article>
${related.length ? `<section class="sec" aria-labelledby="h-rel"><div class="container"><div class="head"><h2 id="h-rel">Истории из дороги</h2><p class="lead">Свежее из рубрики <a href="/r/${g.rubric}/">«${esc((rubricBySlug[g.rubric] || FALLBACK_RUBRIC).name)}»</a>.</p></div>${rows(related, {})}</div></section>` : ''}
<section class="sec" aria-labelledby="h-more-g"><div class="container"><div class="head"><h2 id="h-more-g">Другие гиды</h2></div>
<ul class="guides">${others.map((x) => `<li><a class="sheet guide-card" href="/gid/${x.slug}/"><b>${esc(x.h1)}</b><span>${esc(cut(x.description, 90))}</span></a></li>`).join('')}</ul></div></section>
${ticketsBand()}`;
  return layout({
    title: g.title, desc: g.description, canonical: `/gid/${g.slug}/`, type: 'article', body, active: 'guide',
    crumbs: [['2пшы', '/'], ['Гиды в дорогу', '/#gidy'], [g.h1, `/gid/${g.slug}/`]],
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.description, inLanguage: 'ru', mainEntityOfPage: abs(`/gid/${g.slug}/`), datePublished: GUIDE_DATE, dateModified: dayKey(NOW), author: { '@id': SITE.url + '/#org' }, publisher: { '@id': SITE.url + '/#org' } },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: g.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  });
}
const GUIDE_DATE = '2026-10-28';

function llmsTxt(items, days) {
  const latest = items.slice(0, 20);
  return `# 2пшы

> Независимый развлекательный проект о путешествиях на русском языке: ежедневный выпуск дорожных конфузов, новостей в пути и юмора со всего мира, плюс короткие гиды с ответами на частые вопросы путешественников. Новости из открытых источников публикуются фрагментом со ссылкой на оригинал.

Сайт: ${SITE.url}/
Обновляется: три раза в день, 06:15, 12:15 и 18:15 по Москве.
Язык: русский (часть публикаций рубрики «Юмор мира» на английском, немецком, японском, испанском, французском, с переводом).

## Гиды

${GUIDES.map((g) => `- [${g.h1}](${abs(`/gid/${g.slug}/`)}): ${g.lead}`).join('\n')}

## Рубрики

${ALL_RUBRICS.map((r) => `- [${r.name}](${abs(`/r/${r.slug}/`)}): ${r.desc}`).join('\n')}

## Выпуски

${days.slice(0, 14).map((d) => `- [Выпуск за ${ruDay(d)}](${abs(`/day/${d}/`)})`).join('\n')}

## Свежие публикации

${latest.map((i) => `- [${i.title}](${abs(itemUrl(i))}): ${i.sourceName}, ${ruDay(i.day)}`).join('\n')}

## Прочее

- [RSS-лента](${SITE.url}/rss.xml)
- [Карта сайта](${SITE.url}/sitemap.xml)
`;
}

function rss(items) {
  const x = (s) => esc(s);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${SITE.name}</title><link>${SITE.url}/</link><description>${x(SITE.description)}</description><language>ru</language>
<atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml"/>
${items.slice(0, 50).map((it) => `<item><title>${x(it.title)}</title><link>${abs(itemUrl(it))}</link><guid isPermaLink="true">${abs(itemUrl(it))}</guid><pubDate>${new Date(it.date).toUTCString()}</pubDate><category>${x((rubricBySlug[it.rubric] || FALLBACK_RUBRIC).name)}</category><description>${x(cut(it.text, 300))}</description></item>`).join('\n')}
</channel></rss>`;
}

// ---------- Сборка ----------
async function readJSON(p, fallback) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } }
async function write(rel, content) { const p = path.join(OUT, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content); }
async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(a, b); else await fs.copyFile(a, b);
  }
}
async function bundleCss() {
  let css = await fs.readFile(path.join(ROOT, 'src/site.css'), 'utf8');
  for (const m of [...css.matchAll(/@import url\("\.\/([^"]+)"\);\n?/g)]) css = css.replace(m[0], (await fs.readFile(path.join(ROOT, 'src', m[1]), 'utf8')) + '\n');
  return css;
}

async function main() {
  const cfg = await readJSON(path.join(ROOT, 'sources.json'), { sources: [] });
  const sources = cfg.sources.filter((s) => s.enabled !== false);
  FOOTER_SOURCES = sources;
  const skipRe = new RegExp((cfg.skip || []).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^', 'i');
  const keepDays = cfg.keepDays || 60;

  const store = new Map((await readJSON(DATA_FILE, [])).map((i) => [i.id, i]));
  const report = [];
  if (!NO_FETCH) {
    // Reddit отвечает 429 на частые запросы с одного адреса: его опрашиваем по очереди с паузой, остальных параллельно
    const settle = (p) => p.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
    const nonReddit = Promise.all(sources.map((s) => (s.type === 'reddit' ? null : settle(collect(s)))));
    const redditRes = {};
    for (const [i, s] of sources.entries()) {
      if (s.type !== 'reddit') continue;
      redditRes[i] = await settle(collect(s));
      if (!FIXTURES) await new Promise((r) => setTimeout(r, 8000));
    }
    const results = (await nonReddit).map((r, i) => r || redditRes[i]);
    results.forEach((r, i) => {
      const src = sources[i];
      if (r.status === 'rejected') { report.push(`  ✗ ${src.name}: ${r.reason?.message || r.reason}`); return; }
      let added = 0;
      const fresh = r.value.filter((x) => !skipRe.test(x.text)).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, src.limit || cfg.perSourceLimit || 12);
      for (const raw of fresh) { const it = makeItem(raw); if (!store.has(it.id)) { store.set(it.id, it); added++; } }
      report.push(`  ✓ ${src.name}: получено ${r.value.length}, новых ${added}`);
    });
  }
  // Публикации редакции
  const ed = await readJSON(path.join(ROOT, 'content/editorial.json'), { posts: [] });
  const edSrc = { id: 'editorial', name: 'Редакция 2пшы', home: SITE.url + '/', lang: 'ru', fun: true, weight: 3 };
  for (const p of ed.posts) {
    const it = makeItem({ src: edSrc, nativeId: p.id, url: '', title: p.title, text: p.text, date: p.date, rubric: p.rubric, lang: p.lang, lead: p.lead, editorial: true });
    it.editorial = true; it.lead = !!p.lead; it.url = abs(itemUrl(it));
    store.set(it.id, it);
  }
  // Чистка: старше keepDays, дубли по заголовку
  const cutoff = NOW - keepDays * 864e5;
  const seen = new Set();
  const items = [...store.values()].filter((i) => new Date(i.date) >= cutoff && new Date(i.date) <= new Date(NOW.getTime() + 36e5))
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((i) => { const k = i.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(items.filter((i) => !i.editorial), null, 1));

  const days = [...new Set(items.map((i) => i.day))].sort().reverse();
  let issueDay = dayKey(NOW);
  if (!items.some((i) => i.day === issueDay) && days.length) issueDay = days[0];
  BUILT_LABEL = `Обновлено ${ruDay(dayKey(NOW))} в ${hhmm(NOW)} по Москве`;

  // Файлы сайта
  await fs.rm(OUT, { recursive: true, force: true });
  await copyDir(path.join(ROOT, 'static'), OUT);
  const css = await bundleCss();
  CSS_VER = hash(css + (await fs.readFile(path.join(ROOT, 'static/assets/site.js'), 'utf8')));
  await write('assets/site.css', css);

  GUIDES = (await readJSON(path.join(ROOT, 'content/guides.json'), { guides: [] })).guides;
  const jokes = (await readJSON(path.join(ROOT, 'content/jokes.json'), { jokes: ['Шутка дня скоро будет.'] })).jokes;
  const world = (await readJSON(path.join(ROOT, 'content/world.json'), { items: [] })).items;
  await write('index.html', homePage({ items, issueDay, days, jokes, world }));

  const byDay = Object.fromEntries(days.map((d) => [d, items.filter((i) => i.day === d)]));
  for (const it of items) await write(`n/${it.slug}/index.html`, itemPage(it, byDay[it.day]));
  for (const [i, d] of days.entries()) {
    const prev = days[i + 1], next = days[i - 1];
    const pager = `<nav class="pager" aria-label="Другие дни">${prev ? `<a href="/day/${prev}/">Выпуск за ${esc(ruDay(prev))}</a>` : '<span></span>'}${next ? `<a href="/day/${next}/">Выпуск за ${esc(ruDay(next))}</a>` : ''}</nav>`;
    await write(`day/${d}/index.html`, listPage({ title: `Выпуск за ${ruDay(d)}`, desc: `Все истории выпуска 2пшы за ${ruDay(d)}: конфузы, новости в пути и юмор.`, canonical: `/day/${d}/`, lead: `${cap(ruWeekday(d))}, ${byDay[d].length} ${plural(byDay[d].length, 'история', 'истории', 'историй')}.`, list: byDay[d], pager, active: 'day' }));
  }
  for (const r of ALL_RUBRICS) {
    const list = items.filter((i) => i.rubric === r.slug).slice(0, 80);
    await write(`r/${r.slug}/index.html`, listPage({ title: r.name, desc: `Рубрика «${r.name}» на 2пшы: ${r.desc.toLowerCase()}.`, canonical: `/r/${r.slug}/`, lead: r.day ? `${r.desc}. Главная тема по ${['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'][r.day - 1]}.` : r.desc + '.', list, active: 'rubric' }));
  }
  await write('404.html', layout({ title: 'Страница не найдена', desc: 'Такой страницы нет.', canonical: '/404.html', noindex: true, body: `<section class="sec"><div class="container"><div class="sheet article__sheet"><h1>Не туда свернули</h1><p>Такой страницы нет: возможно, новость старше ${keepDays} дней и уже ушла из архива.</p><div class="actions"><a class="btn btn--primary" href="/">К выпуску дня</a></div></div></div></section>` }));
  for (const g of GUIDES) await write(`gid/${g.slug}/index.html`, guidePage(g, items));
  await write('llms.txt', llmsTxt(items, days));
  await write('rss.xml', rss(items));
  const today = dayKey(NOW);
  const urls = [['/', today, 'hourly', '1.0'], ...GUIDES.map((g) => [`/gid/${g.slug}/`, today, 'weekly', '0.9']), ...days.map((d) => [`/day/${d}/`, d, 'daily', '0.6']), ...ALL_RUBRICS.map((r) => [`/r/${r.slug}/`, today, 'daily', '0.7']), ...items.map((i) => [itemUrl(i), i.day, 'monthly', '0.5'])];
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d, f, pr]) => `<url><loc>${abs(u)}</loc><lastmod>${d}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>`);
  await write('robots.txt', `# Поисковые системы и ИИ-ассистенты: индексация разрешена\nUser-agent: *\nAllow: /\n\nUser-agent: Yandex\nAllow: /\nClean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`);
  await write('CNAME', new URL(SITE.url).host + '\n');

  console.log(`2пшы: ${items.length} публикаций, ${days.length} дней, выпуск за ${issueDay}`);
  if (report.length) console.log('Источники:\n' + report.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
