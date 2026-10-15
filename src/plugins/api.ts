// What a format plugin module gets from the app and must give back.
//
// A plugin is one ES module (plugins/<id>/ in the repository, built into
// markdownz-plugin-<id>.js and signed with the updater key). Its default
// export receives the PluginApi and returns the views for its files.

import type { DocumentView, ViewHost } from "../formats/types";
import type { ToImage } from "../formats/image";
import type { BytesToMarkdown } from "../formats/markdown";
import type { el } from "../ui/overlay";

/** Version of this contract; a plugin built for another one is offered as an update instead of loaded. */
export const PLUGIN_API = 1;

export interface PluginApi {
  api: number;
  appVersion: string;
  /** Contents of the document being shown. */
  readBinary(path: string): Promise<Uint8Array>;
  /** URL of a local file the WebView can fetch (files next to the document, e.g. glTF buffers and textures). */
  fileUrl(path: string): string;
  /** UTF-8, or UTF-16 with a byte order mark. */
  decodeText(data: Uint8Array): string;
  /** The app's Markdown view for a file turned into Markdown (search, outline, pages and print included); HTML in it is sanitized. */
  createMarkdownView(host: ViewHost, toMarkdown: BytesToMarkdown): DocumentView;
  /** The app's picture view (fit to window, zoom, print at the stored dpi) for a file turned into a PNG or JPEG. */
  createImageView(toImage: ToImage): DocumentView;
  el: typeof el;
}

export interface PluginInstance {
  /** A view for the file at `path` (it may look at the file to choose one); it then loads the file itself. */
  createView(host: ViewHost, path: string): DocumentView | Promise<DocumentView>;
}

export interface PluginModule {
  /** The PLUGIN_API the plugin was built for. */
  api: number;
  default(api: PluginApi): PluginInstance;
}

/** An entry of plugins.json in the release; stored with the installed plugin. */
export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  /** Lower-case file extensions without the dot. */
  extensions: string[];
  api: number;
  /** App version the plugin was released with. */
  version: string;
  /** Size of the plugin file in bytes. */
  size: number;
  url: string;
  /** Base64 minisign signature (tauri signer sign). */
  signature: string;
}

export interface PluginIndex {
  version: string;
  api: number;
  plugins: PluginManifest[];
}
