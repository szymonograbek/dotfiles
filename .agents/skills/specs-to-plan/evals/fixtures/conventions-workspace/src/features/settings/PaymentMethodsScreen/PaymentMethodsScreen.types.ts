import type { AppNavigation } from "../../../navigation/AppRoutes.types";

export interface PaymentMethodsScreenProps {
  navigation: AppNavigation;
}

export interface PaymentMethodRowProps {
  id: string;
  label: string;
  detail: string;
  onPress(id: string): void;
}
