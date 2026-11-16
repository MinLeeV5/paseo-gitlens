import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { NativeMarkdown } from "../../client/native-markdown";
import { localImageReferences } from "../../client/preview-images";
import { markdownHtml } from "../../client/preview-model";
import { fileContentRpc, previewImagesRpc, resolveLinkRpc } from "../../shared/contracts";
import { MAX_PREVIEW_IMAGES, type PreviewImages } from "../../shared/preview-images";

// Mount the actual native Markdown component in RN Web without changing Platform.OS
// for RN Web itself, which would disable its browser input handling.
export function NativePreview({
  directory,
  path,
  theme,
}: {
  directory: string;
  path: string;
  theme: PluginTheme;
}) {
  const read = useRpc(fileContentRpc);
  const resolve = useRpc(resolveLinkRpc);
  const loadImages = useRpc(previewImagesRpc);
  const [file, setFile] = useState({ repositoryId: ".", path });
  const [content, setContent] = useState("");
  const [images, setImages] = useState<PreviewImages>({});
  const [navigation, setNavigation] = useState({ fragment: "", request: 0 });
  useEffect(() => {
    let stopped = false;
    void read({ directory, ...file, comparison: "head", scope: "workspace" }).then(async (data) => {
      const hrefs = localImageReferences(markdownHtml(data.content)).slice(0, MAX_PREVIEW_IMAGES);
      const loaded = await loadImages({ directory, ...file, comparison: "head", hrefs });
      if (!stopped) {
        setImages(Object.fromEntries(loaded.map((image) => [image.href, image])));
        setContent(data.content);
      }
    });
    return () => {
      stopped = true;
    };
  }, [read, loadImages, directory, file]);
  if (!content) return <Text>正在读取 Markdown…</Text>;
  return (
    <NativeMarkdown
      key={JSON.stringify(file)}
      content={content}
      theme={theme}
      fontSize={13}
      navigation={navigation}
      images={images}
      onNavigate={(href) => {
        if (href.startsWith("#")) {
          setNavigation((old) => ({
            fragment: decodeURIComponent(href.slice(1)),
            request: old.request + 1,
          }));
          return;
        }
        void resolve({ directory, ...file, href }).then((target) => {
          setContent("");
          setFile({ repositoryId: target.repositoryId, path: target.path });
          setNavigation((old) => ({ fragment: target.fragment, request: old.request + 1 }));
        });
      }}
    />
  );
}
