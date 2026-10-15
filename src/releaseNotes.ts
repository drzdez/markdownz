// Release notes shipped with the app: the <releases> of the AppStream metainfo, written for every version.

import metainfo from "../flatpak/io.github.drzdez.markdownz.metainfo.xml?raw";
import { compareVersions } from "./update";

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  paragraphs: string[];
}

/** Releases described in AppStream metainfo XML, newest first. */
export function parseReleases(xml: string): Release[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.querySelectorAll("releases > release")]
    .map((r) => ({
      version: r.getAttribute("version") ?? "",
      date: r.getAttribute("date") ?? "",
      paragraphs: [...r.querySelectorAll("description > p, description li")].map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim()),
    }))
    .filter((r) => r.version)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Releases newer than the last one the user saw, up to the running version; only the running one after a fresh install. */
export function releasesSince(releases: Release[], seen: string | undefined, current: string): Release[] {
  return releases.filter((r) => compareVersions(r.version, current) <= 0 && (seen ? compareVersions(r.version, seen) > 0 : r.version === current));
}

export const RELEASES = parseReleases(metainfo);

export const APP_VERSION: string = __APP_VERSION__;
