# ROSS privacy impact assessment — controlled-beta draft

Status: incomplete engineering assessment; not legal advice or operator approval  
Assessment date: 2026-07-16  
Decision: retain the synthetic/non-confidential controlled-beta boundary

## Purpose and necessity

ROSS assists Ontario legal professionals with document work and source-grounded legal research. During beta, personal or confidential client information is not necessary to test the system. Synthetic or affirmatively non-confidential material is the proportionate input class.

The Office of the Privacy Commissioner of Canada recommends using anonymized, synthetic, or de-identified data when personal information is unnecessary and recommends privacy-impact assessments for generative AI. The Law Society of Ontario connects technological competence with understanding technology risks and protecting confidential information. These sources support the conservative beta boundary; they do not decide which statute applies to a future operator.

## Applicability requiring legal determination

The operator is not identified. Counsel must determine the application of PIPEDA, provincial privacy statutes, professional duties, contractual confidentiality, public-sector requirements, and, before any health-data use, PHIPA. PIPEDA generally applies to private-sector organizations handling personal information in commercial activities and to cross-border commercial flows, but application is fact-specific.

## Collection and data minimization

Beta collection is limited to account/authentication data needed to operate access, user configuration, synthetic/non-confidential content, legal-source requests/results, and metadata needed for security and reliability. ROSS does not intentionally collect real client documents, privileged prompts, sensitive support content, or analytics events during this mode.

## Use, disclosure, and transfers

Application content may be sent to the configured model provider and, when explicitly invoked, legal-source or connector providers. Provider name alone does not establish retention, training, residency, or contractual terms. Hosted configurations therefore require an explicit provider allowlist, and each actual product/tier remains unapproved until entered in the subprocessor inventory with supporting terms.

## Safeguards implemented in ROSS-130

- Versioned acknowledgement in the authenticated application and API enforcement on content-bearing writes.
- Fail-closed hosted-mode and model-provider configuration.
- Raw model-stream logging prohibited outside local development.
- Metadata-only service audit records with browser roles revoked.
- Prompt-injection and matter-scope instructions.
- Existing authentication, MFA support, exact CORS, security headers, rate limits, encrypted user API-key storage, export, and deletion features preserved.

## Open risks and decisions

- Attestation cannot determine whether content is actually non-confidential.
- Operator, lawful authority, privacy contact, support access, vendors, locations, contracts, retention, backup deletion, and complaint process are unsettled.
- Tenant-isolation and IDOR coverage is incomplete.
- No independent privacy, security, accessibility, or legal review has occurred.
- No production service may accept client material under this assessment.

## Official reference points

- Law Society of Ontario, Rules of Professional Conduct: https://lso.ca/about-lso/legislation-rules/rules-of-professional-conduct/complete-rules-of-professional-conduct
- OPC, PIPEDA requirements in brief: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/
- OPC, responsible generative-AI principles: https://www.priv.gc.ca/en/privacy-topics/technology/artificial-intelligence/gd_principles_ai/
- OPC, breach reporting and recordkeeping: https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/
- Ontario IPC/OHRC, responsible-use principles for AI: https://www.ipc.on.ca/en/resources/principles-responsible-use-artificial-intelligence
