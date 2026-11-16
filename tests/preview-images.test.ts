import { describe, expect, it } from "vitest";
import { type MarkdownNode, markdownNodes } from "../client/markdown-model";
import { htmlImages, localImageReferences } from "../client/preview-images";
import { markdownHtml, previewDocument, previewKind } from "../client/preview-model";
import { previewImagesRpc } from "../shared/contracts";
import { imageMimeType, previewImageSource } from "../shared/preview-images";

const uri = "data:image/png;base64,iVBORw0KGgo=";
const colors = {
  background: "#fff",
  foreground: "#111",
  muted: "#555",
  border: "#ddd",
  accent: "#00f",
};
function descendants(nodes: (MarkdownNode | string)[]): MarkdownNode[] {
  return nodes.flatMap((node) =>
    typeof node === "string" ? [] : [node, ...descendants(node.children)],
  );
}

describe("document images", () => {
  it("recognizes the same formats in the reader and preview selector", () => {
    for (const extension of ["png", "JPG", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp"]) {
      expect(imageMimeType(`folder/image.${extension}`)).toMatch(/^image\//);
      expect(previewKind(`folder/image.${extension}`)).toBe("image");
    }
    for (const extension of ["txt", "constructor", "toString", "__proto__"])
      expect(imageMimeType(`file.${extension}`)).toBeUndefined();
  });

  it("allows inline and HTTP images while rejecting executable and unsupported protocols", () => {
    expect(previewImageSource(uri)).toEqual({ kind: "inline", uri });
    expect(previewImageSource("//example.com/image.svg")).toEqual({
      kind: "remote",
      uri: "https://example.com/image.svg",
    });
    expect(previewImageSource("../a%20b.png?raw=1#preview")).toEqual({
      kind: "file",
      href: "../a%20b.png?raw=1#preview",
    });
    for (const source of [
      "javascript:bad()",
      "mailto:a@example.com",
      "blob:x",
      "ftp://example.com/a.png",
      "data:text/html;base64,eA==",
      "data:image/svg+xml,<svg onload=bad()>",
      "https://example.com/a\n.png",
    ])
      expect(previewImageSource(source)).toBeNull();
  });

  it("loads Markdown images, raw img tags and linked badges without reading code examples", () => {
    const content =
      '![图片](<assets/a b.png>)\n\n[![badge](./badge.svg)](guide.md)\n\n<img src="assets/a&amp;b.png" width="96" alt="图标 > badge" onerror="bad()">\n\n`![example](ignored.png)`\n\n```md\n![example](fenced.png)\n```';
    const markup = markdownHtml(content);
    expect(localImageReferences(markup)).toEqual([
      "assets/a b.png",
      "./badge.svg",
      "assets/a&b.png",
    ]);
    expect(markup).toContain('href="guide.md" rel="noreferrer noopener"><img alt="badge"');
    expect(markup).toContain('width="96"');
    expect(markup).toContain('alt="图标 &gt; badge"');
    expect(markup).not.toContain("onerror=");
    const loaded = markdownHtml(content, "#fff", { "assets/a b.png": { uri, message: null } });
    expect(loaded).toContain(`src="${uri}"`);
  });

  it("rewrites HTML image sources and strips source overrides and event handlers", () => {
    const markup = htmlImages(
      '<picture><img SRC=./a.png alt="a &amp; b" width=120 height="80" srcset="other.png 2x" style="background:url(other.png)" onload="bad()"></picture><img src="java&#x73;cript:bad()"><!-- <img src="comment.png"> --><script>"<img src=script.png>"</script>',
    );
    expect(localImageReferences(markup)).toEqual(["./a.png"]);
    expect(markup).toContain('alt="a &amp; b"');
    expect(markup).toContain('width="120" height="80"');
    expect(markup).not.toContain("srcset=");
    expect(markup).not.toContain("onload=");
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("background:url");
  });

  it("keeps failures readable and escaped and passes resolved images to the native model", () => {
    const images = {
      "a.png": { uri, message: null },
      "missing.png": { uri: null, message: '<missing "image">' },
    };
    const markup = markdownHtml("![成功](a.png) ![失败](missing.png)", "#fff", images);
    expect(markup).toContain("&lt;missing &quot;image&quot;&gt;");
    expect(markup).not.toContain("<missing");
    const nodes = descendants(markdownNodes("[![成功](a.png)](guide.md)", "#fff", images));
    expect(nodes.find((node) => node.tag === "img")?.attributes).toMatchObject({
      src: uri,
      alt: "成功",
    });
    expect(nodes.find((node) => node.tag === "a")?.attributes.href).toBe("guide.md");
  });

  it("deduplicates references and keeps script and connection policies restricted", () => {
    expect(localImageReferences(markdownHtml("![](a.png) ![](a.png) ![](b.png)"))).toEqual([
      "a.png",
      "b.png",
    ]);
    const document = previewDocument(
      '<img src="./a.png"><script>bad()</script>',
      "html",
      colors,
      13,
      { images: { "./a.png": { uri, message: null } } },
    );
    expect(document).toContain(`src="${uri}"`);
    expect(document).toContain("img-src data: https: http:");
    expect(document).toContain("connect-src 'none'");
    expect(document).not.toContain("script-src");
    expect(document).toContain('name="referrer" content="no-referrer"');
  });

  it("bounds image requests before they reach the server", () => {
    expect(
      previewImagesRpc.input.safeParse({
        directory: "/workspace",
        repositoryId: ".",
        path: "README.md",
        hrefs: Array.from({ length: 33 }, (_, i) => `${i}.png`),
      }).success,
    ).toBe(false);
  });

  it("renders large standalone data images without reopening pathological inline parsing", () => {
    const embedded = `data:image/png;base64,${"a".repeat(8192)}`;
    expect(markdownHtml(`![内嵌图](${embedded})`)).toContain(`src="${embedded}"`);
    expect(markdownHtml(`<img alt="内嵌图" src="${embedded}" onload="bad()">`)).toContain(
      `src="${embedded}"`,
    );
    expect(markdownHtml(`<img alt="内嵌图" src="${embedded}" onload="bad()">`)).not.toContain(
      "onload=",
    );
    const malformed = "[".repeat(100000);
    expect(markdownHtml(malformed)).toBe(`<p>${malformed}</p>`);
  });
});
