import { requestUploadUrl } from "@workspace/api-client-react";

export async function uploadFile(
  file: File,
  authHeader?: string,
): Promise<string> {
  const init: RequestInit = authHeader
    ? { headers: { authorization: authHeader } }
    : {};
  const { uploadURL, objectPath } = await requestUploadUrl(
    {
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    },
    init,
  );

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`Falló la subida del archivo (${putRes.status})`);
  }

  return objectPath;
}
