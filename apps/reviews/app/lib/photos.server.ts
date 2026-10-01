/**
 * Review photos in R2 (binding PHOTOS). Keys: `${shop}/${uuid}.${ext}`.
 * Public URLs are served by /media/<key> only while the review is published;
 * the admin sees pending photos through short-lived signed URLs.
 */
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Bucket = {
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
};

export function bucket(env: object): Bucket | undefined {
  return (env as unknown as { PHOTOS?: Bucket }).PHOTOS;
}

/** Detect the real type from the file's first bytes (never trust the browser's label). */
export function sniffImage(bytes: Uint8Array): { ext: string; type: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", type: "image/png" };
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { ext: "webp", type: "image/webp" };
  return null;
}

export type PhotoError = "photo_type" | "photo_size" | "photo_count";

/** Validate all files first, then store them. Returns R2 keys or an error code. */
export async function savePhotos(env: object, shop: string, files: File[]): Promise<{ keys: string[]; error: PhotoError | null }> {
  if (!files.length) return { keys: [], error: null };
  if (files.length > MAX_PHOTOS) return { keys: [], error: "photo_count" };
  const r2 = bucket(env);
  if (!r2) return { keys: [], error: null }; // storage not configured: accept the review without photos
  const prepared: Array<{ data: ArrayBuffer; ext: string; type: string }> = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) return { keys: [], error: "photo_size" };
    const data = await f.arrayBuffer();
    const kind = sniffImage(new Uint8Array(data.slice(0, 16)));
    if (!kind) return { keys: [], error: "photo_type" };
    prepared.push({ data, ...kind });
  }
  const keys: string[] = [];
  for (const p of prepared) {
    const key = `${shop}/${crypto.randomUUID()}.${p.ext}`;
    await r2.put(key, p.data, { httpMetadata: { contentType: p.type } });
    keys.push(key);
  }
  return { keys, error: null };
}

export async function deletePhotos(env: object, keys: string[]) {
  const r2 = bucket(env);
  if (r2 && keys.length) await r2.delete(keys);
}

export async function purgeShopPhotos(env: object, shop: string) {
  const r2 = bucket(env);
  if (!r2) return;
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix: `${shop}/`, cursor, limit: 1000 });
    if (page.objects.length) await r2.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export const parsePhotos = (json: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
};

export const publicPhotoUrl = (appUrl: string, key: string) => `${appUrl.replace(/\/$/, "")}/media/${key}`;

const enc = new TextEncoder();
async function sign(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Admin-only URL for a photo whose review isn't published yet (valid for 1 hour). */
export async function signedPhotoUrl(appUrl: string, secret: string, key: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + 3600;
  return `${publicPhotoUrl(appUrl, key)}?exp=${exp}&sig=${await sign(secret, `${key}:${exp}`)}`;
}

export async function verifyPhotoSig(secret: string, key: string, exp: string | null, sig: string | null, now = Date.now()) {
  if (!exp || !sig || Number(exp) * 1000 < now) return false;
  return (await sign(secret, `${key}:${exp}`)) === sig;
}

/** Short-lived token the product-page widget uses to post a review (with photos) straight to the app. */
export async function signUploadToken(secret: string, shop: string, productNumeric: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + 2 * 3600;
  return `${exp}.${await sign(secret, `upload:${shop}:${productNumeric}:${exp}`)}`;
}

export async function verifyUploadToken(secret: string, shop: string, productNumeric: string, token: string | null, now = Date.now()) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) * 1000 < now) return false;
  return (await sign(secret, `upload:${shop}:${productNumeric}:${exp}`)) === sig;
}
