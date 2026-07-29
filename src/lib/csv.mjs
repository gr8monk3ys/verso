/** RFC 4180 quoting, shared by the ingest scripts and the user data export. */
export function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values) {
  return values.map(csvCell).join(",");
}

export function csvDocument(header, rows) {
  return [csvLine(header), ...rows.map(csvLine)].join("\n");
}
