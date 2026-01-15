import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api";

interface Lab {
  id: string;
  name: string;
  created_at: string;
}

export function LabsPage() {
  const [labs, setLabs] = useState<Lab[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const token = localStorage.getItem("token");

  async function loadLabs() {
    try {
      const data = await apiRequest<{ labs: Lab[] }>("/labs");
      setLabs(data.labs);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load labs";
      setError(message === "Unauthorized" ? "Please sign in to view labs." : message);
    }
  }

  async function createLab() {
    try {
      await apiRequest("/labs", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      loadLabs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create lab";
      setError(message === "Unauthorized" ? "Please sign in to create labs." : message);
    }
  }

  useEffect(() => {
    loadLabs();
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Labs</div>
        <h1>Build, share, and run labs in one workspace.</h1>
        <p>
          Manage your topologies, export YAML, and launch containerlab-backed labs without
          leaving the dashboard.
        </p>
        <div className="badge-row">
          <span className="badge">multi-user</span>
          <span className="badge">YAML export</span>
        </div>
      </header>

      <div className="labs-grid">
        <section className="panel">
          <div className="panel-header">
            <h3>Workspace status</h3>
          </div>
          <p className="panel-subtitle">
            Keep your labs organized by owner and shared access. Reload to pick up changes.
          </p>
          {!token && <p className="callout">Sign in to create and view labs.</p>}
          <div className="stat-grid">
            <div className="stat">
              <span>Total labs</span>
              <strong>{labs.length}</strong>
            </div>
            <div className="stat">
              <span>Active user</span>
              <strong>{token ? "Signed in" : "Guest"}</strong>
            </div>
            <div className="stat">
              <span>Backend</span>
              <strong>containerlab</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Create a lab</h3>
          </div>
          <p className="panel-subtitle">Give it a name, then open the topology canvas.</p>
          <div className="inline-form">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="eg. spine-leaf-1"
              disabled={!token}
            />
            <button onClick={createLab} disabled={!name || !token}>
              Create lab
            </button>
          </div>
          <p className="panel-subtitle">New labs show up immediately in the list.</p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3>Recent labs</h3>
          <div className="page-actions">
            <button className="button-secondary" onClick={loadLabs}>
              Refresh
            </button>
          </div>
        </div>
        {error && <p className="callout">{error}</p>}
        <div className="lab-list">
          {labs.length === 0 ? (
            <div className="lab-item">
              <div>
                <strong>No labs yet</strong>
                <div className="lab-meta">Create your first topology to get started.</div>
              </div>
            </div>
          ) : (
            labs.map((lab) => (
              <div key={lab.id} className="lab-item">
                <div>
                  <Link to={`/labs/${lab.id}`}>{lab.name}</Link>
                  <div className="lab-meta">
                    Created {new Date(lab.created_at).toLocaleString()}
                  </div>
                </div>
                <Link to={`/labs/${lab.id}`} className="button-ghost">
                  Open
                </Link>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
