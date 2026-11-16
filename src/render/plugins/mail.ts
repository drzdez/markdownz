// E-mails from the mailz view (github.com/drzdez/mailz): message.md files and
// attachment cards. Their front matter says what they are (`mailz: message` or
// `mailz: attachment`, `mailz_schema: 1`; older views are recognized by the
// keys they always have). The front matter becomes a card with the headers,
// and the attachments become chips that open the attachment itself on one
// click, not its card. Harmful attachments, and ones still waiting for the
// antivirus, cannot be opened. Switched off, the files are plain Markdown.

import type { MarkdownIt } from "markdown-it";
import { parse as parseYaml } from "yaml";
import { readDoc } from "../../backend";
import { dirname, resolvePath } from "../../paths";
import type { ViewerPlugin } from "../types";
import { escapeHtml } from "../types";

/** The newest front matter schema of mailz this viewer knows; newer ones are shown as far as they match. */
export const MAILZ_SCHEMA = 1;

type Data = Record<string, unknown>;

/** What a mailz file is, from its front matter. */
export function mailKind(data: unknown): "message" | "attachment" | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Data;
  if (d.mailz === "message" || d.mailz === "attachment") return d.mailz;
  if (d.mailz !== undefined) return null;
  // Views written before mailz named its files.
  const has = (...keys: string[]) => keys.every((k) => k in d);
  if (has("mailz_id", "account", "subject", "attachments", "server_status")) return "message";
  if (has("mailz_id", "sha256", "content", "detected_type")) return "attachment";
  return null;
}

const text = (v: unknown) => (v === undefined || v === null ? "" : Array.isArray(v) ? v.map(String).join(", ") : String(v));

/** A UTC time of mailz in local time. */
export function localDate(iso: string): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return iso || "unknown";
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function sizeText(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const row = (label: string, value: string) => (value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : "");

/** The card of a message.md, from its front matter. */
export function messageCard(d: Data): string {
  const deleted = d.server_status === "deleted";
  const warnings = [
    Number(d.threats) > 0 ? `<p class="mdz-mail-warning">${Number(d.threats)} harmful attachment${Number(d.threats) > 1 ? "s" : ""}: their contents are not in the view. Do not trust links in this message.</p>` : "",
    d.incomplete ? `<p class="mdz-mail-warning">Incomplete: ${escapeHtml(text(d.incomplete))}</p>` : "",
  ].join("");
  return (
    `<div class="mdz-mail-card" data-mdz-mail="message"><p class="mdz-mail-kind">E-mail · ${escapeHtml(text(d.account))}</p>` +
    `<table class="mdz-mail-head">` +
    row("From", text(d.from)) +
    row("To", text(d.to)) +
    row("Cc", text(d.cc)) +
    row("Date", localDate(text(d.date))) +
    row("Folders", text(deleted ? d.last_folders : d.folders)) +
    row("Deleted on the server", deleted ? text(d.deleted_on_server) || "yes" : "") +
    `</table>${warnings}</div>\n`
  );
}

/** Where an attachment stands: can be opened, harmful, or waiting for the antivirus. */
export function attachmentState(d: Data): "view" | "threat" | "pending_check" {
  if (d.content_state === "threat" || d.threat) return "threat";
  if (d.content_state === "pending_check" || !d.content) return "pending_check";
  return "view";
}

/** The card of an attachment card file, from its front matter. */
export function attachmentCard(d: Data): string {
  const state = attachmentState(d);
  const open =
    state === "view"
      ? `<p><a class="mdz-mail-file" href="${escapeHtml(text(d.content))}"><span class="mdz-mail-file-name">Open ${escapeHtml(text(d.name))}</span></a></p>`
      : state === "threat"
        ? `<p class="mdz-mail-warning">Harmful, not in the view: ${escapeHtml(text(d.threat))}</p>`
        : `<p class="mdz-mail-note">Waiting for the antivirus check; the content is added after it.</p>`;
  return (
    `<div class="mdz-mail-card" data-mdz-mail="attachment"><p class="mdz-mail-kind">E-mail attachment</p><table class="mdz-mail-head">` +
    row("Type", text(d.detected_type)) +
    row("Size", sizeText(d.size)) +
    row("Encrypted", d.encrypted === true ? "yes, or protected by a password" : "") +
    row("Warning", d.type_mismatch === true ? "the extension does not match the content" : "") +
    row("Antivirus", text(d.scan)) +
    row("Released", d.released_as_false_alarm ? `as a false alarm on ${text(d.released_as_false_alarm)}` : "") +
    `</table>${open}<p class="mdz-mail-note"><a href="${escapeHtml(text(d.message) || "../message.md")}">Back to the message</a></p></div>\n`
  );
}

function setup(md: MarkdownIt): void {
  const previous = md.renderer.rules.front_matter;
  md.renderer.rules.front_matter = (tokens, idx, options, env, self) => {
    const raw = tokens[idx].meta as unknown as string;
    let data: unknown;
    try {
      data = parseYaml(raw);
    } catch {
      data = null;
    }
    const kind = mailKind(data);
    if (kind === "message") return messageCard(data as Data);
    if (kind === "attachment") return attachmentCard(data as Data);
    return previous ? previous(tokens, idx, options, env, self) : "";
  };
}

/** Front matter of a Markdown file (null when it has none or it is not YAML). */
export function frontMatterOf(source: string): Data | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!m) return null;
  try {
    const data = parseYaml(m[1]);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Data) : null;
  } catch {
    return null;
  }
}

/** The list of headers in the body (From, To, …) that the card replaces. */
function headerList(root: HTMLElement): HTMLElement | null {
  for (const ul of Array.from(root.querySelectorAll<HTMLElement>(":scope > ul"))) {
    const first = ul.querySelector(":scope > li > strong");
    if (first && /^From:?$/.test(first.textContent?.trim() ?? "")) return ul;
  }
  return null;
}

/** Turns the attachment list of a message into chips opening the attachments themselves. */
async function enhanceMessage(root: HTMLElement, card: HTMLElement, docPath: string): Promise<void> {
  headerList(root)?.remove();
  const heading = Array.from(root.querySelectorAll<HTMLElement>(":scope > h2")).find((h) => h.textContent?.trim() === "Attachments");
  let next = heading?.nextElementSibling;
  // Skip the source line anchors between blocks (see sourceLines in renderer.ts).
  while (next?.classList.contains("mdz-src")) next = next.nextElementSibling;
  const list = next?.tagName === "UL" ? (next as HTMLElement) : null;
  if (!heading || !list) return;
  const links = Array.from(list.querySelectorAll<HTMLAnchorElement>(":scope > li > a[href]")).filter((a) => /\.md$/i.test(decodeURIComponent(a.getAttribute("href")!)));
  if (!links.length) return;
  const box = document.createElement("div");
  box.className = "mdz-mail-files";
  const head = document.createElement("p");
  head.className = "mdz-mail-files-head";
  head.textContent = `${links.length} ${links.length === 1 ? "attachment" : "attachments"}`;
  box.append(head);
  const base = dirname(docPath);
  await Promise.all(
    links.map(async (a) => {
      const cardHref = decodeURIComponent(a.getAttribute("href")!);
      const chip = document.createElement("a");
      chip.className = "mdz-mail-file";
      const name = document.createElement("span");
      name.className = "mdz-mail-file-name";
      name.textContent = a.textContent ?? "";
      const size = document.createElement("span");
      size.className = "mdz-mail-file-size";
      chip.append(name, " ", size);
      const info = document.createElement("a");
      info.className = "mdz-mail-file-card";
      info.href = a.getAttribute("href")!;
      info.textContent = "ⓘ";
      info.title = "The attachment's card: type, size, antivirus";
      let data: Data | null = null;
      try {
        data = frontMatterOf((await readDoc(resolvePath(base, cardHref))).content);
      } catch {
        data = null;
      }
      if (data && mailKind(data) === "attachment") {
        size.textContent = sizeText(data.size);
        const state = attachmentState(data);
        if (state === "view") {
          // The content path is relative to the card, which lies in attachments/ of the message.
          chip.setAttribute("href", `${dirname(cardHref).replace(/\\/g, "/")}/${text(data.content)}`);
          chip.title = `Open ${name.textContent}${data.encrypted === true ? " (encrypted)" : ""}`;
        } else {
          chip.classList.add(state === "threat" ? "mdz-mail-file-threat" : "mdz-mail-file-pending");
          chip.title = state === "threat" ? `Harmful, not in the view: ${text(data.threat)}` : "Waiting for the antivirus check";
          size.textContent = state === "threat" ? "harmful" : "not checked yet";
        }
      } else {
        // No card to read: the link goes to the card, as in the plain file.
        chip.setAttribute("href", a.getAttribute("href")!);
        chip.title = "Open the attachment's card";
      }
      const item = document.createElement("span");
      item.className = "mdz-mail-file-item";
      item.append(chip, info);
      return item;
    }),
  ).then((items) => box.append(...items));
  card.after(box);
  heading.remove();
  list.remove();
}

export const mailPlugin: ViewerPlugin = {
  id: "mailz",
  name: "E-mails from mailz",
  description: "Messages of the mailz view as a card with the headers, attachments open on one click",
  defaultEnabled: true,
  setup,
  async postRender(root, ctx) {
    const card = root.querySelector<HTMLElement>(':scope > .mdz-mail-card[data-mdz-mail="message"]');
    if (card) await enhanceMessage(root, card, ctx.docPath);
  },
};
