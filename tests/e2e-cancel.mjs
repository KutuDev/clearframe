import { chromium } from 'playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});

try {
  const page = await browser.newPage();
  const workers = new Set();
  page.on('worker', worker => {
    workers.add(worker);
    worker.on('close', () => workers.delete(worker));
  });
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('input[type=file]').setInputFiles(resolve('before.mp4'));
  await page.getByRole('button', { name: 'Enhance recording' }).click();
  await page.locator('.progress.enhancing').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.progress.cancelled').waitFor();
  await page.waitForTimeout(500);
  if (workers.size) throw new Error(`${workers.size} processing worker(s) remained after cancel`);
  await page.getByRole('button', { name: 'Enhance recording' }).click();
  await page.locator('.progress.complete').waitFor({ timeout: 120_000 });
  if (workers.size) throw new Error(`${workers.size} processing worker(s) remained after retry`);
  console.log('Cancel stopped workers; retry completed.');

  const lowMemory = await browser.newContext();
  await lowMemory.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 }));
  const limitedPage = await lowMemory.newPage();
  let startedWorker = false;
  limitedPage.on('worker', () => { startedWorker = true; });
  await limitedPage.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  const seconds = 3 * 60;
  const wav = Buffer.alloc(44 + seconds * 48000 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await limitedPage.locator('input[type=file]').setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: wav });
  await limitedPage.getByRole('button', { name: 'Enhance recording' }).click();
  await limitedPage.locator('.progress.error').waitFor({ timeout: 15_000 });
  if (!((await limitedPage.locator('.progress.error').innerText()).includes('2 minutes'))) throw new Error('Duration limit was not explained.');
  if (startedWorker) throw new Error('FFmpeg started before duration rejection.');
  console.log('Low memory duration preflight rejected long recording before workers started.');

  const shortWav = Buffer.alloc(44 + 2 * 48000 * 2);
  wav.copy(shortWav, 0, 0, 44);
  shortWav.writeUInt32LE(shortWav.length - 8, 4);
  shortWav.writeUInt32LE(shortWav.length - 44, 40);
  const wavWorkers = new Set();
  limitedPage.on('worker', worker => {
    wavWorkers.add(worker);
    worker.on('close', () => wavWorkers.delete(worker));
  });
  await limitedPage.locator('input[type=file]').setInputFiles({ name: 'short.wav', mimeType: 'audio/wav', buffer: shortWav });
  await limitedPage.getByRole('button', { name: 'Enhance recording' }).click();
  await limitedPage.locator('.progress.complete').waitFor({ timeout: 90_000 });
  if (wavWorkers.size) throw new Error('Processing workers remained after WAV export.');
  console.log('WAV export completed and released workers.');
  await lowMemory.close();
} finally {
  await browser.close();
}
