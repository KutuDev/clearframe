import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage();
const messages = [];
page.on('console', message => messages.push(`[console:${message.type()}] ${message.text()}`));
page.on('pageerror', error => messages.push(`[pageerror] ${error.stack || error.message}`));
page.on('requestfailed', request => messages.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`));
page.on('worker', worker => {
  messages.push(`[worker] ${worker.url()}`);
  worker.on('console', message => messages.push(`[worker:${message.type()}] ${message.text()}`));
  worker.on('close', () => messages.push(`[worker:closed] ${worker.url()}`));
});

try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('input[type=file]').setInputFiles(resolve('before.mp4'));
  await page.getByRole('button', { name: 'Enhance recording' }).click();
  await page.waitForFunction(() => ['complete', 'error', 'cancelled'].some(state => document.querySelector(`.progress.${state}`)), null, { timeout: 120_000 });
  const status = await page.locator('.progress').innerText().catch(() => 'no progress panel');
  console.log(status);
  if (status.includes('NEEDS ATTENTION')) throw new Error('The deployed app reported a processing failure.');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download enhanced file' }).click(),
  ]);
  const outputPath = await download.path();
  console.log(`download: ${download.suggestedFilename()} (${(await stat(outputPath)).size} bytes)`);
} finally {
  console.log(messages.join('\n'));
  await browser.close();
}
