import type { ReactNode } from "react";
import { footerGroups, primaryNav, siteConfig } from "./site-config";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="beta-banner">{siteConfig.launchMode}</div>
      <header className="site-header">
        <div className="section-wrap header-inner">
          <a className="brand" href="/" aria-label="ROSS home">
            <img src="/ross-icon.svg" alt="" width="38" height="38" />
            <span>
              ROSS<small>Ranade OSS</small>
            </span>
          </a>
          <nav aria-label="Primary navigation">
            {primaryNav.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <a className="github-link" href={siteConfig.sourceUrl}>
              GitHub
            </a>
            <a className="login-link" href={`${siteConfig.appUrl}/login`}>
              Log in
            </a>
            <a
              className="button small-button"
              href={`${siteConfig.appUrl}/signup`}
            >
              Request access
            </a>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="section-wrap footer-grid">
          <div className="footer-brand">
            <a className="brand inverse" href="/" aria-label="ROSS home">
              <img src="/ross-icon.svg" alt="" width="42" height="42" />
              <span>
                ROSS<small>Ranade OSS</small>
              </span>
            </a>
            <p>Ontario-first legal work, built in the open.</p>
            <p className="footer-boundary">{siteConfig.coverageStatus}.</p>
          </div>
          {footerGroups.map((group) => (
            <div className="footer-group" key={group.title}>
              <h2>{group.title}</h2>
              {group.links.map(([label, href]) =>
                href.startsWith("http") ? (
                  <a key={href} href={href}>
                    {label}
                  </a>
                ) : (
                  <a key={href} href={href}>
                    {label}
                  </a>
                ),
              )}
            </div>
          ))}
        </div>
        <div className="section-wrap footer-bottom">
          <p>© 2026 ROSS contributors. Operator: {siteConfig.operator}.</p>
          <p>
            Modified from <a href={siteConfig.upstreamUrl}>Mike</a>. Licensed
            under AGPL-3.0. No government, court, CanLII, CourtListener, or
            upstream endorsement.
          </p>
        </div>
      </footer>
    </>
  );
}
