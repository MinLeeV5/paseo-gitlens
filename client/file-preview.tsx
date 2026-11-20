import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Text, View } from "react-native";
import {
  type FileContent,
  fileContentRpc,
  mermaidRuntimeRpc,
  previewImagesRpc,
} from "../shared/contracts";
import { MAX_PREVIEW_IMAGES, type PreviewImages } from "../shared/preview-images";
import { parsePreviewLink } from "../shared/preview-links";
import { ToolButton } from "./controls";
import { useT } from "./i18n";
import { Icon } from "./icons";
import { ImagePreview } from "./image-preview";
import { hasMermaid } from "./mermaid-preview";
import { NativeMarkdown } from "./native-markdown";
import { htmlImages, localImageReferences } from "./preview-images";
import { markdownHtml, type PreviewKind, previewDocument } from "./preview-model";
import { panelTokens } from "./theme";

let renderer: Promise<string> | null = null;
type PreviewFrame = { contentWindow: { postMessage(data: unknown, origin: string): void } | null };
type PreviewMessage = {
  source: unknown;
  data?: { type?: unknown; token?: unknown; href?: unknown };
};
type PreviewWindow = {
  addEventListener(type: "message", handler: (event: PreviewMessage) => void): void;
  removeEventListener(type: "message", handler: (event: PreviewMessage) => void): void;
};

export function FilePreview({
  directory,
  repositoryId,
  path,
  version,
  comparison,
  scope = "changes",
  kind,
  theme,
  fontSize,
  fontFamily,
  fontWeight,
  navigation,
  onNavigate,
  onCost,
}: {
  directory: string;
  repositoryId: string;
  path: string;
  version: string;
  comparison: "head" | "staged" | "unstaged";
  scope?: "changes" | "workspace";
  kind: PreviewKind;
  theme: PluginTheme;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: "400" | "500" | "600";
  navigation?: { fragment: string; request: number };
  onNavigate(href: string): void;
  onCost?(bytes: number): void;
}) {
  const call = useRpc(fileContentRpc);
  const loadImages = useRpc(previewImagesRpc);
  const loadRenderer = useRpc(mermaidRuntimeRpc);
  const c = panelTokens(theme);
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [runtime, setRuntime] = useState("");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [state, setState] = useState<{
    key: string;
    data: FileContent | null;
    images: PreviewImages;
    error: string | null;
  }>({ key: "", data: null, images: {}, error: null });
  // Keep a small cache local to the mounted preview. Closing/switching releases it.
  const cache = useRef<{ key: string; data: FileContent; images: PreviewImages } | null>(null);
  const key = JSON.stringify([directory, repositoryId, path, version, comparison, scope, attempt]);
  const frame = useRef<PreviewFrame>(null);
  const onLink = useRef(onNavigate);
  onLink.current = onNavigate;
  const anchor = useRef(navigation);
  anchor.current = navigation;
  const identity = useMemo(() => {
    const token =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return { key, token, nonce: `git-${token}` };
  }, [key]);
  useEffect(() => {
    if (Platform.OS !== "web" || kind !== "markdown") return;
    const host = globalThis as unknown as PreviewWindow;
    const receive = (event: PreviewMessage) => {
      const data = event.data;
      if (
        event.source === frame.current?.contentWindow &&
        data?.type === "git-preview-link" &&
        data.token === identity.token &&
        typeof data.href === "string" &&
        parsePreviewLink(data.href)
      )
        onLink.current(data.href);
    };
    host.addEventListener("message", receive);
    return () => host.removeEventListener("message", receive);
  }, [kind, identity]);
  useEffect(() => {
    let stopped = false;
    if (cache.current?.key === key) {
      setState({ ...cache.current, error: null });
      return;
    }
    setState({ key, data: null, images: {}, error: null });
    void call({ directory, repositoryId, path, comparison, scope }).then(
      async (data) => {
        if (stopped) return;
        const images: PreviewImages = Object.create(null);
        if (
          data.state === "text" &&
          (kind === "markdown" || (kind === "html" && Platform.OS === "web"))
        ) {
          const markup =
            kind === "markdown" ? markdownHtml(data.content) : htmlImages(data.content);
          const hrefs = localImageReferences(markup);
          for (const href of hrefs)
            images[href] = { uri: null, message: t("单个文档最多预览 32 张本地图片。") };
          if (hrefs.length) {
            const requested = hrefs.slice(0, MAX_PREVIEW_IMAGES);
            try {
              const loaded = await loadImages({
                directory,
                repositoryId,
                path,
                comparison,
                hrefs: requested,
              });
              for (const image of loaded)
                images[image.href] = { uri: image.uri, message: image.message };
            } catch {
              for (const href of requested)
                images[href] = { uri: null, message: t("图片读取失败，请重试预览。") };
            }
          }
        }
        if (!stopped) {
          cache.current = { key, data, images };
          setState({ key, data, images, error: null });
        }
      },
      (error: unknown) => {
        if (!stopped)
          setState({
            key,
            data: null,
            images: {},
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      stopped = true;
    };
  }, [call, loadImages, key, directory, repositoryId, path, comparison, scope, kind, t]);
  const current = state.key === key ? state : { data: null, images: {}, error: null };
  const diagrams =
    Platform.OS === "web" &&
    kind === "markdown" &&
    current.data?.state === "text" &&
    hasMermaid(current.data.content);
  useEffect(() => {
    if (current.data)
      onCost?.(
        current.data.content.length * 2 +
          Object.values(current.images).reduce(
            (sum, image) => sum + (image.uri?.length ?? 0) * 2,
            0,
          ) +
          (diagrams ? 8 * 1024 * 1024 : 0),
      );
  }, [current.data, current.images, diagrams, onCost]);
  useEffect(() => {
    if (!diagrams || runtime || runtimeError) return;
    let stopped = false;
    renderer ??= loadRenderer({})
      .then((result) => result.gzip)
      .catch((error) => {
        renderer = null;
        throw error;
      });
    void renderer?.then(
      (source) => {
        if (!stopped) setRuntime(source);
      },
      (error: unknown) => {
        if (!stopped) setRuntimeError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      stopped = true;
    };
  }, [diagrams, loadRenderer, runtime, runtimeError]);
  const document = useMemo(
    () =>
      Platform.OS === "web" && current.data?.state === "text"
        ? previewDocument(
            current.data.content,
            kind,
            {
              background: c.surface0,
              foreground: c.foreground,
              muted: c.foregroundMuted,
              border: c.border,
              accent: c.accent,
            },
            fontSize,
            {
              fontFamily,
              fontWeight,
              filePath: path,
              images: current.images,
              t,
              ...(kind === "markdown" ? { navigation: identity } : {}),
              ...(diagrams && runtime
                ? {
                    mermaid: {
                      gzip: runtime,
                      nonce: identity.nonce,
                    },
                  }
                : {}),
            },
          )
        : "",
    [
      current.data,
      current.images,
      kind,
      c.surface0,
      c.foreground,
      c.foregroundMuted,
      c.border,
      c.accent,
      fontSize,
      fontFamily,
      fontWeight,
      diagrams,
      runtime,
      identity,
      path,
      t,
    ],
  );
  function revealAnchor() {
    if (anchor.current && kind === "markdown")
      frame.current?.contentWindow?.postMessage(
        {
          type: "git-preview-anchor",
          token: identity.token,
          fragment: anchor.current.fragment,
        },
        "*",
      );
  }
  const revealAnchorRef = useRef(revealAnchor);
  revealAnchorRef.current = revealAnchor;
  useEffect(() => {
    if (navigation && document) revealAnchorRef.current();
  }, [navigation, document]);
  if (current.error || (current.data && !["text", "image"].includes(current.data.state)))
    return (
      <View
        style={{ flex: 1, padding: 24, justifyContent: "center", alignItems: "center", gap: 12 }}
      >
        <Icon name="info" size={28} color={c.foregroundMuted} />
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          {current.error ?? current.data?.message}
        </Text>
        {current.error ? (
          <ToolButton
            theme={theme}
            label={t("重试读取预览")}
            text={t("重试")}
            icon="refresh"
            onPress={() => setAttempt((value) => value + 1)}
          />
        ) : null}
      </View>
    );
  if (!current.data)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  if (current.data.state === "image")
    return (
      <ImagePreview
        key={key}
        uri={current.data.content}
        label={t("{path} 文件预览", { path })}
        theme={theme}
        onCost={onCost}
        onReload={() => setAttempt((value) => value + 1)}
      />
    );
  const failedImages = Object.values(current.images).filter((image) => image.message).length;
  const previewActions =
    kind === "markdown" || kind === "html" ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        {failedImages ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{ flex: 1, color: c.foregroundMuted, fontSize: 12 }}
          >
            {t("{count} 张图片未能加载", { count: failedImages })}
          </Text>
        ) : null}
        <ToolButton
          theme={theme}
          icon="refresh"
          label={t("重新加载预览及图片")}
          text={t("刷新预览")}
          size={Platform.OS === "web" ? 28 : 44}
          onPress={() => setAttempt((value) => value + 1)}
        />
      </View>
    ) : null;
  if (Platform.OS === "web")
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        {previewActions}
        {diagrams && runtimeError ? (
          <View
            accessibilityRole="alert"
            style={{ padding: 8, gap: 5, backgroundColor: c.surface1 }}
          >
            <Text style={{ color: c.statusDanger, fontSize: 12 }}>
              {t("Mermaid 加载失败：{error}", { error: runtimeError })}
            </Text>
            <ToolButton
              theme={theme}
              icon="refresh"
              label={t("重试加载 Mermaid")}
              text={t("重试")}
              onPress={() => setRuntimeError(null)}
            />
          </View>
        ) : null}
        {createElement("iframe", {
          key: `${key}:${Boolean(diagrams && runtime)}`,
          ref: frame,
          title: t("{path} 文件预览", { path }),
          "data-testid": "file-preview",
          srcDoc:
            diagrams && runtimeError
              ? document.replaceAll(
                  t("正在加载 Mermaid 图表…"),
                  t("图表引擎加载失败，可展开查看源码。"),
                )
              : document,
          sandbox: kind === "markdown" ? "allow-scripts" : "",
          onLoad: revealAnchor,
          referrerPolicy: "no-referrer",
          style: {
            flex: 1,
            width: "100%",
            minHeight: 0,
            border: 0,
            background: c.surface0,
            colorScheme: "normal",
          },
        })}
      </View>
    );

  if (kind === "markdown")
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        {previewActions}
        <NativeMarkdown
          key={key}
          content={current.data.content}
          theme={theme}
          fontSize={fontSize}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          navigation={navigation}
          onNavigate={onNavigate}
          images={current.images}
        />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text selectable style={{ color: c.foreground, fontSize, lineHeight: fontSize * 1.7 }}>
        {kind === "html" ? `${t("HTML 预览请在桌面或 Web 面板中打开。")}\n\n` : ""}
        {current.data.content}
      </Text>
    </ScrollView>
  );
}
