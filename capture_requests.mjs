import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  { name: 'create', url: 'https://reelmind.ai/create' },
  { name: 'lego', url: 'https://reelmind.ai/lego' },
];

const OUTPUT_DIR = resolve(__dirname, 'captured_requests');
mkdirSync(OUTPUT_DIR, { recursive: true });

async function capture(url, name) {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const requests = [];
  const responses = [];

  page.on('request', (req) => {
    requests.push({
      id: requests.length,
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      headers: req.headers(),
      timestamp: Date.now(),
    });
  });

  page.on('response', (res) => {
    responses.push({
      url: res.url(),
      status: res.status(),
      statusText: res.statusText(),
      headers: res.headers(),
      timestamp: Date.now(),
    });
  });

  console.log(`[${name}] Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for network idle and any lazy-loaded content
  console.log(`[${name}] Waiting for network idle...`);
  await page.waitForLoadState('networkidle', { timeout: 60000 });

  // Scroll down to trigger lazy-loaded images/requests
  console.log(`[${name}] Scrolling page to trigger lazy content...`);
  await page.evaluate(async () => {
    await new Promise((resolveScroll) => {
      let totalHeight = 0;
      const distance = 400;
      const delay = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolveScroll();
        }
      }, delay);
    });
    // Scroll back to top
    window.scrollTo(0, 0);
  });

  // Wait extra for any requests triggered by scroll
  await page.waitForTimeout(3000);

  // Wait for network idle again after scrolling
  console.log(`[${name}] Waiting for final network idle...`);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
    console.log(`[${name}] Network idle timeout, continuing...`);
  });

  await page.waitForTimeout(2000);

  await browser.close();

  return { name, url, requests, responses };
}

async function main() {
  const results = [];

  for (const { name, url } of PAGES) {
    console.log(`\n=== Capturing: ${name} (${url}) ===`);
    const result = await capture(url, name);
    results.push(result);

    // Write individual file
    const filePath = resolve(OUTPUT_DIR, `${name}.json`);
    writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[${name}] Saved ${result.requests.length} requests, ${result.responses.length} responses -> ${filePath}`);

    // Print summary
    const types = {};
    for (const r of result.requests) {
      types[r.resourceType] = (types[r.resourceType] || 0) + 1;
    }
    console.log(`[${name}] Request summary by type:`, JSON.stringify(types, null, 2));

    // Print unique request URLs
    const uniqueUrls = [...new Set(result.requests.map((r) => r.url))];
    console.log(`[${name}] Unique request URLs (${uniqueUrls.length}):`);
    uniqueUrls.forEach((u) => console.log(`  ${u}`));
  }

  // Write combined file
  const combinedPath = resolve(OUTPUT_DIR, 'all_requests.json');
  writeFileSync(combinedPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nCombined results saved -> ${combinedPath}`);
}

main().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
