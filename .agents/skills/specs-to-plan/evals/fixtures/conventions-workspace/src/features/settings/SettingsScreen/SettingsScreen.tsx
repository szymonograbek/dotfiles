import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ScreenTemplate } from "../../../ui/ScreenTemplate";
import { SettingsRow } from "../../../ui/SettingsRow";
import { styles } from "./SettingsScreen.styles";
import type { SettingsScreenProps } from "./SettingsScreen.types";

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const { t } = useTranslation();

  return (
    <ScreenTemplate title={t("settings.title")} testID="settings-screen">
      <View style={styles.section}>
        <SettingsRow
          accessibilityLabel={t("settings.paymentMethods.accessibilityLabel")}
          label={t("settings.paymentMethods.label")}
          onPress={() => navigation.navigate("PaymentMethods", undefined)}
        />
      </View>
    </ScreenTemplate>
  );
}
