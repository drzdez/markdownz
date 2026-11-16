// Czech data box messages (ISDS, "datová schránka"): .zfo files.
//
// A .zfo file is a CMS (PKCS#7) SignedData envelope, signed by the data box
// system, around an XML document: a received or sent message (envelope data
// and files in base64) or a delivery receipt (envelope data and events).
// The view shows the envelope as a card, the files as one-click links (the
// file is written to a temporary folder and opened in a new tab, or shown in
// the file manager when Markdownz has no viewer for it) and the main HTML or
// text file inline. Everything else (find, outline, pages, print) is the
// Markdown view's. The signature is not verified yet, and the view says so.

import * as backend from "../backend";
import { extname } from "../paths";
import { hashText } from "../print/orientation";
import { escapeHtml } from "../render/types";
import { createConvertedView } from "./markdown";
import type { FormatPlugin, ViewHost } from "./types";

// ------------------------------------------------------------ CMS (BER)

interface Ber {
  tag: number;
  constructed: boolean;
  /** Content bytes (primitive) or children (constructed). */
  content: Uint8Array;
  children: Ber[];
  end: number;
}

/** Reads one BER element at `pos` (definite and indefinite lengths, one-byte tags up to 30 and long tags). */
function readBer(data: Uint8Array, pos: number, depth = 0): Ber {
  if (depth > 64) throw new Error("nested too deeply");
  if (pos + 2 > data.length) throw new Error("truncated");
  const first = data[pos++];
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let b: number;
    do {
      if (pos >= data.length) throw new Error("truncated");
      b = data[pos++];
      tag = tag * 128 + (b & 0x7f);
    } while (b & 0x80);
  }
  tag |= (first & 0xc0) << 8; // class bits kept apart from the number
  let length = data[pos++];
  let indefinite = false;
  if (length === 0x80) indefinite = true;
  else if (length & 0x80) {
    const n = length & 0x7f;
    if (n > 4) throw new Error("too long");
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + data[pos++];
  }
  if (!constructed) {
    if (indefinite) throw new Error("bad length");
    if (pos + length > data.length) throw new Error("truncated");
    return { tag, constructed, content: data.subarray(pos, pos + length), children: [], end: pos + length };
  }
  const children: Ber[] = [];
  if (indefinite) {
    while (!(data[pos] === 0 && data[pos + 1] === 0)) {
      const child = readBer(data, pos, depth + 1);
      children.push(child);
      pos = child.end;
    }
    return { tag, constructed, content: new Uint8Array(), children, end: pos + 2 };
  }
  const end = pos + length;
  if (end > data.length) throw new Error("truncated");
  while (pos < end) {
    const child = readBer(data, pos, depth + 1);
    children.push(child);
    pos = child.end;
  }
  return { tag, constructed, content: new Uint8Array(), children, end };
}

const SEQUENCE = 0x10;
const OCTET_STRING = 0x04;
const OID = 0x06;
const CONTEXT_0 = 0x8000;
/** 1.2.840.113549.1.7.2 */
const SIGNED_DATA = "2a864886f70d010702";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** All bytes of an OCTET STRING, also when it is split into pieces (constructed). */
function octets(e: Ber): Uint8Array {
  if (!e.constructed) return e.content;
  const parts = e.children.map(octets);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The signed content of a CMS SignedData envelope (the XML of a data box message). */
export function signedContent(data: Uint8Array): Uint8Array {
  let root: Ber;
  try {
    root = readBer(data, 0);
  } catch (e) {
    throw new Error(`Not a signed data box message (${(e as Error).message}).`);
  }
  const [type, wrapped] = root.children;
  if (root.tag !== SEQUENCE || type?.tag !== OID || hex(type.content) !== SIGNED_DATA || wrapped?.tag !== CONTEXT_0) {
    throw new Error("Not a signed data box message (no CMS SignedData).");
  }
  const signed = wrapped.children[0];
  const encap = signed?.children.find((c, i) => i > 0 && c.tag === SEQUENCE);
  const content = encap?.children[1];
  const value = content?.tag === CONTEXT_0 ? content.children[0] : undefined;
  if (!value || value.tag !== OCTET_STRING) throw new Error("The signed envelope holds no message.");
  return octets(value);
}

// ------------------------------------------------------------ message

export interface ZfoFile {
  name: string;
  mime: string;
  /** main, enclosure, signature or meta. */
  role: string;
  /** Base64 contents (XML contents are serialized and encoded too). */
  base64: string;
  size: number;
}

export interface ZfoEvent {
  time: string;
  text: string;
}

export interface ZfoMessage {
  kind: "received" | "sent" | "delivery" | "message";
  /** Envelope fields by their ISDS name (dmID, dmAnnotation, dmSender, …). */
  fields: Record<string, string>;
  files: ZfoFile[];
  events: ZfoEvent[];
}

const ENVELOPE_FIELDS = [
  "dmID", "dbIDSender", "dmSender", "dmSenderAddress", "dmSenderType", "dmSenderOrgUnit", "dmSenderOrgUnitNum", "dmSenderRefNumber", "dmSenderIdent",
  "dbIDRecipient", "dmRecipient", "dmRecipientAddress", "dmRecipientOrgUnit", "dmRecipientOrgUnitNum", "dmRecipientRefNumber", "dmRecipientIdent",
  "dmToHands", "dmAnnotation", "dmLegalTitleLaw", "dmLegalTitleYear", "dmLegalTitleSect", "dmLegalTitlePar", "dmLegalTitlePoint",
  "dmPersonalDelivery", "dmAllowSubstDelivery", "dmAmbiguousRecipient", "dmType",
  "dmDeliveryTime", "dmAcceptanceTime", "dmMessageStatus", "dmAttachmentSize",
];

const base64Size = (b64: string) => {
  const clean = b64.replace(/\s+/g, "");
  return Math.max(0, Math.floor((clean.length * 3) / 4) - (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0));
};

const utf8ToBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Reads the XML of a data box message or delivery receipt. */
export function parseMessage(xml: string): ZfoMessage {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("The message is not valid XML.");
  const root = doc.documentElement.localName;
  const first = (name: string) => doc.getElementsByTagNameNS("*", name)[0];
  const fields: Record<string, string> = {};
  for (const name of ENVELOPE_FIELDS) {
    const e = first(name);
    const text = e?.textContent?.trim();
    if (text) fields[name] = text;
  }
  // The envelope's own attributes (dmType: kind of message, e.g. commercial).
  const dm = first("dmDm");
  if (dm?.getAttribute("dmType")) fields.dmType = dm.getAttribute("dmType")!;
  const files: ZfoFile[] = [];
  for (const f of Array.from(doc.getElementsByTagNameNS("*", "dmFile"))) {
    const encoded = f.getElementsByTagNameNS("*", "dmEncodedContent")[0];
    const xmlContent = f.getElementsByTagNameNS("*", "dmXMLContent")[0];
    const base64 = encoded ? (encoded.textContent ?? "").replace(/\s+/g, "") : xmlContent ? utf8ToBase64(new XMLSerializer().serializeToString(xmlContent.firstElementChild ?? xmlContent)) : "";
    files.push({
      name: f.getAttribute("dmFileDescr") || `file ${files.length + 1}`,
      mime: f.getAttribute("dmMimeType") ?? "",
      role: f.getAttribute("dmFileMetaType") ?? "",
      base64,
      size: base64Size(base64),
    });
  }
  const events: ZfoEvent[] = Array.from(doc.getElementsByTagNameNS("*", "dmEvent")).map((e) => ({
    time: e.getElementsByTagNameNS("*", "dmEventTime")[0]?.textContent?.trim() ?? "",
    text: e.getElementsByTagNameNS("*", "dmEventDescr")[0]?.textContent?.trim() ?? "",
  }));
  const kind = /Delivery/i.test(root) ? "delivery" : /Sent/i.test(root) ? "sent" : /MessageDownload/i.test(root) ? "received" : "message";
  return { kind, fields, files, events };
}

// ------------------------------------------------------------ Markdown

const STATUS: Record<string, string> = {
  "1": "submitted",
  "2": "time-stamped",
  "3": "refused by the virus check",
  "4": "delivered to the data box",
  "5": "deemed received (10 days passed)",
  "6": "received (the recipient logged in)",
  "7": "read",
  "8": "undeliverable (the data box was made inaccessible)",
  "9": "content deleted",
  "10": "in the data vault",
};

const SENDER_TYPE: Record<string, string> = {
  "10": "public authority",
  "20": "legal entity",
  "30": "self-employed person",
  "40": "natural person",
};

const KIND_TITLE: Record<ZfoMessage["kind"], string> = {
  received: "Received data box message",
  sent: "Sent data box message",
  delivery: "Delivery receipt of a data box message",
  message: "Data box message",
};

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** An ISDS time (ISO 8601 with offset) in local time, as written when it cannot be read. */
export function localTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Href of the link opening file `index` of the message (handled by the view, never resolved as a path). */
export const ATTACHMENT_HREF = "#mdz-attachment-";
export const ALL_ATTACHMENTS_HREF = "#mdz-attachments-folder";

/** Text of the main file when it is HTML or plain text, for showing it inline. */
export function mainText(file: ZfoFile): { html: string } | { text: string } | null {
  const mime = file.mime.toLowerCase();
  const ext = extname(file.name);
  const isHtml = mime.includes("html") || ext === "html" || ext === "htm";
  const isText = mime.startsWith("text/plain") || ext === "txt";
  if (!isHtml && !isText) return null;
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const charset = /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  if (isHtml) {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(text);
    return { html: body ? body[1] : text };
  }
  return { text };
}

/** The message as Markdown with HTML: envelope card, files, main text, events. */
export function messageMarkdown(m: ZfoMessage): string {
  const f = m.fields;
  const row = (label: string, value: string | undefined) => (value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : "");
  const party = (name?: string, box?: string, address?: string, unit?: string, type?: string) =>
    [name, address, unit, box ? `data box ${box}` : "", type ? SENDER_TYPE[type] ?? `type ${type}` : ""].filter(Boolean).join(" · ");
  const legal = f.dmLegalTitleLaw ? `law ${f.dmLegalTitleLaw}/${f.dmLegalTitleYear ?? ""}${f.dmLegalTitleSect ? ` § ${f.dmLegalTitleSect}` : ""}${f.dmLegalTitlePar ? ` par. ${f.dmLegalTitlePar}` : ""}${f.dmLegalTitlePoint ? ` letter ${f.dmLegalTitlePoint}` : ""}` : "";
  const status = f.dmMessageStatus ? STATUS[f.dmMessageStatus] ?? `status ${f.dmMessageStatus}` : "";
  const out: string[] = [];
  out.push(`# ${(f.dmAnnotation ?? KIND_TITLE[m.kind]).replace(/([\\`*_[\]#<>])/g, "\\$1")}`, "");
  const rows = [
    row("From", party(f.dmSender, f.dbIDSender, f.dmSenderAddress, f.dmSenderOrgUnit, f.dmSenderType)),
    row("To", party(f.dmRecipient, f.dbIDRecipient, f.dmRecipientAddress, f.dmRecipientOrgUnit)),
    row("To the hands of", f.dmToHands),
    row("Delivered", f.dmDeliveryTime ? localTime(f.dmDeliveryTime) : undefined),
    row("Received", f.dmAcceptanceTime ? localTime(f.dmAcceptanceTime) : undefined),
    row("Status", status),
    row("Message ID", f.dmID),
    row("Our reference", m.kind === "sent" ? f.dmSenderRefNumber : f.dmRecipientRefNumber),
    row("Their reference", m.kind === "sent" ? f.dmRecipientRefNumber : f.dmSenderRefNumber),
    row("Our file mark", m.kind === "sent" ? f.dmSenderIdent : f.dmRecipientIdent),
    row("Their file mark", m.kind === "sent" ? f.dmRecipientIdent : f.dmSenderIdent),
    row("Legal title", legal),
    row("Personal delivery", f.dmPersonalDelivery === "true" ? "yes (only the recipient in person)" : undefined),
    row("Substitute delivery", f.dmAllowSubstDelivery === "false" ? "not allowed" : undefined),
    row("Kind", f.dmType === "K" || f.dmType === "E" || f.dmType === "G" ? "commercial (postal data message)" : undefined),
  ].join("");
  out.push(
    `<div class="mdz-mail-card mdz-zfo-card"><p class="mdz-mail-kind">${escapeHtml(KIND_TITLE[m.kind])}</p><table class="mdz-mail-head">${rows}</table>`,
    `<p class="mdz-mail-note">The data box signature is not checked by Markdownz; check it in the data box itself or in an application for data boxes when it matters.</p></div>`,
    "",
  );
  if (m.files.length) {
    const total = m.files.reduce((n, x) => n + x.size, 0);
    const chips = m.files
      .map((x, i) => `<a class="mdz-mail-file" href="${ATTACHMENT_HREF}${i}" title="Open ${escapeHtml(x.name)} in a new tab"><span class="mdz-mail-file-name">${escapeHtml(x.name)}</span> <span class="mdz-mail-file-size">${humanSize(x.size)}${x.role === "main" ? " · main" : ""}</span></a>`)
      .join(" ");
    out.push(
      `<div class="mdz-mail-files"><p class="mdz-mail-files-head">${m.files.length} ${m.files.length === 1 ? "file" : "files"}, ${humanSize(total)} · <a href="${ALL_ATTACHMENTS_HREF}">show all in the file manager</a></p>${chips}</div>`,
      "",
    );
  }
  const main = m.files.find((x) => x.role === "main") ?? m.files[0];
  const inline = main && mainText(main);
  if (inline) {
    out.push(`<div class="mdz-mail-body">`, "");
    if ("html" in inline) out.push(inline.html, "");
    else out.push("<pre class=\"mdz-mail-text\">" + escapeHtml(inline.text) + "</pre>", "");
    out.push(`</div>`, "");
  }
  if (m.events.length) {
    out.push("## Events", "", "| Time | Event |", "|---|---|");
    for (const e of m.events) out.push(`| ${escapeHtml(localTime(e.time))} | ${escapeHtml(e.text).replace(/\|/g, "\\|")} |`);
    out.push("");
  }
  return out.join("\n");
}

// ------------------------------------------------------------ format

/** Messages of the open views, for opening their files. */
const messages = new Map<string, ZfoMessage>();

async function openFile(host: ViewHost, path: string, m: ZfoMessage, index: number): Promise<void> {
  const file = m.files[index];
  if (!file) return;
  const target = await backend.extractAttachment(hashText(path), file.name, file.base64);
  if (target) host.followLink(target, true);
  else host.notify?.("Files of a data box message can be opened only in the Markdownz app.");
}

async function openAll(host: ViewHost, path: string, m: ZfoMessage): Promise<void> {
  let last: string | null = null;
  for (const file of m.files) last = await backend.extractAttachment(hashText(path), file.name, file.base64);
  if (last) await backend.revealFile(last);
  else host.notify?.("Files of a data box message can be opened only in the Markdownz app.");
}

export const zfoFormat: FormatPlugin = {
  id: "zfo",
  name: "Data box messages",
  description: "Czech data box messages and delivery receipts (.zfo): envelope, files on one click, main text",
  extensions: ["zfo"],
  defaultEnabled: true,
  createView(host) {
    let docPath = "";
    const wrapped: ViewHost = {
      ...host,
      followLink(href, newTab) {
        const m = messages.get(docPath);
        if (m && href.startsWith(ATTACHMENT_HREF)) {
          void openFile(host, docPath, m, Number(href.slice(ATTACHMENT_HREF.length))).catch((e) => host.notify?.(`Cannot open the file: ${e}`));
          return;
        }
        if (m && href === ALL_ATTACHMENTS_HREF) {
          void openAll(host, docPath, m).catch((e) => host.notify?.(`Cannot write the files: ${e}`));
          return;
        }
        host.followLink(href, newTab);
      },
    };
    const view = createConvertedView(wrapped, (data, path) => {
      docPath = path;
      const m = parseMessage(new TextDecoder("utf-8").decode(signedContent(data)));
      messages.set(path, m);
      return messageMarkdown(m);
    });
    const dispose = view.dispose.bind(view);
    view.dispose = () => {
      messages.delete(docPath);
      dispose();
    };
    return view;
  },
};
