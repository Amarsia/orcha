let fallbackSequence = 0;

export function portableRandomUUID(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto?.getRandomValues === "function") {
    return formatUuid(crypto.getRandomValues(new Uint8Array(16)));
  }

  fallbackSequence = (fallbackSequence + 1) >>> 0;
  const bytes = new Uint8Array(16);
  let state =
    Date.now() ^
    fallbackSequence ^
    Math.floor(Math.random() * 0x1_0000_0000);
  for (let index = 0; index < bytes.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return formatUuid(bytes);
}

function formatUuid(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
