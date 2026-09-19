/** Persistent workspace navigation and the public-site header. */
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BRAND } from "../lib/brand";
import { useAuth } from "../lib/store";
import { Avatar, Icon, Modal, useToast } from "./ui";

export function Logo({ size = 36 }: { size?: number }) {
  return <span className="vault-wordmark">
    <span className="vault-mark" style={{ width: size, height: size }}><Icon name="music" size={size * .52} /></span>
    <span><strong>{BRAND.primary}</strong><small>AND THE CREWS VAULT</small></span>
  </span>;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const links = [
    { to: "/library", label: "Library", icon: "music" as const },
    { to: "/feedback", label: "Review inbox", icon: "comment" as const },
    { to: "/shares", label: "Shared links", icon: "link" as const },
    { to: "/playback", label: "Playback", icon: "volume" as const },
    { to: "/appearance", label: "Appearance", icon: "settings" as const },
  ];
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,[contenteditable=true],[role=dialog]")) return;
      if (e.key === "?") { e.preventDefault(); setShortcuts(v => !v); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (!user) return <div className="relative z-10 min-h-screen">
    <header className="public-header"><Link to="/"><Logo /></Link><div className="flex items-center gap-2"><Link to="/login" className="btn-ghost">Sign in</Link><Link to="/signup" className="btn-primary">Join free</Link></div></header>
    <main id="main-content" className="pb-player mx-auto max-w-6xl px-4 pt-8">{children}</main>
  </div>;

  return <div className="studio-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="studio-sidebar">
      <Link to="/library" className="studio-logo"><Logo /></Link>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Workspace" className="studio-nav">
        {links.map(l => <Link key={l.to} to={l.to} aria-current={loc.pathname.startsWith(l.to) ? "page" : undefined} className={loc.pathname.startsWith(l.to) ? "active" : ""}><Icon name={l.icon} size={19} />{l.label}{loc.pathname.startsWith(l.to) && <span className="nav-indicator" />}</Link>)}
      </nav>
      <div className="sidebar-divider" />
      <div className="workspace-label">QUICK ACCESS</div>
      <nav aria-label="Quick access" className="studio-nav secondary">
        <Link to="/library?favorite=true"><Icon name="heart" size={17} />Favorites</Link>
        <Link to="/library?status=in_review"><Icon name="comment" size={17} />Ready for review</Link>
        <Link to="/library?folder_id=none"><Icon name="folder" size={17} />Unfiled tracks</Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="studio-note"><Icon name="lock" size={16} /><div><strong>Your music stays yours.</strong><p>Private until you share it.</p></div></div>
        <button className="shortcut-trigger" onClick={() => setShortcuts(true)}><span>Keyboard shortcuts</span><kbd>?</kbd></button>
        <button className="account-button" onClick={() => setMenu(true)} aria-label="Account settings"><Avatar name={user.display_name} src={user.avatar_url} size={35} /><span><strong>{user.display_name}</strong><small>@{user.handle}</small></span><Icon name="chevron" size={15} /></button>
      </div>
    </aside>
    <header className="studio-topbar"><div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={13} /><strong>{links.find(l => loc.pathname.startsWith(l.to))?.label ?? (loc.pathname.startsWith("/track/") ? "Track studio" : "Artist profile")}</strong></div><span className="topbar-private"><Icon name="lock" size={13} />Personal vault</span><button className="mobile-account icon-button" onClick={() => setMenu(true)} aria-label="Account settings"><Avatar name={user.display_name} src={user.avatar_url} size={30} /></button></header>
    <main id="main-content" className="studio-content" tabIndex={-1}>{children}</main>
    <nav className="studio-mobile-nav" aria-label="Mobile workspace">
      {links.map(l => <Link key={l.to} to={l.to} aria-current={loc.pathname.startsWith(l.to) ? "page" : undefined} className={loc.pathname.startsWith(l.to) ? "active" : ""}><Icon name={l.icon} size={19} /><span>{l.label === "Review inbox" ? "Inbox" : l.label === "Shared links" ? "Links" : l.label}</span></Link>)}
    </nav>
    <Modal open={menu} onClose={() => setMenu(false)} title="Your account" width={400}>
      <div className="account-details"><Avatar name={user.display_name} src={user.avatar_url} size={48} /><div><strong>{user.display_name}</strong><p className="text-muted">{user.email}</p></div></div>
      <Link className="account-link" to={`/u/${user.handle}`}><Icon name="user" />View and edit public profile<Icon name="chevron" size={14} /></Link>
      <Link className="account-link" to="/appearance"><Icon name="settings" />Customize appearance<Icon name="chevron" size={14} /></Link>
      <button className="btn-ghost mt-5 w-full" onClick={async () => { try { await logout(); nav("/"); } catch { toast("Could not sign out. Please try again.", "err"); } }}><Icon name="logout" size={16} />Sign out</button>
    </Modal>
    <Modal open={shortcuts} onClose={() => setShortcuts(false)} title="Keyboard shortcuts" width={420}>
      <div className="shortcut-list">{[["Search your library", "/"], ["Play / pause", "Space"], ["Seek 5 seconds", "← / →"], ["Previous / next track", "Shift + ← / →"], ["Close a dialog", "Esc"], ["Show shortcuts", "?"]].map(([label,key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
    </Modal>
  </div>;
}
