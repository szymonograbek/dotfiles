import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Button, Text, View } from "react-native";
import { getOrders, type Order, type OrderFilter } from "../../api/orders";

type Props = {
  accountId: string;
  openOrder(orderId: string): void;
};

export function OrderHistoryScreen({ accountId, openOrder }: Props) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [orders, setOrders] = useState<readonly Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextOrders = await getOrders(accountId, filter, new AbortController().signal);
      setOrders(nextOrders);
      setHasLoaded(true);
    } catch (nextError) {
      if (nextError instanceof Error) setError(nextError);
    } finally {
      setIsLoading(false);
    }
  }, [accountId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (filter !== "all") setError(null);
  }, [filter]);

  if (isLoading && !hasLoaded) return <ActivityIndicator accessibilityLabel="Loading orders" />;
  if (error && orders.length === 0) return <Button title="Retry" onPress={() => void load()} />;

  return (
    <View>
      <View accessibilityRole="tablist">
        <Button title="All" onPress={() => setFilter("all")} />
        <Button title="Open" onPress={() => setFilter("open")} />
        <Button title="Completed" onPress={() => setFilter("completed")} />
      </View>
      {isLoading ? <ActivityIndicator accessibilityLabel="Refreshing orders" /> : null}
      {error ? <Button title="Retry refresh" onPress={() => void load()} /> : null}
      {hasLoaded && orders.length === 0 ? <Text>No orders</Text> : null}
      {orders.map((order) => (
        <Button
          key={order.id}
          title={`${order.reference}, ${order.status}, ${order.total}`}
          accessibilityLabel={`Order ${order.reference}, ${order.status}, ${order.total}`}
          onPress={() => openOrder(order.id)}
        />
      ))}
    </View>
  );
}
