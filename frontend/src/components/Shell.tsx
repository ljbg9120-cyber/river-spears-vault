/** App chrome: the logo, the nav, the account menu. */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BRAND } from "../lib/brand";
import { useAuth } from "../lib/store";
import { Avatar, Icon } from "./ui";

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <motion.span
        whileHover={{ rotate: -8, scale: 1.06 }}
        transition={{ type: "spring", stiffness: 400, damping: 14 }}
        className="flex items-center justify-center rounded-xl text-white"
        style={{
          width: size,
          height: size,
          background:
            "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
          boxShadow: "0 6px 18px -6px rgb(var(--accent-rgb))",
        }}
      >
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity="0.35"
          />
          <path
            d="M8 4v16M16 4v16"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      </motion.span>
      <span className="flex flex-col leading-none">
        <span className="title-xl text-[17px] leading-none sm:text-[19px]">
          {BRAND.primary}
        </span>
        <span className="mt-0.5 hidden text-[9.5px] font-medium uppercase tracking-[0.13em] text-muted sm:block">
          {BRAND.secondary}
        </span>
      </span>
    </span>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => setMenu(false), [loc.pathname]);

  const links = [
    { to: "/library", label: "Library", icon: "music" as const },
    { to: "/shares", label: "Links", icon: "link" as const },
    { to: "/appearance", label: "Appearance", icon: "sparkles" as const },
  ];

  return (
    <div className="relative z-10 min-h-screen">
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="glass mx-auto flex max-w-6xl items-center gap-3 rounded-2xl px-3 py-2.5 sm:px-4">
          <Link to={user ? "/library" : "/"} className="shrink-0">
            <Logo />
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {user &&
              links.map((l) => {
                const active = loc.pathname.startsWith(l.to);
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="relative rounded-full px-3.5 py-1.5 text-sm font-medium transition"
                    style={{ color: active ? "rgb(var(--ink-rgb))" : "rgb(var(--muted-rgb))" }}
                  >
                    {active && (
                      <motion.span
                        layoutId="navpill"
                        className="absolute inset-0 rounded-full"
                        style={{ background: "rgb(var(--accent-rgb) / 0.16)" }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span className="relative">{l.label}</span>
                  </Link>
                );
              })}
          </nav>

          <div className="flex-1" />

          {user ? (
            <div className="relative">
              <button
                onClick={() => setMenu((v) => !v)}
                className="flex items-center gap-2 rounded-full p-1 pr-2 transition hover:bg-white/10"
              >
                <Avatar name={user.display_name} src={user.avatar_url} size={30} />
                <span className="hidden text-sm font-medium sm:block">
                  {user.display_name.split(" ")[0]}
                </span>
              </button>

              <AnimatePresence>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 420, damping: 30 }}
                      className="glass-strong absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl p-1.5 shadow-lift"
                    >
                      <div className="px-3 py-2">
                        <div className="truncate text-sm font-semibold">
                          {user.display_name}
                        </div>
                        <div className="truncate text-xs text-muted">@{user.handle}</div>
                      </div>
                      <div className="my-1 h-px bg-[var(--hairline)]" />
                      {[
                        { to: `/u/${user.handle}`, label: "My public page", icon: "user" as const },
                        ...links,
                      ].map((l) => (
                        <Link
                          key={l.to}
                          to={l.to}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition hover:bg-white/10"
                        >
                          <Icon name={l.icon} size={16} />
                          {l.label}
                        </Link>
                      ))}
                      <div className="my-1 h-px bg-[var(--hairline)]" />
                      <button
                        onClick={async () => {
                          await logout();
                          nav("/");
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-white/10 hover:text-ink"
                      >
                        <Icon name="logout" size={16} />
                        Sign out
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="btn-ghost !px-4 !py-2">
                Sign in
              </Link>
              <Link to="/signup" className="btn-primary !px-4 !py-2">
                Join free
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="pb-player mx-auto max-w-6xl px-3 pt-5 sm:px-5">{children}</main>

      {/* Mobile tab bar, tucked above the player */}
      {user && (
        <nav className="glass fixed inset-x-3 z-30 flex items-center justify-around rounded-2xl py-1.5 md:hidden"
             style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}>
          {links.map((l) => {
            const active = loc.pathname.startsWith(l.to);
            return (
              <Link
                key={l.to}
                to={l.to}
                className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition"
                style={{ color: active ? "rgb(var(--accent-rgb))" : "rgb(var(--muted-rgb))" }}
              >
                <Icon name={l.icon} size={19} />
                {l.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
