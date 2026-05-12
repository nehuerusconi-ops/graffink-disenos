$content = @'
import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "crypto";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class CloudinaryFile {
  constructor(
    public publicId: string,
    public url: string
  ) {}
}

export class ObjectStorageService {
  constructor() {}

  getPrivateObjectDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || "private-objects";
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "public-objects";
    return pathsStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const folder = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const publicId = `${folder}/uploads/${objectId}`;
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, public_id: publicId },
      process.env.CLOUDINARY_API_SECRET!
    );
    return (
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload` +
      `?api_key=${process.env.CLOUDINARY_API_KEY}` +
      `&timestamp=${timestamp}` +
      `&public_id=${encodeURIComponent(publicId)}` +
      `&signature=${signature}`
    );
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("https://api.cloudinary.com/")) {
      const url = new URL(rawPath);
      const publicId = url.searchParams.get("public_id");
      if (publicId) return `/objects/${publicId}`;
    }
    if (rawPath.startsWith("https://res.cloudinary.com/")) {
      const url = new URL(rawPath);
      const parts = url.pathname.split("/upload/");
      if (parts.length >= 2) {
        const afterUpload = parts[1].replace(/^v\d+\//, "");
        const withoutExt = afterUpload.replace(/\.[^/.]+$/, "");
        return `/objects/${withoutExt}`;
      }
    }
    return rawPath;
  }

  async searchPublicObject(filePath: string): Promise<CloudinaryFile | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const publicId = `${searchPath}/${filePath}`.replace(/\.[^/.]+$/, "");
      try {
        await cloudinary.api.resource(publicId);
        const url = cloudinary.url(publicId, { secure: true });
        return new CloudinaryFile(publicId, url);
      } catch {
        // not found, try next
      }
    }
    return null;
  }

  async downloadObject(file: CloudinaryFile): Promise<Response> {
    const response = await fetch(file.url);
    if (!response.ok) throw new ObjectNotFoundError();
    return response;
  }

  async getObjectEntityFile(objectPath: string): Promise<CloudinaryFile> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const publicId = objectPath.slice("/objects/".length);
    try {
      await cloudinary.api.resource(publicId);
      const url = cloudinary.url(publicId, { secure: true });
      return new CloudinaryFile(publicId, url);
    } catch {
      throw new ObjectNotFoundError();
    }
  }

  async trySetObjectEntityAclPolicy(rawPath: string, _aclPolicy: unknown): Promise<string> {
    return this.normalizeObjectEntityPath(rawPath);
  }

  async canAccessObjectEntity({ userId }: { userId?: string; objectFile?: unknown; requestedPermission?: unknown }): Promise<boolean> {
    return !!userId;
  }
}
'@

$path = "artifacts\api-server\src\lib\objectStorage.ts"
[System.IO.File]::WriteAllText((Resolve-Path $path), $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "Archivo escrito correctamente" -ForegroundColor Green
Get-Content $path | Measure-Object -Line
