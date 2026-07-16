# ROSS brand foundation

Status: approved foundation; legal name review remains open

The ROSS identity is intentionally original and separate from Mike's public
website, marketing copy, demo materials, and visual assets. The initial system
uses a restrained navy-and-teal palette suitable for a professional legal
workspace without copying government or court branding.

## Canonical configuration

All future website and application surfaces should consume
`config/ross-brand.json`. Do not duplicate product names, domains, attribution,
beta warnings, or colour values in independent configuration files unless a
build step generates them from this source.

The `.invalid` domains and `TBD` owners are deliberate blockers. They must be
replaced through an approved change before a production launch.

## Assets

- `brand/assets/ross-icon.svg` is the square product icon.
- `brand/assets/ross-wordmark.svg` is the horizontal wordmark.
- `brand/assets/favicon.svg` is the simplified browser icon.

The monogram is a geometric R with two teal source lines. The lines represent
traceable primary sources; they are not a stylized flag, trillium, coat of arms,
court seal, or other official symbol.

## Usage rules

- Use ROSS Navy (`#102A43`) for primary text and dark surfaces.
- Use ROSS Teal (`#0F8B8D`) as an accent, not for long body text on white.
- Preserve the icon's proportions and clear space of at least one quarter of
  its height.
- Provide the text alternative “ROSS” for the wordmark and treat a decorative
  icon as having an empty alternative.
- Keep the beta boundary visible wherever users sign in, upload documents, or
  encounter product claims.
- Do not add `®`, `™`, government identifiers, court crests, the Ontario
  trillium, the Canadian flag, or partner logos without documented approval.
- Do not imply endorsement by Mike, courts, governments, CanLII, CourtListener,
  A2AJ, or any source provider.

## Accessibility

ROSS Navy on the light background exceeds WCAG AA contrast for ordinary text.
ROSS Teal is reserved for large text, graphics, focus indicators with adequate
surrounding contrast, and non-text accents. Every implementation must still run
automated and manual contrast testing because adjacent colours and component
states can change the result.

## Review trigger

Review this foundation before purchasing a domain, public promotion, accepting
real client material, adding a partner logo, or representing that trademark or
name clearance has been completed.
