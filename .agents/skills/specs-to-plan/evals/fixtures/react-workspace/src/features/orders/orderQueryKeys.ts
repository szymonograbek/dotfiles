import type { OrderFilter } from "../../api/orders";

export const orderQueryKeys = {
  all: ["orders"],
  list: (accountId: string, filter: OrderFilter): readonly ["orders", string, OrderFilter] => [
    "orders",
    accountId,
    filter,
  ],
};
