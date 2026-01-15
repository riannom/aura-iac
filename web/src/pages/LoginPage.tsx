import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../api";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const formBody = new URLSearchParams();
      formBody.append("username", email);
      formBody.append("password", password);
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
      localStorage.setItem("token", data.access_token);
      navigate("/labs");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Login failed");
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-title">
        <h2>Sign in</h2>
        <p>Use your account to manage labs and start devices.</p>
      </div>
      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@lab.dev"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
      {status && <p className="auth-status">{status}</p>}
      <div className="auth-footer">
        <span>New here?</span>
        <Link to="/auth/register">Create an account</Link>
      </div>
    </div>
  );
}
