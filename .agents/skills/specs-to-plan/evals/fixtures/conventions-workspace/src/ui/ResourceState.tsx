import type { PropsWithChildren } from "react";
import { ActivityIndicator, Button, Text, View } from "react-native";

interface ResourceStateProps extends PropsWithChildren {
  status: "loading" | "error" | "ready";
  loadingLabel: string;
  message: string;
  retryLabel: string;
  onRetry(): void;
}

export function ResourceState(props: ResourceStateProps) {
  if (props.status === "loading") return <ActivityIndicator accessibilityLabel={props.loadingLabel} />;
  if (props.status === "error") {
    return <View><Text accessibilityRole="alert">{props.message}</Text><Button title={props.retryLabel} onPress={props.onRetry} /></View>;
  }
  return props.children;
}
