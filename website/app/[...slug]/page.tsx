import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ONTARIO_WORKFLOW_CATALOGUE } from "../generated-ontario-workflows";
import { publicPages } from "../page-content";
import { SiteShell } from "../site-shell";
import { siteConfig } from "../site-config";

type RouteProps = { params: Promise<{ slug: string[] }> };

function resolvePage(slug: string[]) {
  if (slug[0] === "workflows" && slug.length === 2)
    return ONTARIO_WORKFLOW_CATALOGUE.some((entry) => entry.slug === slug[1])
      ? publicPages.workflows
      : undefined;
  if (slug[0] === "updates" && slug.length === 2) return publicPages.updates;
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
  return {
    title: workflow?.title ?? page.title,
    description: workflow?.description ?? page.summary,
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

  return (
    <SiteShell>
      <main id="main-content" className="page-main">
        <section className="page-hero section-wrap">
          <p className="eyebrow">{page.eyebrow}</p>
          <h1>
            {workflow?.title ?? (isUpdate ? "Update preview" : page.title)}
          </h1>
          <p className="page-summary">
            {workflow?.description ?? page.summary}
          </p>
          <div className="status-panel">
            <span>Status</span>
            <p>
              {workflow
                ? "Draft awaiting independent Ontario lawyer review."
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
          {isUpdate && (
            <article>
              <p className="section-index">Update entry</p>
              <h2>{slug[1].replaceAll("-", " ")}</h2>
              <p>
                No published update exists at this placeholder route. Material
                updates will be versioned and dated.
              </p>
            </article>
          )}
          {!isWorkflow &&
            !isUpdate &&
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
          <p>{page.review}</p>
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
