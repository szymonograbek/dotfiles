export interface AppRoutes {
  Settings: undefined;
  PaymentMethods: undefined;
  SavedAddresses: undefined;
  AddAddress: undefined;
  EditAddress: { addressId: string };
}

export interface AppNavigation {
  navigate<Route extends keyof AppRoutes>(route: Route, params: AppRoutes[Route]): void;
}
