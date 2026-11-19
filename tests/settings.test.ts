import { expect, it } from "vitest";
import { panelSettingsSchema } from "../shared/settings";

it("adds a default view to existing settings without resetting other preferences", () => {
  expect(panelSettingsSchema.parse({ tree: true, fontSize: 16, mode: "patch" })).toMatchObject({
    defaultView: "changes",
    tree: true,
    fontSize: 16,
    mode: "unified",
  });
});

it.each(["changes", "history"])("accepts %s as the default view", (defaultView) => {
  expect(panelSettingsSchema.parse({ defaultView }).defaultView).toBe(defaultView);
});

it("rejects an unsupported default view", () => {
  expect(panelSettingsSchema.safeParse({ defaultView: "diff" }).success).toBe(false);
});

it("defaults existing settings to file count order and hides clean repositories", () => {
  expect(panelSettingsSchema.parse({ tree: true })).toMatchObject({
    tree: true,
    repositorySort: "fileCount",
    showCleanRepositories: false,
  });
  expect(
    panelSettingsSchema.parse({ repositorySort: "loadOrder", showCleanRepositories: true }),
  ).toMatchObject({ repositorySort: "loadOrder", showCleanRepositories: true });
});
