import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";

test("local demo opens the seeded owner collection without sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Local demo", { exact: true })).toBeVisible();
  await expect(page.getByText("Aditi Sharma")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/demo-home.png", fullPage: true });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "artifacts/demo-owner.png", fullPage: true });
  await page.getByRole("searchbox").fill("Meera");
  await expect(page.getByRole("heading", { name: "Meera Iyer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aditi Sharma" })).toHaveCount(
    0,
  );
});

test("guest can submit a real local photo entry, then owner can read, export, and delete it", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const name = `Demo check ${randomUUID().slice(0, 8)}`;
  let entryId: string | undefined;
  try {
    await page.goto("/sign");
    await page.getByLabel("What should I call you?").fill(name);
    await page
      .getByLabel("How did our paths cross?")
      .fill("Testing this local slambook.");
    await page.getByRole("button", { name: "Keep going" }).click();
    await page
      .getByLabel("What’s a favourite memory we share?")
      .fill("A very happy test drive.");
    await page.getByRole("button", { name: "Keep going" }).click();
    await page
      .getByLabel("Leave a note for a few years from now.")
      .fill("More stories to come.");
    await page.getByRole("button", { name: "Keep going" }).click();
    const image = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#ffd7f0" },
    })
      .png()
      .toBuffer();
    await page.locator("#photos").setInputFiles({
      name: "demo.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(page.getByAltText("Selected photo 1")).toBeVisible();
    await page
      .getByLabel("A caption for this one")
      .fill("Saved on this computer.");
    await page.getByRole("button", { name: "Preview my page" }).click();
    await page.getByRole("button", { name: "Send my page" }).click();
    await expect(
      page.getByRole("heading", { name: "You’re part of the story." }),
    ).toBeVisible();
    await page.goto("/admin");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(/\/admin\/entries\/[a-f0-9-]{36}$/);
    entryId = page.url().split("/").at(-1)!;
    await expect(page.getByText("A very happy test drive.")).toBeVisible();
    const photo = page.locator('img[src^="/api/admin/media/"]');
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
    const exported = await request.get(`/api/admin/export?id=${entryId}`);
    expect(exported.ok()).toBeTruthy();
    const files = unzipSync(await exported.body());
    expect(JSON.parse(strFromU8(files["entries.json"])).entries[0].name).toBe(
      name,
    );
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.entries[0].photos[0].caption).toBe(
      "Saved on this computer.",
    );
    expect(files[manifest.entries[0].photos[0].file].length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Delete entry" }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(/\/admin\?deleted=1$/);
    await expect(
      page.getByRole("heading", { name: "Aditi Sharma" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name })).toHaveCount(0);
    entryId = undefined;
  } finally {
    const result = await request.get(
      `/api/admin/entries?q=${encodeURIComponent(name)}`,
    );
    entryId = (await result.json()).entries?.[0]?.id;
    if (entryId)
      await request.delete(`/api/admin/entries/${entryId}`, {
        headers: { origin: "http://localhost:6001" },
      });
  }
});

test("local owner access rejects foreign hosts and cross-site writes", async ({
  request,
}) => {
  expect(
    (
      await request.get("/api/admin/session", {
        headers: { host: "foreign.test:6001" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.patch("/api/admin/settings", {
        headers: { origin: "https://foreign.test" },
        data: { submissions_open: false },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get("/api/settings")).ok()).toBeTruthy();
});
