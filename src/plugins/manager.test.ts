import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../state";
import { APP_VERSION } from "../releaseNotes";
import { PLUGIN_API, type PluginManifest } from "./api";
import { formatSize, indexUrl, isOutdated } from "./manager";

const plugin = (version: string, api = PLUGIN_API): PluginManifest => ({
  id: "dxf",
  name: "DXF drawings",
  description: "",
  extensions: ["dxf"],
  api,
  version,
  size: 1,
  url: "",
  signature: "",
});

describe("plugins", () => {
  it("come from the release of the running version unless the config says otherwise", () => {
    expect(indexUrl(DEFAULT_CONFIG)).toBe(`https://github.com/drzdez/markdownz/releases/download/v${APP_VERSION}/plugins.json`);
    expect(indexUrl({ ...DEFAULT_CONFIG, pluginIndex: "http://127.0.0.1:8765/plugins.json" })).toBe("http://127.0.0.1:8765/plugins.json");
  });

  it("are updated when the release has another version or the API changed", () => {
    expect(isOutdated(plugin("0.4.6"), plugin("0.4.7"))).toBe(true);
    expect(isOutdated(plugin("0.4.7"), plugin("0.4.7"))).toBe(false);
    expect(isOutdated(plugin("0.4.7", PLUGIN_API - 1), undefined)).toBe(true);
    // Never "updated" to a plugin this version cannot load.
    expect(isOutdated(plugin("0.4.6"), plugin("0.5.0", PLUGIN_API + 1))).toBe(false);
  });

  it("show their size", () => {
    expect(formatSize(84_000)).toBe("82 kB");
    expect(formatSize(1_452_000)).toBe("1.4 MB");
  });
});
