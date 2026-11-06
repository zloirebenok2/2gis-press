(async()=>{
const { chromium } = require('playwright');
const path = require('node:path');
const b = await chromium.launch(); const root = path.resolve('.');
let p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + root + '/tools/og.html'); await p.waitForTimeout(500);
await p.screenshot({ path: 'static/assets/og.png' });
p = await b.newPage({ viewport: { width: 180, height: 180 } });
await p.setContent(`<body style="margin:0;background:oklch(97% 0.008 90);display:grid;place-items:center;height:180px"><img src="file://${root}/static/assets/mark.svg" style="width:140px"></body>`);
await p.waitForTimeout(300); await p.screenshot({ path: 'static/assets/apple-touch-icon.png' });
p = await b.newPage({ viewport: { width: 1308, height: 417 } });
await p.goto('file://' + root + '/static/assets/logo.svg'); await p.screenshot({ path: '/tmp/claude-0/-home-claude/8af2689f-2f95-5c1f-91ba-3bc5281629d0/scratchpad/logo-check.png' });
await b.close();
})();
