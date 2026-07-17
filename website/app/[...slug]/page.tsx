import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ONTARIO_WORKFLOW_CATALOGUE } from "../generated-ontario-workflows";
import { PUBLIC_SOURCE_COVERAGE } from "../generated-public-coverage";
import { publicPages, publicUpdates } from "../page-content";
import { SiteShell } from "../site-shell";
import { siteConfig } from "../site-config";

type RouteProps = { params: Promise<{ slug: string[] }> };

function resolvePage(slug: string[]) {
  if (slug[0] === "workflows" && slug.length === 2)
    return ONTARIO_WORKFLOW_CATALOGUE.some((entry) => entry.slug === slug[1])
      ? publicPages.workflows
      : undefined;
  if (slug[0] === "updates" && slug.length === 2)
    return publicUpdates.some((entry) => entry.slug === slug[1])
      ? publicPages.updates
      : undefined;
  if (slug.length !== 1) return undefined;
  return publicPages[slug[0]];
}

export async function generateMetadata({
  params,
}: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = resolvePage(slug);
  if (!page) return {};
  const workflow =
    slug[0] === "workflows"
      ? ONTARIO_WORKFLOW_CATALOGUE.find((entry) => entry.slug === slug[1])
      : undefined;
  const update =
    slug[0] === "updates"
      ? publicUpdates.find((entry) => entry.slug === slug[1])
      : undefined;
  const canonicalPath = `/${slug.join("/")}`;
  return {
    title: workflow?.title ?? update?.title ?? page.title,
    description: workflow?.description ?? update?.summary ?? page.summary,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: workflow?.title ?? update?.title ?? page.title,
      description: workflow?.description ?? update?.summary ?? page.summary,
      url: canonicalPath,
    },
  };
}

export default async function PublicPageRoute({ params }: RouteProps) {
  const { slug } = await params;
  const page = resolvePage(slug);
  if (!page) notFound();

  const isWorkflow = slug[0] === "workflows" && slug.length === 2;
  const isWorkflowCatalogue = slug[0] === "workflows" && slug.length === 1;
  const workflow = isWorkflow
    ? ONTARIO_WORKFLOW_CATALOGUE.find((entry) => entry.slug === slug[1])
    : undefined;
  const isUpdate = slug[0] === "updates" && slug.length === 2;
  const isUpdateCatalogue = slug[0] === "updates" && slug.length === 1;
  const update = isUpdate
    ? publicUpdates.find((entry) => entry.slug === slug[1])
    : undefined;
  const isCoverage = slug[0] === "coverage" && slug.length === 1;
  const isDemo = slug[0] === "demo" && slug.length === 1;
  const isContact = slug[0] === "contact" && slug.length === 1;

  return (
    <SiteShell>
      <main id="main-content" className="page-main">
        <section className="page-hero section-wrap">
          <p className="eyebrow">{page.eyebrow}</p>
          <h1>{workflow?.title ?? update?.title ?? page.title}</h1>
          <p className="page-summary">
            {workflow?.description ?? update?.summary ?? page.summary}
          </p>
          <div className="status-panel">
            <span>Status</span>
            <p>
              {workflow
                ? "Draft awaiting independent Ontario lawyer review."
                : update
                  ? update.status
                  : page.status}
            </p>
          </div>
        </section>
        <section className="section-wrap page-sections">
          {isWorkflowCatalogue &&
            ONTARIO_WORKFLOW_CATALOGUE.map((entry, index) => (
              <article key={entry.slug}>
                <p className="section-index">
                  {String(index + 1).padStart(2, "0")} · {entry.version}
                </p>
                <h2>
                  <a href={`/workflows/${entry.slug}`}>{entry.title}</a>
                </h2>
                <p>{entry.description}</p>
                <p>
                  <strong>{entry.practice}</strong> ·{" "}
                  {entry.jurisdictions.join(", ")}
                </p>
              </article>
            ))}
          {workflow && (
            <>
              <article>
                <p className="section-index">Scope</p>
                <h2>Inputs and output</h2>
                <p>
                  <strong>Required:</strong>{" "}
                  {workflow.requiredInputs.join("; ")}
                </p>
                <p>
                  <strong>Output:</strong> {workflow.output}
                </p>
              </article>
              <article>
                <p className="section-index">Boundaries</p>
                <h2>Excluded uses</h2>
                <p>{workflow.excludedUses.join("; ")}</p>
              </article>
              <article>
                <p className="section-index">Sources</p>
                <h2>Primary authority</h2>
                {workflow.primarySources.map((source) => (
                  <p key={source.url}>
                    <a href={source.url}>{source.label}</a>
                  </p>
                ))}
                <p>{workflow.sourceCurrency}</p>
              </article>
              <article>
                <p className="section-index">Review</p>
                <h2>Human checks</h2>
                <p>{workflow.reviewChecklist.join("; ")}</p>
              </article>
              <article>
                <p className="section-index">Governance</p>
                <h2>Not yet approved</h2>
                <p>
                  Reviewer: not assigned. Review date: not set. Synthetic
                  fixture: {workflow.syntheticFixture}.
                </p>
              </article>
              <article>
                <p className="section-index">Application</p>
                <h2>Open the draft</h2>
                <p>Authentication and beta access are required.</p>
                <a
                  className="button small-button"
                  href={`${siteConfig.appUrl}${workflow.appPath}`}
                >
                  Open in ROSS
                </a>
              </article>
            </>
          )}
          {isCoverage && (
            <article className="coverage-table-card">
              <p className="section-index">
                Registry v{PUBLIC_SOURCE_COVERAGE.version} · As of{" "}
                {PUBLIC_SOURCE_COVERAGE.asOfDate}
              </p>
              <h2>Implemented provider boundaries</h2>
              <p>{PUBLIC_SOURCE_COVERAGE.disclaimer}</p>
              <div
                className="table-scroll"
                role="region"
                aria-label="Legal source coverage table"
                tabIndex={0}
              >
                <table>
                  <caption>Sanitized public legal-source registry</caption>
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Jurisdiction and material</th>
                      <th scope="col">Engineering status</th>
                      <th scope="col">Known limits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PUBLIC_SOURCE_COVERAGE.providers.map((provider) => (
                      <tr key={provider.id}>
                        <th scope="row">
                          {provider.name}
                          <small>{provider.authority}</small>
                        </th>
                        <td>
                          {provider.jurisdictions.join(", ")}
                          <small>{provider.materials.join(" · ")}</small>
                        </td>
                        <td>
                          {provider.integrationStatus}
                          <small>
                            {provider.enabledByDefault
                              ? "Configured by default"
                              : "Disabled by default"}
                          </small>
                        </td>
                        <td>{provider.knownLimits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {isDemo && (
            <article className="demo-card">
              <p className="section-index">Illustrative product view</p>
              <h2>Conflicting-authority check</h2>
              <figure className="demo-window">
                <div className="demo-toolbar">
                  <span>Northstar Components — synthetic matter</span>
                  <strong>Ontario</strong>
                </div>
                <div className="demo-message user-message">
                  Compare the supplied passages. Do not resolve the conflict
                  from memory.
                </div>
                <div className="demo-message ross-message">
                  <strong>ROSS</strong>
                  <p>
                    The fictional passages state different tests. Both were
                    retrieved from the supplied synthetic record; verify the
                    complete decisions and current law before relying on this
                    comparison.
                  </p>
                  <div className="verification-grid">
                    <span>✓ Citation verified</span>
                    <span>✓ Passage verified</span>
                    <span>✓ Currency metadata present</span>
                    <span>! Treatment unavailable</span>
                  </div>
                </div>
                <figcaption>
                  Fictional demonstration only. No real authority, party,
                  matter, or client information. Full text transcript follows on
                  this page.
                </figcaption>
              </figure>
            </article>
          )}
          {isContact && (
            <article>
              <p className="section-index">Security-sensitive reports</p>
              <h2>Use private vulnerability reporting</h2>
              <p>
                Do not include real client information, privileged material,
                credentials, or unnecessary personal information.
              </p>
              <a className="button small-button" href={siteConfig.securityUrl}>
                Open private security report
              </a>
            </article>
          )}
          {isUpdateCatalogue &&
            publicUpdates.map((entry) => (
              <article key={entry.slug}>
                <p className="section-index">{entry.publishedAt}</p>
                <h2>
                  <a href={`/updates/${entry.slug}`}>{entry.title}</a>
                </h2>
                <p>{entry.summary}</p>
                <p>{entry.status}</p>
              </article>
            ))}
          {update && (
            <>
              <article>
                <p className="section-index">Published {update.publishedAt}</p>
                <h2>What changed</h2>
                <ul>
                  {update.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </article>
              <article>
                <p className="section-index">Boundary</p>
                <h2>What remains blocked</h2>
                <p>{update.limitations}</p>
              </article>
            </>
          )}
          {!isWorkflow &&
            !isUpdate &&
            !isUpdateCatalogue &&
            page.sections.map((section, index) => (
              <article key={section.title}>
                <p className="section-index">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2>{section.title}</h2>
                <p>{section.body}</p>
              </article>
            ))}
        </section>
        <section className="section-wrap review-panel">
          <div>
            <p className="eyebrow">Content governance</p>
            <h2>Review status is part of the content.</h2>
          </div>
          <dl className="governance-list">
            <div>
              <dt>Owner</dt>
              <dd>{page.governance.owner}</dd>
            </div>
            <div>
              <dt>Reviewer</dt>
              <dd>{page.governance.reviewer ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt>Review status</dt>
              <dd>{page.governance.reviewStatus}</dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>{page.governance.effectiveDate ?? "Not effective"}</dd>
            </div>
            <div>
              <dt>Last reviewed</dt>
              <dd>{page.governance.lastReviewedDate ?? "Not reviewed"}</dd>
            </div>
            <div>
              <dt>Next review</dt>
              <dd>{page.governance.nextReviewDate}</dd>
            </div>
          </dl>
        </section>
        <section className="page-cta">
          <div className="section-wrap">
            <div>
              <p className="eyebrow">Inspect the work</p>
              <h2>Follow ROSS in the open.</h2>
            </div>
            <div className="hero-actions">
              <a className="button light-button" href={siteConfig.sourceUrl}>
                View source
              </a>
              <a className="button outline-button" href="/">
                Back home
              </a>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
