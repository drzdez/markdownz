import { describe, expect, it } from "vitest";
import { csvToMarkdown, fence, guessDelimiter, languageFor, notebookToMarkdown, parseDelimited } from "./converted";

describe("fence", () => {
  it("is longer than any backticks in the code", () => {
    expect(fence("a ``` b\n", "text")).toBe("````text\na ``` b\n````\n");
  });
});

describe("languageFor", () => {
  it("uses the extension, or the whole name", () => {
    expect(languageFor("C:/x/build.ps1")).toBe("powershell");
    expect(languageFor("/src/Makefile")).toBe("makefile");
    expect(languageFor("/src/.gitignore")).toBe("text");
    expect(languageFor("/src/photo.png")).toBeNull();
  });
});

describe("CSV", () => {
  it("parses quoted fields with delimiters, quotes and line breaks", () => {
    expect(parseDelimited('a,"b,c","say ""hi""","x\ny"\r\n1,2,3,4', ",")).toEqual([
      ["a", "b,c", 'say "hi"', "x\ny"],
      ["1", "2", "3", "4"],
    ]);
  });
  it("guesses the semicolon of spreadsheet exports", () => {
    expect(guessDelimiter("name;price;note\nA;1,5;x, y\nB;2,0;z", "data.csv")).toBe(";");
    expect(guessDelimiter("a,b\n1,2", "data.tsv")).toBe("\t");
  });
  it("becomes one table block, escaped, numbers to the right", () => {
    const md = csvToMarkdown("name,count\n<b>x</b>,12\n", "a.csv");
    expect(md).toContain("<th>name</th>");
    expect(md).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td>");
    expect(md).toContain('<td align="right">12</td>');
    expect(md).not.toMatch(/<table>[\s\S]*\n\n[\s\S]*<\/table>/);
  });
});

describe("notebook", () => {
  it("shows Markdown cells, code and outputs", () => {
    const nb = {
      metadata: { language_info: { name: "python" } },
      cells: [
        { cell_type: "markdown", source: ["# Title\n", "Text"] },
        {
          cell_type: "code",
          source: "print(1)",
          outputs: [
            { output_type: "stream", text: ["1\n"] },
            { output_type: "display_data", data: { "image/png": "iVBOR\n", "text/plain": "<Figure>" } },
          ],
        },
      ],
    };
    const md = notebookToMarkdown(JSON.stringify(nb));
    expect(md).toContain("# Title\nText");
    expect(md).toContain("```python\nprint(1)\n```");
    expect(md).toContain("```text\n1\n```");
    expect(md).toContain('<img src="data:image/png;base64,iVBOR"');
  });
});
