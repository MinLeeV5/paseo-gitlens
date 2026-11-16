import { Image } from "react-native";
import { gitLensIconUri } from "./generated/brand";

const source = { uri: gitLensIconUri };

export function GitLensIcon({ size = 16 }: { size?: number }) {
  return (
    <Image
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      source={source}
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  );
}
