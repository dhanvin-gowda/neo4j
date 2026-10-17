import neo4j, { Driver } from "neo4j-driver";

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USERNAME || "neo4j";
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !password) {
      throw new Error("Missing NEO4J_URI or NEO4J_PASSWORD in environment variables");
    }

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 20000, // 20s
    });
  }
  return driver;
}

export async function runQuery<T = any>(
  cypher: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  const d = getNeo4jDriver();
  const session = d.session({
    database: process.env.NEO4J_DATABASE || "neo4j",
  });

  try {
    const result = await session.run(cypher, params);
    return result.records.map((record) => record.toObject() as T);
  } finally {
    await session.close();
  }
}
