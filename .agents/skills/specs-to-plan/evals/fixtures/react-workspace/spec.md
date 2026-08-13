# Filter order history

## At a glance

**Problem:** Customers with long order histories cannot quickly find open or completed orders, and a temporary loading failure leaves them without a recovery action.
**Goal:** Let customers filter their order history and recover from failures without showing results that belong to another account or selection.
**Primary users:** Signed-in customers reviewing past and active orders.
**Success:** Customers can move between useful order subsets, understand loading and failure states, retry, and open the intended order.
**Status:** Agreed

## Scope and non-goals

- **In scope:** All, Open, and Completed filters; loading and refreshing feedback; empty and failure states; retry; preservation of existing order-row navigation and accessibility.
- **Out of scope:** Pagination, offline availability, order editing, optimistic updates, analytics changes, and service API changes.

## Story map

| ID | Actor | Trigger | Goal | Outcome |
| --- | --- | --- | --- | --- |
| OH-1 | Customer | Opens order history | Review all orders | The current account's order history appears |
| OH-2 | Customer | Chooses a status filter | Narrow the list | Only orders in that subset appear |
| OH-3 | Customer | Loading fails | Recover without leaving | Retry is available for the failed view |
| OH-4 | Customer | Selects an order | View its details | The selected order opens as before |

## Detailed stories and scenarios

### OH-1: Review order history

**Story:** As a customer, I want clear feedback while my order history opens so that I know whether there are orders to review or a problem to resolve.

#### Primary scenario

1. The customer opens order history.
2. Loading feedback appears until the outcome is known.
3. The customer's orders appear.

#### Alternate and non-happy scenarios

- **No orders:** A successful empty result shows the empty state.
- **Failure before results are available:** The list area shows a failure state and Retry.
- **Account changes:** The new account starts on All, and results from the previous account never appear as the current account's orders.

### OH-2: Filter orders

**Story:** As a customer, I want to view all, open, or completed orders so that I can find the order I need quickly.

#### Primary scenario

1. All is selected when the screen opens.
2. The customer selects Open or Completed.
3. Existing rows remain visible with refreshing feedback while the new selection loads.
4. The selected subset replaces the previous rows when available.

#### Alternate and non-happy scenarios

- **Selected subset is empty:** The empty state appears only after the selection finishes successfully.
- **First load of a selected subset fails:** The failed selection shows a failure state and Retry.
- **An already displayed subset fails to refresh:** Its rows remain visible, refreshing feedback ends, and Retry appears.
- **Selections finish out of order:** A result for an earlier selection never replaces the latest selection.

#### Acceptance criteria

- All, Open, and Completed are available, and the current selection is perceivable to assistive technology.
- When the active account changes, All becomes the selected filter for the new account.
- Only the latest account and filter selection determines the displayed result.
- Existing rows remain visible while a new filter selection is loading.
- Empty state is shown only for a successful result with no orders.

### OH-3: Retry a failure

**Story:** As a customer, I want to retry the view that failed so that a temporary problem does not block me.

#### Primary scenario

1. Loading the current view fails.
2. Retry appears in the appropriate full-screen or inline failure state.
3. The customer selects Retry.
4. The same account and filter are attempted again.

### OH-4: Open an order

**Story:** As a customer, I want filtering not to change how order rows work so that I can still identify and open an order.

#### Acceptance criteria

- Each row retains its order reference, status, and total in its accessible label.
- Selecting a row opens that order's details.

## Cross-cutting requirements

- **Accessibility:** Filter selection, loading feedback, order descriptions, and retry actions are announced meaningfully.
- **Privacy:** Orders from one account must never be presented as another account's results.
- **Analytics:** No changes.

## Constraints, assumptions, and risks

- **Constraint:** Existing service APIs do not change.
- **Risk:** Rapid account or filter changes could show an obsolete result.
- **Risk:** Overlapping loading, empty, failure, and populated presentations could give contradictory feedback.

## Open questions

- None. Product behavior and scope are agreed; implementation design remains to be planned.
