import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./tests/demo-browser",
  webServer: undefined,
  use: { ...base.use, baseURL: "http://localhost:6001" },
});
