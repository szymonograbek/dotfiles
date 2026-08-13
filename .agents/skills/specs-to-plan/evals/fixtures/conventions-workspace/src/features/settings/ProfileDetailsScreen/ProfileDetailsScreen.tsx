import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ScreenTemplate } from "../../../ui/ScreenTemplate";
import { styles } from "./ProfileDetailsScreen.styles";
import type { ProfileDetailsScreenProps } from "./ProfileDetailsScreen.types";

export function ProfileDetailsScreen(_props: ProfileDetailsScreenProps) {
  const { t } = useTranslation();
  return <ScreenTemplate title={t("profileDetails.title")} testID="profile-details-screen"><View style={styles.fields}><Text>{t("profileDetails.name")}</Text></View></ScreenTemplate>;
}
