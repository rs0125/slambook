import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
await mkdir("artifacts", { recursive: true });
async function inspectType(page, label) {
  const result = await page.evaluate(() => {
    const sizes = new Set();
    const families = new Set();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (
        !node.textContent.trim() ||
        !element ||
        element.closest('script, style, [aria-hidden="true"]') ||
        !element.getClientRects().length
      )
        continue;
      const style = getComputedStyle(element);
      if (style.visibility !== "visible") continue;
      sizes.add(style.fontSize);
      families.add(style.fontFamily);
    }
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      sizes: [...sizes],
      fonts: [...families],
    };
  });
  console.log(JSON.stringify({ label, ...result }));
}
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto("http://localhost:6001/");
    await page.getByRole("link", { name: "Sign my slam book" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `artifacts/cover-${width}.png`,
      fullPage: true,
    });
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          viewport: [innerWidth, innerHeight],
          document: [
            document.documentElement.scrollWidth,
            document.documentElement.scrollHeight,
          ],
          title: document.querySelector("h1")?.getBoundingClientRect().toJSON(),
          animations: document.getAnimations().map((animation) => ({
            state: animation.playState,
            duration: animation.effect?.getTiming().duration,
          })),
        })),
      ),
    );
    if (width === 1440) {
      await page.waitForTimeout(5000);
      await page.screenshot({
        path: "artifacts/cover-1440-motion.png",
        fullPage: true,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      console.log(
        "Reduced-motion animations: " +
          (await page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((animation) => animation.playState === "running")
                .length,
          )),
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto("http://localhost:6001/sign");
      await page.getByLabel("What should I call you?").waitFor();
      await inspectType(page, "Desktop form typography");
      await page.screenshot({
        path: "artifacts/form-simplified-1440.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Keep going" })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: "artifacts/form-footer-1440.png" });
    }
    if (width === 390 || width === 320) {
      await page.goto("http://localhost:6001/sign");
      await page.getByLabel("What should I call you?").waitFor();
      await page.screenshot({
        path: `artifacts/form-simplified-${width}.png`,
        fullPage: true,
      });
      console.log(
        "Form animations: " +
          (await page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((animation) => animation.playState === "running")
                .length,
          )),
      );
      await inspectType(page, `Form typography at ${width}px`);
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "200%"),
      );
      await inspectType(page, `Form with 200% text at ${width}px`);
      await page.addStyleTag({
        content:
          "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
      });
      await inspectType(
        page,
        `Form with enlarged text and spacing at ${width}px`,
      );
      await page.screenshot({
        path: `artifacts/form-enlarged-${width}.png`,
        fullPage: true,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
