import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { ToolButton } from "./controls";
import { panelTokens } from "./theme";

function useImageSize(uri: string, attempt = 0) {
  const [state, setState] = useState<{
    uri: string;
    attempt: number;
    width: number;
    height: number;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!stopped) setState({ uri, attempt, width, height, error: !(width > 0 && height > 0) });
      },
      () => {
        if (!stopped) setState({ uri, attempt, width: 0, height: 0, error: true });
      },
    );
    return () => {
      stopped = true;
    };
  }, [uri, attempt]);
  return state?.uri === uri && state.attempt === attempt ? state : null;
}

export function MarkdownImage({
  uri,
  label,
  width,
  requestedWidth,
  requestedHeight,
  color,
}: {
  uri: string;
  label: string;
  width: number;
  requestedWidth?: number;
  requestedHeight?: number;
  color: string;
}) {
  const size = useImageSize(uri);
  const [failed, setFailed] = useState(false);
  if (failed || size?.error) return <Text style={{ color }}>{label}（图片加载失败）</Text>;
  if (!size) return <Text style={{ color }}>{label}（正在加载图片…）</Text>;
  const displayWidth = Math.min(
    width,
    requestedWidth || (requestedHeight ? (size.width * requestedHeight) / size.height : size.width),
  );
  return (
    <Image
      accessibilityLabel={label}
      source={{ uri }}
      resizeMode="contain"
      onError={() => setFailed(true)}
      style={{ width: displayWidth, height: (displayWidth * size.height) / size.width }}
    />
  );
}

export function ImagePreview({
  uri,
  label,
  theme,
  onCost,
  onReload,
}: {
  uri: string;
  label: string;
  theme: PluginTheme;
  onCost?(bytes: number): void;
  onReload?(): void;
}) {
  const c = panelTokens(theme);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const size = useImageSize(uri, attempt);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const scale =
    zoom ??
    (size
      ? Math.min(
          1,
          Math.max(1, viewport.width - 32) / size.width,
          Math.max(1, viewport.height - 32) / size.height,
        )
      : 1);
  useEffect(() => {
    if (size && !size.error) onCost?.(uri.length * 2 + size.width * size.height * 4);
  }, [size, uri, onCost]);
  if (failed || size?.error)
    return (
      <View
        accessibilityRole="alert"
        style={{ flex: 1, gap: 12, padding: 24, alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          图片加载失败，文件可能已损坏或当前客户端不支持此格式。
        </Text>
        <ToolButton
          theme={theme}
          label="重试加载图片"
          text="重试"
          icon="refresh"
          size={44}
          onPress={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
            onReload?.();
          }}
        />
      </View>
    );
  return (
    <View testID="image-preview" style={{ flex: 1, minHeight: 0, backgroundColor: c.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 4,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <ToolButton
          theme={theme}
          label="适应窗口"
          text="适应"
          size={44}
          active={zoom === null}
          onPress={() => setZoom(null)}
        />
        <ToolButton
          theme={theme}
          label="原始尺寸（100%）"
          text="100%"
          size={44}
          active={zoom === 1}
          disabled={!size}
          onPress={() => setZoom(1)}
        />
        <ToolButton
          theme={theme}
          label="缩小图片"
          text="−"
          size={44}
          disabled={!size || scale <= 0.05}
          onPress={() => setZoom(Math.max(0.05, scale / 1.25))}
        />
        <ToolButton
          theme={theme}
          label="放大图片"
          text="+"
          size={44}
          disabled={!size || scale >= 8}
          onPress={() => setZoom(Math.min(8, scale * 1.25))}
        />
        <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted, fontSize: 11 }}>
          {size ? `${Math.round(scale * 100)}% · ${size.width} × ${size.height}` : "正在加载图片…"}
        </Text>
      </View>
      <View
        style={{ flex: 1, minHeight: 0 }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setViewport({ width, height });
        }}
      >
        {size ? (
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
            <ScrollView
              nestedScrollEnabled
              style={{ width: Math.max(viewport.width, size.width * scale + 32) }}
              contentContainerStyle={{
                minHeight: viewport.height,
                padding: 16,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                accessibilityLabel={label}
                source={{ uri }}
                resizeMode="contain"
                onError={() => setFailed(true)}
                style={{ width: size.width * scale, height: size.height * scale }}
              />
            </ScrollView>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={c.accent} />
          </View>
        )}
      </View>
    </View>
  );
}
