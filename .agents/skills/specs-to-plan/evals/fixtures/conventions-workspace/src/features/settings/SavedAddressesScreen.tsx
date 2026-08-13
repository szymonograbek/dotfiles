import { ActivityIndicator, Button, SafeAreaView, Text } from "react-native";
import { useEffect, useState } from "react";
import { getSavedAddresses, type Address } from "../../api/addresses";
import type { AppNavigation } from "../../navigation/AppRoutes.types";

type Props = { navigation: AppNavigation };

export function SavedAddressesScreen({ navigation }: Props) {
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getSavedAddresses(new AbortController().signal).then((value) => {
      setAddresses(value);
      setLoading(false);
    });
  }, []);

  return (
    <SafeAreaView>
      <Text>Saved addresses</Text>
      {loading ? <ActivityIndicator /> : null}
      {addresses.map((address) => <Button key={address.id} title={address.formatted} onPress={() => navigation.navigate("EditAddress", { addressId: address.id })} />)}
    </SafeAreaView>
  );
}
