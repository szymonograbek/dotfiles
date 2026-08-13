export interface PaymentMethodFixture {
  id: string;
  label: string;
  detail: string;
}

export function paymentMethodFixture(): PaymentMethodFixture {
  return { id: "payment-1", label: "Visa", detail: "•••• 4242" };
}
