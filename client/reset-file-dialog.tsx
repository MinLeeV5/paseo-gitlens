import type { PluginTheme } from "@getpaseo/plugin";
import { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "./icons";
import { panelTokens } from "./theme";

export function ResetFileDialog({
  path,
  repository,
  hasHead,
  theme,
  onCancel,
  onConfirm,
}: {
  path: string;
  repository: string;
  hasHead: boolean;
  theme: PluginTheme;
  onCancel(): void;
  onConfirm(): void;
}) {
  const c = panelTokens(theme);
  const cancelRef = useRef<View>(null);
  const [focused, setFocused] = useState<"cancel" | "reset" | null>(null);
  const buttonHeight = Platform.OS === "web" ? 30 : 44;
  return (
    <Modal
      transparent
      animationType="none"
      onRequestClose={onCancel}
      onShow={() => cancelRef.current?.focus()}
    >
      <View
        style={{
          flex: 1,
          padding: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#00000066",
        }}
      >
        <Pressable
          accessibilityLabel="取消 Reset"
          accessible={false}
          {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
          onPress={onCancel}
          style={{ position: "absolute", inset: 0 }}
        />
        <View
          testID="git-reset-file-dialog"
          accessibilityLabel="Reset 文件更改？"
          accessibilityViewIsModal
          {...(Platform.OS === "web"
            ? {
                role: "alertdialog",
                "aria-modal": true,
                "aria-describedby": "git-reset-description",
              }
            : {})}
          style={{
            width: "100%",
            maxWidth: 420,
            maxHeight: "100%",
            padding: 20,
            gap: 16,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="warning" color={c.statusWarning} size={18} />
            <Text style={{ color: c.foreground, fontSize: 15, fontWeight: "600" }}>
              Reset 文件更改？
            </Text>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }}>
            <Text selectable style={{ color: c.foreground, fontSize: 12, lineHeight: 19 }}>
              {repository} / {path}
            </Text>
            <Text
              nativeID="git-reset-description"
              style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 19 }}
            >
              {hasHead
                ? "将丢弃此文件的全部未提交更改（包括已暂存内容），并恢复到 HEAD。尚未提交的新文件将被删除。"
                : "此仓库尚无提交，该文件将被删除（包括已暂存内容）。"}
              {"\n"}此操作无法撤销。
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              ref={cancelRef}
              accessibilityRole="button"
              accessibilityLabel="取消 Reset"
              onPress={onCancel}
              onFocus={() => setFocused("cancel")}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => ({
                minHeight: buttonHeight,
                minWidth: 64,
                paddingHorizontal: 10,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                borderWidth: 1,
                borderColor: focused === "cancel" ? c.accent : c.border,
                backgroundColor: pressed ? c.surface2 : c.surface0,
              })}
            >
              <Text style={{ color: c.foreground, fontSize: 12 }}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="确认 Reset"
              onPress={onConfirm}
              onFocus={() => setFocused("reset")}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => ({
                minHeight: buttonHeight,
                minWidth: 84,
                paddingHorizontal: 10,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                borderWidth: 1,
                borderColor: focused === "reset" ? c.accent : c.statusDanger,
                backgroundColor: pressed ? c.surface2 : c.surface0,
              })}
            >
              <Text style={{ color: c.statusDanger, fontSize: 12 }}>确认 Reset</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
