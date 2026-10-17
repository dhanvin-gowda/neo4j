import { NextResponse } from "next/server";
import { runQuery } from "@/lib/neo4j";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, meta, description, relatedToId, relationship } = body;

    if (!type || !["Decision", "Reason", "Bug", "Fix"].includes(type)) {
      return NextResponse.json(
        { error: "type must be one of 'Decision', 'Reason', 'Bug', 'Fix'" },
        { status: 400 }
      );
    }

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "description string is required" },
        { status: 400 }
      );
    }

    const id = body.id || `node-${Date.now()}`;
    const nodeMeta =
      meta ||
      `${type.toUpperCase()} · MANUAL ENTRY · ${
        new Date().toISOString().split("T")[0]
      }`;

    const cypher = `
      MERGE (n:${type} {id: $id})
      SET n.meta = $meta, n.description = $description, n.createdAt = datetime()
      RETURN n.id AS id, labels(n) AS labels, n.meta AS meta, n.description AS description
    `;

    const records = await runQuery(cypher, { id, meta: nodeMeta, description });

    if (relatedToId && relationship) {
      const relCypher = `
        MATCH (a {id: $id}), (b {id: $relatedToId})
        MERGE (a)-[r:${relationship.toUpperCase()}]->(b)
        RETURN type(r) AS relType
      `;
      await runQuery(relCypher, { id, relatedToId });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully stored ${type} node in Neo4j AuraDB!`,
      node: records[0],
    });
  } catch (err: any) {
    console.error("Neo4j /api/store error:", err);
    return NextResponse.json(
      { error: "Failed to store node in Neo4j", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
