import { describe, expect, it } from "vitest";
import { ATTACHMENT_HREF, localTime, mainText, messageMarkdown, parseMessage, signedContent } from "./zfo";

// ---- a minimal CMS SignedData envelope around some content, as the data box system makes it

const der = (tag: number, body: number[]): number[] => {
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
  return [tag, ...len, ...body];
};
/** Indefinite length, as in real .zfo files. */
const ber = (tag: number, ...parts: number[][]): number[] => [tag, 0x80, ...parts.flat(), 0, 0];
const OID_SIGNED = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const OID_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01];

function envelope(content: Uint8Array, chunked: boolean): Uint8Array {
  const bytes = [...content];
  const chunks: number[][] = [];
  for (let i = 0; i < bytes.length; i += 1000) chunks.push(der(0x04, bytes.slice(i, i + 1000)));
  const value = chunked ? ber(0x24, ...chunks) : der(0x04, bytes);
  const encap = ber(0x30, der(0x06, OID_DATA), ber(0xa0, value));
  const signed = ber(0x30, der(0x02, [1]), der(0x31, der(0x30, [])), encap, der(0x31, []));
  return new Uint8Array(ber(0x30, der(0x06, OID_SIGNED), ber(0xa0, signed)));
}

const html = "<html><head><meta charset=\"utf-8\"></head><body><p>Dobrý den, <script>alert(1)</script>výzva.</p></body></html>";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const utf8Length = (s: string) => new TextEncoder().encode(s).length;

const MESSAGE = `<?xml version="1.0" encoding="UTF-8"?>
<q:MessageDownloadResponse xmlns:q="http://isds.czechpoint.cz/v20/message" xmlns:p="http://isds.czechpoint.cz/v20">
<q:dmReturnedMessage>
<p:dmDm>
<p:dmID>1234567</p:dmID><p:dbIDSender>abc1234</p:dbIDSender><p:dmSender>Finanční úřad</p:dmSender>
<p:dmSenderAddress>Praha</p:dmSenderAddress><p:dmSenderType>10</p:dmSenderType>
<p:dmRecipient>Jan Novák</p:dmRecipient><p:dbIDRecipient>xyz9876</p:dbIDRecipient>
<p:dmAnnotation>Výzva &lt;důležitá&gt;</p:dmAnnotation><p:dmSenderRefNumber>FU-1/2026</p:dmSenderRefNumber>
<p:dmLegalTitleLaw>280</p:dmLegalTitleLaw><p:dmLegalTitleYear>2009</p:dmLegalTitleYear><p:dmLegalTitleSect>46</p:dmLegalTitleSect>
<p:dmPersonalDelivery>true</p:dmPersonalDelivery>
<p:dmFiles>
<p:dmFile dmMimeType="text/html" dmFileMetaType="main" dmFileDescr="zprava.html"><p:dmEncodedContent>${b64(html)}</p:dmEncodedContent></p:dmFile>
<p:dmFile dmMimeType="application/pdf" dmFileMetaType="enclosure" dmFileDescr="priloha.pdf"><p:dmEncodedContent>JVBERi0x</p:dmEncodedContent></p:dmFile>
</p:dmFiles>
</p:dmDm>
<q:dmDeliveryTime>2026-11-10T08:15:00.123+01:00</q:dmDeliveryTime>
<q:dmMessageStatus>6</q:dmMessageStatus>
</q:dmReturnedMessage>
</q:MessageDownloadResponse>`;

describe("data box messages", () => {
  it("reads the content of the signed envelope, also split into pieces", () => {
    const content = new TextEncoder().encode(MESSAGE.repeat(3));
    expect(new TextDecoder().decode(signedContent(envelope(content, true)))).toBe(MESSAGE.repeat(3));
    expect(new TextDecoder().decode(signedContent(envelope(content, false)))).toBe(MESSAGE.repeat(3));
    expect(() => signedContent(new TextEncoder().encode("hello"))).toThrow(/Not a signed data box message/);
    expect(() => signedContent(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]))).toThrow(/Not a signed/);
  });

  it("reads the envelope and the files", () => {
    const m = parseMessage(MESSAGE);
    expect(m.kind).toBe("received");
    expect(m.fields).toMatchObject({ dmID: "1234567", dmSender: "Finanční úřad", dmAnnotation: "Výzva <důležitá>", dmMessageStatus: "6" });
    expect(m.files.map((f) => [f.name, f.role, f.size])).toEqual([
      ["zprava.html", "main", utf8Length(html)],
      ["priloha.pdf", "enclosure", 6],
    ]);
    expect(mainText(m.files[0])).toEqual({ html: "<p>Dobrý den, <script>alert(1)</script>výzva.</p>" });
    expect(mainText(m.files[1])).toBeNull();
  });

  it("shows the envelope as a card with the files on one click", () => {
    const md = messageMarkdown(parseMessage(MESSAGE));
    expect(md).toMatch(/^# Výzva \\<důležitá\\>/);
    expect(md).toContain("<th>From</th><td>Finanční úřad · Praha · data box abc1234 · public authority</td>");
    expect(md).toContain("<th>Their reference</th><td>FU-1/2026</td>");
    expect(md).toContain("<th>Status</th><td>received (the recipient logged in)</td>");
    expect(md).toContain("law 280/2009 § 46");
    expect(md).toContain(`href="${ATTACHMENT_HREF}1"`);
    expect(md).toContain("2 files");
    expect(md).toContain("not checked by Markdownz");
    // The main text inline (the sanitizer of the Markdown view removes the script).
    expect(md).toContain("výzva.</p>");
  });

  it("reads a delivery receipt", () => {
    const m = parseMessage(`<q:GetSignedDeliveryInfoResponse xmlns:q="q" xmlns:p="p"><q:dmDelivery><p:dmDm><p:dmID>1</p:dmID></p:dmDm>
      <q:dmEvents><q:dmEvent><q:dmEventTime>2026-11-10T08:15:00+01:00</q:dmEventTime><q:dmEventDescr>EV5: Zpráva byla doručena</q:dmEventDescr></q:dmEvent></q:dmEvents></q:dmDelivery></q:GetSignedDeliveryInfoResponse>`);
    expect(m.kind).toBe("delivery");
    expect(m.events).toEqual([{ time: "2026-11-10T08:15:00+01:00", text: "EV5: Zpráva byla doručena" }]);
    const md = messageMarkdown(m);
    expect(md).toContain("# Delivery receipt of a data box message");
    expect(md).toContain("| Time | Event |");
    expect(localTime("nonsense")).toBe("nonsense");
  });
});
