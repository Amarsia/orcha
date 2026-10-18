const DEFAULT_AMARSIA_API_URL = "https://api.amarsia.com";

export function resolveAmarsiaEndpoint(endpoint: string | undefined): string {
  return (
    endpoint?.trim() ||
    (typeof process !== "undefined"
      ? process.env?.AMARSIA_API_URL
      : undefined) ||
    DEFAULT_AMARSIA_API_URL
  ).replace(/\/$/, "");
}
