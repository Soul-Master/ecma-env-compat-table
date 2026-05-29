import puppeteer from "puppeteer";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const pageUrl = process.env.PAGE_URL;
const outputPath = process.env.OUTPUT_PATH ?? ".preview/preview.png";
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

const viewportWidth = Number(process.env.VIEWPORT_WIDTH ?? 1280);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT ?? 800);
const networkIdleMs = Number(process.env.NETWORK_IDLE_MS ?? 1000);

const selector = process.env.CAPTURE_ELEMENT_SELECTOR;

if (!pageUrl) {
  throw new Error("Missing PAGE_URL environment variable.");
}

if (!selector) {
  throw new Error("Missing CAPTURE_ELEMENT_SELECTOR environment variable.");
}

if (!Number.isFinite(networkIdleMs) || networkIdleMs < 0) {
  throw new Error(`Invalid NETWORK_IDLE_MS: ${process.env.NETWORK_IDLE_MS}`);
}

await mkdir(dirname(outputPath), { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--no-default-browser-check",
    "--no-first-run",
    "--ignore-certificate-errors",
    "--disable-default-apps",
    "--disable-component-update",
    "--enable-automation",
    "--disable-background-timer-throttling",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-device-discovery-notifications",
  ],
});

try {
  const page = await browser.newPage();

  await page.setViewport({
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
  });

  await page.goto(pageUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await page.waitForSelector(selector, {
    visible: true,
    timeout: 30_000,
  });

  await page.waitForNetworkIdle({
    idleTime: networkIdleMs,
    timeout: 30_000,
    concurrency: 0,
  });

  const element = await page.$(selector);

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  await element.screenshot({
    path: outputPath,
    type: "png",
  });

  console.log(`Captured element ${selector} from ${pageUrl} -> ${outputPath}`);
} finally {
  await browser.close();
}