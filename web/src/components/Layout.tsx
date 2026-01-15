import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { applyTheme, getPreferredTheme, toggleTheme } from "../theme";

export function Layout() {
  const token = localStorage.getItem("token");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const preferred = getPreferredTheme();
    applyTheme(preferred);
    setTheme(preferred);
  }, []);

  function handleToggleTheme() {
    setTheme(toggleTheme());
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <div className="brand-name">Aura</div>
            <div className="brand-subtitle">an IaC Canvas</div>
          </div>
        </div>
        <div className="sidebar-section-title">Workspace</div>
        <nav className="nav">
          <NavLink to="/labs">
            <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M8 8h8M8 12h8M8 16h6" strokeWidth="1.4" />
            </svg>
            Labs
          </NavLink>
          {!token && (
            <NavLink to="/auth/login">
              <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
                <path d="M7 7h6a4 4 0 0 1 4 4v6" strokeWidth="1.6" />
                <rect x="3" y="11" width="10" height="10" rx="2" />
                <path d="M13 16h8M18 12l3 4-3 4" strokeWidth="1.6" />
              </svg>
              Login
            </NavLink>
          )}
        </nav>
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={handleToggleTheme} type="button">
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-icon">🧩</span>
            Aura
          </div>
          <div className="topbar-meta" />
        </header>
        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
