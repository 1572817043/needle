import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("styles", () => {
  it("keeps the prompt bar input shrinkable so the send button stays visible", () => {
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) auto auto;");
    expect(styles).toContain(".prompt-bar input");
    expect(styles).toContain("min-width: 0;");
  });

  it("keeps panel header text from stretching the layout", () => {
    expect(styles).toContain(".panel-header");
    expect(styles).toContain(".panel-header > div");
    expect(styles).toContain(".status-pill");
    expect(styles).toContain("text-overflow: ellipsis;");
    expect(styles).toContain("overflow-wrap: anywhere;");
  });

  it("gives the library view a fuller layout with a restrained active state", () => {
    expect(styles).toContain(".library-panel");
    expect(styles).toContain("align-content: start;");
    expect(styles).toContain(".library-panel-header");
    expect(styles).toContain(".song-list-summary");
    expect(styles).toContain(".song-list.compact");
    expect(styles).toContain(".song-row.is-active");
    expect(styles).toContain("border-left: 2px solid #087d68;");
    expect(styles).toContain(".song-playing-badge");
    expect(styles).toContain(".song-action-button");
    expect(styles).toContain(".library-empty");
  });
});
