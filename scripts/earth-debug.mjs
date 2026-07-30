import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("response", (r) => {
  if (r.url().includes("texture") || r.url().includes(".jpg") || r.url().includes(".png") || r.url().includes("fonts")) {
    logs.push(`[resp ${r.status()}] ${r.url().slice(0,120)}`);
  }
});
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(5000);
const sample = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { err: "no canvas" };
  return { w: c.width, h: c.height };
});
console.log(JSON.stringify({ sample, logs }, null, 2));
await page.screenshot({ path: "/workspace/screenshots/earthlink-debug.png" });
await browser.close();
