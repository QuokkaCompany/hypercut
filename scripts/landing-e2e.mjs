import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { preview } from "vite";
const server = process.env.HYPERCUT_LANDING_URL
  ? null
  : await preview({
      configFile: false,
      build: { outDir: "site-dist" },
      preview: { host: "127.0.0.1", port: 0, strictPort: true },
    });
const base =
  process.env.HYPERCUT_LANDING_URL ||
  `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch(
  process.env.CI ? {} : { channel: "chrome" },
);
const evidence = "test-output/landing";
await mkdir(evidence, { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (new URL(req.url()).origin !== new URL(base).origin)
      external.push(req.url());
  });
  await page.addInitScript(() => {
    window.audioEvidence = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      window.audioEvidence.push({ duration: this.buffer.duration, audible: this.buffer.getChannelData(0).some(v => Math.abs(v) > 0.01) });
      return start.apply(this, args);
    };
  });
  await page.goto(base);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => {
        img.loading = "eager";
        return img.decode();
      }),
    );
  });
  await page.screenshot({ path: `${evidence}/desktop.png`, fullPage: true });
  await page.screenshot({ path: `${evidence}/hero.png` });
  assert.match(await page.locator("h1").innerText(), /Without the pauses/);
  assert.equal(await page.locator(".savings strong").innerText(), "4.27s");
  await page.getByLabel("Silence threshold").fill("-55");
  assert.equal(await page.locator(".savings strong").innerText(), "0.00s");
  await page.getByLabel("Silence threshold").fill("-40");
  await page
    .getByRole("button", { name: "Restore pause 1, 1.05 seconds", exact: true })
    .click();
  assert.equal(await page.locator(".savings strong").innerText(), "3.22s");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  assert.match(await page.locator(".timecode").innerText(), /7.90/);
  await page.getByRole("button", { name: "HyperCut", exact: true }).click();
  assert.match(await page.locator(".timecode").innerText(), /3.63/);
  await page
    .getByRole("button", { name: "Play audio preview" })
    .click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".timecode").textContent.split("/")[0]) >
      0.1,
  );
  await page.getByRole("button", { name: "Pause timeline preview" }).click();
  const audio = await page.evaluate(() => window.audioEvidence);
  assert.equal(audio.length, 1);
  assert.equal(audio[0].audible, true);
  assert.ok(Math.abs(audio[0].duration - 3.633) < .002);
  const paused = await page.locator(".timecode").innerText();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".timecode").innerText(), paused);
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await page.getByRole("button", { name: "Play audio preview" }).click();
  await page.waitForFunction(() => window.audioEvidence.length === 2);
  assert.ok(Math.abs((await page.evaluate(() => window.audioEvidence[1].duration)) - 7.903) < .002);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "emphasis", exact: true }).click();
  assert.equal(await page.locator(".caption-emphasis").count(), 1);
  await page.getByLabel("Sample caption language").selectOption("ja");
  assert.match(await page.locator(".sample-caption").innerText(), /アイデア/);
  await page.getByRole("button", { name: "Self-host", exact: true }).click();
  assert.match(await page.locator("pre").innerText(), /docker compose/);
  await page
    .getByRole("button", { name: "Copy installation commands" })
    .click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /docker compose up/,
  );
  await page.getByRole("button", { name: "Run locally", exact: true }).click();
  assert.match(await page.locator("pre").innerText(), /npm start/);
  await page.getByText("Is HyperCut free?", { exact: true }).click();
  assert.equal(await page.locator("details[open]").count(), 1);
  await page
    .getByRole("button", { name: "Watch the 30-second story" })
    .click();
  await page.locator("dialog[open]").waitFor();
  await page.waitForFunction(
    () => document.querySelector("dialog video").readyState >= 2,
  );
  assert.equal(await page.locator("dialog video").evaluate(el => el.muted), false);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Watch the 30-second story" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Horizontal overflow at ${width}px`,
    );
    await page.getByLabel("Silence threshold").focus();
    await page.keyboard.press("Home");
    assert.equal(
      await page.getByLabel("Silence threshold").inputValue(),
      "-55",
    );
    await page.getByRole("button", { name: "Reset demo" }).click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${evidence}/${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).scrollBehavior),
    "auto",
  );
  await page.waitForTimeout(50);
  assert.equal(await page.locator(".workflow").evaluate(el => getComputedStyle(el).transform), "none");
  assert.deepEqual(errors, []);
  console.log(
    "PASS landing: threshold, restore/reset, original/edited playback, caption styles/languages, install tabs/copy, FAQ, real video modal/Escape/focus return, 320/390/768px layouts, reduced motion, zero external requests and page errors.",
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
