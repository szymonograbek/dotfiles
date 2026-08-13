import { Button, Text, View } from "react-native";

interface SettingsRowProps {
  accessibilityLabel: string;
  detail?: string;
  label: string;
  onPress(): void;
}

export function SettingsRow({ accessibilityLabel, detail, label, onPress }: SettingsRowProps) {
  return <View><Button accessibilityLabel={accessibilityLabel} title={label} onPress={onPress} />{detail ? <Text>{detail}</Text> : null}</View>;
}
