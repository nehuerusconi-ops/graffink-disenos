const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function toStorageUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("/objects/") || path.startsWith("/public-objects/")) {
    return `${BASE}/api/storage${path}`;
  }
  return path;
}
