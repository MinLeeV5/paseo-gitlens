import { symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, type TestContext } from "vitest";
import { revealTarget } from "../server/files";
import { GitChangesService } from "../server/service";
import { addModule, command, commit, fixture, put } from "./fixtures";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const f = await fixture();
  cleanups.push(f.close);
  const directory = await f.repo("preview");
  const service = new GitChangesService();
  cleanups.push(() => service.close());
  return { ...f, directory, service };
}
async function linkFile(context: TestContext, target: string, path: string) {
  try {
    await symlink(target, path);
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM")
      return context.skip("File symlinks require Windows Developer Mode or elevation");
    throw error;
  }
}
it("previews the actual index separately from working content including staged image bytes", async () => {
  const { directory, service } = await setup();
  await put(directory, "readme.md", "# Original\n");
  await commit(directory);
  await put(directory, "readme.md", "# Index\n");
  const image = Buffer.from([137, 80, 78, 71, 0, 255, 128]);
  await put(directory, "image.png", image);
  await command(directory, "add", "readme.md", "image.png");
  await put(directory, "readme.md", "# Working\n");
  const input = { directory, repositoryId: ".", path: "readme.md" };
  expect(await service.content({ ...input, comparison: "staged" })).toMatchObject({
    state: "text",
    source: "index",
    content: "# Index\n",
  });
  expect(await service.content({ ...input, comparison: "head" })).toMatchObject({
    state: "text",
    source: "working",
    content: "# Working\n",
  });
  expect(
    (await service.content({ ...input, path: "image.png", comparison: "staged" })).content,
  ).toBe(`data:image/png;base64,${image.toString("base64")}`);
});
it("returns deliberate states for deleted, binary and large files", async () => {
  const { directory, service } = await setup();
  await put(directory, "deleted.html", "before");
  await commit(directory);
  await unlink(join(directory, "deleted.html"));
  await put(directory, "binary.dat", Buffer.from([0, 1, 2]));
  await put(directory, "large.html", "x".repeat(1024 * 1024 + 1));
  const input = { directory, repositoryId: ".", comparison: "head" as const };
  expect((await service.content({ ...input, path: "deleted.html" })).state).toBe("missing");
  expect((await service.content({ ...input, path: "binary.dat" })).state).toBe("binary");
  expect((await service.content({ ...input, path: "large.html" })).state).toBe("too_large");
});
it("rejects unknown files and repository escape paths", async () => {
  const { directory, service, base } = await setup();
  await put(directory, "known.md", "known");
  await commit(directory);
  await put(base, "private.md", "outside");
  const input = { directory, repositoryId: ".", comparison: "head" as const };
  await expect(service.content({ ...input, path: "../private.md" })).rejects.toThrow();
  await expect(service.content({ ...input, path: "known.md" })).rejects.toThrow();
});
it("rejects worktree file symlinks", async (context) => {
  const { directory, service, base } = await setup();
  await put(directory, "known.md", "known");
  await commit(directory);
  await put(base, "private.md", "outside");
  await linkFile(context, join(base, "private.md"), join(directory, "linked.md"));
  const input = { directory, repositoryId: ".", comparison: "head" as const };
  expect((await service.content({ ...input, path: "linked.md" })).state).toBe("unsupported");
});
it("reveals deleted files at their nearest existing parent without shell interpretation", async () => {
  const { directory, service } = await setup();
  await put(directory, "folder/$(touch danger).md", "old");
  await commit(directory);
  await unlink(join(directory, "folder/$(touch danger).md"));
  const snapshot = await service.snapshot({ directory, comparison: "head" });
  expect(await revealTarget(snapshot.repositories[0], "folder/$(touch danger).md")).toEqual({
    target: join(snapshot.repositories[0].directory, "folder"),
    directory: true,
  });
  await expect(revealTarget(snapshot.repositories[0], "../outside")).rejects.toThrow();
});
it("opens unchanged linked files, root-relative paths, encoded names and nested submodule targets", async () => {
  const { directory, service, repo } = await setup();
  await put(directory, "docs/source.md", "# Source");
  await put(directory, "docs/target file.md", "# Destination");
  await put(directory, "README.md", "# Root");
  const child = await repo("child");
  await put(child, "guide.md", "# Child");
  await commit(child);
  await addModule(directory, child, "modules/child");
  await commit(directory);
  const source = { directory, repositoryId: ".", path: "docs/source.md" };
  const target = await service.resolveLink({ ...source, href: "target%20file.md#destination" });
  expect(target).toMatchObject({
    repositoryId: ".",
    path: "docs/target file.md",
    kind: "file",
    fragment: "destination",
  });
  await expect(
    service.content({
      directory,
      repositoryId: target.repositoryId,
      path: target.path,
      comparison: "head",
    }),
  ).rejects.toThrow("变更列表");
  expect(
    await service.content({
      directory,
      repositoryId: target.repositoryId,
      path: target.path,
      comparison: "head",
      scope: "workspace",
    }),
  ).toMatchObject({ content: "# Destination", source: "working" });
  expect(await service.resolveLink({ ...source, href: "/README.md" })).toMatchObject({
    repositoryId: ".",
    path: "README.md",
  });
  expect(await service.resolveLink({ ...source, href: "../modules/child/guide.md" })).toMatchObject(
    { repositoryId: "modules/child", path: "guide.md" },
  );
  expect(
    await service.resolveLink({
      directory,
      repositoryId: "modules/child",
      path: "guide.md",
      href: "../../README.md",
    }),
  ).toMatchObject({ repositoryId: ".", path: "README.md" });
  expect(
    await service.resolveLink({
      ...source,
      href: pathToFileURL(join(directory, "README.md")).href,
    }),
  ).toMatchObject({ path: "README.md" });
  expect(await service.resolveLink({ ...source, href: "../" })).toMatchObject({
    path: ".",
    kind: "directory",
  });
  expect(await service.resolveLink({ ...source, href: "./" })).toMatchObject({
    path: "docs",
    kind: "directory",
  });
});
it("confines linked and directly requested workspace files", async () => {
  const { directory, service, base } = await setup();
  await put(directory, "docs/source.md", "source");
  await put(directory, "clean.md", "clean");
  await commit(directory);
  await put(base, "outside.md", "private");
  await put(directory, "large.txt", "x".repeat(1024 * 1024 + 1));
  const source = { directory, repositoryId: ".", path: "docs/source.md" };
  for (const href of [
    "../../outside.md",
    pathToFileURL(join(base, "outside.md")).href,
    "../.git/config",
    "missing.md",
    "javascript:bad",
  ]) {
    await expect(service.resolveLink({ ...source, href })).rejects.toThrow();
  }
  for (const path of ["../outside.md", ".git/config"]) {
    await expect(
      service.content({
        directory,
        repositoryId: ".",
        path,
        comparison: "head",
        scope: "workspace",
      }),
    ).rejects.toThrow();
  }
  expect(
    (
      await service.content({
        directory,
        repositoryId: ".",
        path: "large.txt",
        comparison: "head",
        scope: "workspace",
      })
    ).state,
  ).toBe("too_large");
});
it("confines workspace file symlink aliases", async (context) => {
  const { directory, service, base } = await setup();
  await put(directory, "docs/source.md", "source");
  await put(base, "outside.md", "private");
  await linkFile(context, join(base, "outside.md"), join(directory, "outside-link.md"));
  await linkFile(context, join(directory, ".git/config"), join(directory, "internal-link.md"));
  for (const path of ["outside-link.md", "internal-link.md"]) {
    await expect(
      service.resolveLink({
        directory,
        repositoryId: ".",
        path: "docs/source.md",
        href: `../${path}`,
      }),
    ).rejects.toThrow();
    await expect(
      service.content({
        directory,
        repositoryId: ".",
        path,
        comparison: "head",
        scope: "workspace",
      }),
    ).rejects.toThrow();
  }
});

it("previews unchanged document images with encoded, root-relative and submodule paths", async () => {
  const { directory, service, repo } = await setup();
  const image = Buffer.from([137, 80, 78, 71, 0, 255, 128]);
  await put(directory, "docs/source.md", "![图](../assets/a%20b.PNG)");
  await put(directory, "assets/a b.PNG", image);
  const child = await repo("image-child");
  await put(child, "child.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await commit(child);
  await addModule(directory, child, "modules/child");
  await commit(directory);
  const input = {
    directory,
    repositoryId: ".",
    path: "docs/source.md",
    comparison: "head" as const,
  };
  const images = await service.previewImages({
    ...input,
    hrefs: ["../assets/a%20b.PNG?raw=1", "/assets/a%20b.PNG", "../modules/child/child.svg"],
  });
  expect(images.slice(0, 2).map((image) => image.uri)).toEqual(
    Array(2).fill(`data:image/png;base64,${image.toString("base64")}`),
  );
  expect(images[2].uri).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(images.every((image) => image.message === null)).toBe(true);
  const stagedSvg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Index image</title></svg>';
  const childDirectory = join(directory, "modules/child");
  await put(childDirectory, "child.svg", stagedSvg);
  await command(childDirectory, "add", "child.svg");
  await put(childDirectory, "child.svg", "working image differs");
  const [staged] = await service.previewImages({
    ...input,
    comparison: "staged",
    hrefs: ["../modules/child/child.svg"],
  });
  expect(staged.uri).toBe(`data:image/svg+xml;base64,${Buffer.from(stagedSvg).toString("base64")}`);
});

it("uses staged image blobs even after the working image changes or disappears", async () => {
  const { directory, service } = await setup();
  await put(directory, "docs/source.md", "source");
  await commit(directory);
  const image = Buffer.from([0, 1, 255, 128]);
  await put(directory, "assets/[image]*.png", image);
  await put(directory, "assets/gone.png", image);
  await command(directory, "add", "assets/[image]*.png", "assets/gone.png");
  await put(directory, "assets/[image]*.png", "working version");
  await unlink(join(directory, "assets/gone.png"));
  await put(directory, "assets/untracked.png", image);
  const input = {
    directory,
    repositoryId: ".",
    path: "docs/source.md",
    comparison: "staged" as const,
  };
  const images = await service.previewImages({
    ...input,
    hrefs: ["../assets/[image]*.png", "../assets/gone.png", "../assets/untracked.png"],
  });
  expect(images.slice(0, 2).map((image) => image.uri)).toEqual(
    Array(2).fill(`data:image/png;base64,${image.toString("base64")}`),
  );
  expect(images[2]).toMatchObject({ uri: null, message: expect.stringContaining("暂存区") });
  expect(
    await service.content({
      directory,
      repositoryId: ".",
      path: "assets/gone.png",
      comparison: "staged",
      scope: "workspace",
    }),
  ).toMatchObject({ source: "index", state: "image" });
});

it("keeps missing, unsupported and outside images from breaking the document", async () => {
  const { directory, service, base } = await setup();
  await put(directory, "docs/source.md", "source");
  await put(directory, "assets/file.txt", "text");
  await put(base, "outside.png", "private");
  const hrefs = [
    "missing.png",
    "../../outside.png",
    "../.git/config.png",
    "../assets/file.txt",
    "https://example.com/a.png",
    "javascript:bad()",
  ];
  const images = await service.previewImages({
    directory,
    repositoryId: ".",
    path: "docs/source.md",
    comparison: "head",
    hrefs,
  });
  expect(images.map((image) => image.href)).toEqual(hrefs);
  expect(images.every((image) => image.uri === null && image.message)).toBe(true);
});

it("confines image symlinks and refuses index symlink blobs", async (context) => {
  const { directory, service, base } = await setup();
  await put(directory, "docs/source.md", "source");
  await put(base, "outside.png", "private");
  await linkFile(context, join(base, "outside.png"), join(directory, "link.png"));
  await command(directory, "add", "docs/source.md", "link.png");
  for (const comparison of ["head", "staged"] as const) {
    const [image] = await service.previewImages({
      directory,
      repositoryId: ".",
      path: "docs/source.md",
      comparison,
      hrefs: ["../link.png"],
    });
    expect(image).toMatchObject({ uri: null, message: expect.any(String) });
  }
});

it("bounds per-image size and combined document image memory", async () => {
  const { directory, service } = await setup();
  await put(directory, "source.md", "source");
  for (const name of ["a.png", "b.png", "c.png"])
    await put(directory, name, Buffer.alloc(1024 * 1024));
  await put(directory, "large.png", Buffer.alloc(1024 * 1024 + 1));
  const images = await service.previewImages({
    directory,
    repositoryId: ".",
    path: "source.md",
    comparison: "head",
    hrefs: ["a.png", "b.png", "c.png", "large.png"],
  });
  expect(images.slice(0, 2).every((image) => image.uri)).toBe(true);
  expect(images[2]).toMatchObject({ uri: null, message: expect.stringContaining("8 MiB") });
  expect(images[3]).toMatchObject({ uri: null, message: expect.stringContaining("1 MiB") });
});
