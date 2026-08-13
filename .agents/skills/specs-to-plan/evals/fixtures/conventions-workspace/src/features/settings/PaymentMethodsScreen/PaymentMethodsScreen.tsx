import { useQuery } from "@tanstack/react-query";
import { Button, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ResourceState } from "../../../ui/ResourceState";
import { ScreenTemplate } from "../../../ui/ScreenTemplate";
import { SettingsRow } from "../../../ui/SettingsRow";
import { paymentMethodsQuery } from "./paymentMethods.queries";
import { styles } from "./PaymentMethodsScreen.styles";
import type { PaymentMethodsScreenProps } from "./PaymentMethodsScreen.types";

export function PaymentMethodsScreen({ navigation }: PaymentMethodsScreenProps) {
  const { t } = useTranslation();
  const methods = useQuery(paymentMethodsQuery);
  const addAction = <Button title={t("paymentMethods.add")} onPress={() => navigation.navigate("PaymentMethods", undefined)} />;

  return (
    <ScreenTemplate title={t("paymentMethods.title")} footer={addAction} testID="payment-methods-screen">
      <ResourceState
        status={methods.isPending ? "loading" : methods.isError ? "error" : "ready"}
        loadingLabel={t("paymentMethods.loading")}
        message={t("paymentMethods.error")}
        retryLabel={t("common.retry")}
        onRetry={() => void methods.refetch()}
      >
        {methods.data?.length === 0 ? <Text>{t("paymentMethods.empty")}</Text> : null}
        <View style={styles.list}>
          {methods.data?.map((method) => (
            <SettingsRow key={method.id} accessibilityLabel={`${method.label}, ${method.detail}`} label={method.label} detail={method.detail} onPress={() => undefined} />
          ))}
        </View>
      </ResourceState>
    </ScreenTemplate>
  );
}
