# GitLens

**Review and commit across repositories, without leaving Paseo.**

- 🧩 **Nested repositories**: Review the root and initialized submodules, even with `ignore = all`. Each uses its own HEAD.
- 🔍 **Focused diffs**: Split or unified views, staged/unstaged comparisons, file tabs, change markers, and stable refresh.
- ✍️ **Commit and sync**: Stage, unstage, reset files after confirmation, commit, fast-forward pull, and push per repository; draft messages with Paseo AI or local rules.
- 🌿 **Trace history**: Browse branches, merges, refs, and tags; search loaded commits and inspect historical diffs.
- 📖 **Preview documents**: Read Markdown, offline Mermaid, static HTML, and images; follow workspace links and heading anchors.

## Workflow

Open GitLens in a workspace, choose a repository, and review its changes or history. Customize fonts, layout, refresh behavior, and commit instructions per host. Git runs on the daemon host using its identity, authentication, and hooks.

AI drafts send file paths, change metadata, diff excerpts, and instructions to the configured Paseo provider. Local rules run on the host.

Reset discards the selected file's uncommitted changes, including staged content, after confirmation. Tracked files return to HEAD; new files are deleted. This cannot be undone. Files changed since the confirmation dialog opened require a new confirmation.

## Requirements and scope

Image files open in preview with fit, original-size and zoom controls. Documents support local relative paths, submodules, inline data images and HTTP(S) images.

Requires **Paseo daemon and client 0.12.0+**, with Git on the host. Files and individual local images are limited to **1 MiB**, patches to **2 MiB**. Each document supports **32** distinct local image references with an **8 MiB** image-content cache budget. HTML and rendered Mermaid are for desktop/Web; native mobile supports Markdown images and shows Mermaid source.

Submodule initialization, branch switching, and arbitrary-ref comparisons are not provided.
