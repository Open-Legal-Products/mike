export type PublicPage = {
  title: string;
  eyebrow: string;
  summary: string;
  status: string;
  sections: { title: string; body: string }[];
  governance: {
    owner: string;
    reviewer: string | null;
    reviewStatus: "engineering-reviewed" | "independent-review-required";
    effectiveDate: string | null;
    lastReviewedDate: string | null;
    nextReviewDate: string;
  };
};

const engineeringReviewed = (owner: string): PublicPage["governance"] => ({
  owner,
  reviewer: "ROSS engineering review",
  reviewStatus: "engineering-reviewed",
  effectiveDate: "2026-07-16",
  lastReviewedDate: "2026-07-16",
  nextReviewDate: "2026-08-16",
});

const independentReviewRequired = (
  owner: string,
): PublicPage["governance"] => ({
  owner,
  reviewer: null,
  reviewStatus: "independent-review-required",
  effectiveDate: null,
  lastReviewedDate: null,
  nextReviewDate: "2026-08-16",
});

export const publicPages: Record<string, PublicPage> = {
  ontario: {
    title: "Ontario and Canadian capability",
    eyebrow: "Jurisdiction plan",
    summary:
      "ROSS adds an Ontario-first, provider-neutral research foundation without removing inherited optional U.S. research.",
    status:
      "Engineering integrations are implemented; live availability, completeness, and legal-content approval are not claimed.",
    governance: independentReviewRequired("Legal-content owner — unassigned"),
    sections: [
      {
        title: "Implemented foundation",
        body: "Provider-neutral records separate jurisdiction, court, authority level, document type, source version, provider, canonical URL, retrieval time, and verification state.",
      },
      {
        title: "Authorized sources",
        body: "The implemented connectors use A2AJ, official government sources, optional CourtListener for U.S. research, and a disabled licensed-provider boundary. ROSS does not scrape CanLII; its connector requires a separately approved licence and transport.",
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
    status:
      "Inherited capability preservation is automated; end-to-end product coverage remains incomplete.",
    governance: engineeringReviewed("ROSS product maintainers"),
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
    governance: independentReviewRequired(
      "Ontario workflow owner — unassigned",
    ),
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
    eyebrow: "Generated source registry",
    summary:
      "Coverage must describe what ROSS can retrieve and verify without implying completeness, official status, or currentness that the evidence does not support.",
    status:
      "Generated from the implemented provider registry; runtime health and comprehensive coverage remain unverified.",
    governance: independentReviewRequired(
      "Legal-content and technical owners — unassigned",
    ),
    sections: [
      {
        title: "Decisions",
        body: "A2AJ is implemented for Canadian decision discovery and unofficial text, subject to its runtime-reported datasets and availability. CourtListener remains available for optional U.S. research. CanLII remains disabled without a separately approved licensed transport.",
      },
      {
        title: "Legislation",
        body: "Ontario e-Laws and federal Justice Laws connectors are implemented with source, currency, consolidation, amendment, canonical-link, and reproduction metadata. Historical-version retrieval is explicitly limited.",
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
    governance: independentReviewRequired("Release owner — unassigned"),
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
      "Engineering threat model, incident plan, data inventory, retention schedule, and vendor inventory exist; independent security and privacy review remains open.",
    governance: independentReviewRequired("Security owner — unassigned"),
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
    title: "Privacy notice — controlled-beta draft",
    eyebrow: "Legal review required",
    summary:
      "The public site does not intentionally collect form submissions, run product analytics, authenticate visitors, or load application data; hosting-level request records may still be processed.",
    status:
      "Independent privacy/legal review, operator identity, effective date, vendor terms, and complaint contact are required before this notice can take effect.",
    governance: independentReviewRequired(
      "Privacy owner and legal operator — unassigned",
    ),
    sections: [
      {
        title: "Public website",
        body: "The site serves public content only and has no first-party form or analytics integration. Its hosting service may process network identifiers, request metadata, security events, and necessary cookies or tokens; the selected operator must publish the actual hosting terms, purposes, locations, access, and retention.",
      },
      {
        title: "Hosted application",
        body: "The invitation-only hosted application is restricted to synthetic or affirmatively non-confidential material. It may process account, configuration, project, prompt, file, generated-content, source-query, connector, security, and support data as described in the engineering inventory. No real client or privileged material is approved.",
      },
      {
        title: "Choices, access, and deletion",
        body: "The inherited application includes account export, content deletion, and account deletion surfaces. Applicable legal rights, verification steps, response periods, appeals, and the privacy contact cannot be finalized until the operator and governing privacy obligations are determined.",
      },
      {
        title: "Retention and disclosure",
        body: "Draft retention periods and deletion triggers exist, but infrastructure, backups, provider retention, lawful disclosure, cross-border processing, and contract terms are not approved. The effective notice must identify each actual subprocessor and material transfer.",
      },
    ],
  },
  terms: {
    title: "Hosted-service terms — legal draft",
    eyebrow: "Legal review required",
    summary:
      "No hosted-service terms have been approved and this page does not create a production service offering.",
    status:
      "Operator, service scope, jurisdiction, support, suspension, liability, and change terms remain open.",
    governance: independentReviewRequired(
      "Legal operator and legal reviewer — unassigned",
    ),
    sections: [
      {
        title: "Current effect",
        body: "The repository is available under its open-source licence. Separate terms will be required for any operator-hosted service.",
      },
      {
        title: "Professional responsibility",
        body: "Future terms must preserve the user’s responsibility to verify sources, protect information, supervise work, and exercise independent professional judgment.",
      },
      {
        title: "No legal service or authority guarantee",
        body: "ROSS is software, not a lawyer, law firm, court, government service, comprehensive citator, or substitute for professional judgment. A hosted agreement must define service availability, source limits, beta changes, support, suspension, termination, warranties, liability, and dispute terms before it can bind anyone.",
      },
      {
        title: "Open-source code",
        body: "Repository use is governed by AGPL-3.0 and applicable notices. A hosted-service agreement cannot remove recipients’ rights under the code licence or replace the corresponding-source obligation for a network deployment.",
      },
    ],
  },
  "acceptable-use": {
    title: "Acceptable use — controlled-beta draft",
    eyebrow: "Controlled beta",
    summary:
      "ROSS is intended for lawful professional work by approved beta participants using synthetic or non-confidential materials.",
    status: "Enforcement controls and final policy remain open.",
    governance: independentReviewRequired(
      "Operator, security, and legal reviewers — unassigned",
    ),
    sections: [
      {
        title: "Prohibited during beta",
        body: "Do not submit privileged, confidential, regulated, proprietary, or real client material; attempt unauthorized access; misrepresent output as verified authority; or use the service for consumer legal advice.",
      },
      {
        title: "Report concerns",
        body: "Security issues belong in private vulnerability reporting. Other concerns will use the contact workflow after it is implemented.",
      },
      {
        title: "Source and system integrity",
        body: "Do not bypass access controls, probe another user’s matter, upload malware, abuse source providers, scrape prohibited services, inject instructions intended to exfiltrate secrets, or represent unverified output as an official or human-reviewed source.",
      },
    ],
  },
  accessibility: {
    title: "Accessibility",
    eyebrow: "WCAG 2.2 AA target",
    summary:
      "New ROSS public surfaces target accessible semantics, keyboard operation, visible focus, contrast, zoom, and reduced-motion support.",
    status: "Formal conformance has not been audited or claimed.",
    governance: independentReviewRequired("Accessibility owner — unassigned"),
    sections: [
      {
        title: "Built into the public site",
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
    eyebrow: "Verified channels",
    summary:
      "Security-sensitive reports use private GitHub vulnerability reporting; other operational and legal contact channels are not yet approved.",
    status:
      "Do not send client information or confidential facts through a public issue or unapproved mailbox.",
    governance: independentReviewRequired(
      "Legal operator and support owner — unassigned",
    ),
    sections: [
      {
        title: "Security",
        body: "Use the repository’s private vulnerability reporting for security-sensitive details. Do not place vulnerability details in a public issue.",
      },
      {
        title: "Other enquiries",
        body: "The repository issue tracker may be used for non-sensitive software defects and feature discussion. Privacy, legal, licensing, partnership, and support mailboxes remain intentionally unpublished until the operator, retention, routing, access, and privacy terms are approved.",
      },
    ],
  },
  about: {
    title: "About ROSS",
    eyebrow: "Ranade OSS",
    summary:
      "ROSS is an Ontario-focused, open-source legal workspace in development and a modified fork of Mike.",
    status:
      "The legal operator and accountable independent reviewers remain unassigned.",
    governance: independentReviewRequired("Product owner — unassigned"),
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
    governance: engineeringReviewed("ROSS technical maintainers"),
    sections: [
      {
        title: "Start with the repository",
        body: "The README covers the inherited application. The docs directory records the baseline, product boundary, architecture decisions, brand rules, and verification results.",
      },
    ],
  },
  updates: {
    title: "Project updates",
    eyebrow: "Versioned changelog",
    summary:
      "Future product, security, source-coverage, and legal-content updates will carry effective and review dates.",
    status:
      "The first engineering update is published; security-sensitive detail remains in private reporting.",
    governance: engineeringReviewed("ROSS release maintainers"),
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
      "The public website has an owner-only checkpoint deployment. No general-public hosted application or client-material service is approved.",
    status:
      "Website checkpoint available to its owner; application, API, legal-source health, monitoring, and public status infrastructure remain pre-production.",
    governance: independentReviewRequired("Operations owner — unassigned"),
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
    status:
      "A draft candidate inventory exists; no production subprocessors, tiers, regions, retention terms, or contracts are approved.",
    governance: independentReviewRequired("Privacy owner — unassigned"),
    sections: [
      {
        title: "Required disclosure",
        body: "Before launch, the inventory must identify purpose, data categories, region, retention, access, contractual basis, and review date for each service.",
      },
      {
        title: "Candidate categories",
        body: "The engineering inventory identifies authentication/database, object storage, model providers, email, hosting, logging, monitoring, backups, and support as candidate categories. A product name in source configuration is not approval of a vendor, tier, region, or term.",
      },
    ],
  },
  "responsible-ai": {
    title: "Responsible AI and verification",
    eyebrow: "Human review is required",
    summary:
      "Model output is not authority. ROSS is designed to connect propositions to inspectable sources and make uncertainty visible.",
    status:
      "Automated synthetic thresholds are implemented and passing; Ontario lawyer review and all production approvals remain blocked.",
    governance: independentReviewRequired(
      "Legal-content and evaluation owners — unassigned",
    ),
    sections: [
      {
        title: "Verification",
        body: "A source link alone does not prove that the cited passage supports the proposition, remains current, or has not been limited. Those are distinct checks.",
      },
      {
        title: "Evaluation",
        body: "The versioned Ontario gate measures source completeness, proposition support, jurisdiction, temporal accuracy, citation precision, coverage gaps, refusal behaviour, prompt-injection resistance, and preservation of inherited functions. Its current 11 cases are synthetic engineering fixtures, not a lawyer-authored benchmark.",
      },
      {
        title: "Release boundary",
        body: "A perfect synthetic score is not legal validation. Production remains blocked until a named Ontario lawyer approves the benchmark and named legal-content, privacy, security, accessibility, and product reviewers provide dated evidence.",
      },
    ],
  },
  demo: {
    title: "Synthetic Ontario product demonstration",
    eyebrow: "No client information",
    summary:
      "A captioned, text-equivalent demonstration shows how ROSS is intended to expose source, passage, currency, treatment, and coverage states.",
    status:
      "Illustrative engineering demonstration using fictional facts and citations; it is not legal advice or evidence of live provider coverage.",
    governance: engineeringReviewed("ROSS product maintainers"),
    sections: [
      {
        title: "Synthetic scenario",
        body: "A fictional lawyer asks ROSS to compare two invented Ontario appellate passages for a demonstration matter called Northstar Components. No real person, client, dispute, authority, or confidential information is represented.",
      },
      {
        title: "Caption",
        body: "The demonstration panel shows a fictional Ontario matter, a user request, a response that identifies conflicting authorities, and separate badges for citation, passage, currency, and treatment verification. A visible warning says that comprehensive treatment data is unavailable.",
      },
      {
        title: "Transcript",
        body: "User: Compare the supplied passages and identify the conflict without resolving it from memory. ROSS: The two fictional passages use different tests. Both passages were retrieved from the supplied synthetic record. Citation and passage checks passed for the fixture; currency metadata is present; comprehensive treatment is unavailable. Verify the full decisions and current law before relying on the comparison.",
      },
      {
        title: "What this demonstrates",
        body: "The intended interaction distinguishes retrieved evidence from model prose, exposes unavailable checks, keeps jurisdiction visible, and requires professional review. It does not demonstrate legal accuracy, good-law status, production confidentiality, or filing readiness.",
      },
    ],
  },
};

export const publicUpdates = [
  {
    slug: "foundation",
    title: "Ontario product foundation and trust gates",
    publishedAt: "2026-07-16",
    status: "Engineering update — independent approvals pending",
    summary:
      "ROSS now has an Ontario-first provider layer, draft workflows, controlled-beta data boundary, and synthetic evaluation gate while preserving inherited Mike functions.",
    changes: [
      "Implemented A2AJ, official Ontario and federal legislation, Canadian citation, procedure-source, and disabled licensed-provider boundaries.",
      "Added five governed Ontario workflow drafts and retained inherited Mike workflows and optional U.S. CourtListener research.",
      "Enforced synthetic or non-confidential hosted-beta acknowledgement and fail-closed production configuration.",
      "Added an 11-case synthetic Ontario evaluation seed, generated report, accessibility/performance contracts, and independent-approval gate.",
    ],
    limitations:
      "No Ontario lawyer has approved the benchmark or workflows. No production operator, vendor set, confidential-data mode, comprehensive citator, or public launch has been approved.",
  },
] as const;
