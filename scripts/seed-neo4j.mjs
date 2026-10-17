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
  // Turbopack Cluster
  {
    decision: {
      id: "dec-turbopack",
      meta: "DECISION · ADR-042 · 2026-03-12 · APPROVED",
      description:
        "Adopted Turbopack as the default development bundler across all workspaces to reduce cold-start latency from 8.2s to under 1.1s.",
      keywords: ["turbopack", "bundler", "webpack", "hmr", "build", "performance"],
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
      keywords: ["fix", "socket", "pr 214", "tcp"],
    },
  },

  // Redis Cluster
  {
    decision: {
      id: "dec-redis",
      meta: "DECISION · ADR-038 · 2026-02-18 · APPROVED",
      description:
        "Standardized on Valkey/Redis cluster read-through cache with strict TTL quotas to prevent memory fragmentation.",
      keywords: ["redis", "cache", "valkey", "cluster", "ttl", "memory"],
    },
    reason: {
      id: "rsn-redis",
      meta: "REASON · POST-MORTEM-INCIDENT-402",
      description:
        "Default ioredis client retry backoff was unbounded, flooding nodes with synthetic reconnection storms during failovers.",
      keywords: ["redis", "failover", "ioredis", "reconnection"],
    },
    bug: {
      id: "bug-redis",
      meta: "BUG · ISSUE-884 · P1 CRITICAL · RESOLVED",
      description:
        "Connection pool exhaustion occurred during 99th percentile traffic surges due to non-recycled read-replica leases.",
      keywords: ["redis", "pool", "exhaustion", "replica", "leak"],
    },
    fix: {
      id: "fix-redis",
      meta: "FIX · PR #199 · MERGED · SHA 4b791cf",
      description:
        "Introduced circuit breaker middleware with exponential jitter backoff and a hard ceiling of 50 active pooled connections per pod.",
      keywords: ["circuit breaker", "redis", "pr 199", "backoff"],
    },
  },

  // Auth Cluster
  {
    decision: {
      id: "dec-auth",
      meta: "DECISION · ADR-031 · 2026-01-24 · APPROVED",
      description:
        "Migrated auth layer to Ed25519 signed JWTs with 15-minute expiry and sliding-window refresh token rotation.",
      keywords: ["auth", "jwt", "token", "ed25519", "refresh", "rotation", "session"],
    },
    reason: {
      id: "rsn-auth",
      meta: "REASON · SCALE-ROADMAP-2026",
      description:
        "Central PostgreSQL session lookup was accounting for 34% of global query latency on authenticated API routes.",
      keywords: ["postgres", "session", "latency", "scale"],
    },
    bug: {
      id: "bug-auth",
      meta: "BUG · ISSUE-741 · SECURITY-AUDIT · RESOLVED",
      description:
        "Concurrent API calls from multi-tab browser clients triggered false-positive token reuse invalidation alerts.",
      keywords: ["auth", "race condition", "multitab", "token reuse", "security"],
    },
    fix: {
      id: "fix-auth",
      meta: "FIX · PR #167 · MERGED · SHA e931fa2",
      description:
        "Implemented a 10-second grace window for consumed refresh tokens to handle parallel tab dispatch gracefully.",
      keywords: ["grace window", "refresh token", "pr 167", "auth"],
    },
  },

  // Neo4j Knowledge Graph Optimization
  {
    decision: {
      id: "dec-neo4j",
      meta: "DECISION · ADR-049 · 2026-04-02 · APPROVED",
      description:
        "Configured Neo4j full-text schema indexes on node description and metadata fields to achieve sub-50ms subgraph traversal queries.",
      keywords: ["neo4j", "graph", "cypher", "index", "traversal", "search"],
    },
    reason: {
      id: "rsn-neo4j",
      meta: "REASON · QUERY-BENCHMARK-V2",
      description:
        "Unindexed label scans on large graph topologies were causing query latency spikes above 450ms under concurrent developer assistant sessions.",
      keywords: ["neo4j", "index scan", "latency", "benchmark"],
    },
    bug: {
      id: "bug-neo4j",
      meta: "BUG · ISSUE-1190 · RESOLVED",
      description:
        "Complex multi-hop Cypher queries were exhausting transaction memory limits during graph traversals exceeding 5 degrees of separation.",
      keywords: ["cypher", "memory limit", "multi-hop", "degrees"],
    },
    fix: {
      id: "fix-neo4j",
      meta: "FIX · PR #288 · MERGED · COMMIT 9c42f0a",
      description:
        "Restricted relationship expansion to targeted domain edge types and capped maximum traversal depth at 3 hops.",
      keywords: ["pr 288", "traversal depth", "cypher optimization"],
    },
  },
];

async function seed() {
  const session = driver.session({ database });
  console.log(`\nSeeding project memory knowledge graph into ${uri}...`);

  try {
    // 1. Create constraints & indexes
    console.log("Creating unique constraints and indexes...");
    await session.run(`
      CREATE CONSTRAINT unique_decision_id IF NOT EXISTS
      FOR (d:Decision) REQUIRE d.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT unique_reason_id IF NOT EXISTS
      FOR (r:Reason) REQUIRE r.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT unique_bug_id IF NOT EXISTS
      FOR (b:Bug) REQUIRE b.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT unique_fix_id IF NOT EXISTS
      FOR (f:Fix) REQUIRE f.id IS UNIQUE
    `);

    // 2. Ingest clusters
    for (const cluster of GRAPH_DATA) {
      console.log(`Ingesting cluster: ${cluster.decision.id}...`);

      const cypher = `
        MERGE (d:Decision {id: $d.id})
        SET d.meta = $d.meta, d.description = $d.description, d.keywords = $d.keywords

        MERGE (r:Reason {id: $r.id})
        SET r.meta = $r.meta, r.description = $r.description, r.keywords = $r.keywords

        MERGE (b:Bug {id: $b.id})
        SET b.meta = $b.meta, b.description = $b.description, b.keywords = $b.keywords

        MERGE (f:Fix {id: $f.id})
        SET f.meta = $f.meta, f.description = $f.description, f.keywords = $f.keywords

        // Create relationships
        MERGE (d)-[:MOTIVATED_BY]->(r)
        MERGE (f)-[:FIXES]->(b)
        MERGE (f)-[:IMPLEMENTS]->(d)
        MERGE (d)-[:RESOLVES]->(b)
      `;

      await session.run(cypher, {
        d: cluster.decision,
        r: cluster.reason,
        b: cluster.bug,
        f: cluster.fix,
      });
    }

    // Verify count
    const countResult = await session.run("MATCH (n) RETURN count(n) AS count");
    const count = countResult.records[0].get("count").toString();
    console.log(`\n✓ Graph seeded successfully! Total nodes in database: ${count}`);

    const relResult = await session.run("MATCH ()-[r]->() RETURN count(r) AS relCount");
    const relCount = relResult.records[0].get("relCount").toString();
    console.log(`✓ Total relationships in database: ${relCount}`);
  } catch (err) {
    console.error("Seeding failed:", err);
  } finally {
    await session.close();
    await driver.close();
  }
}

seed();
