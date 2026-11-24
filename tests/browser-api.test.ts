import { test } from "node:test";
import assert from "node:assert/strict";
import { api, RequestError } from "../src/lib/browser-api";
import { submittedResponseSchema } from "../src/lib/questions";

test("successful HTTP responses with invalid JSON never acknowledge a save", async (t) => {
  for (const body of [
    "<html>Upstream error</html>",
    "not JSON",
    "null",
    "[]",
  ]) {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(body, {
          headers: { "Content-Type": "application/json" },
        }),
    );
    await assert.rejects(
      api("/api/submissions", { method: "POST" }),
      (error: unknown) =>
        error instanceof RequestError && error.code === "INVALID_RESPONSE",
    );
    t.mock.restoreAll();
  }
});

test("request headers preserve Headers and tuple inputs", async (t) => {
  const received: Headers[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      received.push(new Headers(init.headers));
      return Response.json({ ok: true });
    },
  );
  await api("/api/test", { headers: new Headers({ "X-Test": "headers" }) });
  await api("/api/test", { headers: [["X-Test", "tuples"]] });
  assert.deepEqual(
    received.map((headers) => headers.get("X-Test")),
    ["headers", "tuples"],
  );
  assert.equal(received[0].get("Content-Type"), "application/json");
});

test("HTTP failures retain their status and useful validation details", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: "Please check your name.",
        code: "INVALID_ENTRY",
        fields: { name: "Required" },
      },
      { status: 400 },
    ),
  );
  await assert.rejects(
    api("/api/test"),
    (error: unknown) =>
      error instanceof RequestError &&
      error.status === 400 &&
      error.fields?.name === "Required",
  );
});

test("a save needs an explicit valid acknowledgement", async (t) => {
  for (const response of [{}, { submitted: false }, { submitted: "true" }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(response));
    await assert.rejects(
      api(
        "/api/submissions",
        { method: "POST" },
        {
          schema: submittedResponseSchema,
        },
      ),
      (error: unknown) =>
        error instanceof RequestError && error.code === "INVALID_RESPONSE",
    );
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ submitted: true }),
  );
  assert.deepEqual(
    await api(
      "/api/submissions",
      { method: "POST" },
      {
        schema: submittedResponseSchema,
      },
    ),
    { submitted: true },
  );
});

test("a hung request times out and aborts its transport", async (t) => {
  let signal: AbortSignal | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal = init.signal!;
        signal.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
      }),
  );
  await assert.rejects(
    api("/api/test", undefined, { timeoutMs: 10 }),
    (error: unknown) =>
      error instanceof RequestError && error.code === "REQUEST_TIMEOUT",
  );
  assert.equal(signal?.aborted, true);
});

test("caller cancellation stays distinguishable from network failure", async (t) => {
  const controller = new AbortController();
  const reason = new DOMException("View changed", "AbortError");
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(init.signal!.reason),
          { once: true },
        );
      }),
  );
  const request = api("/api/test", { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(request, (error: unknown) => error === reason);
});
