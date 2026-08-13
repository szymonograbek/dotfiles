export const invoiceQueryKeys = {
  list: (accountId: string): readonly ["invoices", string] => ["invoices", accountId],
};
