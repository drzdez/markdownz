import packageJson from "../package.json?raw";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES, parseReleases, releasesSince } from "./releaseNotes";

const XML = `<component><releases>
  <release version="0.10.0" date="2026-10-20"><description><p>Ten.</p></description></release>
  <release version="0.9.1" date="2026-10-10"><description><p>Nine
    one.</p><ul><li>Item</li></ul></description></release>
  <release version="0.9.0" date="2026-10-01"><description><p>Nine.</p></description></release>
</releases></component>`;

describe("release notes", () => {
  it("parses AppStream releases, newest first", () => {
    const releases = parseReleases(XML);
    expect(releases.map((r) => r.version)).toEqual(["0.10.0", "0.9.1", "0.9.0"]);
    expect(releases[1]).toEqual({ version: "0.9.1", date: "2026-10-10", paragraphs: ["Nine one.", "Item"] });
  });

  it("shows the versions since the last seen one, or only the running one after an install", () => {
    const releases = parseReleases(XML);
    expect(releasesSince(releases, "0.9.0", "0.10.0").map((r) => r.version)).toEqual(["0.10.0", "0.9.1"]);
    expect(releasesSince(releases, undefined, "0.9.1").map((r) => r.version)).toEqual(["0.9.1"]);
    expect(releasesSince(releases, "0.10.0", "0.10.0")).toEqual([]);
  });

  it("has notes for the version in package.json", () => {
    const { version } = JSON.parse(packageJson);
    expect(APP_VERSION).toBe(version);
    expect(RELEASES[0].version).toBe(version);
    expect(RELEASES[0].paragraphs.length).toBeGreaterThan(0);
  });
});
