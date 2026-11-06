// Проверка разборщиков на тестовых копиях разметки источников (без сети).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const env = { ...process.env, OUT_DIR: '.test-out', BUILD_NOW: '2026-10-28T18:00:00+03:00' };
execFileSync(process.execPath, ['scripts/build.mjs', '--fixtures'], { env, stdio: 'inherit' });
const items = JSON.parse(fs.readFileSync('data/items.demo.json', 'utf8'));
const by = (s) => items.filter((i) => i.source === s);
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
ok(by('aviasales').length === 2, 'Telegram: 2 поста (короткий и рекламный отфильтрованы)');
ok(by('aviasales').some((i) => i.text.includes('&') && !i.text.includes('&amp;')), 'Telegram: HTML-сущности раскодированы');
ok(by('aviasales').every((i) => !/[—–]/.test(i.text)), 'Тире заменены');
ok(by('psgr').length === 2 && by('psgr')[0].title.startsWith('[Тестовая'), 'RSS: 2 статьи, CDATA разобран');
ok(by('r-travel').length === 1, 'Reddit: фильтр по рейтингу и NSFW');
ok(by('r-funny').length === 1, 'Reddit: закреплённые посты отфильтрованы');
ok(by('matrasy')[0]?.rubric === 'gde-ya', 'Рубрика по ключевым словам');
ok(by('r-travel')[0]?.rubric === 'yumor-mira', 'Иностранные публикации в «Юмор мира»');
ok(items.every((i) => fs.existsSync(`.test-out/n/${i.slug}/index.html`)), 'У каждой новости своя страница');
ok(fs.existsSync('.test-out/sitemap.xml') && fs.existsSync('.test-out/rss.xml'), 'sitemap.xml и rss.xml');
fs.rmSync('.test-out', { recursive: true, force: true }); fs.rmSync('data/items.demo.json', { force: true });
