"use client";

import React, { useState, useRef, useEffect } from "react";

type NodeType = "Decision" | "Reason" | "Bug" | "Fix";

interface EvidenceNode {
  id: string;
  type: NodeType;
  meta: string;
  description: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: {
    nodesTraversed: number;
    time: number;
    confidence: string;
  };
}

// In-memory knowledge graph responses for realistic developer queries
const PRESET_QUERIES: Record<
  string,
  {
    answer: string;
    nodesTraversed: number;
    time: number;
    confidence: string;
    evidence: EvidenceNode[];
  }
> = {
  turbopack: {
    answer:
      "We adopted Turbopack in ADR-042 after monorepo benchmark runs showed Webpack HMR latency exceeding 8.2s. During the transition, an associated WebSocket teardown memory leak (Issue-1082) was identified and resolved in PR #214 by forcing TCP socket drains prior to AST cache updates.",
    nodesTraversed: 4,
    time: 0.32,
    confidence: "high confidence",
    evidence: [
      {
        id: "ev-1",
        type: "Decision",
        meta: "DECISION · ADR-042 · 2026-03-12 · APPROVED",
        description:
          "Adopted Turbopack as the default development bundler across all workspaces to reduce cold-start latency from 8.2s to under 1.1s.",
      },
      {
        id: "ev-2",
        type: "Reason",
        meta: "REASON · BENCHMARK-Q1 · DEVEX INITIATIVE",
        description:
          "Legacy Webpack configurations were encountering out-of-memory errors on monorepo micro-frontends during repeated HMR rebuilds.",
      },
      {
        id: "ev-3",
        type: "Bug",
        meta: "BUG · ISSUE-1082 · HIGH PRIORITY · RESOLVED",
        description:
          "Persistent memory leak in development server socket teardown causing gradual node process heap degradation after 2+ hours.",
      },
      {
        id: "ev-4",
        type: "Fix",
        meta: "FIX · PR #214 · MERGED · COMMIT 8f3d1b9",
        description:
          "Added an explicit socket drain listener and forced TCP RST timeout hook during watcher teardown cycles.",
      },
    ],
  },
  redis: {
    answer:
      "The Redis connection pool exhaustion bug (Issue-884) was traced to unclosed read replicas during traffic spikes. We migrated session caching to a distributed key-ring structure in ADR-038 and patched client pooling in PR #199.",
    nodesTraversed: 5,
    time: 0.41,
    confidence: "high confidence",
    evidence: [
      {
        id: "ev-r1",
        type: "Bug",
        meta: "BUG · ISSUE-884 · P1 CRITICAL · RESOLVED",
        description:
          "Connection pool exhaustion occurred during 99th percentile traffic surges due to non-recycled read-replica leases.",
      },
      {
        id: "ev-r2",
        type: "Reason",
        meta: "REASON · POST-MORTEM-INCIDENT-402",
        description:
          "Default ioredis client retry backoff was unbounded, flooding nodes with synthetic reconnection storms during failovers.",
      },
      {
        id: "ev-r3",
        type: "Fix",
        meta: "FIX · PR #199 · MERGED · SHA 4b791cf",
        description:
          "Introduced circuit breaker middleware with exponential jitter backoff and a hard ceiling of 50 active pooled connections per pod.",
      },
      {
        id: "ev-r4",
        type: "Decision",
        meta: "DECISION · ADR-038 · 2026-02-18 · APPROVED",
        description:
          "Standardized on Valkey/Redis cluster read-through cache with strict TTL quotas to prevent memory fragmentation.",
      },
    ],
  },
  auth: {
    answer:
      "In ADR-031, we transitioned from stateful database sessions to short-lived asymmetric Ed25519 JWT tokens with refresh token rotation. A race condition vulnerability during concurrent tab refresh was mitigated in PR #167.",
    nodesTraversed: 4,
    time: 0.28,
    confidence: "high confidence",
    evidence: [
      {
        id: "ev-a1",
        type: "Decision",
        meta: "DECISION · ADR-031 · 2026-01-24 · APPROVED",
        description:
          "Migrated auth layer to Ed25519 signed JWTs with 15-minute expiry and sliding-window refresh token rotation.",
      },
      {
        id: "ev-a2",
        type: "Reason",
        meta: "REASON · SCALE-ROADMAP-2026",
        description:
          "Central PostgreSQL session lookup was accounting for 34% of global query latency on authenticated API routes.",
      },
      {
        id: "ev-a3",
        type: "Bug",
        meta: "BUG · ISSUE-741 · SECURITY-AUDIT · RESOLVED",
        description:
          "Concurrent API calls from multi-tab browser clients triggered false-positive token reuse invalidation alerts.",
      },
      {
        id: "ev-a4",
        type: "Fix",
        meta: "FIX · PR #167 · MERGED · SHA e931fa2",
        description:
          "Implemented a 10-second grace window for consumed refresh tokens to handle parallel tab dispatch gracefully.",
      },
    ],
  },
};

// Seed conversation and initial graph evidence
const INITIAL_MESSAGES: Message[] = [
  {
    id: "seed-user-1",
    role: "user",
    content:
      "Why did we switch to Turbopack, and was the WebSocket memory leak resolved?",
  },
  {
    id: "seed-assistant-1",
    role: "assistant",
    content:
      "We adopted Turbopack in ADR-042 after monorepo benchmark runs showed Webpack HMR latency exceeding 8.2s. During the transition, an associated WebSocket teardown memory leak (Issue-1082) was identified and resolved in PR #214 by forcing TCP socket drains prior to AST cache updates.",
    meta: {
      nodesTraversed: 4,
      time: 0.32,
      confidence: "high confidence",
    },
  },
];

const INITIAL_EVIDENCE: EvidenceNode[] = PRESET_QUERIES.turbopack.evidence;

export default function DeveloperAssistantPage() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [evidence, setEvidence] = useState<EvidenceNode[]>(INITIAL_EVIDENCE);
  const [inputValue, setInputValue] = useState("");
  const [isTraversing, setIsTraversing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTraversing]);

  const handleAsk = (queryText?: string) => {
    const text = (queryText ?? inputValue).trim();
    if (!text || isTraversing) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTraversing(true);

    // Realistic traversal simulation
    setTimeout(() => {
      const lower = text.toLowerCase();
      let matchedData = PRESET_QUERIES.turbopack;

      if (
        lower.includes("redis") ||
        lower.includes("cache") ||
        lower.includes("pool") ||
        lower.includes("exhaustion")
      ) {
        matchedData = PRESET_QUERIES.redis;
      } else if (
        lower.includes("auth") ||
        lower.includes("token") ||
        lower.includes("jwt") ||
        lower.includes("session")
      ) {
        matchedData = PRESET_QUERIES.auth;
      } else {
        // Dynamic contextual response for arbitrary developer queries
        const randomTime = +(0.25 + Math.random() * 0.22).toFixed(2);
        const nodeCount = 3 + Math.floor(Math.random() * 3);
        matchedData = {
          answer: `Traversed project graph for "${text}". Found active architectural consensus and linked bug mitigation records across historical commits and ADR docs.`,
          nodesTraversed: nodeCount,
          time: randomTime,
          confidence: "high confidence",
          evidence: [
            {
              id: `ev-dyn-1-${Date.now()}`,
              type: "Decision",
              meta: `DECISION · ADR-0${30 + Math.floor(Math.random() * 20)} · 2026-02-14 · ACTIVE`,
              description: `Architecture record governing: ${text.slice(0, 75)}${text.length > 75 ? "…" : ""}. Standardized module contracts and boundary isolation.`,
            },
            {
              id: `ev-dyn-2-${Date.now()}`,
              type: "Reason",
              meta: "REASON · SYSTEM-PERF-ANALYSIS · Q1 REVIEW",
              description:
                "Identified non-deterministic latency spikes and thread contention in underlying microservice telemetry.",
            },
            {
              id: `ev-dyn-3-${Date.now()}`,
              type: "Bug",
              meta: `BUG · ISSUE-${1000 + Math.floor(Math.random() * 500)} · RESOLVED · QA VERIFIED`,
              description:
                "Intermittent race condition identified during concurrent IO dispatch under peak distributed loads.",
            },
            {
              id: `ev-dyn-4-${Date.now()}`,
              type: "Fix",
              meta: `FIX · PR #${200 + Math.floor(Math.random() * 90)} · MERGED · MAIN`,
              description:
                "Patched synchronization primitive with atomic read-write barriers and validated against regression test suite.",
            },
          ],
        };
      }

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: matchedData.answer,
        meta: {
          nodesTraversed: matchedData.nodesTraversed,
          time: matchedData.time,
          confidence: matchedData.confidence,
        },
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setEvidence(matchedData.evidence);
      setIsTraversing(false);
    }, 380);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  // Color mapping strictly according to requirements:
  // Decision: tan/beige (#F4EFE6)
  // Reason: same tan (#F4EFE6)
  // Bug: orange-tinted (#FDF0E6)
  // Fix: green-tinted (#EDF7ED)
  const getNodeColorStyles = (type: NodeType) => {
    switch (type) {
      case "Decision":
      case "Reason":
        return {
          backgroundColor: "#F4EFE6",
          borderColor: "#E5E3DA",
        };
      case "Bug":
        return {
          backgroundColor: "#FDF0E6",
          borderColor: "#F6D7C3",
        };
      case "Fix":
        return {
          backgroundColor: "#EDF7ED",
          borderColor: "#CDE9CE",
        };
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F7F6F2] font-sans antialiased text-[#1F1E1B] select-none">
      {/* ======================================================== */}
      {/* LEFT COLUMN: CHAT PANEL (flex: 1.4)                     */}
      {/* ======================================================== */}
      <section
        className="flex flex-col h-full border-r border-[#E5E3DA] bg-[#F7F6F2]"
        style={{ flex: "1.4 1 0%" }}
        aria-label="Developer Assistant Chat Panel"
      >
        {/* Header Bar */}
        <header className="px-7 py-5 border-b border-[#E5E3DA] bg-[#F7F6F2] shrink-0">
          <div className="text-[11px] font-semibold tracking-wider text-[#73726C] uppercase leading-tight">
            DEVELOPER ASSISTANT
          </div>
          <h1 className="text-xl font-bold text-[#1F1E1B] mt-0.5 tracking-tight">
            Project memory
          </h1>
        </header>

        {/* Scrollable Message Area */}
        <main className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div
                    className="max-w-[78%] px-4 py-3 text-sm leading-relaxed text-white rounded-[14px] rounded-br-[2px]"
                    style={{ backgroundColor: "#1F1E1B" }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className="flex flex-col items-start space-y-2 max-w-[85%]"
              >
                {/* Assistant Bubble */}
                <div className="px-4 py-3 text-sm leading-relaxed text-[#1F1E1B] bg-white border border-[#E5E3DA] rounded-[14px] rounded-bl-[2px]">
                  {msg.content}
                </div>

                {/* Assistant Metadata Row */}
                {msg.meta && (
                  <div className="flex items-center space-x-2 pl-1 text-xs text-[#73726C]">
                    <span>
                      {msg.meta.nodesTraversed} nodes traversed · {msg.meta.time}s
                    </span>
                    <span>•</span>
                    <span
                      className="px-2 py-0.5 text-[11px] font-medium rounded-full"
                      style={{
                        backgroundColor: "#D4EFDF",
                        color: "#145A32",
                      }}
                    >
                      {msg.meta.confidence}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* In-flight Traversal Indicator */}
          {isTraversing && (
            <div className="flex flex-col items-start space-y-2 max-w-[85%]">
              <div className="px-4 py-3 text-sm leading-relaxed text-[#73726C] bg-white border border-[#E5E3DA] rounded-[14px] rounded-bl-[2px] flex items-center space-x-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[#73726C] animate-pulse" />
                <span>Traversing knowledge graph...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Suggested Quick Inquiries */}
        <div className="px-7 pt-2 pb-1 flex flex-wrap items-center gap-2 text-xs text-[#73726C] shrink-0">
          <span className="font-medium text-[11px] uppercase tracking-wide">
            Try:
          </span>
          <button
            type="button"
            onClick={() => handleAsk("Why did we switch to Turbopack?")}
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs"
          >
            Turbopack migration
          </button>
          <button
            type="button"
            onClick={() =>
              handleAsk("What caused the Redis connection leak bug?")
            }
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs"
          >
            Redis connection leak
          </button>
          <button
            type="button"
            onClick={() =>
              handleAsk("What was the decision on auth JWT refresh tokens?")
            }
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs"
          >
            Auth token rotation
          </button>
        </div>

        {/* Fixed Input Bar */}
        <footer className="p-6 border-t border-[#E5E3DA] bg-[#F7F6F2] shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk();
            }}
            className="flex items-center gap-3"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a decision, bug, or dependency…"
              className="flex-1 px-4 py-3 text-sm text-[#1F1E1B] bg-white border border-[#E5E3DA] rounded-[12px] placeholder-[#8A8880] focus:outline-none focus:border-[#1F1E1B] transition-colors"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isTraversing}
              className="px-6 py-3 text-sm font-medium text-white rounded-[10px] transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
              style={{ backgroundColor: "#1F1E1B" }}
            >
              Ask
            </button>
          </form>
        </footer>
      </section>

      {/* ======================================================== */}
      {/* RIGHT COLUMN: EVIDENCE PANEL (flex: 1)                  */}
      {/* ======================================================== */}
      <aside
        className="flex flex-col h-full bg-[#F7F6F2]"
        style={{ flex: "1 1 0%" }}
        aria-label="Graph Evidence Panel"
      >
        {/* Header Bar */}
        <header className="px-6 py-5 border-b border-[#E5E3DA] bg-[#F7F6F2] flex items-center justify-between shrink-0">
          <div className="text-[11px] font-semibold tracking-wider text-[#73726C] uppercase leading-tight">
            GRAPH EVIDENCE
          </div>
          <span className="text-xs font-medium text-[#73726C] px-2 py-0.5 rounded-[6px] border border-[#E5E3DA] bg-white">
            {evidence.length} nodes
          </span>
        </header>

        {/* Vertical Stack of Color-Coded Cards */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {evidence.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-xs text-[#73726C] border border-dashed border-[#E5E3DA] rounded-[8px] p-6">
              Ask a question to inspect traversed graph nodes and contextual
              evidence.
            </div>
          ) : (
            evidence.map((node) => {
              const styles = getNodeColorStyles(node.type);

              return (
                <article
                  key={node.id}
                  className="p-4 border rounded-[8px] transition-colors"
                  style={{
                    backgroundColor: styles.backgroundColor,
                    borderColor: styles.borderColor,
                    boxShadow: "none",
                  }}
                >
                  {/* Small gray label line */}
                  <div className="text-[11px] font-semibold text-[#73726C] tracking-wide uppercase leading-tight">
                    {node.meta}
                  </div>

                  {/* Node description text */}
                  <p className="mt-1.5 text-sm text-[#1F1E1B] leading-relaxed">
                    {node.description}
                  </p>
                </article>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}

