import { type PreviewImages, previewImageSource } from "../shared/preview-images";

export function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

function decodeAttribute(value: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] ?? entity;
    const point =
      code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd";
  });
}

// Preserve non-image HTML, but rebuild image tags from a small attribute allowlist.
// Quoted '>' characters are part of an attribute, not a tag boundary.
export function replaceImageTags(
  source: string,
  render: (attributes: Record<string, string>) => string,
) {
  return source.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi,
    (tag) => {
      if (!/^<img\b/i.test(tag)) return tag;
      const attributes: Record<string, string> = {};
      for (const attribute of tag
        .slice(4, -1)
        .matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
        const name = attribute[1].toLowerCase();
        attributes[name] ??= decodeAttribute(attribute[2] ?? attribute[3] ?? attribute[4]);
      }
      return render(attributes);
    },
  );
}

export function imageHtml(
  href: string,
  alt: string,
  images: PreviewImages = {},
  attributes: Record<string, string> = {},
) {
  const source = previewImageSource(href);
  const label = escapeAttribute(alt || "图片");
  if (!source) return `<span class="asset">${label}（不支持的图片地址）</span>`;
  const local = source.kind === "file";
  const image = local && Object.hasOwn(images, source.href) ? images[source.href] : undefined;
  if (local && image?.message)
    return `<span class="asset" role="img" aria-label="${label}（${escapeAttribute(image.message)}）" title="${escapeAttribute(image.message)}">${label}（${escapeAttribute(image.message)}）</span>`;
  const uri = local ? image?.uri : source.uri;
  const dimensions = ["width", "height"]
    .map((name) =>
      /^\d{1,4}$/.test(attributes[name] ?? "") ? ` ${name}="${attributes[name]}"` : "",
    )
    .join("");
  return `<img alt="${label}"${uri ? ` src="${escapeAttribute(uri)}"` : ""}${local ? ` data-preview-src="${escapeAttribute(source.href)}"` : ""}${dimensions} loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

export function htmlImages(source: string, images: PreviewImages = {}) {
  return replaceImageTags(source, (attributes) =>
    imageHtml(attributes.src ?? "", attributes.alt ?? "", images, attributes),
  );
}

export function localImageReferences(markup: string) {
  const hrefs = new Set<string>();
  replaceImageTags(markup, (attributes) => {
    const href = attributes["data-preview-src"];
    if (href && previewImageSource(href)?.kind === "file") hrefs.add(href);
    return "";
  });
  return [...hrefs];
}
