import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Button, Text, View } from "react-native";
import { invoiceQueryKeys } from "./invoiceQueryKeys";

type Props = { accountId: string };
type Invoice = { id: string; reference: string };

async function getInvoices(accountId: string, signal: AbortSignal): Promise<readonly Invoice[]> {
  const response = await fetch(`/accounts/${accountId}/invoices`, { signal });
  if (!response.ok) throw new Error("Invoices could not be loaded");
  return response.json();
}

export function InvoiceListScreen({ accountId }: Props) {
  const invoices = useQuery({
    queryKey: invoiceQueryKeys.list(accountId),
    queryFn: ({ signal }) => getInvoices(accountId, signal),
    placeholderData: keepPreviousData,
  });

  if (invoices.isPending) return <ActivityIndicator accessibilityLabel="Loading invoices" />;
  if (invoices.isError && invoices.data === undefined) {
    return <Button title="Retry" onPress={() => void invoices.refetch()} />;
  }

  return (
    <View>
      {invoices.isFetching ? <ActivityIndicator accessibilityLabel="Refreshing invoices" /> : null}
      {invoices.isError ? <Button title="Retry refresh" onPress={() => void invoices.refetch()} /> : null}
      {invoices.data?.length === 0 ? <Text>No invoices</Text> : null}
      {invoices.data?.map((invoice) => <Text key={invoice.id}>{invoice.reference}</Text>)}
    </View>
  );
}
