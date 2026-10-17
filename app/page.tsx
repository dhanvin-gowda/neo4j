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

export default function DeveloperAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [evidence, setEvidence] = useState<EvidenceNode[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTraversing, setIsTraversing] = useState(false);

  // Store Node Modal state
  const [isStoreOpen, setIsStoreOpen] = useState(false);
  const [newType, setNewType] = useState<NodeType>("Decision");
  const [newMeta, setNewMeta] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [isStoring, setIsStoring] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTraversing]);

  // LIVE QUERY: Sends user query to the database and displays the response
  const handleAsk = async (queryText?: string) => {
    const text = (queryText ?? inputValue).trim();
    if (!text || isTraversing) return;

    // 1. Append user message to chat stream
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      },
    ]);

    setInputValue("");
    setIsTraversing(true);

    try {
      // 2. Send query to backend live database endpoint
      const response = await fetch("/api/debug", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bug: text }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to query Neo4j database.");
      }

      // 3. Render real assistant response from database
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.answer || "No response generated from graph evidence.",
          meta: {
            nodesTraversed: data.nodesTraversed ?? (data.evidence?.length || 0),
            time: typeof data.time === "number" ? data.time : 0,
            confidence: data.confidence ?? "high confidence",
          },
        },
      ]);

      // 4. Render real traversed graph evidence cards
      const validTypes: NodeType[] = ["Decision", "Reason", "Bug", "Fix"];
      const returnedEvidence: EvidenceNode[] = Array.isArray(data.evidence)
        ? data.evidence.map((node: any, index: number) => ({
            id: String(node.id ?? `evidence-${index}`),
            type: validTypes.includes(node.type as NodeType)
              ? (node.type as NodeType)
              : "Decision",
            meta: String(node.meta ?? "GRAPH EVIDENCE"),
            description: String(
              node.description ?? "No description available."
            ),
          }))
        : [];

      setEvidence(returnedEvidence);
    } catch (error: any) {
      console.error("Ask query failed:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Error querying database: ${
            error?.message || "Check server connection and try again."
          }`,
        },
      ]);
    } finally {
      setIsTraversing(false);
    }
  };

  // STORE NODE: Persists custom node directly into live Neo4j AuraDB
  const handleStoreNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDesc.trim() || isStoring) return;

    setIsStoring(true);
    try {
      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          meta:
            newMeta.trim() ||
            `${newType.toUpperCase()} · MANUAL ENTRY · ${
              new Date().toISOString().split("T")[0]
            }`,
          description: newDesc.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const created: EvidenceNode = {
          id: data.node.id,
          type: newType,
          meta: data.node.meta,
          description: data.node.description,
        };
        setEvidence((prev) => [created, ...prev]);
        setNewMeta("");
        setNewDesc("");
        setIsStoreOpen(false);
      }
    } catch (err) {
      console.error("Failed to store node:", err);
    } finally {
      setIsStoring(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

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
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto px-4">
              <div className="w-10 h-10 rounded-full border border-[#E5E3DA] bg-white flex items-center justify-center text-[#1F1E1B] font-bold text-sm mb-3">
                PM
              </div>
              <h2 className="text-base font-bold text-[#1F1E1B]">
                Connected to Neo4j Project Memory
              </h2>
              <p className="mt-1 text-xs text-[#73726C] leading-relaxed">
                Ask about past engineering decisions, bug post-mortems, or PR
                fixes. Every query runs live Cypher traversals against your
                Neo4j database.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
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
                  <div className="px-4 py-3 text-sm leading-relaxed text-[#1F1E1B] bg-white border border-[#E5E3DA] rounded-[14px] rounded-bl-[2px]">
                    {msg.content}
                  </div>

                  {msg.meta && (
                    <div className="flex items-center space-x-2 pl-1 text-xs text-[#73726C]">
                      <span>
                        {msg.meta.nodesTraversed} nodes traversed ·{" "}
                        {msg.meta.time}s
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
            })
          )}

          {/* In-flight Traversal Indicator */}
          {isTraversing && (
            <div className="flex flex-col items-start space-y-2 max-w-[85%]">
              <div className="px-4 py-3 text-sm leading-relaxed text-[#73726C] bg-white border border-[#E5E3DA] rounded-[14px] rounded-bl-[2px] flex items-center space-x-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[#73726C] animate-pulse" />
                <span>Traversing live Neo4j database...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Suggested Live Query Chips */}
        <div className="px-7 pt-2 pb-1 flex flex-wrap items-center gap-2 text-xs text-[#73726C] shrink-0">
          <span className="font-medium text-[11px] uppercase tracking-wide">
            Try:
          </span>
          <button
            type="button"
            onClick={() =>
              handleAsk("Why were users logged out unexpectedly every 5 minutes?")
            }
            disabled={isTraversing}
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs disabled:opacity-40"
          >
            5-min logout bug
          </button>
          <button
            type="button"
            onClick={() =>
              handleAsk("What was the fix for gRPC timeout errors on payment confirmation?")
            }
            disabled={isTraversing}
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs disabled:opacity-40"
          >
            gRPC payment timeout
          </button>
          <button
            type="button"
            onClick={() =>
              handleAsk("What caused memory usage spikes under concurrent logins?")
            }
            disabled={isTraversing}
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs disabled:opacity-40"
          >
            Concurrent login memory spike
          </button>
          <button
            type="button"
            onClick={() =>
              handleAsk("Why did we add rate limiting to api-gateway?")
            }
            disabled={isTraversing}
            className="px-2.5 py-1 rounded-[8px] bg-white border border-[#E5E3DA] hover:border-[#1F1E1B] hover:text-[#1F1E1B] transition-colors cursor-pointer text-xs disabled:opacity-40"
          >
            API gateway rate limiter
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
              {isTraversing ? "Asking..." : "Ask"}
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
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold tracking-wider text-[#73726C] uppercase leading-tight">
              GRAPH EVIDENCE
            </div>
            <span className="text-xs font-medium text-[#73726C] px-2 py-0.5 rounded-[6px] border border-[#E5E3DA] bg-white">
              {evidence.length} nodes
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsStoreOpen(true)}
            className="text-xs font-medium text-[#1F1E1B] px-2.5 py-1 rounded-[6px] border border-[#E5E3DA] bg-white hover:bg-[#E5E3DA] transition-colors cursor-pointer"
          >
            + Store Node
          </button>
        </header>

        {/* Store Node Modal */}
        {isStoreOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-none">
            <div
              className="w-full max-w-md bg-[#F7F6F2] border border-[#E5E3DA] rounded-[12px] p-6 text-[#1F1E1B]"
              style={{ boxShadow: "none" }}
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E3DA]">
                <div>
                  <div className="text-[11px] font-semibold text-[#73726C] uppercase tracking-wider">
                    NEO4J AURADB
                  </div>
                  <h3 className="text-base font-bold text-[#1F1E1B]">
                    Store Graph Node
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStoreOpen(false)}
                  className="text-lg text-[#73726C] hover:text-[#1F1E1B] p-1 leading-none cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleStoreNode} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#73726C] uppercase tracking-wide mb-1">
                    Node Type
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as NodeType)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#E5E3DA] rounded-[8px] outline-none"
                  >
                    <option value="Decision">Decision (Tan / Beige)</option>
                    <option value="Reason">Reason (Tan / Beige)</option>
                    <option value="Bug">Bug (Orange-tinted)</option>
                    <option value="Fix">Fix (Green-tinted)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#73726C] uppercase tracking-wide mb-1">
                    Metadata Label Line
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. DECISION · ADR-055 · 2026-04-12 · APPROVED"
                    value={newMeta}
                    onChange={(e) => setNewMeta(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#E5E3DA] rounded-[8px] outline-none placeholder-[#8A8880]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#73726C] uppercase tracking-wide mb-1">
                    Description Text
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Describe the architectural decision, bug details, or fix implementation..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#E5E3DA] rounded-[8px] outline-none placeholder-[#8A8880] resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E5E3DA]">
                  <button
                    type="button"
                    onClick={() => setIsStoreOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-[#73726C] hover:text-[#1F1E1B] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newDesc.trim() || isStoring}
                    className="px-4 py-2 text-xs font-medium text-white bg-[#1F1E1B] rounded-[8px] hover:bg-[#33312B] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isStoring ? "Saving to Neo4j..." : "Save Node"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

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
                  <div className="text-[11px] font-semibold text-[#73726C] tracking-wide uppercase leading-tight">
                    {node.meta}
                  </div>
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