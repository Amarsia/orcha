import type { CompiledBundle } from "../types.js";
import {
  createAmarsiaProjectMetadata,
  type AmarsiaProjectMetadata,
} from "./metadata.js";

const DEFAULT_AMARSIA_API_URL = "https://api.amarsia.com";
const syncedHashes = new Map<string, string>();

export function syncAmarsiaProject(options: {
  key: string;
  endpoint?: string;
  bundle: CompiledBundle;
  projectRoot: string;
}): void {
  const metadata = createAmarsiaProjectMetadata(
    options.bundle,
    options.projectRoot,
  );
  const baseUrl = resolveAmarsiaEndpoint(options.endpoint);
  const dedupeKey = `${baseUrl}:${options.key}`;
  if (syncedHashes.get(dedupeKey) === metadata.content_hash) {
    return;
  }
  syncedHashes.set(dedupeKey, metadata.content_hash);

  void postProjectMetadata({
    key: options.key,
    baseUrl,
    metadata,
  }).catch((error: unknown) => {
    syncedHashes.delete(dedupeKey);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[orcha] Amarsia project sync failed: ${message}`);
  });
}

function resolveAmarsiaEndpoint(endpoint: string | undefined): string {
  return (
    endpoint?.trim() || process.env.AMARSIA_API_URL || DEFAULT_AMARSIA_API_URL
  ).replace(/\/$/, "");
}

async function postProjectMetadata(options: {
  key: string;
  baseUrl: string;
  metadata: AmarsiaProjectMetadata;
}): Promise<void> {
  const response = await fetch(`${options.baseUrl}/v3/project-sync`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-amarsia-project-key": options.key,
    },
    body: JSON.stringify(options.metadata),
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText || "sync failed"}`,
    );
  }
}
