import { parsePreviewLink } from "./preview-links";

export const MAX_PREVIEW_IMAGES = 32;
export const MAX_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024;
export type PreviewImages = Record<string, { uri: string | null; message: string | null }>;

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  bmp: "image/bmp",
};

export function imageMimeType(path: string): string | undefined {
  const extension = path.split("/").at(-1)?.split(".").at(-1)?.toLowerCase() ?? "";
  return Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
}

// Remote images are loaded by the client, never fetched by the daemon.
export function previewImageSource(value: string) {
  const source = value.trim();
  if (
    /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|avif|bmp);base64,[a-z\d+/=]+$/i.test(source)
  )
    return { kind: "inline" as const, uri: source };
  const link = parsePreviewLink(source);
  if (link?.kind === "web" && /^https?:/i.test(link.url))
    return { kind: "remote" as const, uri: link.url };
  if (link?.kind === "file") return { kind: "file" as const, href: source };
  return null;
}
