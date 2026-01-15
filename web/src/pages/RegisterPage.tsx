import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../api";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setStatus("Account created. Please sign in.");
      setTimeout(() => navigate("/auth/login"), 800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Registration failed");
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-title">
        <h2>Create account</h2>
        <p>Reserve your lab workspace and unlock sharing.</p>
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
            placeholder="At least 8 characters"
          />
        </label>
        <button type="submit">Create account</button>
      </form>
      {status && <p className="auth-status">{status}</p>}
      <div className="auth-footer">
        <span>Already have an account?</span>
        <Link to="/auth/login">Sign in</Link>
      </div>
    </div>
  );
}
