export interface DownloadPayload {
  filename: string;
  mimeType: string;
  content: string;
}

export type DownloadHandler = (payload: DownloadPayload) => void;

export const browserDownload: DownloadHandler = ({ filename, mimeType, content }) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
};

export function reportBaseName(sourceName: string): string {
  const withoutExtension = sourceName.replace(/\.[^.]+$/, "");
  const safe = withoutExtension.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "catalog";
}