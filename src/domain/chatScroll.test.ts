import { describe, expect, it } from "vitest";
import { isChatNearBottom } from "./chatScroll";

describe("chat scroll", () => {
  it("treats small remaining distance as near bottom", () => {
    expect(isChatNearBottom(1000, 920, 40)).toBe(true);
    expect(isChatNearBottom(1000, 900, 40)).toBe(false);
  });

  it("allows overriding the threshold", () => {
    expect(isChatNearBottom(1000, 850, 100, 60)).toBe(true);
    expect(isChatNearBottom(1000, 850, 100, 40)).toBe(false);
  });
});
