const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function toStorageUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("/objects/")) {
    return `${BASE}/api/storage${path}`;
  }
  if (path.startsWith("/public-objects/")) {
    return `${BASE}/api/storage${path}`;
  }
  if (path.startsWith("/private-objects/")) {
    return `${BASE}/api/storage/objects/${path.slice("/private-objects/".length)}`;
  }
  return path;
}
