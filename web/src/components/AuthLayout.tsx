import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { applyTheme, getPreferredTheme, toggleTheme } from "../theme";

export function AuthLayout() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const preferred = getPreferredTheme();
    applyTheme(preferred);
    setTheme(preferred);
  }, []);

  function handleToggleTheme() {
    setTheme(toggleTheme());
  }
  return (
    <div className="auth-shell">
      <div className="auth-bg" />
      <button className="theme-toggle auth-toggle" onClick={handleToggleTheme} type="button">
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
      <div className="auth-content">
        <div className="auth-hero">
          <div className="auth-brand">Aura</div>
          <h1>Aura, an IaC Canvas for network labs.</h1>
          <p>
            Drag, connect, label, and run multi-vendor topologies. Keep everything reproducible
            in netlab YAML.
          </p>
          <div className="auth-badges">
            <span>multi-user</span>
            <span>YAML export</span>
          </div>
        </div>
        <div className="auth-panel">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
