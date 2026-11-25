import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { emptyEntry } from "../../src/lib/questions";

const id = "10000000-0000-4000-8000-000000000001";
const photoId = "10000000-0000-4000-8000-000000000002";
const settings = {
  available: true,
  submissions_open: true,
  welcome_text: "A warm hello from Raghav.",
};
const sample = {
  ...emptyEntry,
  id,
  name: "Aditi Sharma",
  nickname: "Adi",
  created_at: "2026-11-24T00:00:00Z",
  questionnaire_version: 1,
  contact_handle: "@aditi",
  answers: {
    ...emptyEntry.answers,
    how_we_met: "In the college canteen.",
    favourite_memory:
      "That rainy road trip when we missed our turn and found a much better adventure.",
    future_message: "Same time, same terrible jokes, ten years from now.",
  },
  entry_media: [],
};

async function openBook(page: Page) {
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: settings }),
  );
  await page.goto("/sign");
  await expect(page.getByLabel("What should I call you?")).toBeVisible();
}
async function fillRequired(page: Page) {
  await page.getByLabel("What should I call you?").fill("Aditi");
  await page
    .getByLabel("How did our paths cross?")
    .fill("The first day of college.");
  await page.getByRole("button", { name: "Keep going" }).click();
  await page
    .getByLabel("What’s a favourite memory we share?")
    .fill("The rainy road trip, obviously.");
  await page.getByRole("button", { name: "Keep going" }).click();
  await page
    .getByLabel("Leave a note for a few years from now.")
    .fill("Let’s do it all again.");
  await page.getByRole("button", { name: "Keep going" }).click();
}
async function mockOwner(page: Page) {
  await page.route("**/api/admin/session", (route) =>
    route.fulfill({ json: { settings } }),
  );
  await page.route("**/api/admin/entries?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({
      json: {
        entries:
          q && !"aditi sharma adi".includes(q.toLowerCase()) ? [] : [sample],
        total: q && !"aditi sharma adi".includes(q.toLowerCase()) ? 0 : 1,
        page: 1,
      },
    });
  });
  await page.route(`**/api/admin/entries/${id}`, (route) =>
    route.fulfill({ json: { entry: sample } }),
  );
}
async function expectNoOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
  }));
  expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
}

test("welcome invites friends without exposing submitted content", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Raghav’s Slambook",
  );
  await expect(page.getByText("Aditi Sharma")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign my slam book" }).click();
  await expect(page).toHaveURL(/\/sign$/);
});
test("required answers are clear, text survives refresh, and reset asks before clearing", async ({
  page,
}) => {
  await openBook(page);
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(page.getByText("Tell me your name.")).toBeVisible();
  await expect(page.getByLabel("What should I call you?")).toBeFocused();
  await page.getByLabel("What should I call you?").fill("Aditi");
  await page.getByLabel("How did our paths cross?").fill("At school");
  await page.reload();
  await expect(page.getByLabel("What should I call you?")).toHaveValue("Aditi");
  await expect(page.getByText("Welcome back. Your text draft")).toBeVisible();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page.getByRole("button", { name: "Keep my draft" }).click();
  await expect(page.getByLabel("What should I call you?")).toHaveValue("Aditi");
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page.getByRole("button", { name: "Yes, start fresh" }).click();
  await expect(page.getByLabel("What should I call you?")).toHaveValue("");
});

test("the optional memories note survives refresh and appears in preview, submission and owner view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const note = "I really appreciated those check-ins during exams.";
  const label = "Anything left unsaid?";
  await openBook(page);
  await page.getByLabel("What should I call you?").fill("Aditi");
  await page.getByLabel("How did our paths cross?").fill("At college");
  await page.getByRole("button", { name: "Keep going" }).click();
  await page
    .getByLabel("What’s a favourite memory we share?")
    .fill("The class trip");
  const field = page.getByLabel(label);
  await expect(field).toHaveJSProperty("required", false);
  await field.fill(note);
  await expectNoOverflow(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("raghav-slambook:draft:v1")!).entry
            .answers.unsaid_note,
      ),
    )
    .toBe(note);
  await page.reload();
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(page.getByLabel(label)).toHaveValue(note);
  await page.getByRole("button", { name: "Keep going" }).click();
  await page.getByRole("button", { name: "Keep going" }).click();
  await page.getByRole("button", { name: "Preview my page" }).click();
  await expect(page.getByRole("heading", { name: label })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ json: { submitted: false, files: [] } }),
  );
  await page.route("**/api/submissions", (route) => {
    expect(route.request().postDataJSON().entry.answers.unsaid_note).toBe(note);
    return route.fulfill({ json: { submitted: true } });
  });
  await page.getByRole("button", { name: "Send my page" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re part of the story." }),
  ).toBeVisible();
  await mockOwner(page);
  await page.route(`**/api/admin/entries/${id}`, (route) =>
    route.fulfill({
      json: {
        entry: { ...sample, answers: { ...sample.answers, unsaid_note: note } },
      },
    }),
  );
  await page.goto(`/admin/entries/${id}`);
  await expect(page.getByRole("heading", { name: label })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
});
test("phone gallery, captions, preview, interrupted submission, retry and draft clearing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#ffd7f0" },
  })
    .png()
    .toBuffer();
  const requestIds: string[] = [];
  let uploads = 0;
  let submissions = 0;
  await page.route("**/api/uploads", (route) => {
    const body = route.request().postDataJSON();
    requestIds.push(body.requestId);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].mime).toBe("image/jpeg");
    expect(body.files[0].size).toBeLessThanOrEqual(512_000);
    return route.fulfill({
      json: {
        submitted: false,
        files: body.files.map((file: { id: string }) => ({
          id: file.id,
          uploaded: uploads > 0,
          url: "http://127.0.0.1:3100/storage-test/photo",
        })),
      },
    });
  });
  await page.route("**/storage-test/photo", (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-submission-token"]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    uploads++;
    return route.fulfill({ json: { Key: "private/test" } });
  });
  await page.route("**/api/submissions", (route) => {
    submissions++;
    const body = route.request().postDataJSON();
    requestIds.push(body.requestId);
    expect(body.entry.name).toBe("Aditi");
    expect(body.media[0].caption).toBe("Still laughing about this.");
    return submissions === 1
      ? route.fulfill({
          status: 503,
          json: { error: "Connection interrupted. Please retry." },
        })
      : route.fulfill({ json: { submitted: true } });
  });
  await openBook(page);
  await fillRequired(page);
  await page
    .locator("#photos")
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("Selected photo 1")).toBeVisible();
  await page
    .getByLabel("A caption for this one")
    .fill("Still laughing about this.");
  await page.getByRole("button", { name: "Preview my page" }).click();
  await expect(
    page.getByRole("heading", { name: "A page worth keeping." }),
  ).toBeVisible();
  await expect(page.getByText("The rainy road trip, obviously.")).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "Send my page" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await page.getByRole("button", { name: "Send my page" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re part of the story." }),
  ).toBeFocused();
  expect(uploads).toBe(1);
  expect(new Set(requestIds).size).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("raghav-slambook:draft:v1")),
  ).toBeNull();
  await expectNoOverflow(page);
});
test("unsupported photos and more than three images are rejected without clearing answers", async ({
  page,
}) => {
  await openBook(page);
  await fillRequired(page);
  await page.locator("#photos").setInputFiles({
    name: "photo.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("heic"),
  });
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "JPEG, PNG, or WebP",
  );
  await page.locator("#photos").setInputFiles(
    Array.from({ length: 4 }, (_, i) => ({
      name: `photo${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from("x"),
    })),
  );
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "up to 3 photos",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByLabel("Leave a note for a few years from now."),
  ).toHaveValue("Let’s do it all again.");
});

test("malformed save acknowledgements retain the draft and allow an idempotent retry", async ({
  page,
}) => {
  const requestIds: string[] = [];
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ json: { submitted: false, files: [] } }),
  );
  await page.route("**/api/submissions", (route) => {
    requestIds.push(route.request().postDataJSON().requestId);
    return route.fulfill({
      json: requestIds.length === 1 ? {} : { submitted: true },
    });
  });
  await openBook(page);
  await fillRequired(page);
  await page.getByRole("button", { name: "Preview my page" }).click();
  await page.getByRole("button", { name: "Send my page" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "incomplete response",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("raghav-slambook:draft:v1")!).entry
          .name,
    ),
  ).toBe("Aditi");
  await page.getByRole("button", { name: "Send my page" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re part of the story." }),
  ).toBeFocused();
  expect(new Set(requestIds).size).toBe(1);
});

test("an open reset confirmation cannot clear a submission that is in progress", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ json: { submitted: false, files: [] } }),
  );
  await page.route("**/api/submissions", async (route) => {
    await pending;
    await route.fulfill({ json: { submitted: true } });
  });
  await openBook(page);
  await fillRequired(page);
  await page.getByRole("button", { name: "Preview my page" }).click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  const request = page.waitForRequest("**/api/submissions");
  await page.getByRole("button", { name: "Send my page" }).click();
  await request;
  try {
    await expect(
      page.getByRole("button", { name: "Yes, start fresh" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Keep my draft" }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "You’re part of the story." }),
  ).toBeFocused();
});

test("failed owner searches clear old results and lost owner access clears the private view", async ({
  page,
}) => {
  await mockOwner(page);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await page.route("**/api/admin/entries?*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "failure")
      return route.fulfill({
        status: 503,
        json: { error: "Temporary outage" },
      });
    if (query === "expired")
      return route.fulfill({
        status: 403,
        json: { error: "Owner access expired" },
      });
    return route.fulfill({ json: { entries: [sample], total: 1, page: 1 } });
  });
  await page.getByLabel("Search entries by name or nickname").fill("failure");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Temporary outage",
  );
  await expect(page.getByRole("heading", { name: "Aditi Sharma" })).toHaveCount(
    0,
  );
  await page.route("**/api/admin/entries?q=failure&*", (route) =>
    route.fulfill({ json: { entries: [sample], total: 1, page: 1 } }),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await page.getByLabel("Search entries by name or nickname").fill("");
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await page.getByLabel("Search entries by name or nickname").fill("expired");
  await expect(
    page.getByRole("button", { name: "Open my book" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aditi Sharma" })).toHaveCount(
    0,
  );
});

test("owner pagination recovers when another session deletes the last page", async ({
  page,
}) => {
  await mockOwner(page);
  let firstPageReads = 0;
  await page.route("**/api/admin/entries?*", (route) => {
    const number = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    if (number === 2)
      return route.fulfill({ json: { entries: [], total: 1, page: 2 } });
    firstPageReads++;
    return route.fulfill({
      json: {
        entries: [sample],
        total: firstPageReads === 1 ? 13 : 1,
        page: 1,
      },
    });
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => firstPageReads).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The best pages are still unwritten." }),
  ).toHaveCount(0);
});
test("closed book keeps the guest's draft and removes the submission action", async ({
  page,
}) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { ...settings, submissions_open: false } }),
  );
  await page.goto("/sign");
  await expect(
    page.getByRole("heading", { name: "A little pause between pages." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send my page" })).toHaveCount(
    0,
  );
});
test("direct owner APIs deny anonymous reads, exports, photos, mutations, and cleanup", async ({
  request,
}) => {
  for (const path of [
    "/api/admin/session",
    "/api/admin/entries",
    `/api/admin/entries/${id}`,
    `/api/admin/media/${photoId}`,
    "/api/admin/export",
    "/api/cron/cleanup",
  ])
    expect((await request.get(path)).status(), path).toBe(401);
  expect((await request.delete(`/api/admin/entries/${id}`)).status()).toBe(401);
  expect((await request.put(`/api/demo/uploads/${photoId}`)).status()).toBe(
    404,
  );
  expect(
    (
      await request.patch("/api/admin/settings", {
        data: { submissions_open: false },
      })
    ).status(),
  ).toBe(401);
});
test("owner can search, change submission status, edit the note, and delete an entry", async ({
  page,
}) => {
  await mockOwner(page);
  const updates: unknown[] = [];
  await page.route("**/api/admin/settings", (route) => {
    updates.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Aditi Sharma" }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("Nobody");
  await expect(
    page.getByRole("heading", { name: "No familiar faces by that name." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: "Close submissions", exact: true })
    .click();
  await page.getByRole("button", { name: "Yes, close submissions" }).click();
  await expect(
    page.getByText("Taking a little pause", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit welcome note" }).click();
  await page
    .getByLabel("Your note on the welcome page")
    .fill("A new warm hello.");
  await page.getByRole("button", { name: "Save welcome note" }).click();
  expect(updates).toEqual([
    { submissions_open: false },
    { welcome_text: "A new warm hello." },
  ]);
  await page.getByRole("link", { name: /Aditi Sharma/ }).click();
  await expect(page.getByText("In the college canteen.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Export this page" }),
  ).toHaveAttribute("href", `/api/admin/export?id=${id}`);
  await page.route(`**/api/admin/entries/${id}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ json: { deleted: true, photosRemoved: true } })
      : route.fulfill({ json: { entry: sample } }),
  );
  await page.getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Keep this memory" }).click();
  await expect(
    page.getByRole("heading", { name: "A page from Adi." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/admin\?deleted=1/);
});
for (const width of [320, 375, 390, 768, 1440]) {
  test(`responsive welcome, form, preview, confirmation, login, collection and entry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expectNoOverflow(page);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `artifacts/home-${width}.png`,
        fullPage: true,
      });
    await openBook(page);
    await expectNoOverflow(page);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `artifacts/form-${width}.png`,
        fullPage: true,
      });
    await fillRequired(page);
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Preview my page" }).click();
    await expectNoOverflow(page);
    await page.route("**/api/uploads", (route) =>
      route.fulfill({ json: { submitted: true, files: [] } }),
    );
    await page.getByRole("button", { name: "Send my page" }).click();
    await expect(
      page.getByRole("heading", { name: "You’re part of the story." }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page.goto("/admin");
    await expect(
      page.getByRole("button", { name: "Open my book" }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await mockOwner(page);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Aditi Sharma" }),
    ).toBeVisible();
    await expectNoOverflow(page);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `artifacts/owner-${width}.png`,
        fullPage: true,
      });
    await page.goto(`/admin/entries/${id}`);
    await expect(
      page.getByRole("heading", { name: "A page from Adi." }),
    ).toBeVisible();
    await expectNoOverflow(page);
  });
}
