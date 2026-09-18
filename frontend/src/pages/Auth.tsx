/** Sign in and join, with Google Identity Services when the server has a key. */
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/store";
import { Logo } from "../components/Shell";
import { Icon, Spinner, useToast } from "../components/ui";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: {
            client_id: string;
            callback: (r: { credential: string }) => void;
          }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function GoogleButton({ onCredential }: { onCredential: (c: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cfg = await api
        .get<{ google_enabled: boolean; google_client_id: string }>("/api/auth/config")
        .catch(() => null);
      if (cancelled) return;
      if (!cfg?.google_enabled) {
        setState("off");
        return;
      }

      const mount = () => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: cfg.google_client_id,
          callback: (res) => onCredential(res.credential),
        });
        window.google.accounts.id.renderButton(holder.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          width: 320,
          text: "continue_with",
          logo_alignment: "center",
        });
        setState("ready");
      };

      if (window.google) return mount();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = mount;
      script.onerror = () => !cancelled && setState("off");
      document.head.appendChild(script);
    })();

    return () => {
      cancelled = true;
    };
  }, [onCredential]);

  if (state === "off") return null;

  return (
    <div className="space-y-4">
      <div className="flex min-h-[44px] justify-center">
        {state === "loading" ? (
          <span className="text-muted">
            <Spinner />
          </span>
        ) : null}
        <div ref={holder} />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-[var(--hairline)]" />
        or use your email
        <span className="h-px flex-1 bg-[var(--hairline)]" />
      </div>
    </div>
  );
}

export default function Auth({ mode }: { mode: "login" | "signup" }) {
  const { login, signup, loginWithGoogle, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) nav("/library", { replace: true });
  }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") await signup(email, password, name);
      else await login(email, password);
      toast(mode === "signup" ? "Your vault is ready" : "Welcome back");
      nav("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async (credential: string) => {
    setBusy(true);
    setError("");
    try {
      await loginWithGoogle(credential);
      toast("Signed in with Google");
      nav("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="glass-strong w-full max-w-md rounded-3xl p-7 shadow-lift sm:p-9"
      >
        <Link to="/" className="mb-7 flex justify-center">
          <Logo size={38} />
        </Link>

        <h1 className="title-xl mb-1.5 text-center text-2xl">
          {mode === "signup" ? "Start your vault" : "Welcome back"}
        </h1>
        <p className="mb-7 text-center text-sm text-muted">
          {mode === "signup"
            ? "Free forever. Unlimited tracks, unlimited albums."
            : "Everything is right where you left it."}
        </p>

        <GoogleButton onCredential={onGoogle} />

        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === "signup" && (
            <input
              className="field"
              placeholder="Artist or producer name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoComplete="name"
            />
          )}
          <input
            className="field"
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="field"
            type="password"
            placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ background: "rgba(255,84,112,0.14)", color: "#ff8098" }}
            >
              {error}
            </motion.p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full !py-3 disabled:opacity-70">
            {busy ? <Spinner size={18} /> : mode === "signup" ? "Create my vault" : "Sign in"}
            {!busy && <Icon name="chevron" size={16} />}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {mode === "signup" ? (
            <>
              Already have a vault?{" "}
              <Link to="/login" className="font-semibold text-ink hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link to="/signup" className="font-semibold text-ink hover:underline">
                Join free
              </Link>
            </>
          )}
        </p>
      </motion.div>
    </div>
  );
}
