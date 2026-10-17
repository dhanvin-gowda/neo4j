import { NextResponse } from "next/server";
import { runQuery } from "@/lib/neo4j";
import Groq from "groq-sdk";

interface EvidenceNode {
  id: string;
  type: "Decision" | "Reason" | "Bug" | "Fix";
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
      if (row.connectedId && row.connectedLabels && row.connectedProps) {
        const connectedType = (row.connectedLabels.find((l) =>
          ["Decision", "Reason", "Bug", "Fix"].includes(l)
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
              content: `You are RepoMind AI, an expert project memory and debugging assistant for developers.
Analyze the developer's question and answer using ONLY the supplied Neo4j graph evidence.
1. Directly state the matching bug, architectural decision, reason, or fix from the evidence.
2. Include specific issue IDs, PR numbers, or dates if mentioned in the metadata.
3. Be direct, clear, and concise (2-4 sentences max). Never fabricate information not present in the graph evidence.`,
            },
            {
              role: "user",
              content: `Developer Query: ${query}\n\nRetrieved Graph Evidence:\n${JSON.stringify(
                evidence,
                null,
                2
              )}`,
            },
          ],
          temperature: 0.2,
        });

        answer = completion.choices[0]?.message?.content?.trim() || "";
      } catch (llmErr) {
        console.warn("Groq completion failed, falling back to dynamic synthesis:", llmErr);
      }
    }

    // Dynamic fallback grounded strictly in the retrieved nodes
    if (!answer) {
      if (evidence.length === 0) {
        answer = `No matching records found in your Neo4j project memory for "${query}". Try searching for keywords like "logout", "grpc", "jwt", "rate limiter", "redis", or "memory".`;
      } else {
        const lines = evidence.map(
          (e) => `• [${e.type.toUpperCase()}] ${e.meta ? `${e.meta}: ` : ""}${e.description}`
        );
        answer = `Found ${evidence.length} record(s) in Neo4j project memory for "${query}":\n\n${lines.join(
          "\n"
        )}`;
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
