export type OrderStatus = "open" | "completed";
export type OrderFilter = "all" | OrderStatus;

export type Order = {
  id: string;
  reference: string;
  status: OrderStatus;
  total: string;
};

export class RequestError extends Error {
  constructor(readonly code: "offline" | "server", message: string) {
    super(message);
  }
}

export async function getOrders(
  accountId: string,
  filter: OrderFilter,
  signal: AbortSignal,
): Promise<readonly Order[]> {
  const response = await fetch(`/accounts/${accountId}/orders?status=${filter}`, { signal });

  if (!response.ok) {
    throw new RequestError("server", "Orders could not be loaded");
  }

  return response.json();
}
