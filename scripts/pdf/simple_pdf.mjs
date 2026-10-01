/**
 * Minimal, dependency-free multi-page PDF writer. Text-only (Helvetica /
 * Helvetica-Bold, the standard 14 base fonts every PDF viewer ships with, so
 * nothing needs to be embedded). Good enough for an internal status report;
 * not a general PDF library.
 *
 * Why hand-rolled instead of a library: Part U of the brief asks for "a
 * minimal and appropriate implementation" and explicitly not to add a
 * production dependency just for reporting. This lives under scripts/ only
 * -- it is never imported by src/ and never ships in the npm package.
 */

import { writeFileSync } from "node:fs";

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const LINE_HEIGHT = 14;

function escapePdfText(text) {
  // Replace anything outside printable ASCII with a safe approximation --
  // the standard fonts' default encoding does not reliably cover Unicode,
  // and this report only ever needs plain ASCII.
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function widthEstimate(fontSize) {
  // Rough average glyph width for Helvetica at this size -- good enough for
  // wrapping plain-text report content, not typesetting-grade.
  return fontSize * 0.5;
}

function wrapText(text, maxChars) {
  if (maxChars < 4) maxChars = 4;
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export class SimplePdfDocument {
  constructor() {
    this.pages = [];
    this.currentLines = [];
    this.cursorY = PAGE_HEIGHT - MARGIN;
  }

  _startNewPage() {
    if (this.currentLines.length > 0) this.pages.push(this.currentLines);
    this.currentLines = [];
    this.cursorY = PAGE_HEIGHT - MARGIN;
  }

  _ensureSpace(needed) {
    if (this.cursorY - needed < MARGIN) this._startNewPage();
  }

  _push(text, font, size) {
    this.currentLines.push({ text, font, size, x: MARGIN, y: this.cursorY });
    this.cursorY -= Math.max(LINE_HEIGHT, size + 4);
  }

  _pushIndented(text, font, size, indent) {
    this.currentLines.push({ text, font, size, x: MARGIN + indent, y: this.cursorY });
    this.cursorY -= Math.max(LINE_HEIGHT, size + 4);
  }

  title(text) {
    this._ensureSpace(26);
    this._push(text, "F2", 20);
    this.cursorY -= 6;
  }

  subtitle(text) {
    this._ensureSpace(18);
    this._push(text, "F1", 11);
    this.cursorY -= 8;
  }

  heading(text) {
    this._ensureSpace(24);
    this.cursorY -= 6;
    this._push(text, "F2", 13);
    this.cursorY -= 2;
  }

  paragraph(text, { size = 10 } = {}) {
    const maxChars = Math.floor((PAGE_WIDTH - 2 * MARGIN) / widthEstimate(size));
    for (const line of wrapText(text, maxChars)) {
      this._ensureSpace(LINE_HEIGHT);
      this._push(line, "F1", size);
    }
  }

  bullet(text, { size = 10 } = {}) {
    const indent = 14;
    const maxChars = Math.floor((PAGE_WIDTH - 2 * MARGIN - indent) / widthEstimate(size));
    const wrapped = wrapText(text, maxChars);
    wrapped.forEach((line, i) => {
      this._ensureSpace(LINE_HEIGHT);
      this._pushIndented(i === 0 ? `- ${line}` : `  ${line}`, "F1", size, indent);
    });
  }

  spacer(px = 6) {
    this._ensureSpace(px);
    this.cursorY -= px;
  }

  hr() {
    this._ensureSpace(10);
    this._push("--------------------------------------------------------------------", "F1", 9);
  }

  save(path) {
    if (this.currentLines.length > 0) this.pages.push(this.currentLines);
    if (this.pages.length === 0) this.pages.push([]);
    const bytes = buildPdfBytes(this.pages);
    writeFileSync(path, bytes);
    return { pageCount: this.pages.length, byteLength: bytes.length };
  }
}

function buildPdfBytes(pages) {
  const FONT_REGULAR_ID = 3;
  const FONT_BOLD_ID = 4;
  let nextId = 5;

  const objectsById = new Map();
  objectsById.set(1, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objectsById.set(
    FONT_REGULAR_ID,
    `${FONT_REGULAR_ID} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );
  objectsById.set(
    FONT_BOLD_ID,
    `${FONT_BOLD_ID} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`,
  );

  const pageIds = [];
  for (const lines of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageIds.push(pageId);

    let streamData = "";
    for (const line of lines) {
      streamData += `BT /${line.font} ${line.size} Tf 1 0 0 1 ${line.x} ${line.y.toFixed(2)} Tm (${escapePdfText(line.text)}) Tj ET\n`;
    }
    const streamBytes = Buffer.byteLength(streamData, "latin1");

    objectsById.set(
      contentId,
      `${contentId} 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamData}endstream\nendobj\n`,
    );
    objectsById.set(
      pageId,
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${FONT_REGULAR_ID} 0 R /F2 ${FONT_BOLD_ID} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>\nendobj\n`,
    );
  }

  objectsById.set(
    2,
    `2 0 obj\n<< /Type /Pages /Kids [ ${pageIds.map((id) => `${id} 0 R`).join(" ")} ] /Count ${pageIds.length} >>\nendobj\n`,
  );

  const maxId = Math.max(...objectsById.keys());
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = new Array(maxId + 1).fill(0);
  for (let id = 1; id <= maxId; id++) {
    const body = objectsById.get(id);
    if (!body) continue;
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += body;
  }

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
