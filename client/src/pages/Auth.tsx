import { FormEvent, useState } from "react";
import { ArrowLeft, LockKeyhole, Mail, LogIn, UserRoundPlus } from "lucide-react";

const copy = {
  login: {
    title: "Welcome back",
    subtitle: "Log in to your account",
    icon: LogIn,
  },
  register: {
    title: "Create your account",
    subtitle: "Sign up to get started",
    icon: UserRoundPlus,
  },
  reset: {
    title: "Reset password",
    subtitle: "We'll send you a link to reset it",
    icon: Mail,
  },
};

type Mode = keyof typeof copy;

function currentMode(): Mode {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/register") return "register";
  if (path === "/forgot-password") return "reset";
  return "login";
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.39-4.55H24v9.02h12.88c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.36 38.09 46.98 31.85 46.98 24.55Z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.57 10.78l7.96-6.19Z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}

function Field({
  id,
  label,
  type = "text",
  placeholder,
  icon,
  autoComplete,
}: {
  id: string;
  label: string;
  type?: string;
  placeholder: string;
  icon: typeof Mail;
  autoComplete: string;
}) {
  const Icon = icon;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
        <input id={id} name={id} type={type} placeholder={placeholder} autoComplete={autoComplete} required />
      </div>
    </div>
  );
}

export default function Home() {
  const mode = currentMode();
  const { title, subtitle, icon: ModeIcon } = copy[mode];
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"info" | "success">("info");

  function showNotice(message: string, type: "info" | "success" = "info") {
    setNotice(message);
    setNoticeType(type);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    if (mode === "register") {
      const password = (form.elements.namedItem("password") as HTMLInputElement).value;
      const confirm = (form.elements.namedItem("confirm") as HTMLInputElement).value;
      if (password !== confirm) {
        showNotice("Passwords do not match. Please try again.");
        return;
      }
      showNotice("This copy is a frontend demo. Account creation is not connected yet.");
      return;
    }

    if (mode === "reset") {
      showNotice("This copy is a frontend demo. No reset email was sent.", "success");
      return;
    }

    showNotice("This copy is a frontend demo. Sign-in is not connected yet.");
  }

  return (
    <main className="auth-shell">
      <section className="auth-stack" aria-labelledby="auth-title">
        <header className="auth-heading">
          <div className="brand-icon" aria-hidden="true"><ModeIcon size={20} strokeWidth={1.8} /></div>
          <h1 id="auth-title">{title}</h1>
          <p>{subtitle}</p>
        </header>

        <form className="auth-card" onSubmit={handleSubmit}>
          {mode !== "reset" && (
            <>
              <button type="button" className="google-button" onClick={() => showNotice("Google sign-in is not configured in this copy.")}>
                <GoogleMark />
                <span>Continue with Google</span>
              </button>
              <div className="divider" role="separator"><span>OR</span></div>
            </>
          )}

          {mode === "reset" ? (
            <Field id="email" label="Email address" type="email" placeholder="you@example.com" icon={Mail} autoComplete="email" />
          ) : (
            <>
              <Field id="email" label="Email" type="email" placeholder="you@example.com" icon={Mail} autoComplete="email" />
              <div className="field-heading">
                <label htmlFor="password">Password</label>
                {mode === "login" && <a className="forgot-link" href="/forgot-password">Forgot password?</a>}
              </div>
              <div className="input-wrap">
                <LockKeyhole size={15} strokeWidth={1.7} aria-hidden="true" />
                <input id="password" name="password" type="password" placeholder="••••••••" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={6} />
              </div>
              {mode === "register" && (
                <Field id="confirm" label="Confirm Password" type="password" placeholder="••••••••" icon={LockKeyhole} autoComplete="new-password" />
              )}
            </>
          )}

          <button type="submit" className="submit-button">
            {mode === "login" ? "Log in" : mode === "register" ? "Create account" : "Send reset link"}
          </button>
          {notice && <p className={`form-notice ${noticeType}`} role="status">{notice}</p>}
        </form>

        {mode === "login" && (
          <p className="auth-footer">Don't have an account? <a href="/register">Create one</a></p>
        )}
        {mode === "register" && (
          <p className="auth-footer">Already have an account? <a href="/login">Log in</a></p>
        )}
        {mode === "reset" && (
          <a className="back-link" href="/login"><ArrowLeft size={14} /> Back to log in</a>
        )}
      </section>
      <span className="sr-only">Agenten-Villa Pro</span>
    </main>
  );
}
