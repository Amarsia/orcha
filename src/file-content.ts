import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { LocalFileContent } from "./types.js";

const MIME_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function normalizeLocalFile(
  filePath: string,
  mimeType?: string,
  projectRoot = process.cwd(),
): LocalFileContent {
  const absolutePath = resolve(projectRoot, filePath);
  return {
    type: "file",
    filePath: absolutePath,
    mimeType: normalizeMimeType(mimeType, absolutePath),
  };
}

export function normalizeUrlContent(
  url: string,
  mimeType?: string,
): {
  type: "url";
  fileUri: string;
  mimeType: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid content URL "${url}".`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Content URLs must use http or https.");
  }
  return {
    type: "url",
    fileUri: parsed.href,
    mimeType: normalizeMimeType(mimeType, parsed.pathname),
  };
}

export async function readLocalFileContent(
  content: LocalFileContent,
): Promise<{
  bytes: Uint8Array;
  base64: string;
  dataUri: string;
  fileName: string;
}> {
  const bytes = await readFile(content.filePath);
  const base64 = bytes.toString("base64");
  return {
    bytes,
    base64,
    dataUri: `data:${content.mimeType};base64,${base64}`,
    fileName: basename(content.filePath),
  };
}

function normalizeMimeType(
  mimeType: string | undefined,
  source: string,
): string {
  if (mimeType?.trim()) {
    return mimeType.trim().toLowerCase();
  }
  const inferred = MIME_TYPES[extname(source).toLowerCase()];
  if (!inferred) {
    throw new Error(
      `Could not infer a MIME type for "${source}". Provide mimeType explicitly.`,
    );
  }
  return inferred;
}
