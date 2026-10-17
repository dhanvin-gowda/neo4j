import { NextResponse } from "next/server";
import { runQuery } from "@/lib/neo4j";
import Groq from "groq-sdk";

interface EvidenceNode {
  id: string;
  type: "Decision" | "Reason" | "Bug" | "Fix";
  meta: string;
  description: string;
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const body = await req.json();
    const query = (body.bug || body.question || "").trim();

    if (!query) {
      return NextResponse.json(
        { error: "Provide a question or bug description." },
        { status: 400 }
      );
    }

    const queryTokens = query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    // 1. Query live Neo4j database for matching nodes and connected evidence
    const cypher = `
      MATCH (n)
      WHERE (n:Decision OR n:Reason OR n:Bug OR n:Fix OR labels(n) <> [])
      AND (
        any(k IN keys(n) WHERE toLower(toString(n[k])) CONTAINS toLower($query))
        OR ANY(token IN $tokens WHERE toLower(coalesce(n.description, '')) CONTAINS token)
        OR ANY(token IN $tokens WHERE toLower(coalesce(n.meta, '')) CONTAINS token)
        OR ANY(token IN $tokens WHERE ANY(kw IN coalesce(n.keywords, []) WHERE toLower(toString(kw)) CONTAINS token))
      )
      OPTIONAL MATCH (n)-[r]-(connected)
      WHERE connected:Decision OR connected:Reason OR connected:Bug OR connected:Fix OR labels(connected) <> []
      RETURN DISTINCT
        elementId(n) AS id,
        labels(n) AS labels,
        properties(n) AS props,
        elementId(connected) AS connectedId,
        labels(connected) AS connectedLabels,
        properties(connected) AS connectedProps
      LIMIT 10
    `;

    const records = await runQuery<{
      id: string;
      labels: string[];
      props: Record<string, any>;
      connectedId?: string;
      connectedLabels?: string[];
      connectedProps?: Record<string, any>;
    }>(cypher, { query, tokens: queryTokens });

    const evidenceMap = new Map<string, EvidenceNode>();

    records.forEach((row) => {
      // Primary matched node
      if (row.id && row.labels) {
        const type = (row.labels.find((l) =>
          ["Decision", "Reason", "Bug", "Fix"].includes(l)
        ) || row.labels[0] || "Decision") as EvidenceNode["type"];

        if (!evidenceMap.has(row.id)) {
          evidenceMap.set(row.id, {
            id: String(row.id),
            type,
            meta: String(
              row.props.meta ||
              row.props.title ||
              row.props.name ||
              row.props.issueId ||
              `${type.toUpperCase()} · LIVE GRAPH`
            ),
            description: String(
              row.props.description ||
              row.props.summary ||
              row.props.message ||
              JSON.stringify(row.props)
            ),
          });
        }
      }

      // Connected graph node (1-hop traversal)
      if (row.connectedId && row.connectedLabels) {
        const connectedType = (row.connectedLabels.find((l) =>
          ["Decision", "Reason", "Bug", "Fix"].includes(l)
        ) || row.connectedLabels[0] || "Evidence") as EvidenceNode["type"];

        if (!evidenceMap.has(row.connectedId) && row.connectedProps) {
          evidenceMap.set(row.connectedId, {
            id: String(row.connectedId),
            type: connectedType,
            meta: String(
              row.connectedProps.meta ||
              row.connectedProps.title ||
              row.connectedProps.name ||
              row.connectedProps.issueId ||
              `${connectedType.toUpperCase()} · LINKED EVIDENCE`
            ),
            description: String(
              row.connectedProps.description ||
              row.connectedProps.summary ||
              row.connectedProps.message ||
              JSON.stringify(row.connectedProps)
            ),
          });
        }
      }
    });

    const evidence = Array.from(evidenceMap.values());
    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));

    // 2. Synthesize answer using Groq LLM if key is configured, else direct graph synthesis
    let answer = "";
    const groqApiKey = process.env.GROQ_API_KEY;

    if (groqApiKey) {
      try {
        const groq = new Groq({ apiKey: groqApiKey });
        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: `You are RepoMind AI, an expert project memory and debugging assistant for developers.
Use the supplied Neo4j graph evidence for claims about past decisions, bugs, reasons, and fixes.
If evidence is present, clearly explain the cause, decision, and fix. If no relevant evidence exists in the graph, state that clearly without hallucinating fake commit hashes or PRs.`,
            },
            {
              role: "user",
              content: `Developer Query: ${query}\n\nTraversed Graph Evidence:\n${JSON.stringify(
                evidence
              )}`,
            },
          ],
        });
        answer = completion.choices[0]?.message?.content || "";
      } catch (llmErr) {
        console.warn("Groq completion failed, falling back to direct synthesis:", llmErr);
      }
    }

    // Direct grounded synthesis fallback
    if (!answer) {
      if (evidence.length === 0) {
        answer = `No matching records found in your Neo4j project memory graph for "${query}". You can add new nodes using the "+ Store Node" button or run the seed script to ingest project memory records.`;
      } else {
        const decisionNode = evidence.find((e) => e.type === "Decision");
        const bugNode = evidence.find((e) => e.type === "Bug");
        const fixNode = evidence.find((e) => e.type === "Fix");
        const reasonNode = evidence.find((e) => e.type === "Reason");

        if (decisionNode && bugNode && fixNode) {
          answer = `Based on Neo4j graph traversal: ${decisionNode.description} This addressed ${bugNode.description} which was resolved in ${fixNode.meta}: ${fixNode.description}`;
        } else if (decisionNode) {
          answer = `Based on Neo4j graph traversal: ${decisionNode.description} ${
            reasonNode ? `Context: ${reasonNode.description}` : ""
          }`;
        } else if (bugNode && fixNode) {
          answer = `Identified bug record in Neo4j: ${bugNode.description} Resolved in ${fixNode.meta}: ${fixNode.description}`;
        } else {
          answer = `Traversed ${evidence.length} connected record(s) in your live Neo4j AuraDB graph matching "${query}". See the traversed graph cards on the right.`;
        }
      }
    }

    return NextResponse.json({
      bug: query,
      answer,
      contextFound: evidence.length > 0,
      evidence,
      nodesTraversed: evidence.length,
      time: durationSeconds,
      confidence:
        evidence.length > 0 ? "high confidence" : "no matching evidence",
    });
  } catch (error: any) {
    console.error("Live Neo4j query error:", error);
    return NextResponse.json(
      {
        error: "Database query failed. Check Neo4j connection and server logs.",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
