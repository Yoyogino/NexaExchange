import { FormEvent, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Account, ApiError, confirmPasswordReset, getMe, login, logout, register, requestPasswordReset } from "./api";
import { Dashboard } from "./Dashboard";
import { AdminPanel } from "./AdminPanel";
import { LegalLinks, LegalPage, LegalPageName } from "./Legal";

const milestones = [
  ["1", "Foundation", "Application, database, and development tooling"],
  ["2", "Accounts & ledger", "Secure access and simulated balances"],
  ["3", "Trading engine", "Orders, matching, trades, and fees"],
  ["4", "Exchange UI", "Wallets, market, and trade history"],
];

function AuthScreen({ onAuthenticated }: { onAuthenticated: (account: Account) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"register" | "login" | "reset">("register");
  const [resetCode, setResetCode] = useState("");
  const [demoResetCode, setDemoResetCode] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      if (mode === "reset") {
        if (!resetRequested) {
          const result = await requestPasswordReset(email);
          setDemoResetCode(result.demoCode ?? ""); setResetRequested(true); setMessage(result.demoCode ? `Demo reset code: ${result.demoCode}` : result.message);
        } else {
          const result = await confirmPasswordReset(email, resetCode, password);
          setMessage(result.message); setMode("login"); setDemoResetCode(""); setResetRequested(false); setResetCode(""); setPassword("");
        }
        return;
      }
      const data = mode === "register" ? await register(email, password) : await login(email, password, twoFactorCode || undefined);
      onAuthenticated({ user: data.user, wallets: data.wallets });
    } catch (error) {
      if (error instanceof ApiError && error.code === "TWO_FACTOR_REQUIRED") setNeedsTwoFactor(true);
      setMessage(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content">
      <a className="skip-link" href="#auth-form">Skip to account form</a>
      <section className="hero">
        <p className="eyebrow">SIMULATED ENVIRONMENT</p>
        <h1>Nexa Exchange</h1>
        <p className="lead">A BTC/USDT trading demo. No real assets, deposits, or withdrawals are accepted.</p>
        <form id="auth-form" className="auth" onSubmit={submit} aria-describedby={message ? "auth-message" : undefined}>
          <h2>{mode === "register" ? "Create your demo account" : mode === "login" ? "Sign in" : "Reset password"}</h2>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" maxLength={254} required />
          </label>
          {mode === "reset" && resetRequested && <label>Reset code<input value={resetCode} onChange={(event) => setResetCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></label>}
          {(mode !== "reset" || resetRequested) && <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} maxLength={128} required />
          </label>}
          {mode === "login" && needsTwoFactor && <label>Authenticator or recovery code<input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} autoComplete="one-time-code" required /></label>}
          {message && <p id="auth-message" className="error" role="alert">{message}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Please wait…" : mode === "register" ? "Create demo account" : mode === "login" ? "Sign in" : resetRequested ? "Set new password" : "Send reset code"}
          </button>
          <button className="link" type="button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? "Already have an account? Sign in" : "Need an account? Register"}
          </button>
          {mode === "login" && <button className="link" type="button" onClick={() => { setMode("reset"); setMessage(""); }}>Forgot password?</button>}
        </form>
      </section>
      <section id="roadmap" className="roadmap" aria-labelledby="roadmap-heading">
        <p className="eyebrow">BUILD STATUS</p>
        <h2 id="roadmap-heading">Building the exchange safely, one layer at a time.</h2>
        <div className="cards">
          {milestones.map(([number, title, description]) => (
            <article key={number} className="card">
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [view, setView] = useState<"trade" | "admin">("trade");
  const [legalPage, setLegalPage] = useState<LegalPageName | null>(() => window.location.hash === "#terms" ? "terms" : window.location.hash === "#privacy" ? "privacy" : null);

  useEffect(() => {
    const updateLegalPage = () => setLegalPage(window.location.hash === "#terms" ? "terms" : window.location.hash === "#privacy" ? "privacy" : null);
    window.addEventListener("hashchange", updateLegalPage);
    return () => window.removeEventListener("hashchange", updateLegalPage);
  }, []);

  useEffect(() => {
    getMe("")
      .then((data) => {
        setToken("cookie-session");
        setAccount(data);
      })
      .catch(() => {})
      .finally(() => setRestoring(false));
  }, []);

  function handleAuthenticated(nextAccount: Account) {
    setToken("cookie-session");
    setAccount(nextAccount);
  }

  function handleSignOut() {
    if (token) void logout(token).catch(() => {});
    setToken(null);
    setAccount(null);
    setView("trade");
  }

  if (legalPage) return <LegalPage page={legalPage} />;
  if (restoring) return null; // avoid a login-screen flash while we check for a saved session
  if (token && account) {
    if (view === "admin" && account.user.role === "ADMIN") {
      return <><AdminPanel token={token} account={account} onBack={() => setView("trade")} onSignOut={handleSignOut} /><LegalLinks /></>;
    }
    return (<>
      <Dashboard
        token={token}
        account={account}
        onAccountChange={setAccount}
        onSignOut={handleSignOut}
        onOpenAdmin={account.user.role === "ADMIN" ? () => setView("admin") : undefined}
      />
      <LegalLinks />
    </>);
  }
  return <><AuthScreen onAuthenticated={handleAuthenticated} /><LegalLinks /></>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
