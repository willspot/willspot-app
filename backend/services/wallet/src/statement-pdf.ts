import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Statement } from "./statements.js";

/**
 * PDF statement (A4) with pdf-lib's built-in Helvetica. Those fonts only cover Latin-1
 * (WinAnsi), so text is made safe first: ₦ is written "NGN", accents are dropped
 * (Adébáyọ̀ → Adebayo) and anything else unprintable becomes "?". Never throws on odd text.
 */
export function pdfSafe(s: string): string {
  return s
    .replaceAll("₦", "NGN ")
    .replaceAll("→", "->")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replaceAll("•", "*")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

const group = (v: string) => {
  const [i, f] = v.split(".");
  const neg = i!.startsWith("-");
  const g = (neg ? i!.slice(1) : i!).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${g}${f !== undefined ? `.${f}` : ""}`;
};
const amt = (v: string, asset: string) => (v ? `${asset} ${group(v)}` : "");

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const INK = rgb(0.1, 0.1, 0.15);
const MUTED = rgb(0.42, 0.44, 0.5);
const LINE = rgb(0.86, 0.87, 0.9);

export interface PdfMeta {
  brand: string;
  holder: string;
  /** Last 4 of the account number, if any. */
  account?: string;
  generatedAt?: Date;
}

/** Fingerprint printed on every page so support can confirm a statement wasn't altered. */
export function statementFingerprint(s: Statement, holderId: string): string {
  return createHash("sha256").update(JSON.stringify({ holderId, ...s })).digest("hex").slice(0, 16).toUpperCase();
}

export async function statementPdf(s: Statement, meta: PdfMeta, fingerprint: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${meta.brand} statement ${s.from} to ${s.to}`));
  doc.setAuthor(pdfSafe(meta.brand));
  doc.setCreator(pdfSafe(meta.brand));
  doc.setProducer("WillSpot ledger");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const generated = meta.generatedAt ?? new Date();

  const text = (p: PDFPage, t: string, x: number, y: number, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean; max?: number } = {}) => {
    const f = o.f ?? font;
    const size = o.size ?? 9;
    let str = pdfSafe(t);
    // Too wide for its column: trim and end with "...".
    if (o.max && f.widthOfTextAtSize(str, size) > o.max) {
      while (str.length > 1 && f.widthOfTextAtSize(`${str}...`, size) > o.max) str = str.slice(0, -1);
      str = `${str.trimEnd()}...`;
    }
    const w = f.widthOfTextAtSize(str, size);
    p.drawText(str, { x: o.right ? x - w : x, y, size, font: f, color: o.color ?? INK });
  };

  // Columns: date | description | debit | credit | balance
  const cols = { date: M, desc: M + 78, debit: 400, credit: 470, bal: A4[0] - M };
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const header = (first: boolean) => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
    text(page, meta.brand, M, y - 4, { f: bold, size: 16 });
    text(page, "Account statement", A4[0] - M, y - 4, { f: bold, size: 12, right: true });
    y -= 26;
    if (first) {
      const rows: [string, string][] = [
        ["Account holder", meta.holder],
        ["Currency", s.asset],
        ["Period", `${s.from} to ${s.to} (Africa/Lagos)`],
        ["Generated", generated.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
        ...(meta.account ? ([["Account", `•••• ${meta.account}`]] as [string, string][]) : []),
      ];
      for (const [k, v] of rows) {
        text(page, k, M, y, { color: MUTED });
        text(page, v, M + 90, y, { max: 300 });
        y -= 13;
      }
      y -= 8;
      // Summary box
      page.drawRectangle({ x: M, y: y - 46, width: A4[0] - 2 * M, height: 50, color: rgb(0.96, 0.96, 0.99), borderColor: LINE, borderWidth: 0.8 });
      const cells: [string, string][] = [
        ["Opening balance", amt(s.openingBalance, s.asset)],
        ["Money in", amt(s.totalIn, s.asset)],
        ["Money out", amt(s.totalOut, s.asset)],
        ["Closing balance", amt(s.closingBalance, s.asset)],
      ];
      const w = (A4[0] - 2 * M) / 4;
      cells.forEach(([k, v], i) => {
        text(page, k, M + 12 + i * w, y - 16, { color: MUTED, size: 8 });
        text(page, v, M + 12 + i * w, y - 32, { f: bold, size: 10, max: w - 16 });
      });
      y -= 66;
    }
    // Table header
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, color: LINE, thickness: 0.8 });
    text(page, "Date", cols.date, y - 8, { f: bold, size: 8, color: MUTED });
    text(page, "Description", cols.desc, y - 8, { f: bold, size: 8, color: MUTED });
    text(page, "Debit", cols.debit, y - 8, { f: bold, size: 8, color: MUTED, right: true });
    text(page, "Credit", cols.credit, y - 8, { f: bold, size: 8, color: MUTED, right: true });
    text(page, "Balance", cols.bal, y - 8, { f: bold, size: 8, color: MUTED, right: true });
    page.drawLine({ start: { x: M, y: y - 14 }, end: { x: A4[0] - M, y: y - 14 }, color: LINE, thickness: 0.8 });
    y -= 28;
  };

  header(true);
  if (s.lines.length === 0) {
    text(page, "No transactions in this period.", M, y, { color: MUTED });
    y -= 14;
  }
  for (const l of s.lines) {
    if (y < M + 40) header(false);
    const d = new Date(l.date);
    const lagos = new Date(d.getTime() + 3600_000).toISOString();
    text(page, `${lagos.slice(0, 10)} ${lagos.slice(11, 16)}`, cols.date, y, { size: 8 });
    text(page, l.description, cols.desc, y, { size: 8.5, max: cols.debit - cols.desc - 60 });
    text(page, l.reference, cols.desc, y - 10, { size: 7, color: MUTED });
    text(page, l.debit ? group(l.debit) : "", cols.debit, y, { size: 8.5, right: true });
    text(page, l.credit ? group(l.credit) : "", cols.credit, y, { size: 8.5, right: true, color: rgb(0.05, 0.5, 0.3) });
    text(page, group(l.balance), cols.bal, y, { size: 8.5, right: true, f: bold });
    page.drawLine({ start: { x: M, y: y - 15 }, end: { x: A4[0] - M, y: y - 15 }, color: rgb(0.94, 0.94, 0.96), thickness: 0.5 });
    y -= 26;
  }

  // Footer on every page: page numbers and the fingerprint.
  pages.forEach((p, i) => {
    text(p, `Statement ref ${fingerprint} · amounts in ${s.asset} · computed from the ${pdfSafe(meta.brand)} ledger`, M, 24, { size: 7, color: MUTED });
    text(p, `Page ${i + 1} of ${pages.length}`, A4[0] - M, 24, { size: 7, color: MUTED, right: true });
  });
  return doc.save();
}
