import type { ReactElement } from "react";

interface RenderOptions {
  paymentMethods?: readonly unknown[];
}

export function renderScreen(_element: ReactElement, _options: RenderOptions = {}) {
  return { findByLabelText: async (label: string) => label };
}
