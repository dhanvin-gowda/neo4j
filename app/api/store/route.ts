import { NextResponse } from "next/server";
import neo4j from "neo4j-driver";
import Groq from "groq-sdk";

export const runtime = "nodejs";

const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(
    process.env.NEO4J_USERNAME!,
    process.env.NEO4J_PASSWORD!
  )
);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const body = await req.json();
    const bug =
      typeof body.bug === "string" ? body.bug.trim() : "";

    if (!bug || bug.length > 2000) {
      return NextResponse.json(
        { error: "Provide a bug description (max 2000 characters)." },
        { status: 400 }
      );
    }

    const session = driver.session();

    let evidence: {
      id: string;
      type: string;
      meta: string;
      description: string;
    }[] = [];

    try {
      const result = await session.run(
        `MATCH (n)
         WHERE any(k IN keys(n)
           WHERE toLower(toString(n[k])) CONTAINS toLower($bug))
         RETURN elementId(n) AS id,
                labels(n) AS labels,
                properties(n) AS props
         LIMIT 10`,
        { bug }
      );

      evidence = result.records.map((record) => {
        const labels = record.get("labels") as string[];
        const props = record.get("props") as Record<string, unknown>;

        const type =
          labels.find((label) =>
            ["Decision", "Reason", "Bug", "Fix"].includes(label)
          ) ?? labels[0] ?? "Evidence";

        return {
          id: String(record.get("id")),
          type,
          meta: String(
            props.title ??
            props.name ??
            props.issueId ??
            labels.join(" · ")
          ),
          description: String(
            props.description ??
            props.summary ??
            props.message ??
            JSON.stringify(props)
          ),
        };
      });
    } finally {
      await session.close();
    }

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `You are RepoMind AI, a repository debugging assistant.
Use only the supplied evidence for claims about past project decisions,
bugs, and fixes. Clearly distinguish evidence from hypotheses.
If evidence is missing, say so. Never invent issue IDs, PRs, or verified fixes.
Give a concise answer with the likely cause, recommended next step,
and relevant evidence.`,
        },
        {
          role: "user",
          content: `Bug report:\n${bug}\n\nGraph evidence:\n${JSON.stringify(evidence)}`,
        },
      ],
    });

    return NextResponse.json({
      bug,
      answer: completion.choices[0]?.message?.content ?? "",
      contextFound: evidence.length > 0,
      evidence,
      nodesTraversed: evidence.length,
      time: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      confidence: evidence.length > 0
        ? "evidence available"
        : "no matching evidence",
    });
  } catch (error) {
    console.error("RepoMind debug error:", error);

    return NextResponse.json(
      { error: "Debugging failed. Check server logs and configuration." },
      { status: 500 }
    );
  }
}