# Manage saved addresses

## At a glance

**Problem:** Customers cannot review or update the delivery addresses saved to their account from the app.
**Goal:** Add a Saved addresses screen where customers can review, add, and edit addresses.
**Primary users:** Signed-in customers who use delivery.
**Success:** Customers can understand the state of their saved addresses and reach the existing add/edit flows.
**Status:** Agreed

## Scope and non-goals

- **In scope:** A settings entry point; a Saved addresses screen; loading, failure, empty, and populated states; add and edit actions.
- **Out of scope:** Address creation/edit forms, deletion, choosing a checkout address, offline storage, and service API changes.

## Stories and scenarios

### SA-1: Open saved addresses

**Story:** As a customer, I want to open Saved addresses from Settings so that I can manage delivery details associated with my account.

#### Acceptance criteria

- Settings includes a Saved addresses entry.
- Opening it shows a screen titled “Saved addresses.”
- Back navigation behaves like other Settings destinations.

### SA-2: Review addresses

**Story:** As a customer, I want to see my saved addresses so that I know which delivery details are available.

#### Primary scenario

1. The customer opens Saved addresses.
2. Loading feedback appears while addresses are retrieved.
3. Each saved address shows its label and formatted address.
4. The default address is identified.

#### Alternate scenarios

- **No addresses:** The customer sees an explanation and an Add address action.
- **Load failure:** The customer sees a failure explanation and Retry.

### SA-3: Add an address

**Story:** As a customer, I want to add an address from the screen so that it is available for future deliveries.

#### Acceptance criteria

- Add address is available whether the list is empty or populated.
- Selecting it opens the existing add-address flow.

### SA-4: Edit an address

**Story:** As a customer, I want to select a saved address so that I can update it.

#### Acceptance criteria

- Selecting an address opens the existing edit-address flow for that address.
- Address rows expose meaningful accessible labels and actions.

## Cross-cutting requirements

- **Accessibility:** Screen title, state feedback, default status, and row actions are perceivable.
- **Localization:** Customer-facing copy supports the app’s existing locales.
- **Privacy:** Only addresses for the signed-in account are shown.
- **Analytics:** No changes.

## Constraints and risks

- **Constraint:** Existing address services and add/edit flows remain unchanged.
- **Risk:** A bespoke screen could behave inconsistently with other account-management lists.

## Open questions

- None. Product behavior is agreed; implementation design remains to be planned.
