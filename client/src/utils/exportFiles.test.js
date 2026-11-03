// Tests for the dependency-free XLSX / PDF writers. Run with Vitest: npx vitest run src/utils/exportFiles.test.js
import { describe, expect, it } from "vitest";
import { buildXlsx, buildZip, crc32 } from "./exportXlsx";
import { buildPdf, textWidth, toLatin1, wrapText } from "./exportPdf";

const text = (bytes) => new TextDecoder("latin1").decode(bytes);

describe("zip / xlsx", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("zip has local headers, a central directory and an end record", () => {
    const zip = buildZip([{ name: "a.txt", data: "hello" }, { name: "b/c.txt", data: "world" }]);
    const s = text(zip);
    expect(s.startsWith("PK\x03\x04")).toBe(true);
    expect(s).toContain("PK\x01\x02");
    expect(s).toContain("PK\x05\x06");
    expect(s).toContain("hello");
  });
  it("xlsx contains the workbook parts and escapes XML", () => {
    const bytes = buildXlsx({ title: "T & <t>", headers: ["A", "B"], rows: [["x\u0001y", 4.5]], kinds: ["data"] });
    const s = text(bytes);
    for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) expect(s).toContain(part);
    expect(s).toContain("T &amp; &lt;t&gt;");
    expect(s).toContain("<v>4.5</v>");
    expect(s).toContain(">xy<"); // the control character was stripped from the cell text
  });
});

describe("pdf", () => {
  const opts = (rows, kinds) => ({ title: "Report", metaLines: ["Total Pheera: 1"], headers: ["A", "B"], rows, kinds, weights: [1, 1], align: ["left", "right"] });
  it("is a well-formed single-page PDF for a small table", () => {
    const s = text(buildPdf(opts([["x", "1"]], ["data"])));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/Count 1");
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });
  it("adds pages when there are many rows", () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`row ${i}`, String(i)]);
    expect(text(buildPdf(opts(rows, rows.map(() => "data"))))).toMatch(/\/Count [2-9]/);
  });
  it("escapes brackets and replaces non-Latin text", () => {
    expect(toLatin1("a\nb")).toBe("a b");
    expect(toLatin1("\u092e\u0930")).toBe("??");
    const s = text(buildPdf(opts([["(a)\\", "1"]], ["data"])));
    expect(s).toContain("\\(a\\)\\\\");
  });
  it("wraps long text and splits long words", () => {
    const lines = wrapText("one two three four five six seven eight nine ten", 60, 9);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 9) < 61).toBe(true);
    expect(wrapText("x".repeat(100), 40, 9).length).toBeGreaterThan(1);
    expect(wrapText("", 40, 9)).toEqual([""]);
  });
});
