import { OrchaError } from "./errors.js";
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

export interface LoadedLocalFileContent {
  bytes: Uint8Array;
  base64: string;
  dataUri: string;
  fileName: string;
}

interface CachedFileEntry {
  mtimeMs: number;
  size: number;
  mimeType: string;
  byteLength: number;
  value: LoadedLocalFileContent;
}

const MAX_CACHED_FILES = 32;
const MAX_CACHED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_CACHE_BYTES = 64 * 1024 * 1024;

const localFileCache = new Map<string, CachedFileEntry>();
let totalCachedBytes = 0;

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
): Promise<LoadedLocalFileContent> {
  const fsModule = "node:fs/promises";
  const { readFile, stat } = await import(fsModule);
  let fileStats: { mtimeMs: number; size: number };
  try {
    fileStats = await stat(content.filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OrchaError(
      "invalid_input",
      `Failed to read local file "${content.filePath}": ${reason}`,
      {
        retryable: false,
        cause: error,
        details: { filePath: content.filePath },
      },
    );
  }

  const cached = localFileCache.get(content.filePath);
  if (
    cached &&
    cached.mtimeMs === fileStats.mtimeMs &&
    cached.size === fileStats.size &&
    cached.mimeType === content.mimeType
  ) {
    localFileCache.delete(content.filePath);
    localFileCache.set(content.filePath, cached);
    return cached.value;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(content.filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OrchaError(
      "invalid_input",
      `Failed to read local file "${content.filePath}": ${reason}`,
      {
        retryable: false,
        cause: error,
        details: { filePath: content.filePath },
      },
    );
  }
  const base64 = bytes.toString("base64");
  const value: LoadedLocalFileContent = {
    bytes,
    base64,
    dataUri: `data:${content.mimeType};base64,${base64}`,
    fileName: portableBasename(content.filePath),
  };

  if (bytes.byteLength <= MAX_CACHED_FILE_BYTES) {
    setCachedFile(content.filePath, {
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      mimeType: content.mimeType,
      byteLength: bytes.byteLength,
      value,
    });
  }

  return value;
}

function setCachedFile(key: string, entry: CachedFileEntry): void {
  const existing = localFileCache.get(key);
  if (existing) {
    totalCachedBytes -= existing.byteLength;
    localFileCache.delete(key);
  }
  while (
    localFileCache.size >= MAX_CACHED_FILES ||
    totalCachedBytes + entry.byteLength > MAX_TOTAL_CACHE_BYTES
  ) {
    const oldest = localFileCache.keys().next().value;
    if (!oldest) {
      break;
    }
    const evicted = localFileCache.get(oldest);
    if (evicted) {
      totalCachedBytes -= evicted.byteLength;
    }
    localFileCache.delete(oldest);
  }
  localFileCache.set(key, entry);
  totalCachedBytes += entry.byteLength;
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
