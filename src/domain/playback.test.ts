import { describe, expect, it } from "vitest";
import {
  calculateProgressPercent,
  calculateSeekTime,
  createAudioPlayerKey,
  formatPlaybackTime,
  toPlayableLocalSrc
} from "./playback";

describe("playback", () => {
  it("uses Tauri converter for local files in desktop mode", () => {
    const src = toPlayableLocalSrc("/Users/a0000/Music/Needle/demo.m4a", "tauri", (path) => {
      return `asset://localhost/${path}`;
    });

    expect(src).toBe("asset://localhost//Users/a0000/Music/Needle/demo.m4a");
  });

  it("uses file URL fallback in browser preview mode", () => {
    expect(toPlayableLocalSrc("/Users/a0000/Music/Needle/demo.m4a", "browser", () => "")).toBe(
      "file:///Users/a0000/Music/Needle/demo.m4a"
    );
  });
});

describe("formatPlaybackTime", () => {
  it("formats zero", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
  });

  it("formats seconds only", () => {
    expect(formatPlaybackTime(5)).toBe("0:05");
  });

  it("formats minutes and seconds", () => {
    expect(formatPlaybackTime(83)).toBe("1:23");
  });

  it("formats over 10 minutes", () => {
    expect(formatPlaybackTime(605)).toBe("10:05");
  });

  it("truncates fractional seconds", () => {
    expect(formatPlaybackTime(83.7)).toBe("1:23");
  });

  it("handles negative input", () => {
    expect(formatPlaybackTime(-5)).toBe("0:00");
  });

  it("handles Infinity", () => {
    expect(formatPlaybackTime(Infinity)).toBe("0:00");
  });

  it("handles NaN", () => {
    expect(formatPlaybackTime(NaN)).toBe("0:00");
  });
});

describe("calculateProgressPercent", () => {
  it("returns 0 when total is 0", () => {
    expect(calculateProgressPercent(0, 0)).toBe(0);
  });

  it("returns 0 when total is negative", () => {
    expect(calculateProgressPercent(0, -10)).toBe(0);
  });

  it("returns 0 when total is Infinity", () => {
    expect(calculateProgressPercent(0, Infinity)).toBe(0);
  });

  it("returns 0 at start", () => {
    expect(calculateProgressPercent(0, 100)).toBe(0);
  });

  it("returns 100 at end", () => {
    expect(calculateProgressPercent(100, 100)).toBe(100);
  });

  it("returns 50 at midpoint", () => {
    expect(calculateProgressPercent(30, 60)).toBe(50);
  });

  it("clamps to 100 when current exceeds total", () => {
    expect(calculateProgressPercent(200, 100)).toBe(100);
  });

  it("clamps to 0 when current is negative", () => {
    expect(calculateProgressPercent(-10, 100)).toBe(0);
  });
});

describe("calculateSeekTime", () => {
  it("returns 0 when total is unavailable", () => {
    expect(calculateSeekTime(50, 0)).toBe(0);
  });

  it("maps midpoint percent to time", () => {
    expect(calculateSeekTime(50, 200)).toBe(100);
  });

  it("clamps percent below 0", () => {
    expect(calculateSeekTime(-20, 200)).toBe(0);
  });

  it("clamps percent above 100", () => {
    expect(calculateSeekTime(140, 200)).toBe(200);
  });
});

describe("createAudioPlayerKey", () => {
  it("changes when playback instance changes", () => {
    expect(createAudioPlayerKey(1)).not.toBe(createAudioPlayerKey(2));
  });

  it("does not include the audio source in the key", () => {
    expect(createAudioPlayerKey(7)).toBe("audio-7");
  });
});
