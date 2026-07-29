import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Streaming CSV reader for files too large to hold in memory
 * (MetObjects.csv is ~318 MB).
 *
 * Handles RFC 4180 quoting including embedded newlines, which the Met data
 * does contain — several credit lines and artist bios wrap across lines.
 */
export async function* readCsvRows(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let pending = "";
  let first = true;

  for await (const rawLine of lines) {
    // Strip the UTF-8 BOM the Met file opens with.
    const line = first ? rawLine.replace(/^﻿/, "") : rawLine;
    first = false;
    pending = pending ? `${pending}\n${line}` : line;
    if (countQuotes(pending) % 2 !== 0) continue; // record continues on next line
    yield parseCsvLine(pending);
    pending = "";
  }
  if (pending.trim()) yield parseCsvLine(pending);
}

/** Rows as objects keyed by the header row. */
export async function* readCsvObjects(filePath) {
  let header = null;
  for await (const cells of readCsvRows(filePath)) {
    if (!header) {
      header = cells;
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? "";
    yield row;
  }
}

function countQuotes(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '"') count++;
  return count;
}

export function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Quote a value for CSV output (used by the data export in §8/G1). */
export function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values) {
  return values.map(csvCell).join(",");
}
