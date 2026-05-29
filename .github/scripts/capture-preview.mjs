import captureWebsite from "capture-website";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const pageUrl = process.env.PAGE_URL;
const outputPath = process.env.OUTPUT_PATH ?? ".preview/preview.png";
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

const viewportWidth = Number(process.env.VIEWPORT_WIDTH ?? 1440);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT ?? 900);
const delaySeconds = Number(process.env.CAPTURE_DELAY_SECONDS ?? 3);

if (!pageUrl) {
  throw new Error("Missing PAGE_URL environment variable.");
}

if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
  throw new Error(`Invalid VIEWPORT_WIDTH: ${process.env.VIEWPORT_WIDTH}`);
}

if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
  throw new Error(`Invalid VIEWPORT_HEIGHT: ${process.env.VIEWPORT_HEIGHT}`);
}

if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
  throw new Error(`Invalid CAPTURE_DELAY_SECONDS: ${process.env.CAPTURE_DELAY_SECONDS}`);
}

await mkdir(dirname(outputPath), { recursive: true });

await captureWebsite.file(pageUrl, outputPath, {
  width: viewportWidth,
  height: viewportHeight,
  delay: delaySeconds,
  overwrite: true,
  type: "png",
  launchOptions: {
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
  },
});

console.log(`Captured ${pageUrl} -> ${outputPath}`);
