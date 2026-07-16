import { type ReactNode, useState } from "react";

// docs/ARCHITECTURE.md: "Admin/analyst routes sit behind an additional shared
// password checked client-side + in functions via a header — demo-grade
// only, documented as such on the page." This is NOT real authentication —
// the whole site already sits behind a Netlify page password; this is just a
// second speed bump so a shared demo link doesn't put admin controls one
// click away from a farmer view.
const DEMO_PASSWORDS: Record<string, string> = {
  admin: "vch-admin-demo",
  analyst: "vch-analyst-demo",
};

export function PasswordGate({ area, children }: { area: "admin" | "analyst"; children: ReactNode }) {
  const storageKey = `vch_demo_gate_${area}`;
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(storageKey) === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (input === DEMO_PASSWORDS[area]) {
      sessionStorage.setItem(storageKey, "1");
      setUnlocked(true);
    } else {
      setError(true);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6">
      <div className="vch-card w-full">
        <h1 className="text-xl">{area === "admin" ? "Admin" : "Analyst"} access</h1>
        <p className="text-sm text-sand-700">
          Demo-grade password gate only — not real authentication. The whole site already sits behind a Netlify page
          password; this is a second checkpoint in front of {area} controls.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            autoFocus
            className="vch-input w-full"
            placeholder="Password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
          />
          {error && <p className="text-sm text-rust">Incorrect password.</p>}
          <button type="submit" className="vch-btn-primary w-full">
            Enter
          </button>
        </form>
        <p className="text-xs text-sand-500">
          Demo hint: <code>{DEMO_PASSWORDS[area]}</code>
        </p>
      </div>
    </div>
  );
}
