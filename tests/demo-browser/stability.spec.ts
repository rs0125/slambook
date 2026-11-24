import { test, expect } from "@playwright/test";

test("local preview stays on the homepage and preserves an in-progress form without automatic refreshes", async ({
  page,
}) => {
  const activity: { kind: string; value: string }[] = [];
  page.on("console", (message) => {
    if (/refresh|reload|hmr/i.test(message.text()))
      activity.push({ kind: "console", value: message.text() });
  });
  page.on("websocket", (socket) => {
    socket.on("framereceived", (event) => {
      const value = event.payload.toString();
      if (
        value.startsWith("{") &&
        /turbopack-message|reloadPage|building|built/.test(value)
      )
        activity.push({ kind: "websocket", value: value.slice(0, 1000) });
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Sign my slam book" }),
  ).toBeVisible();
  await page.waitForTimeout(2000);
  const repeatedRequests: string[] = [];
  let observedPath = "/";
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === observedPath)
      repeatedRequests.push(request.url());
  });
  await page.waitForTimeout(12000);
  expect(
    repeatedRequests,
    JSON.stringify(activity.slice(-20), null, 2),
  ).toEqual([]);
  await page.getByRole("link", { name: "Sign my slam book" }).click();
  await page.getByLabel("What should I call you?").fill("Stable preview check");
  await page
    .getByLabel("How did our paths cross?")
    .fill("Trying out the local book.");
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(
    page.getByRole("heading", { name: "The good old days." }),
  ).toBeFocused();
  const memory = page.getByLabel("What’s a favourite memory we share?");
  await memory.fill("This draft should stay right here while I think.");
  await expect(memory).toBeFocused();
  await page.waitForTimeout(2000);
  observedPath = "/sign";
  repeatedRequests.length = 0;
  await page.waitForTimeout(15000);
  expect(
    repeatedRequests,
    JSON.stringify(activity.slice(-20), null, 2),
  ).toEqual([]);
  await expect(memory).toHaveValue(
    "This draft should stay right here while I think.",
  );
  await expect(memory).toBeFocused();
});
