import { NextResponse } from "next/server";
import { runQuery } from "@/lib/neo4j";
import Groq from "groq-sdk";

interface EvidenceNode {
  id: string;
  type: "Decision" | "Reason" | "Bug" | "Fix" | "Component" | "Dependency" | "Project";
  meta: string;
  description: string;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "because", "as", "what",
  "which", "this", "that", "these", "those", "then", "just", "so", "than",
  "such", "both", "through", "about", "for", "is", "of", "while", "during",
  "to", "from", "in", "out", "on", "off", "again", "further", "once",
  "here", "there", "when", "where", "why", "how", "all", "any", "each",
  "few", "more", "most", "other", "some", "no", "nor", "not", "only",
  "own", "same", "too", "very", "can", "will", "don", "should", "now",
  "was", "were", "did", "does", "do", "we", "i", "you", "they", "it",
  "its", "our", "their", "give", "me", "related", "dataset", "query", "cause", "caused"
]);

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

    // Extract meaningful semantic tokens, stripping English stop words
    const queryTokens = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 2 && !STOP_WORDS.has(w));

    const tokensToSearch = queryTokens.length > 0 ? queryTokens : [query.toLowerCase()];

    // 1. Query live Neo4j database matching specific semantic keywords, ranked by relevance
    const cypher = `
      MATCH (n)
      WHERE (n:Decision OR n:Reason OR n:Bug OR n:Fix OR labels(n) <> [])
      AND ANY(token IN $tokens WHERE
        toLower(coalesce(n.description, '')) CONTAINS token
        OR toLower(coalesce(n.meta, '')) CONTAINS token
        OR toLower(coalesce(n.title, '')) CONTAINS token
        OR toLower(coalesce(n.name, '')) CONTAINS token
        OR toLower(coalesce(n.issueId, '')) CONTAINS token
        OR ANY(kw IN coalesce(n.keywords, []) WHERE toLower(toString(kw)) CONTAINS token)
      )
      WITH n,
           size([token IN $tokens WHERE toLower(coalesce(n.description, '')) CONTAINS token]) +
           size([token IN $tokens WHERE toLower(coalesce(n.meta, '')) CONTAINS token]) AS score
      ORDER BY score DESC
      LIMIT 5
      OPTIONAL MATCH (n)-[r]-(connected)
      WHERE connected:Decision OR connected:Reason OR connected:Bug OR connected:Fix OR labels(connected) <> []
      RETURN DISTINCT
        elementId(n) AS id,
        labels(n) AS labels,
        properties(n) AS props,
        elementId(connected) AS connectedId,
        labels(connected) AS connectedLabels,
        properties(connected) AS connectedProps
    `;

    const records = await runQuery<{
      id: string;
      labels: string[];
      props: Record<string, any>;
      connectedId?: string;
      connectedLabels?: string[];
      connectedProps?: Record<string, any>;
    }>(cypher, { query, tokens: tokensToSearch });

    const evidenceMap = new Map<string, EvidenceNode>();

    const recognizedTypes = ["Component", "Dependency", "Project", "Decision", "Reason", "Bug", "Fix"];

    records.forEach((row) => {
      // Primary matched node
      if (row.id && row.labels) {
        const type = (row.labels.find((l) =>
          recognizedTypes.includes(l)
        ) || row.labels[0] || "Component") as EvidenceNode["type"];

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
      if (row.connectedId && row.connectedLabels && row.connectedProps) {
        const connectedType = (row.connectedLabels.find((l) =>
          recognizedTypes.includes(l)
        ) || row.connectedLabels[0] || "Fix") as EvidenceNode["type"];

        if (!evidenceMap.has(row.connectedId)) {
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

    // 2. Synthesize answer using Groq LLM (openai/gpt-oss-20b) with accurate prompt
    let answer = "";
    const groqApiKey = process.env.GROQ_API_KEY;

    if (groqApiKey && evidence.length > 0) {
      try {
        const groq = new Groq({ apiKey: groqApiKey });
        const completion = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: `You are a developer assistant. Answer the user's question in 1 or 2 brief sentences in plain text only.
Rules:
- Plain text only: do not use markdown, asterisks, bullet points, or lists.
- Do not mention or reference the words "Decision", "Reason", or internal node IDs.
- If asked why a component was changed and if it is related to an API error, explain why it was changed and directly address whether the error is related and how it was resolved based on the evidence.
- Directly state the issue and the fix or outcome concisely based on the evidence.`,
            },
            {
              role: "user",
              content: `Query: ${query}\n\nEvidence:\n${JSON.stringify(evidence)}`,
            },
          ],
          temperature: 0.1,
        });

        answer = completion.choices[0]?.message?.content?.trim() || "";
        // Strip any residual markdown asterisks or bullet prefixes if present
        answer = answer.replace(/[*_#`]/g, "").replace(/^[-•]\s*/gm, "").trim();
      } catch (llmErr) {
        console.warn("Groq completion failed, falling back to dynamic synthesis:", llmErr);
      }
    }

    // Dynamic fallback grounded strictly in the retrieved nodes in brief plain text
    if (!answer) {
      if (evidence.length === 0) {
        answer = `No matching records found in project memory for "${query}".`;
      } else {
        const bugNode = evidence.find((e) => e.type === "Bug");
        const fixNode = evidence.find((e) => e.type === "Fix");
        if (bugNode && fixNode) {
          answer = `${bugNode.description}, which was resolved by: ${fixNode.description}.`;
        } else {
          answer = evidence[0].description;
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
