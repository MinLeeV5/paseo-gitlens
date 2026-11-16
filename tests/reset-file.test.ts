import { lstat, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { GitChangesService } from "../server/service";
import type { Comparison } from "../shared/contracts";
import { repositoryActionRpc } from "../shared/repository-contracts";
import { command, commit, fixture, put } from "./fixtures";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function setup() {
  const f = await fixture();
  cleanups.push(f.close);
  const directory = await f.repo("workspace");
  const service = new GitChangesService();
  cleanups.push(async () => service.close());
  const input = async (path: string, comparison: Comparison = "head") => {
    const snapshot = await service.snapshot({ directory, comparison, force: true });
    const file = snapshot.repositories[0].files.find((file) => file.path === path);
    if (!file) throw new Error(`Missing fixture change: ${path}`);
    const request = repositoryActionRpc.input.parse({
      directory,
      repositoryId: ".",
      action: "reset",
      path,
      comparison,
      expectedVersion: file.version,
    });
    if (request.action !== "reset") throw new Error("Invalid reset fixture");
    return request;
  };
  return { f, directory, service, input };
}

it("resets only the confirmed file's staged and working content and refreshes cached diffs", async () => {
  const { directory, service, input } = await setup();
  await put(directory, "file.txt", "baseline\n");
  await put(directory, "other.txt", "keep\n");
  await commit(directory);
  await put(directory, "file.txt", "staged\n");
  await command(directory, "add", "file.txt");
  await put(directory, "file.txt", "working\n");
  await put(directory, "other.txt", "unrelated\n");
  const request = await input("file.txt");
  const target = {
    directory,
    repositoryId: ".",
    path: "file.txt",
    comparison: "head" as const,
    context: 3,
    ignoreWhitespace: false,
  };
  await service.diff(target);
  await expect(service.repositoryAction(request)).resolves.toMatchObject({
    message: "已丢弃所选文件的未提交更改。",
  });
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("baseline\n");
  expect(await command(directory, "show", ":file.txt")).toBe("baseline\n");
  expect(await readFile(join(directory, "other.txt"), "utf8")).toBe("unrelated\n");
  const snapshot = await service.snapshot({ directory, comparison: "head" });
  expect(snapshot.repositories[0].files.map((file) => file.path)).toEqual(["other.txt"]);
  await expect(service.diff(target)).rejects.toThrow("文件已不在");
});

it.each([false, true])(
  "deletes only the selected new file with an unborn HEAD: %s",
  async (unborn) => {
    const { directory, service, input } = await setup();
    if (!unborn) {
      await put(directory, "baseline.txt", "baseline\n");
      await commit(directory);
    }
    await put(directory, "new/added.txt", "staged\n");
    await command(directory, "add", "new/added.txt");
    await put(directory, "new/added.txt", "working\n");
    const literal = process.platform === "win32" ? "new/file [1].txt" : "new/:(glob)*.txt";
    await put(directory, literal, "untracked\n");
    await put(directory, "new/keep.txt", "keep\n");
    await service.repositoryAction(await input("new/added.txt"));
    await service.repositoryAction(await input(literal));
    expect(await lstat(join(directory, "new/added.txt")).catch(() => null)).toBeNull();
    expect(await lstat(join(directory, literal)).catch(() => null)).toBeNull();
    expect(await command(directory, "ls-files", "--", "new/added.txt")).toBe("");
    expect(await readFile(join(directory, "new/keep.txt"), "utf8")).toBe("keep\n");
  },
);

it.each(["head", "staged", "unstaged"] as const)(
  "restores renamed files and their original names from the %s comparison",
  async (comparison) => {
    const { directory, service, input } = await setup();
    await put(directory, "original.txt", "baseline\n");
    await commit(directory);
    await command(directory, "mv", "original.txt", "renamed.txt");
    await put(directory, "renamed.txt", "baseline\nworking\n");
    await service.repositoryAction(await input("renamed.txt", comparison));
    expect(await readFile(join(directory, "original.txt"), "utf8")).toBe("baseline\n");
    expect(await lstat(join(directory, "renamed.txt")).catch(() => null)).toBeNull();
    expect(await command(directory, "status", "--porcelain")).toBe("");
  },
);

it("restores deleted files and handles staged edits canceled out in the working tree", async () => {
  const { directory, service, input } = await setup();
  await put(directory, "deleted.txt", "baseline\n");
  await put(directory, "canceled.txt", "baseline\n");
  await commit(directory);
  await rm(join(directory, "deleted.txt"));
  await put(directory, "canceled.txt", "staged\n");
  await command(directory, "add", "canceled.txt");
  await put(directory, "canceled.txt", "baseline\n");
  await service.repositoryAction(await input("deleted.txt"));
  await service.repositoryAction(await input("canceled.txt", "unstaged"));
  expect(await readFile(join(directory, "deleted.txt"), "utf8")).toBe("baseline\n");
  expect(await command(directory, "status", "--porcelain")).toBe("");
});

it("requires confirmation of the latest file contents and HEAD", async () => {
  const { directory, service, input } = await setup();
  await put(directory, "file.txt", "baseline\n");
  await commit(directory);
  await put(directory, "file.txt", "confirmed\n");
  const request = await input("file.txt");
  await put(directory, "file.txt", "newer unconfirmed content\n");
  await expect(service.repositoryAction(request)).rejects.toThrow("重新确认");
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("newer unconfirmed content\n");
  const next = await input("file.txt");
  await command(directory, "commit", "--allow-empty", "-qm", "advance HEAD");
  await expect(service.repositoryAction(next)).rejects.toThrow("重新确认");
});

it("refuses directories, internal files, pathspecs and paths outside the repository", async () => {
  const { directory, service, input } = await setup();
  await put(directory, "nested/file.txt", "baseline\n");
  await commit(directory);
  await put(directory, "nested/file.txt", "working\n");
  const request = await input("nested/file.txt");
  for (const path of [".", "../outside.txt", ".git/config", ":(glob)**", "nested"])
    await expect(service.repositoryAction({ ...request, action: "reset", path })).rejects.toThrow();
  expect(await readFile(join(directory, "nested/file.txt"), "utf8")).toBe("working\n");
});

it.skipIf(process.platform === "win32")(
  "unlinks new symlinks without deleting their targets",
  async () => {
    const { f, directory, service, input } = await setup();
    const outside = await f.repo("outside");
    await put(outside, "keep.txt", "keep\n");
    await symlink(join(outside, "keep.txt"), join(directory, "link.txt"));
    await service.repositoryAction(await input("link.txt"));
    expect(await lstat(join(directory, "link.txt")).catch(() => null)).toBeNull();
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep\n");
  },
);

it("refuses to overwrite a recreated original path when resetting a rename", async () => {
  const { directory, service, input } = await setup();
  await put(directory, "original.txt", "baseline\n");
  await commit(directory);
  await command(directory, "mv", "original.txt", "renamed.txt");
  await put(directory, "original.txt", "new content\n");
  await expect(service.repositoryAction(await input("renamed.txt", "staged"))).rejects.toThrow(
    "重命名前的路径已存在",
  );
  expect(await readFile(join(directory, "original.txt"), "utf8")).toBe("new content\n");
  expect(await readFile(join(directory, "renamed.txt"), "utf8")).toBe("baseline\n");
});
