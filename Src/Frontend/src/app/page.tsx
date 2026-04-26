"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const USE_MOCK = false;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type TrendPoint = { date: string; count: number };

type SubmitResponse =
  | {
      status: "allowed";
      theme_label?: string;
      submitted_post: { id: string; text: string; created_at: string; similarity: number };
      similar_count: number;
      similarity_threshold: number;
      trend: TrendPoint[];
      trend_granularity: "day" | "week" | "month";
      common_phrases: string[];
      examples: { text: string; similarity: number; created_at: string }[];
    }
  | { status: "rejected"; reason: string; policy_category?: string };

function mockResponse(): SubmitResponse {
  const now = new Date();
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    return { date: d.toISOString().slice(0, 10), count: Math.floor(Math.random() * 30) };
  });

  return {
    status: "allowed",
    theme_label: "High rent in New York City",
    submitted_post: {
      id: "mock",
      text: "(mock) submitted text",
      created_at: new Date().toISOString(),
      similarity: 1.0,
    },
    similar_count: 3421,
    similarity_threshold: 0.82,
    trend: days,
    trend_granularity: "day",
    common_phrases: [
      "rent is insane",
      "unaffordable apartments",
      "landlords are squeezing people",
      "NYC housing is crazy",
    ],
    examples: [
      {
        text: "I can't afford my apartment anymore. Rent keeps climbing.",
        similarity: 0.91,
        created_at: new Date().toISOString(),
      },
      {
        text: "NYC rent is ridiculous compared to a few years ago.",
        similarity: 0.88,
        created_at: new Date().toISOString(),
      },
      {
        text: "Manhattan studios cost more than my entire paycheck.",
        similarity: 0.86,
        created_at: new Date().toISOString(),
      },
    ],
  };
}

function fmtInt(n: number) {
  return new Intl.NumberFormat().format(n);
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return dateStr;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function useCountUp(target: number, opts?: { durationMs?: number }) {
  const durationMs = opts?.durationMs ?? 900;
  const [value, setValue] = useState(() => (target > 0 ? Math.floor(target) : 0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (!Number.isFinite(target) || target <= 0) {
      // Defer state update to avoid sync setState inside effect
      rafRef.current = requestAnimationFrame(() => setValue(0));
      return;
    }

    const start = performance.now();
    const from = 0;
    const to = Math.floor(target);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

export default function Page() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState<"idle" | "posting" | "analyzing">("idle");
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPost = useMemo(() => text.trim().length >= 5 && loading === "idle", [text, loading]);
  const canAnalyze = useMemo(() => text.trim().length >= 10 && loading === "idle", [text, loading]);

  async function onPost() {
    if (!canPost) {
      setNotice(null);
      setResult(null);
      if (text.trim().length < 5) {
        setError("Please enter at least 5 characters to post.");
      } else {
        setError("Please wait—an action is already in progress.");
      }
      return;
    }

    setNotice(null);
    setError(null);
    setResult(null);
    setLoading("posting");

    if (USE_MOCK) {
      await new Promise((res) => setTimeout(res, 150));
      setNotice("Saved (mock). ");
      setLoading("idle");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
        }),
      });
      const data = await res.json();

      if (data?.status === "rejected") {
        setError(data?.reason ?? "Rejected");
      } else if (data?.status === "ok") {
        setNotice("Posted successfully.");
      } else {
        setError("Unexpected response from server.");
      }
    } catch (err) {
      console.error(err);
      setError("Couldn't reach backend. Is it running on :8000?");
    } finally {
      setLoading("idle");
    }
  }

  async function onAnalyze() {
    if (!canAnalyze) {
      setNotice(null);
      if (text.trim().length < 10) {
        setError("Please enter at least 10 characters to analyze.");
      } else {
        setError("Please wait—an action is already in progress.");
      }
      return;
    }

    setNotice(null);
    setError(null);
    setLoading("analyzing");
    setResult(null);

    if (USE_MOCK) {
      await new Promise((res) => setTimeout(res, 200));
      setResult(mockResponse());
      setLoading("idle");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
        }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      setError("Couldn't reach backend. Is it running on :8000?");
    } finally {
      setLoading("idle");
    }
  }

  const allowed = result && result.status === "allowed" ? result : null;
  const rejected = result && result.status === "rejected" ? result : null;

  const bigCount = useCountUp(allowed?.similar_count ?? 0, { durationMs: 1100 });

  const displayExamples = useMemo<Array<{ text: string; similarity: number; created_at: string }>>(() => {
    if (!allowed) return [];
    const base = Array.isArray(allowed.examples) ? allowed.examples : [];
    const submitted = allowed.submitted_post
      ? [
          {
            text: allowed.submitted_post.text,
            similarity: allowed.submitted_post.similarity,
            created_at: allowed.submitted_post.created_at,
          },
        ]
      : [];

    // Put the submitted post first so it reliably appears in both lists.
    return [...submitted, ...base];
  }, [allowed]);

  const mostSimilarGroups = useMemo(() => {
    if (!displayExamples.length) return [];

    const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const byKey = new Map<
      string,
      {
        text: string;
        duplicates: number;
        bestSimilarity: number;
        bestCreatedAt: string;
      }
    >();

    for (const ex of displayExamples) {
      const key = norm(ex.text);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, {
          text: ex.text,
          duplicates: 1,
          bestSimilarity: ex.similarity ?? 0,
          bestCreatedAt: ex.created_at,
        });
        continue;
      }

      prev.duplicates += 1;
      if ((ex.similarity ?? 0) > prev.bestSimilarity) {
        prev.bestSimilarity = ex.similarity ?? 0;
        prev.bestCreatedAt = ex.created_at;
      }
    }

    // Show the "best" groups first
    return [...byKey.values()]
      .sort((a, b) => {
        if (b.bestSimilarity !== a.bestSimilarity) return b.bestSimilarity - a.bestSimilarity;
        const ta = new Date(a.bestCreatedAt).getTime();
        const tb = new Date(b.bestCreatedAt).getTime();
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      })
      .slice(0, 5);
  }, [displayExamples]);

  const mostRecentExamples = useMemo(() => {
    if (!displayExamples.length) return [];
    return [...displayExamples]
      .sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        const na = Number.isFinite(ta) ? ta : 0;
        const nb = Number.isFinite(tb) ? tb : 0;
        return nb - na;
      })
      .slice(0, 5);
  }, [displayExamples]);

  return (
    <main className="min-h-screen text-gray-900">
      <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 md:px-6">

        {/* Header */}
        <div className="mb-7 flex items-center justify-between">
          <div>
            <div className="text-2xl font-black tracking-tight text-gray-950">YouType</div>
            <div className="text-sm text-gray-400 mt-0.5">See who else is thinking what you&apos;re thinking</div>
          </div>
          <a
            href={process.env.NEXT_PUBLIC_DONATE_URL || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50"
            onClick={(e) => {
              if (!process.env.NEXT_PUBLIC_DONATE_URL) {
                e.preventDefault();
                alert("Donate link coming soon! Set NEXT_PUBLIC_DONATE_URL to enable.");
              }
            }}
          >
            ☕ Donate
          </a>
        </div>

        {/* Input card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <textarea
            className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-4 text-base leading-relaxed outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            rows={5}
            placeholder="What's on your mind?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onPost}
              disabled={!canPost}
              type="button"
            >
              {loading === "posting" ? "Saving…" : "Type"}
            </button>
            <button
              className="flex-1 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onAnalyze}
              disabled={!canAnalyze}
              type="button"
            >
              {loading === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>
          </div>

          {notice && (
            <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              {notice}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
              {error}
            </div>
          )}
        </div>

        {/* Rejected */}
        {rejected && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <div className="font-semibold text-rose-900">Not accepted</div>
            <p className="mt-1 text-sm text-rose-700">{rejected.reason}</p>
            {rejected.policy_category && (
              <p className="mt-1 text-xs text-rose-400">Category: {rejected.policy_category}</p>
            )}
          </div>
        )}

        {/* Count hero */}
        {allowed && (
          <div className="mt-4 rounded-2xl bg-gray-950 px-8 py-7 text-white">
            <div className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              People said something similar
            </div>
            <div className="mt-1.5 text-7xl font-black tabular-nums tracking-tight leading-none">
              {fmtInt(bigCount)}
            </div>
            {allowed.theme_label && (
              <div className="mt-4 inline-block rounded-full bg-white/10 px-3 py-1 text-xs text-gray-400">
                {allowed.theme_label}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        {allowed && allowed.trend?.length ? (
          <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            {(() => {
              const granularity = allowed.trend_granularity;
              const n = new Date();
              const localToday = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;

              const localMonday = (() => {
                const offset = n.getDay() === 0 ? 6 : n.getDay() - 1;
                const m = new Date(n);
                m.setDate(n.getDate() - offset);
                return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
              })();

              const localMonthPrefix = localToday.slice(0, 7);

              function isCurrentPeriod(pointDate: string): boolean {
                if (granularity === "day") return pointDate === localToday;
                if (granularity === "week") return pointDate === localMonday;
                return pointDate.slice(0, 7) === localMonthPrefix;
              }

              function currentPeriodLabel(): string {
                if (granularity === "day") return "Today";
                if (granularity === "week") return "This week";
                return "This month";
              }

              function formatLabels(pointDate: string): { primary: string; secondary: string } {
                const d = new Date(pointDate + "T00:00:00");
                if (!Number.isFinite(d.getTime())) return { primary: pointDate, secondary: "" };
                if (granularity === "day") {
                  return {
                    primary: d.toLocaleDateString(undefined, { weekday: "short" }),
                    secondary: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  };
                }
                if (granularity === "week") {
                  return { primary: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), secondary: "" };
                }
                return {
                  primary: d.toLocaleDateString(undefined, { month: "short" }),
                  secondary: `'${String(d.getFullYear()).slice(2)}`,
                };
              }

              function windowLabel(): string {
                const count = allowed!.trend.length;
                if (granularity === "day") return `last ${count} days`;
                if (granularity === "week") return `last ${count} weeks`;
                return `last ${count} months`;
              }

              const maxCount = Math.max(...allowed.trend.map((p) => p.count), 1);
              const totalCount = allowed.trend.reduce((s, p) => s + p.count, 0);
              const rows = allowed.trend.map((point) => {
                const current = isCurrentPeriod(point.date);
                const labels = formatLabels(point.date);
                return {
                  point,
                  current,
                  primaryLabel: current ? currentPeriodLabel() : labels.primary,
                  secondaryLabel: current ? "" : labels.secondary,
                  tooltipLabel: labels.primary,
                  heightPct: point.count > 0 ? Math.max((point.count / maxCount) * 100, 8) : 0,
                };
              });

              return (
                <>
                  <div className="flex items-baseline justify-between">
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                      When People Are Typing
                    </div>
                    <div className="text-xs text-gray-400 tabular-nums">
                      {fmtInt(totalCount)} posts · {windowLabel()}
                    </div>
                  </div>
                  <div className="mt-4 flex h-28 items-end justify-between gap-1">
                    {rows.map(({ point, current, tooltipLabel, heightPct }) => (
                      <div key={point.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                        {point.count > 0 && (
                          <span className="tabular-nums text-[10px] font-semibold text-gray-400">
                            {fmtInt(point.count)}
                          </span>
                        )}
                        {heightPct > 0 ? (
                          <div
                            className={`w-full rounded-t-md transition-all ${current ? "bg-indigo-500" : "bg-gray-100"}`}
                            style={{ height: `${heightPct}%` }}
                            title={`${tooltipLabel}: ${fmtInt(point.count)}`}
                          />
                        ) : (
                          <div className="w-full border-t border-dashed border-gray-200" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between gap-1">
                    {rows.map(({ point, current, primaryLabel, secondaryLabel }) => (
                      <div key={point.date} className="flex-1 text-center">
                        <div className={`text-[10px] leading-tight ${current ? "font-semibold text-indigo-500" : "text-gray-400"}`}>
                          {primaryLabel}
                        </div>
                        {secondaryLabel && (
                          <div className="text-[9px] leading-tight text-gray-300">{secondaryLabel}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        ) : null}

        {/* Most Similar */}
        {allowed && (
          <div className="mt-6">
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
              Most Similar
            </div>
            {mostSimilarGroups.length ? (
              <div className="space-y-2">
                {mostSimilarGroups.map((g, idx) => (
                  <div
                    key={`${g.text}-${idx}`}
                    className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
                  >
                    <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words">{g.text}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-600">
                        {Math.round(g.bestSimilarity * 100)}% match
                      </span>
                      {g.duplicates > 1 && (
                        <span className="text-xs text-gray-400">{fmtInt(g.duplicates)} copies</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No similar posts found yet.</p>
            )}
          </div>
        )}

        {/* Recent Similar */}
        {mostRecentExamples.length ? (
          <div className="mt-6">
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
              Recent Similar
            </div>
            <div className="space-y-2">
              {mostRecentExamples.map((ex, idx) => (
                <div
                  key={`${ex.created_at}-${idx}`}
                  className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words">{ex.text}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-400">{relativeTime(ex.created_at)}</span>
                    <span className="text-gray-200" aria-hidden="true">·</span>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-600">
                      {Math.round(ex.similarity * 100)}% match
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

      </div>
    </main>
  );
}
