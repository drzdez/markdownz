import { describe, expect, it, vi } from "vitest";

const files: Record<string, string> = {};
vi.mock("../../backend", () => ({
  readDoc: async (path: string) => {
    const key = path.replace(/\\/g, "/");
    if (!(key in files)) throw new Error(`missing ${key}`);
    return { path, content: files[key] };
  },
  fileSrc: (p: string) => p,
}));

const { Renderer } = await import("../renderer");
const { attachmentState, mailKind } = await import("./mail");

const MESSAGE = `---
mailz: message
mailz_schema: 1
mailz_id: "m1"
account: "home"
date: "2026-11-10T07:15:00Z"
from: "Ann <ann@example.org>"
to: ["Bob <bob@example.org>"]
cc: []
subject: "Invoice"
folders: ["INBOX"]
flags: []
size: 1234
attachments: 3
server_status: present
threats: 1
---

# Invoice

- **From:** Ann <ann@example.org>
- **To:** Bob <bob@example.org>
- **Date:** 2026-11-10T07:15:00Z (UTC)
- **Folders:** INBOX

## Attachments

- [invoice.pdf](attachments/invoice.pdf.md) – application/pdf, 10 kB
- [evil.exe](attachments/evil.exe.md) – application/x-msdownload, 2 kB
- [new.docx](attachments/new.docx.md) – docx, 5 kB

## Body

Hello Bob.
`;

const card = (extra: string) => `---
mailz: attachment
mailz_schema: 1
name: "x"
detected_type: "application/pdf"
size: 10240
sha256: "${"a".repeat(64)}"
mailz_id: "m1"
${extra}
---

# x
`;

files["/view/mail/m1/attachments/invoice.pdf.md"] = card(`content: "../../../attachments/aa/aaa.pdf"\ncontent_state: view`);
files["/view/mail/m1/attachments/evil.exe.md"] = card(`content: ""\ncontent_state: threat\nthreat: "Trojan"`);
files["/view/mail/m1/attachments/new.docx.md"] = card(`content: ""\ncontent_state: pending_check`);

describe("e-mails from mailz", () => {
  it("are recognized by their front matter, also from older views", () => {
    expect(mailKind({ mailz: "message" })).toBe("message");
    expect(mailKind({ mailz: "attachment" })).toBe("attachment");
    expect(mailKind({ mailz: "something else", mailz_id: 1, account: 1, subject: 1, attachments: 1, server_status: 1 })).toBeNull();
    expect(mailKind({ mailz_id: "1", account: "a", subject: "s", attachments: 0, server_status: "present" })).toBe("message");
    expect(mailKind({ mailz_id: "1", sha256: "x", content: "", detected_type: "t" })).toBe("attachment");
    expect(mailKind({ title: "A note", account: "x" })).toBeNull();
    expect(mailKind(null)).toBeNull();
    expect(attachmentState({ content: "a", content_state: "view" })).toBe("view");
    expect(attachmentState({ content: "", threat: "x" })).toBe("threat");
    expect(attachmentState({ content: "" })).toBe("pending_check");
  });

  it("show a card and attachments that open on one click", async () => {
    const article = await new Renderer({}).render(MESSAGE, { docPath: "/view/mail/m1/message.md", theme: "light" });
    const card = article.querySelector(".mdz-mail-card")!;
    expect(card.textContent).toContain("Ann <ann@example.org>");
    expect(card.textContent).toContain("1 harmful attachment");
    // The headers list of the body and the attachment list are replaced.
    expect(article.querySelector(":scope > ul")).toBeNull();
    expect([...article.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Body"]);
    const chips = [...article.querySelectorAll<HTMLAnchorElement>("a.mdz-mail-file")];
    expect(chips.map((c) => c.getAttribute("href"))).toEqual(["attachments/../../../attachments/aa/aaa.pdf", null, null]);
    expect(chips[1].classList.contains("mdz-mail-file-threat")).toBe(true);
    expect(chips[2].textContent).toContain("not checked yet");
    expect(article.querySelector(".mdz-mail-file-card")!.getAttribute("href")).toBe("attachments/invoice.pdf.md");
  });

  it("stay plain Markdown when switched off, and other front matter stays a table", async () => {
    const off = await new Renderer({ mailz: false }).render(MESSAGE, { docPath: "/view/mail/m1/message.md", theme: "light" });
    expect(off.querySelector(".mdz-mail-card")).toBeNull();
    expect(off.querySelector("table.mdz-front-matter")).not.toBeNull();
    const note = await new Renderer({}).render("---\ntitle: Note\n---\n\n# Note\n", { docPath: "/n.md", theme: "light" });
    expect(note.querySelector(".mdz-mail-card")).toBeNull();
    expect(note.querySelector("table.mdz-front-matter")).not.toBeNull();
  });

  it("show an attachment card with its own open link", async () => {
    const article = await new Renderer({}).render(files["/view/mail/m1/attachments/invoice.pdf.md"], { docPath: "/view/mail/m1/attachments/invoice.pdf.md", theme: "light" });
    expect(article.querySelector("a.mdz-mail-file")!.getAttribute("href")).toBe("../../../attachments/aa/aaa.pdf");
    expect(article.querySelector(".mdz-mail-card")!.textContent).toContain("10 kB");
  });
});
