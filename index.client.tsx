import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ChangesPanel } from "./client/changes-panel";
import { GitLensIcon } from "./client/gitlens-icon";

type ContributionIcon = Parameters<PluginClientContext["addHeaderButton"]>[0]["button"]["icon"];
type WithIcon<T> = T extends unknown ? Omit<T, "icon"> & { icon: ContributionIcon } : never;

export default function contribute(client: PluginClientContext) {
  type WorkspacePage = Awaited<ReturnType<typeof client.paseo.workspaces.list>>;
  let disposed = false;
  let generation = 0;
  let subscription: WorkspacePage["subscription"];
  let unsubscribe: (() => void) | undefined;
  let icon: ContributionIcon = GitLensIcon;
  const headerButtons = new Map<string, ReturnType<PluginClientContext["addHeaderButton"]>>();
  const removedWorkspaces = new Set<string>();
  const addHeader = (workspaceId: string) => {
    if (disposed || headerButtons.has(workspaceId)) return;
    headerButtons.set(
      workspaceId,
      client.addHeaderButton({
        id: "open-gitlens",
        workspaceId,
        button: {
          title: "Open GitLens",
          icon,
          behavior: {
            kind: "action",
            onPress: () => client.openPanel("changes", { workspaceId }),
          },
        },
      }),
    );
  };
  const removeHeader = (workspaceId: string) => {
    removedWorkspaces.add(workspaceId);
    headerButtons.get(workspaceId)?.remove();
    headerButtons.delete(workspaceId);
  };
  const syncWorkspace = (workspace: WorkspacePage["entries"][number]) => {
    if (workspace.archivingAt) removeHeader(workspace.id);
    else addHeader(workspace.id);
  };
  const reportError = (error: unknown) => {
    if (!disposed) console.error("GitLens workspace header observation failed", error);
  };
  const loadHeaders = async (page: WorkspacePage, run: number) => {
    while (!disposed && run === generation) {
      for (const workspace of page.entries) {
        if (!removedWorkspaces.has(workspace.id)) syncWorkspace(workspace);
      }
      if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) return;
      page = await client.paseo.workspaces.list({
        page: { cursor: page.pageInfo.nextCursor, limit: 100 },
      });
    }
  };
  const panel = {
    id: "changes",
    title: "GitLens",
    context: "workspace" as const,
    locations: ["workspace", "explorer"] as const,
    Component: ChangesPanel,
  };
  // Paseo 0.12–0.15 only accept Lucide names for panel/command icons. Probe the
  // client registration boundary, rather than the connected daemon's version.
  // These signatures also keep the guarded 0.16 API typecheckable with older SDKs.
  const addPanel = client.addWorkspacePanel.bind(client) as (
    contribution: WithIcon<Parameters<PluginClientContext["addWorkspacePanel"]>[0]>,
  ) => ReturnType<PluginClientContext["addWorkspacePanel"]>;
  const addCommand = client.addCommandCenterItem.bind(client) as (
    contribution: WithIcon<Parameters<PluginClientContext["addCommandCenterItem"]>[0]>,
  ) => ReturnType<PluginClientContext["addCommandCenterItem"]>;
  let removePanel: ReturnType<PluginClientContext["addWorkspacePanel"]>;
  try {
    removePanel = addPanel({ ...panel, icon });
  } catch {
    icon = "GitCompare";
    removePanel = addPanel({ ...panel, icon });
  }
  const removeCommand = addCommand({
    id: "open-changes",
    title: "GitLens · With submodules",
    icon,
    keywords: ["GitLens", "Git", "submodule"],
    context: "workspace",
    onSelect({ openPanel, workspace }) {
      addHeader(workspace.id);
      openPanel("changes");
    },
  });
  void client.paseo.workspaces
    .list({ subscribe: {}, page: { limit: 100 } })
    .then((result) => {
      if (disposed) {
        void result.subscription.release().catch(reportError);
        return;
      }
      subscription = result.subscription;
      unsubscribe = subscription.subscribe({
        snapshot: (first) => {
          removedWorkspaces.clear();
          void loadHeaders(first, ++generation).catch(reportError);
        },
        update: (message) => {
          if (disposed || message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "upsert") {
            removedWorkspaces.delete(update.workspace.id);
            syncWorkspace(update.workspace);
          } else if (update.kind === "remove") {
            removeHeader(update.id);
          }
        },
        error: reportError,
      });
    })
    .catch(reportError);
  return () => {
    disposed = true;
    unsubscribe?.();
    void subscription?.release().catch(reportError);
    for (const button of headerButtons.values()) button.remove();
    headerButtons.clear();
    removedWorkspaces.clear();
    removeCommand();
    removePanel();
  };
}
