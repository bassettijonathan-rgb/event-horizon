// Loads the built Artifact page inside a sandboxed iframe, the way claude.ai
// shows it, at desktop and phone widths, and checks that every mode runs:
//   node tools/build-artifact.mjs && node test/browser/artifact-check.mjs
// Set SHOTS=dir to save a screenshot of each mode.
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const body = readFileSync(new URL('../../dist/event-horizon.html', import.meta.url), 'utf8');
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${body}</body></html>`;
const host = `<!doctype html><html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="border:0;width:100vw;height:100vh"></iframe>
<script>document.getElementById('f').srcdoc = ${JSON.stringify(doc).replace(/<\//g, '<\\/')};</script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(host);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: (process.env.GPU_FLAGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader').split(' ') });
let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`FAIL ${msg}`);
};

for (const vp of [{ width: 1280, height: 860, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }]) {
  const page = await browser.newPage({ viewport: vp });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  const frame = page.frameLocator('#f');
  await frame.locator('#tab-view').waitFor();
  await page.waitForTimeout(3000);

  const overflow = await frame.locator('body').evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) fail(`${vp.name}: page scrolls sideways by ${overflow}px`);

  for (const mode of ['view', 'orbits', 'tides', 'clocks', 'chirp', 'validation']) {
    await frame.locator(`#tab-${mode}`).click();
    await page.waitForTimeout(mode === 'validation' ? 6000 : 2500);
    if (mode === 'orbits') {
      await frame.getByRole('button', { name: 'Swarm on GPU' }).click();
      await page.waitForTimeout(2500);
    }
    if (mode !== 'validation') {
      // Software GPUs in CI can take seconds per frame; wait for the first one.
      await frame.locator('#readout span').first().waitFor({ timeout: 60000 }).catch(() => {});
    }
    const readout = await frame.locator('#readout').textContent();
    const info = await frame.locator('body').evaluate(() => {
      const app = globalThis.__eventHorizon;
      return { backend: app?.backendLabel?.(), mode: app?.mode?.id };
    });
    let note = readout.slice(0, 110);
    if (mode === 'validation') {
      note = await frame.locator('.vhead .pill').textContent();
      const rows = await frame.locator('.vrow').count();
      if (!/(\d+) of \1 within 1%/.test(note)) fail(`${vp.name}: validation says "${note}"`);
      if (rows < 10) fail(`${vp.name}: only ${rows} validation rows`);
    } else if (!readout.trim()) fail(`${vp.name}: ${mode} shows no readout`);
    if (mode === 'orbits' && !/swarm \d+ of \d+/.test(readout)) fail(`${vp.name}: swarm did not start (${readout})`);
    console.log(`${vp.name} ${mode}: ${info.backend} | ${note}`);
    if (shots) await page.screenshot({ path: `${shots}/${vp.name}-${mode}.png` });
  }
  const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
  if (errors.length) fail(`${vp.name}: ${errors.join('\n')}`);
  await page.close();
}
await browser.close();
server.close();
console.log(failed ? 'browser check failed' : 'browser check passed');
process.exit(failed ? 1 : 0);
