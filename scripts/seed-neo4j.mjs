import neo4j from "neo4j-driver";
import fs from "fs";
import path from "path";

// Read .env manually
const envContent = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
const env = {};
envContent.split("\n").forEach((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
  if (match) {
    let value = match[2] || "";
    value = value.trim().replace(/^['"]|['"]$/g, "");
    env[match[1]] = value;
  }
});

const uri = env.NEO4J_URI;
const user = env.NEO4J_USERNAME || "neo4j";
const password = env.NEO4J_PASSWORD;
const database = env.NEO4J_DATABASE || "neo4j";

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

const GRAPH_DATA = [
  // 1. Auth Module & JWT Challenge Cluster
  {
    project: {
      id: "proj-core",
      meta: "PROJECT · MAIN REPOSITORY",
      description: "Primary backend monorepo and API platform services",
    },
    component: {
      id: "comp-auth",
      meta: "COMPONENT · AUTH-MODULE",
      description: "Authentication module managing user sessions, JWT token lifecycle, and API authorization guards",
      keywords: ["auth", "authentication", "auth-module", "session", "jwt", "login", "tokens"],
    },
    dependency: {
      id: "dep-jwt",
      meta: "DEPENDENCY · JSONWEBTOKEN v9.0.2",
      description: "JWT token signing and asymmetric verification package used by the auth module",
      keywords: ["jsonwebtoken", "jwt", "ed25519", "crypto", "auth"],
    },
    decision: {
      id: "dec-auth",
      meta: "DECISION · ADR-031 · 2026-01-24 · APPROVED",
      description:
        "Migrated authentication module from stateful PostgreSQL sessions to Ed25519 signed JWT tokens with refresh token rotation.",
      keywords: ["auth", "authentication", "jwt", "token", "ed25519", "refresh", "rotation", "session"],
    },
    reason: {
      id: "rsn-auth",
      meta: "REASON · SCALE-ROADMAP-2026",
      description:
        "PostgreSQL session table lookup caused database connection bottlenecks and 34% API latency overhead during login surges.",
      keywords: ["postgres", "session", "latency", "scale", "auth"],
    },
    bug: {
      id: "bug-auth",
      meta: "BUG · ISSUE-741 · CRITICAL · RESOLVED",
      description:
        "Users received unexpected 401 Unauthorized API errors and premature logouts after 5 minutes due to aggressive token expiration and parallel tab refresh invalidation.",
      keywords: ["401", "unauthorized", "api error", "logout", "5 minutes", "auth", "expiry", "token"],
    },
    fix: {
      id: "fix-auth",
      meta: "FIX · PR #123 · MERGED · COMMIT e931fa2",
      description:
        "Restored refresh window grace period to 15 minutes and implemented sliding-window token rotation to prevent 401 API authentication errors.",
      keywords: ["grace period", "refresh token", "pr 123", "pr #123", "fix", "auth"],
    },
  },

  // 2. API Gateway & Rate Limiting Cluster
  {
    project: {
      id: "proj-core",
      meta: "PROJECT · MAIN REPOSITORY",
      description: "Primary backend monorepo and API platform services",
    },
    component: {
      id: "comp-gateway",
      meta: "COMPONENT · API-GATEWAY",
      description: "Edge reverse proxy handling routing, SSL termination, and client request rate limiting",
      keywords: ["gateway", "api-gateway", "rate limiter", "proxy", "routing"],
    },
    dependency: {
      id: "dep-redis",
      meta: "DEPENDENCY · IOREDIS v5.4.1",
      description: "Redis client driver powering distributed rate limiting and token bucket storage",
      keywords: ["ioredis", "redis", "valkey", "cache", "driver"],
    },
    decision: {
      id: "dec-redis",
      meta: "DECISION · ADR-038 · 2026-02-18 · APPROVED",
      description:
        "Added Redis-based sliding-window rate limiter to api-gateway with strict quota limits per IP and API key.",
      keywords: ["redis", "rate limiter", "api-gateway", "gateway", "quota"],
    },
    reason: {
      id: "rsn-redis",
      meta: "REASON · SECURITY-INCIDENT-402",
      description:
        "Needed to protect backend downstream microservices from unauthenticated bulk scraping and DDoS traffic spikes.",
      keywords: ["scraping", "bulk", "unauthenticated", "abuse", "ddos"],
    },
    bug: {
      id: "bug-redis",
      meta: "BUG · ISSUE-884 · P1 CRITICAL · RESOLVED",
      description:
        "Strict rate limiter caused false-positive 429 errors and blocked legitimate burst traffic during checkout surges.",
      keywords: ["rate limit", "burst", "429", "checkout", "traffic"],
    },
    fix: {
      id: "fix-redis",
      meta: "FIX · PR #145 · MERGED · SHA 4b791cf",
      description:
        "Configured dynamic burst allowance and exponential jitter retry-after headers in rate limiter middleware.",
      keywords: ["burst allowance", "pr 145", "pr #145", "jitter", "fix"],
    },
  },

  // 3. Payment Service & gRPC Cluster
  {
    project: {
      id: "proj-core",
      meta: "PROJECT · MAIN REPOSITORY",
      description: "Primary backend monorepo and API platform services",
    },
    component: {
      id: "comp-payment",
      meta: "COMPONENT · PAYMENT-SERVICE",
      description: "Transaction processing service communicating with third-party banking APIs and ledger",
      keywords: ["payment", "payment-service", "checkout", "billing", "grpc"],
    },
    dependency: {
      id: "dep-grpc",
      meta: "DEPENDENCY · @GRPC/GRPC-JS v1.10.8",
      description: "High-performance RPC transport for internal inter-service payment confirmation calls",
      keywords: ["grpc", "protobuf", "rpc", "transport"],
    },
    decision: {
      id: "dec-grpc",
      meta: "DECISION · ADR-045 · 2026-03-01 · APPROVED",
      description:
        "Migrated internal payment service communication from REST JSON to gRPC Protobuf for deterministic latency.",
      keywords: ["grpc", "payment", "rest", "protobuf", "latency"],
    },
    reason: {
      id: "rsn-grpc",
      meta: "REASON · BENCHMARK-Q1",
      description:
        "REST JSON serialization and HTTP/1 connection handshakes were adding 80ms overhead to every payment confirmation.",
      keywords: ["serialization", "json", "overhead", "latency"],
    },
    bug: {
      id: "bug-grpc",
      meta: "BUG · ISSUE-952 · P1 · RESOLVED",
      description:
        "gRPC timeout errors occurred on payment confirmation during upstream bank gateway latency surges.",
      keywords: ["grpc timeout", "payment confirmation", "timeout", "bank", "error"],
    },
    fix: {
      id: "fix-grpc",
      meta: "FIX · PR #167 · MERGED · SHA 9c42f0a",
      description:
        "Increased gRPC timeout threshold to 5 seconds and added graceful retry fallback for pending payment validations.",
      keywords: ["timeout threshold", "5 seconds", "pr 167", "pr #167", "fix"],
    },
  },

  // 4. Bundler & DevServer Cluster
  {
    project: {
      id: "proj-core",
      meta: "PROJECT · MAIN REPOSITORY",
      description: "Primary backend monorepo and API platform services",
    },
    component: {
      id: "comp-bundler",
      meta: "COMPONENT · DEV-TOOLING",
      description: "Developer compilation pipeline, watcher daemon, and fast-refresh WebSocket server",
      keywords: ["dev-tooling", "bundler", "turbopack", "webpack", "watcher"],
    },
    dependency: {
      id: "dep-turbopack",
      meta: "DEPENDENCY · TURBOPACK v16.4.2",
      description: "Rust-based incremental bundler replacing legacy Webpack in Next.js development server",
      keywords: ["turbopack", "rust", "bundler", "compiler"],
    },
    decision: {
      id: "dec-turbopack",
      meta: "DECISION · ADR-042 · 2026-03-12 · APPROVED",
      description:
        "Adopted Turbopack as the default development bundler across all workspaces to reduce cold-start latency from 8.2s to under 1.1s.",
      keywords: ["turbopack", "bundler", "webpack", "hmr", "build"],
    },
    reason: {
      id: "rsn-turbopack",
      meta: "REASON · BENCHMARK-Q1 · DEVEX INITIATIVE",
      description:
        "Legacy Webpack configurations were encountering out-of-memory errors on monorepo micro-frontends during repeated HMR rebuilds.",
      keywords: ["turbopack", "webpack", "memory", "benchmark"],
    },
    bug: {
      id: "bug-turbopack",
      meta: "BUG · ISSUE-1082 · HIGH PRIORITY · RESOLVED",
      description:
        "Persistent memory leak in development server socket teardown causing gradual node process heap degradation after 2+ hours.",
      keywords: ["websocket", "leak", "turbopack", "socket", "teardown"],
    },
    fix: {
      id: "fix-turbopack",
      meta: "FIX · PR #214 · MERGED · COMMIT 8f3d1b9",
      description:
        "Added an explicit socket drain listener and forced TCP RST timeout hook during watcher teardown cycles.",
      keywords: ["socket drain", "tcp", "pr 214", "pr #214", "fix"],
    },
  },
];

async function seed() {
  const session = driver.session({ database });
  console.log(`\nSeeding Project → Component → Dependency → Bug → Fix graph into ${uri}...`);

  try {
    // 1. Create constraints
    console.log("Creating unique constraints...");
    const constraints = ["Project", "Component", "Dependency", "Decision", "Reason", "Bug", "Fix"];
    for (const label of constraints) {
      await session.run(`
        CREATE CONSTRAINT unique_${label.toLowerCase()}_id IF NOT EXISTS
        FOR (n:${label}) REQUIRE n.id IS UNIQUE
      `);
    }

    // 2. Ingest clusters and connect the multi-layered topology
    for (const cluster of GRAPH_DATA) {
      console.log(`Ingesting cluster for component: ${cluster.component.id}...`);

      const cypher = `
        // Create Project node
        MERGE (proj:Project {id: $proj.id})
        SET proj.meta = $proj.meta, proj.description = $proj.description

        // Create Component node
        MERGE (comp:Component {id: $comp.id})
        SET comp.meta = $comp.meta, comp.description = $comp.description, comp.keywords = $comp.keywords

        // Create Dependency node
        MERGE (dep:Dependency {id: $dep.id})
        SET dep.meta = $dep.meta, dep.description = $dep.description, dep.keywords = $dep.keywords

        // Create Decision node
        MERGE (d:Decision {id: $d.id})
        SET d.meta = $d.meta, d.description = $d.description, d.keywords = $d.keywords

        // Create Reason node
        MERGE (r:Reason {id: $r.id})
        SET r.meta = $r.meta, r.description = $r.description, r.keywords = $r.keywords

        // Create Bug node
        MERGE (b:Bug {id: $b.id})
        SET b.meta = $b.meta, b.description = $b.description, b.keywords = $b.keywords

        // Create Fix node
        MERGE (f:Fix {id: $f.id})
        SET f.meta = $f.meta, f.description = $f.description, f.keywords = $f.keywords

        // Connect Project -> Component -> Dependency -> Bug -> Fix
        MERGE (proj)-[:HAS_COMPONENT]->(comp)
        MERGE (comp)-[:DEPENDS_ON]->(dep)
        MERGE (comp)-[:HAD_BUG]->(b)
        MERGE (f)-[:FIXES]->(b)
        MERGE (f)-[:IMPLEMENTS]->(d)

        // Connect Decision -> Reason & Component
        MERGE (d)-[:MOTIVATED_BY]->(r)
        MERGE (d)-[:AFFECTS_COMPONENT]->(comp)
        MERGE (d)-[:RESOLVES]->(b)
      `;

      await session.run(cypher, {
        proj: cluster.project,
        comp: cluster.component,
        dep: cluster.dependency,
        d: cluster.decision,
        r: cluster.reason,
        b: cluster.bug,
        f: cluster.fix,
      });
    }

    const countResult = await session.run("MATCH (n) RETURN count(n) AS count");
    console.log(`\n✓ Graph seeded successfully! Total nodes: ${countResult.records[0].get("count")}`);

    const relResult = await session.run("MATCH ()-[r]->() RETURN count(r) AS relCount");
    console.log(`✓ Total relationships: ${relResult.records[0].get("relCount")}`);
  } catch (err) {
    console.error("Seeding failed:", err);
  } finally {
    await session.close();
    await driver.close();
  }
}

seed();
