import { describe, expect, it } from "vitest";
import { DOUBLE_TAB_MS, doubleTabMs } from "../state";
import { doubleTabSetting } from "./dialogs";

const tab = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));

describe("double Tab", () => {
  it("has a default gap and keeps the setting within limits", () => {
    expect(doubleTabMs({})).toBe(DOUBLE_TAB_MS);
    expect(doubleTabMs({ doubleTabMs: 250 })).toBe(250);
    expect(doubleTabMs({ doubleTabMs: 5 })).toBe(120);
    expect(doubleTabMs({ doubleTabMs: 5000 })).toBe(800);
  });

  it("can be tried in the settings: quick presses are a double Tab, slow ones two single Tabs", () => {
    let ms = 300;
    let clock = 1000;
    const real = performance.now.bind(performance);
    performance.now = () => clock;
    try {
      const group = doubleTabSetting(() => ms, (v) => (ms = v));
      const pad = group.querySelector<HTMLElement>(".mdz-tab-test")!;
      tab(pad);
      expect(pad.dataset.result).toBe("single");
      clock += 200;
      tab(pad);
      expect(pad.dataset.result).toBe("double");
      expect(pad.textContent).toContain("200 ms");
      tab(pad);
      clock += 400;
      tab(pad);
      expect(pad.dataset.result).toBe("single");
      expect(pad.textContent).toContain("400 ms > 300 ms");
      const input = group.querySelector<HTMLInputElement>("input")!;
      input.value = "500";
      input.dispatchEvent(new Event("change"));
      expect(ms).toBe(500);
      clock += 450;
      tab(pad);
      expect(pad.dataset.result).toBe("double");
      input.value = "9";
      input.dispatchEvent(new Event("change"));
      expect(ms).toBe(500);
      expect(input.value).toBe("500");
    } finally {
      performance.now = real;
    }
  });
});
