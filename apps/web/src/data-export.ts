// File exports of tabular data. The spreadsheet and PDF libraries load only
// when someone exports, so they never weigh on the first page load.
import type { Locale } from "./locale.js";

export type ExportFormat = "xlsx" | "csv" | "pdf";

export type ExportColumn = {
  header: string;
  /** Width shown on screen, in pixels; exports keep the proportions. */
  width: number;
  align: "start" | "end";
};

/** Numbers stay numeric so spreadsheets can calculate with them. */
export type ExportCell = string | number;

export type ExportTable = {
  /** File name and PDF title. */
  title: string;
  locale: Locale;
  columns: readonly ExportColumn[];
  rows: readonly (readonly ExportCell[])[];
  /** Subtitle of the PDF, such as the date and the number of records. */
  description: string;
  page: (page: number, pages: number) => string;
};

function fileName(title: string, extension: string) {
  const now = new Date();
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${title.replace(/[\\/:*?"<>|]+/g, "-").trim()} ${day}.${extension}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Spreadsheets run text that starts with these characters as a formula, so
 * CSV cells keep it as text (OWASP CSV injection guidance).
 */
const formulaStart = /^[=+\-@\t\r]/;

function csvCell(
  cell: ExportCell,
  delimiter: string,
  number: Intl.NumberFormat,
) {
  let text = typeof cell === "number" ? number.format(cell) : cell;
  if (typeof cell === "string" && formulaStart.test(text)) text = `'${text}`;
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

/**
 * CSV for other systems and spreadsheets: UTF-8 with a byte order mark so
 * Excel reads accents, CRLF lines, and the separator and decimal mark that
 * spreadsheets of the locale expect (";" and "," in Portuguese).
 */
export function toCsv({ locale, columns, rows }: ExportTable): string {
  const delimiter = locale === "pt-BR" ? ";" : ",";
  const number = new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
  const lines = [
    columns.map((column) => csvCell(column.header, delimiter, number)),
    ...rows.map((row) => row.map((cell) => csvCell(cell, delimiter, number))),
  ];
  return `\uFEFF${lines.map((line) => line.join(delimiter)).join("\r\n")}\r\n`;
}

async function toXlsx({ title, columns, rows }: ExportTable): Promise<Blob> {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const header = columns.map((column) => ({
    value: column.header,
    fontWeight: "bold" as const,
    backgroundColor: "#E2E8F0",
  }));
  return writeExcelFile([header, ...rows.map((row) => [...row])], {
    // Sheet names are limited to 31 characters without []:*?/\.
    sheet: title.replace(/[[\]:*?/\\]+/g, " ").slice(0, 31) || "Sheet 1",
    columns: columns.map((column) => ({
      width: Math.max(8, Math.round(column.width / 7)),
    })),
    stickyRowsCount: 1,
  }).toBlob();
}

const pageMargin = 40;

async function toPdf(table: ExportTable): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { title, locale, columns, rows } = table;
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
    orientation: totalWidth > 700 ? "landscape" : "portrait",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const usable = pageWidth - pageMargin * 2;
  const scale = Math.min(1, usable / totalWidth);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 20 });
  pdf.setFont("helvetica", "bold").setFontSize(14).setTextColor(15, 23, 42);
  pdf.text(title, pageMargin, pageMargin);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(82, 98, 120);
  pdf.text(table.description, pageMargin, pageMargin + 16);
  autoTable(pdf, {
    startY: pageMargin + 30,
    margin: { left: pageMargin, right: pageMargin, bottom: pageMargin },
    theme: "grid",
    head: [columns.map((column) => column.header)],
    body: rows.map((row) =>
      row.map((cell) =>
        typeof cell === "number" ? number.format(cell) : cell,
      ),
    ),
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 4,
      overflow: "linebreak",
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: { fillColor: [241, 245, 249], fontStyle: "bold" },
    // Headers of end-aligned columns line up with their values.
    didParseCell: ({ section, column, cell }) => {
      if (section === "head" && columns[column.index]?.align === "end")
        cell.styles.halign = "right";
    },
    columnStyles: Object.fromEntries(
      columns.map((column, index) => [
        index,
        {
          cellWidth: column.width * scale,
          halign: column.align === "end" ? "right" : "left",
        },
      ]),
    ),
  });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFontSize(8).setTextColor(82, 98, 120);
    pdf.text(title, pageMargin, pageHeight - pageMargin / 2);
    pdf.text(
      table.page(page, pages),
      pageWidth - pageMargin,
      pageHeight - pageMargin / 2,
      {
        align: "right",
      },
    );
  }
  return pdf.output("blob");
}

/** Builds the file in the browser and asks it to save the download. */
export async function exportTable(format: ExportFormat, table: ExportTable) {
  const blob =
    format === "csv"
      ? new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" })
      : format === "xlsx"
        ? await toXlsx(table)
        : await toPdf(table);
  download(blob, fileName(table.title, format));
}
