/** Saves a text file through the browser's download (on your click: Export). False when the browser refused. */
export function downloadText(name: string, text: string, type = "application/json"): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** "8 Oct 2026, 14:02" in the viewer's locale ("Unknown date" for a time no Date holds). */
export function savedDate(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  try {
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return date.toISOString();
  }
}
/** A <time dateTime> value, or undefined for a time no Date holds (toISOString would throw while rendering). */
export function isoTime(ms: number): string | undefined {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
