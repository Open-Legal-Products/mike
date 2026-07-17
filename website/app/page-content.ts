export type PublicPage = {
  title: string;
  eyebrow: string;
  summary: string;
  status: string;
  sections: { title: string; body: string }[];
  review: string;
};

export const publicPages: Record<string, PublicPage> = {
  ontario: {
    title: "Ontario and Canadian capability",
    eyebrow: "Jurisdiction plan",
    summary:
      "ROSS will add verified Ontario and binding federal primary law without removing inherited U.S. research.",
    status: "Source integrations are planned, not yet live.",
    review: "Legal-content owner: TBD · Review required before coverage claims",
    sections: [
      {
        title: "Planned foundation",
        body: "Provider-neutral records will separate jurisdiction, court, authority level, document type, source version, provider, canonical URL, retrieval time, and verification state.",
      },
      {
        title: "Authorized sources",
        body: "The approved direction is A2AJ, official government and court sources, and negotiated or licensed providers. ROSS will not scrape CanLII contrary to its terms or without permission.",
      },
      {
        title: "Visible gaps",
        body: "Coverage for ONSC, ONCJ, Small Claims Court, tribunals, historical material, noting-up, and source currency must be measured and displayed before being represented as supported.",
      },
    ],
  },
  features: {
    title: "A complete legal workspace",
    eyebrow: "Preserved Mike capabilities",
    summary:
      "ROSS keeps the inherited assistant, project, document, tabular-review, workflow, sharing, connector, and self-hosting surfaces under regression protection.",
    status: "Ontario-specific defaults and research are future packages.",
    review: "Product owner: TBD · Last reviewed 2026-07-15",
    sections: [
      {
        title: "Work with matters and documents",
        body: "Organize projects, upload and preview documents, draft and edit, track document versions, and export generated work.",
      },
      {
        title: "Structured review",
        body: "Use assistant workflows, reusable workflows, and tabular review while retaining citations and matter context.",
      },
      {
        title: "Deploy on your terms",
        body: "The AGPL codebase supports self-hosting. Each deployer remains responsible for security, privacy, providers, storage, legal content, backups, and operations.",
      },
    ],
  },
  workflows: {
    title: "Ontario workflow catalogue",
    eyebrow: "Public catalogue",
    summary:
      "Five versioned Ontario workflow drafts are available for transparent review while the inherited Mike workflow library remains intact.",
    status:
      "Drafts await independent Ontario lawyer review and are not approved for production use.",
    review:
      "Workflow owner: TBD · Reviewer and review date intentionally unset",
    sections: [
      {
        title: "Catalogue requirements",
        body: "Each workflow states jurisdiction, practice area, version, intended user, required inputs, primary sources, exclusions, review checklist, and synthetic benchmark fixture.",
      },
      {
        title: "Current availability",
        body: "Draft catalogue entries can be inspected publicly and opened in the authenticated application. They remain limited to synthetic or non-confidential material until the controlled-beta gates are met.",
      },
    ],
  },
  coverage: {
    title: "Source coverage",
    eyebrow: "Machine-readable status planned",
    summary:
      "Coverage must describe what ROSS can retrieve and verify without implying completeness, official status, or currentness that the evidence does not support.",
    status: "Foundation only — coverage registry not implemented.",
    review:
      "Legal-content and technical owners: TBD · Review before source launch",
    sections: [
      {
        title: "Decisions",
        body: "CourtListener remains available for optional U.S. research. A2AJ, official sources, and licensed providers are the approved Ontario and Canadian direction.",
      },
      {
        title: "Legislation",
        body: "Ontario e-Laws and federal Justice Laws sources are planned with version, currency, consolidation, amendment, and canonical-link metadata.",
      },
      {
        title: "Decisions and noting-up",
        body: "Decision availability and citator coverage vary by court and provider. Missing coverage must be explicit, and noting-up must never be inferred from ordinary search results.",
      },
    ],
  },
  "open-source": {
    title: "Open source and self-hosting",
    eyebrow: "AGPL-3.0",
    summary:
      "ROSS is an independently developed modified fork of Mike. Its source and architecture decisions are public.",
    status:
      "Self-hosting documentation and production runbooks remain in development.",
    review:
      "Release owner: TBD · Licence review required before public service",
    sections: [
      {
        title: "Corresponding source",
        body: "Every ROSS network deployment must provide a working link to the corresponding source and preserve applicable copyright and licence notices.",
      },
      {
        title: "Deployment responsibility",
        body: "Self-hosters choose and operate authentication, database, storage, model providers, email, conversion, monitoring, backups, retention, and incident response.",
      },
      {
        title: "Upstream attribution",
        body: "ROSS preserves Mike functionality and credits the upstream project without implying endorsement or affiliation.",
      },
    ],
  },
  security: {
    title: "Security",
    eyebrow: "Controls before claims",
    summary:
      "ROSS is not yet approved for real confidential or privileged client material in an operator-hosted service.",
    status:
      "Threat model, privacy assessment, retention schedule, vendor inventory, and independent review remain open.",
    review: "Security owner: TBD · Technical and legal review required",
    sections: [
      {
        title: "Current beta boundary",
        body: "Development, demos, previews, and hosted beta use synthetic or non-confidential materials only. This applies to documents, prompts, logs, screenshots, support, and analytics.",
      },
      {
        title: "Architecture direction",
        body: "The inherited application uses authenticated API, database, object storage, model-provider, conversion, and email services. Production regions and vendors are not yet approved.",
      },
      {
        title: "Report safely",
        body: "Do not open public vulnerability details. Private GitHub vulnerability reporting is the current security channel.",
      },
    ],
  },
  privacy: {
    title: "Privacy notice — placeholder",
    eyebrow: "Legal review required",
    summary:
      "This scaffold does not collect form submissions, run analytics, authenticate visitors, or load application data.",
    status: "Not a production privacy notice.",
    review: "Privacy owner and operator: TBD · Effective date not set",
    sections: [
      {
        title: "Public website",
        body: "The scaffold serves public content only. Hosting-level request logs may still exist and must be documented before publication.",
      },
      {
        title: "Hosted application",
        body: "The planned invitation-only beta is limited to synthetic or non-confidential material. A complete data inventory and retention schedule are required before launch.",
      },
    ],
  },
  terms: {
    title: "Terms of service — placeholder",
    eyebrow: "Legal review required",
    summary:
      "No hosted-service terms have been approved and this page does not create a production service offering.",
    status:
      "Operator, service scope, jurisdiction, support, suspension, liability, and change terms remain open.",
    review: "Operator and legal reviewer: TBD",
    sections: [
      {
        title: "Current effect",
        body: "The repository is available under its open-source licence. Separate terms will be required for any operator-hosted service.",
      },
      {
        title: "Professional responsibility",
        body: "Future terms must preserve the user’s responsibility to verify sources, protect information, supervise work, and exercise independent professional judgment.",
      },
    ],
  },
  "acceptable-use": {
    title: "Acceptable use — placeholder",
    eyebrow: "Controlled beta",
    summary:
      "ROSS is intended for lawful professional work by approved beta participants using synthetic or non-confidential materials.",
    status: "Enforcement controls and final policy remain open.",
    review: "Operator, security, and legal reviewers: TBD",
    sections: [
      {
        title: "Prohibited during beta",
        body: "Do not submit privileged, confidential, regulated, proprietary, or real client material; attempt unauthorized access; misrepresent output as verified authority; or use the service for consumer legal advice.",
      },
      {
        title: "Report concerns",
        body: "Security issues belong in private vulnerability reporting. Other concerns will use the contact workflow after it is implemented.",
      },
    ],
  },
  accessibility: {
    title: "Accessibility",
    eyebrow: "WCAG 2.2 AA target",
    summary:
      "New ROSS public surfaces target accessible semantics, keyboard operation, visible focus, contrast, zoom, and reduced-motion support.",
    status: "Formal conformance has not been audited or claimed.",
    review: "Accessibility owner: TBD · Manual review pending",
    sections: [
      {
        title: "Built into the scaffold",
        body: "The site includes a skip link, semantic landmarks, labelled navigation, keyboard-visible focus, responsive layouts, and reduced-motion handling.",
      },
      {
        title: "Feedback",
        body: "A production accessibility feedback channel will be published after the operator and contact system are approved.",
      },
    ],
  },
  contact: {
    title: "Contact ROSS",
    eyebrow: "Channels pending",
    summary:
      "Support, privacy, security, licensing, partnership, and general-inquiry routes will remain separated.",
    status: "No contact form or production mailbox is active in this scaffold.",
    review: "Operator and support owner: TBD",
    sections: [
      {
        title: "Security",
        body: "Use the repository’s private vulnerability reporting for security-sensitive details. Do not place vulnerability details in a public issue.",
      },
      {
        title: "Other enquiries",
        body: "Placeholder addresses are intentionally non-deliverable until the operator, retention, routing, spam protection, and privacy notice are approved.",
      },
    ],
  },
  about: {
    title: "About ROSS",
    eyebrow: "Ranade OSS",
    summary:
      "ROSS is an Ontario-focused, open-source legal workspace in development and a modified fork of Mike.",
    status: "The legal operator and accountable owners remain TBD.",
    review: "Product owner: TBD · Name and trademark review open",
    sections: [
      {
        title: "Purpose",
        body: "The project aims to preserve a useful open-source legal workspace while adding authorized, traceable Ontario and Canadian legal sources and Canadian drafting defaults.",
      },
      {
        title: "Independence",
        body: "ROSS is not affiliated with or endorsed by governments, courts, CanLII, CourtListener, A2AJ, source providers, or the upstream Mike maintainers.",
      },
      {
        title: "Contributors",
        body: "Contributor records and governance will be published as the project develops.",
      },
    ],
  },
  docs: {
    title: "Documentation",
    eyebrow: "Versioned project records",
    summary:
      "Architecture decisions, product boundaries, verification reports, and contributor guidance live with the source code.",
    status: "Deployment and user documentation are still being developed.",
    review: "Technical owner: TBD",
    sections: [
      {
        title: "Start with the repository",
        body: "The README covers the inherited application. The docs directory records the baseline, product boundary, architecture decisions, brand rules, and verification results.",
      },
    ],
  },
  updates: {
    title: "Project updates",
    eyebrow: "Changelog scaffold",
    summary:
      "Future product, security, source-coverage, and legal-content updates will carry effective and review dates.",
    status: "No public update feed is active yet.",
    review: "Release owner: TBD",
    sections: [
      {
        title: "Publication policy",
        body: "Material changes should distinguish software releases from source, prompt, workflow, policy, and coverage changes.",
      },
    ],
  },
  status: {
    title: "Service status",
    eyebrow: "No production service",
    summary:
      "ROSS does not yet operate a production public website or client-material application.",
    status: "Development scaffold only.",
    review: "Operations owner: TBD",
    sections: [
      {
        title: "Future status reporting",
        body: "Production status will be independently hosted and cover website, application, API, legal-source ingestion, and material incidents.",
      },
    ],
  },
  subprocessors: {
    title: "Subprocessors",
    eyebrow: "Vendor selection pending",
    summary:
      "No production hosting, analytics, support, email, monitoring, or model-provider configuration has been approved for the ROSS hosted service.",
    status: "Inventory pending.",
    review: "Privacy owner: TBD",
    sections: [
      {
        title: "Required disclosure",
        body: "Before launch, the inventory must identify purpose, data categories, region, retention, access, contractual basis, and review date for each service.",
      },
    ],
  },
  "responsible-ai": {
    title: "Responsible AI and verification",
    eyebrow: "Human review is required",
    summary:
      "Model output is not authority. ROSS is designed to connect propositions to inspectable sources and make uncertainty visible.",
    status: "Ontario benchmark and release thresholds are not yet implemented.",
    review: "Legal-content and evaluation owners: TBD",
    sections: [
      {
        title: "Verification",
        body: "A source link alone does not prove that the cited passage supports the proposition, remains current, or has not been limited. Those are distinct checks.",
      },
      {
        title: "Evaluation",
        body: "The Ontario release gate will measure source support, jurisdiction, temporal validity, citation accuracy, coverage gaps, refusal behaviour, and preservation of inherited functions.",
      },
    ],
  },
};
