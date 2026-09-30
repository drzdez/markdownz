# Flatpak and Flathub

| File | Purpose |
|---|---|
| `io.github.drzdez.markdownz.yml` | Manifest; builds the current checkout (CI, local builds) |
| `io.github.drzdez.markdownz.desktop` | Launcher entry and `.md` file association |
| `io.github.drzdez.markdownz.metainfo.xml` | AppStream data shown in software centers and on Flathub |
| `cargo-sources.json`, `node-sources.json` | Offline dependency lists (Flatpak builds have no network) |
| `update-sources.sh` | Regenerates the two lists after dependency changes |

The app gets read-only access to the home directory (`--filesystem=home:ro`).
The document portal alone would expose just the opened file, which would break relative links, images next to the document and live reload.

## Build locally

On Linux with `flatpak-builder`:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak-builder --user --install-deps-from=flathub --install --force-clean flatpak/build flatpak/io.github.drzdez.markdownz.yml
flatpak run io.github.drzdez.markdownz README.md
```

Anywhere with Podman or Docker (produces `flatpak/markdownz.flatpak`):

```sh
podman run --rm --privileged -v "$PWD:/src" ghcr.io/flathub-infra/flatpak-github-actions:gnome-51 bash -c '
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo &&
  flatpak-builder --user --install-deps-from=flathub --force-clean --disable-rofiles-fuse \
    --state-dir=/tmp/state --repo=/tmp/repo /tmp/build /src/flatpak/io.github.drzdez.markdownz.yml &&
  flatpak build-bundle /tmp/repo /src/flatpak/markdownz.flatpak io.github.drzdez.markdownz \
    --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo'
```

Install the bundle with `flatpak install --user ./markdownz.flatpak`; the GNOME runtime is fetched from Flathub automatically.

## Releases

Pushing a `v*` tag builds the bundle in [`release.yml`](../.github/workflows/release.yml) and attaches `Markdownz_<version>_x86_64.flatpak` to the draft release.

## Publishing on Flathub

Flathub does not accept uploaded builds. It builds apps itself from a manifest kept in its own GitHub repository, so publishing happens in two stages.

**First submission (manual, reviewed by Flathub):**

1. Fork [flathub/flathub](https://github.com/flathub/flathub) and branch off `new-pr`.
2. Add `io.github.drzdez.markdownz.yml` (the manifest from this directory with the source switched to the release tag, see below), `cargo-sources.json` and `node-sources.json`.
3. Open a pull request against `new-pr` titled `Add io.github.drzdez.markdownz`. Reviewers check the manifest, permissions and metadata; the bot builds it on request (`bot, build`).
4. After merging, Flathub creates `github.com/flathub/io.github.drzdez.markdownz` and gives the submitter write access. Log in on flathub.org with GitHub to verify the `io.github.drzdez` app ID.

For Flathub, replace the `type: dir` source with the release tag:

```yaml
      - type: git
        url: https://github.com/drzdez/markdownz.git
        tag: v0.1.1
        commit: <full commit hash of the tag>
        x-checker-data:
          type: git
          tag-pattern: ^v([\d.]+)$
```

**Updates:** Flathub's external data checker notices new `v*` tags (thanks to `x-checker-data`) and opens a pull request in the Flathub repository. If dependencies changed, regenerate the sources (`update-sources.sh`) and add them to that pull request. Merging it publishes the new version.
