import { queryOptions } from "@tanstack/react-query";

async function getPaymentMethods(signal: AbortSignal): Promise<readonly { id: string; label: string; detail: string }[]> {
  const response = await fetch("/me/payment-methods", { signal });
  if (!response.ok) throw new Error("Payment methods could not be loaded");
  return response.json();
}

export const paymentMethodsQuery = queryOptions({
  queryKey: ["payment-methods"],
  queryFn: ({ signal }) => getPaymentMethods(signal),
});
