import { SiteShell } from "./site-shell";
import { siteConfig } from "./site-config";

const inheritedFeatures = [
  "Assistant and project workspaces",
  "Document drafting and editing",
  "Tabular review and workflows",
  "Sharing, connectors, and self-hosting",
];

const OntarioLayer = () => (
  <div className="source-window" aria-label="Ontario source coverage preview">
    <div className="window-bar">
      <span />
      <span />
      <span />
      <p>ROSS source map</p>
    </div>
    <div className="source-body">
      <p className="eyebrow">Coverage status</p>
      <h2>Connectors implemented. Coverage stays conditional.</h2>
      <ul className="source-list">
        <li>
          <span className="source-dot implemented" />
          Ontario &amp; federal legislation <strong>implemented</strong>
        </li>
        <li>
          <span className="source-dot conditional" />
          Canadian decisions through A2AJ <strong>runtime-dependent</strong>
        </li>
        <li>
          <span className="source-dot inherited" />
          CourtListener for U.S. research <strong>preserved</strong>
        </li>
      </ul>
      <a className="text-link" href="/coverage">
        Read the coverage policy <span aria-hidden="true">→</span>
      </a>
    </div>
  </div>
);

export default function Home() {
  return (
    <SiteShell>
      <main id="main-content">
        <section className="hero section-wrap">
          <div className="hero-copy">
            <p className="status-pill">
              <span />
              Invitation-only beta foundation
            </p>
            <h1>
              Ontario-first legal work, <em>built in the open.</em>
            </h1>
            <p className="hero-lede">
              ROSS is an open-source legal AI workspace in development for
              Ontario lawyers and paralegals—preserving Mike’s capable document
              workspace while adding verified Canadian legal sources.
            </p>
            <div className="hero-actions">
              <a className="button primary" href={siteConfig.appUrl}>
                Try ROSS <span aria-hidden="true">↗</span>
              </a>
              <a className="button secondary" href={siteConfig.sourceUrl}>
                View source
              </a>
            </div>
            <p className="hero-note">
              <strong>Current mode:</strong> synthetic or non-confidential
              materials only. Engineering integrations exist; live availability
              and comprehensive Ontario coverage are not verified.
            </p>
          </div>
          <OntarioLayer />
        </section>

        <section className="trust-strip" aria-label="ROSS product principles">
          <div className="section-wrap trust-grid">
            <p>
              <span>01</span>Open source
              <br />
              <strong>AGPL-3.0</strong>
            </p>
            <p>
              <span>02</span>Jurisdiction
              <br />
              <strong>Ontario, Canada</strong>
            </p>
            <p>
              <span>03</span>Product mode
              <br />
              <strong>Controlled beta</strong>
            </p>
            <p>
              <span>04</span>Source posture
              <br />
              <strong>Verify, then show</strong>
            </p>
          </div>
        </section>

        <section className="section-wrap split-section">
          <div>
            <p className="eyebrow">A legal workspace, not an oracle</p>
            <h2>
              Keep the useful work together. Keep professional judgment in
              charge.
            </h2>
          </div>
          <div className="principle-copy">
            <p>
              ROSS is designed to help professionals organize matters, work with
              documents, research sources, and inspect support for a
              proposition. It does not turn model output into legal authority.
            </p>
            <a className="text-link" href="/responsible-ai">
              How verification is meant to work{" "}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <section
          className="section-wrap feature-grid"
          aria-labelledby="foundations-title"
        >
          <div className="section-heading">
            <p className="eyebrow">Product foundations</p>
            <h2 id="foundations-title">
              Built on Mike. Extended deliberately for Ontario.
            </h2>
          </div>
          <article className="feature-card navy-card">
            <p className="card-number">01</p>
            <h3>Preserve the workspace</h3>
            <p>
              Assistant, projects, document tools, tabular review, workflows,
              sharing, connectors, and optional U.S. research stay protected by
              regression tests.
            </p>
            <ul>
              {inheritedFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
          <article className="feature-card teal-card">
            <p className="card-number">02</p>
            <h3>Add Ontario with provenance</h3>
            <p>
              Provider-neutral research distinguishes jurisdiction, court level,
              source version, canonical link, retrieval time, and verification
              state.
            </p>
            <a className="card-link" href="/ontario">
              Explore the Ontario foundation <span aria-hidden="true">→</span>
            </a>
          </article>
          <article className="feature-card light-card">
            <p className="card-number">03</p>
            <h3>Make limits visible</h3>
            <p>
              Coverage gaps, stale sources, unsupported requests, and unverified
              propositions belong in the interface—not hidden in fine print.
            </p>
            <a className="card-link" href="/coverage">
              See coverage status <span aria-hidden="true">→</span>
            </a>
          </article>
        </section>

        <section className="section-wrap split-section demo-invite">
          <div>
            <p className="eyebrow">Synthetic demonstration</p>
            <h2>See how verification states stay separate.</h2>
          </div>
          <div className="principle-copy">
            <p>
              A fictional Ontario matter demonstrates citation, passage,
              currency, treatment, and coverage states without using client
              information or claiming live legal accuracy.
            </p>
            <a className="button secondary" href="/demo">
              View the captioned demo
            </a>
          </div>
        </section>

        <section className="section-wrap deployment-section">
          <div className="deployment-copy">
            <p className="eyebrow">Two deployment paths</p>
            <h2>A controlled hosted beta, or infrastructure you operate.</h2>
            <p>
              The operator-hosted service is limited to synthetic or
              non-confidential material until privacy and security controls are
              independently ready. Self-hosting gives deployers control—and
              responsibility—for their own configuration.
            </p>
          </div>
          <div className="deployment-options">
            <article>
              <p className="option-label">Hosted beta</p>
              <h3>Invitation only</h3>
              <p>
                Placeholder domains, named owners, hosting vendors, and
                production data controls remain open.
              </p>
              <a href="/security">Review current boundaries →</a>
            </article>
            <article>
              <p className="option-label">Open source</p>
              <h3>AGPL repository</h3>
              <p>
                Inspect, adapt, and deploy the code while meeting licence,
                security, operations, and source obligations.
              </p>
              <a href="/open-source">Read the self-hosting overview →</a>
            </article>
          </div>
        </section>

        <section className="final-cta">
          <div className="section-wrap cta-inner">
            <div>
              <p className="eyebrow">Follow the build</p>
              <h2>Ontario legal infrastructure should be inspectable.</h2>
              <p>
                ROSS is a modified fork of Mike. The roadmap, architecture
                decisions, source policy, and code are public.
              </p>
            </div>
            <div className="hero-actions">
              <a className="button light-button" href={siteConfig.sourceUrl}>
                View ROSS on GitHub
              </a>
              <a className="button outline-button" href="/about">
                About the project
              </a>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
