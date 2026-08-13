# Figma design context

File key: `AbC123Fixture`
Node ID: `42:100`
Node URL: https://www.figma.com/design/AbC123Fixture/Booking-App?node-id=42-100
Frame: Booking confirmed
Viewport: 390 × 844

## Hierarchy and layout
- Full-height mobile screen with `#F7F7F5` background and 24px horizontal padding.
- Status-safe header starts 24px below the safe area. A 32px circular close control is aligned to the top-right.
- Main content is a centered vertical stack. The illustration is 240 × 184 and begins 148px below the frame top.
- Title follows the illustration with 32px spacing. Supporting copy follows with 12px spacing.
- Primary action is pinned 40px above the bottom safe-area edge, spans the content width, and is 56px high.

## Visible layers
- Close icon: SF Symbol generated context `Image(systemName: "xmark")`, 16px, `#1C1C1A`.
- Raster illustration `calendar-confetti.png`, 240 × 184. Implementation requires the original source asset.
  - Figma file key: `AbC123Fixture`
  - Node ID: `42:108`
  - Node URL: https://www.figma.com/design/AbC123Fixture/Booking-App?node-id=42-108
- Heading: `You're all booked!`
  - Inter Semibold, 28px/34px, centered, `#1C1C1A`.
- Supporting text: `We'll send a reminder 24 hours before your appointment.`
  - Inter Regular, 16px/24px, centered, `#6F6F69`.
- Button label: `Done`
  - Button fill `#5B4CF0`, text `#FFFFFF`, 16px Semibold, 16px corner radius.

No scrolling is needed at the reference viewport. On shorter screens, keep the action after the content in normal flow rather than overlapping text.
