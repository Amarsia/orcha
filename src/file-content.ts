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
  projectRoot = ".",
): LocalFileContent {
  const absolutePath = resolvePortablePath(projectRoot, filePath);
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
  const fsModule = "node:fs/promises";
  const { readFile } = await import(fsModule);
  const bytes = await readFile(content.filePath);
  const base64 = bytes.toString("base64");
  return {
    bytes,
    base64,
    dataUri: `data:${content.mimeType};base64,${base64}`,
    fileName: portableBasename(content.filePath),
  };
}

function normalizeMimeType(
  mimeType: string | undefined,
  source: string,
): string {
  if (mimeType?.trim()) {
    return mimeType.trim().toLowerCase();
  }
  const inferred = MIME_TYPES[portableExtension(source).toLowerCase()];
  if (!inferred) {
    throw new Error(
      `Could not infer a MIME type for "${source}". Provide mimeType explicitly.`,
    );
  }
  return inferred;
}

function resolvePortablePath(root: string, filePath: string): string {
  if (/^(?:\/|[a-zA-Z]:[\\/])/.test(filePath)) {
    return normalizePath(filePath);
  }
  return normalizePath(`${root.replace(/[\\/]+$/, "")}/${filePath}`);
}

function normalizePath(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const prefix = path.match(/^(?:[a-zA-Z]:)?[\\/]/)?.[0] ?? "";
  const source = prefix ? path.slice(prefix.length) : path;
  const parts: string[] = [];
  for (const part of source.split(/[\\/]+/)) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") {
        parts.pop();
      } else if (!prefix) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  return `${prefix}${parts.join(separator)}` || ".";
}

function portableBasename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function portableExtension(path: string): string {
  const name = portableBasename(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}
