import { describe, it } from "vitest";
import { renderScreen } from "../../../testing/renderScreen";
import { paymentMethodFixture } from "../../../testing/fixtures/paymentMethodFixture";
import { PaymentMethodsScreen } from "./PaymentMethodsScreen";

const screenNavigation = { navigate: () => undefined };

describe("PaymentMethodsScreen", () => {
  it("renders payment methods and opens an action", async () => {
    const method = paymentMethodFixture();
    const screen = renderScreen(<PaymentMethodsScreen navigation={screenNavigation} />, { paymentMethods: [method] });
    await screen.findByLabelText(`${method.label}, ${method.detail}`);
  });
});
