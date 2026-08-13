import type { PropsWithChildren, ReactNode } from "react";
import { SafeAreaView, ScrollView, Text, View } from "react-native";

interface ScreenTemplateProps extends PropsWithChildren {
  title: string;
  footer?: ReactNode;
  testID: string;
}

export function ScreenTemplate({ children, footer, testID, title }: ScreenTemplateProps) {
  return (
    <SafeAreaView testID={testID}>
      <Text accessibilityRole="header">{title}</Text>
      <ScrollView><View>{children}</View></ScrollView>
      {footer}
    </SafeAreaView>
  );
}
