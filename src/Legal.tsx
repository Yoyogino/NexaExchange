export type LegalPageName = "terms" | "privacy";

export function LegalLinks() {
  return <footer className="legal-links"><span>Nexa Exchange is a simulated trading demo.</span><nav aria-label="Legal information"><a href="#terms">Terms</a><a href="#privacy">Privacy</a></nav></footer>;
}

export function LegalPage({ page }: { page: LegalPageName }) {
  const terms = page === "terms";
  return <main id="main-content" className="legal-page">
    <a className="skip-link" href="#legal-content">Skip to legal information</a>
    <a className="back-link" href="#">← Back to exchange</a>
    <article id="legal-content" className="panel">
      <p className="eyebrow">NEXA EXCHANGE DEMO</p>
      <h1>{terms ? "Terms of use" : "Privacy notice"}</h1>
      <p className="legal-updated">Demo template · Last updated September 2, 2026</p>
      {terms ? <>
        <h2>Simulation only</h2><p>Nexa Exchange is a local software demonstration. Balances, orders, trades, fees, and market activity are simulated and have no monetary value.</p>
        <h2>No financial service</h2><p>The demo does not accept deposits, process withdrawals, custody cryptoassets, provide investment advice, or promise that an order can be executed in a real market.</p>
        <h2>Your responsibilities</h2><p>Use the demo only for testing and education. Do not enter real financial credentials, wallet keys, confidential information, or personal information belonging to someone else.</p>
        <h2>Availability and risk</h2><p>Local demo data may be changed, reset, or lost. Features may contain errors and are provided without a production-service guarantee.</p>
        <h2>Before a real launch</h2><p>These terms are a product template. Qualified legal counsel must replace or approve them and complete jurisdiction-specific financial-services, consumer-protection, and compliance reviews before any public or real-money use.</p>
      </> : <>
        <h2>Information stored locally</h2><p>The demo stores account email addresses, password hashes, simulated balances and trading records, administrator audit events, sessions, login history, IP addresses, and browser user-agent information in the local PostgreSQL database.</p>
        <h2>Security data</h2><p>Session tokens, verification codes, password-reset codes, and recovery codes are stored as hashes. An authenticator setup secret is stored for accounts that enable two-factor authentication.</p>
        <h2>How information is used</h2><p>Information is used to operate authentication, simulated trading, security controls, auditing, and local system monitoring. This version does not include advertising or analytics integrations.</p>
        <h2>Storage and deletion</h2><p>Data remains in local Docker volumes and backups until the operator removes it. Administrators should protect backups and establish retention and deletion procedures before shared use.</p>
        <h2>Before a real launch</h2><p>This notice is a product template, not a final privacy policy. Legal review, a data inventory, retention rules, user-rights procedures, vendor disclosures, and jurisdiction-specific notices are required before deployment.</p>
      </>}
    </article>
    <LegalLinks />
  </main>;
}
