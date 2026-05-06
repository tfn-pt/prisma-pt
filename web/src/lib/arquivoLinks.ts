export const ARQUIVO_FALLBACK_URL = "https://arquivo.pt/";

export function toSafeExternalUrl(url?: string | null, fallback = ARQUIVO_FALLBACK_URL) {
  const candidate = url?.trim();
  if (!candidate) return fallback;

  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }

  if (candidate.startsWith("//")) {
    return `https:${candidate}`;
  }

  try {
    return new URL(`https://${candidate}`).toString();
  } catch {
    return fallback;
  }
}
