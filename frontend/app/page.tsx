// Server component: talks to the backend over the compose network.
const API_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

type Check = { status: "up" } | { status: "down"; error: string };
type Readiness = {
  status: string;
  checks: { database: Check; storage: Check };
};

async function getReadiness(): Promise<Readiness | null> {
  try {
    const res = await fetch(`${API_URL}/health/ready`, { cache: "no-store" });
    return (await res.json()) as Readiness;
  } catch {
    return null;
  }
}

function Row({ label, check }: { label: string; check: Check }) {
  const up = check.status === "up";
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.75rem 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span>{label}</span>
      <span style={{ color: up ? "var(--up)" : "var(--down)", fontVariantNumeric: "tabular-nums" }}>
        {up ? "up" : `down — ${check.error}`}
      </span>
    </li>
  );
}

export default async function Home() {
  const readiness = await getReadiness();

  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>BDI Project</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Next.js · Express · Postgres · MinIO
      </p>

      <h2 style={{ fontSize: "1rem", marginTop: "2.5rem" }}>Service health</h2>
      {readiness ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <Row label="Backend" check={{ status: "up" }} />
          <Row label="Postgres" check={readiness.checks.database} />
          <Row label="MinIO" check={readiness.checks.storage} />
        </ul>
      ) : (
        <p style={{ color: "var(--down)" }}>
          Backend unreachable at <code>{API_URL}</code>.
        </p>
      )}

      <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: "2.5rem" }}>
        Edit <code>frontend/app/page.tsx</code> to get started. MinIO console:{" "}
        <a href="http://localhost:9001">localhost:9001</a>
      </p>
    </main>
  );
}
