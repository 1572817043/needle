import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8")
) as {
  app?: {
    security?: {
      csp?: string;
    };
  };
};

describe("tauri config", () => {
  it("allows packaged audio playback from generated data URLs", () => {
    const csp = tauriConfig.app?.security?.csp ?? "";

    expect(csp).toContain("media-src");
    expect(csp).toContain("data:");
  });
});
