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

  // (UI simplified): we no longer render trend/phrases/examples in this minimal count view.

  return (
    <main className="min-h-screen text-gray-900">
      <div className="mx-auto max-w-3xl px-4 py-2 md:px-8">
        {/* Input */}
  <section className="rounded-3xl border border-gray-400 bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="text-base font-extrabold tracking-tight text-gray-950">YouType</div>
            <a
              href={process.env.NEXT_PUBLIC_DONATE_URL || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-gray-400 bg-white px-3 py-1 text-sm font-semibold text-gray-950 shadow-sm transition hover:bg-gray-50 hover:shadow"
              onClick={(e) => {
                if (!process.env.NEXT_PUBLIC_DONATE_URL) {
                  e.preventDefault();
                  alert('Donate link coming soon! Set NEXT_PUBLIC_DONATE_URL to enable.');
                }
              }}
            >
              ☕ Donate
            </a>
          </div>
          <textarea
            className="mt-1.5 w-full resize-none rounded-2xl border border-gray-400 bg-white/90 p-4 text-base leading-relaxed shadow-sm outline-none focus:ring-2 focus:ring-indigo-200"
            rows={6}
            placeholder={`Paste your text here.

Then click:
• Type — save it
• Analyze — count similar texts`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              className="w-full rounded-2xl border border-gray-400 bg-white px-4 py-3 text-base font-semibold text-gray-950 shadow-sm transition hover:bg-gray-50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:shadow-none data-[disabled=true]:border-gray-300"
              onClick={onPost}
              aria-disabled={!canPost}
              data-disabled={!canPost ? "true" : "false"}
              type="button"
            >
              {loading === "posting" ? "Typing…" : "Type"}
            </button>

            <button
              className="w-full rounded-2xl border border-gray-400 bg-white px-4 py-3 text-base font-semibold text-gray-950 shadow-sm transition hover:bg-gray-50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:shadow-none data-[disabled=true]:border-gray-300"
              onClick={onAnalyze}
              aria-disabled={!canAnalyze}
              data-disabled={!canAnalyze ? "true" : "false"}
              type="button"
            >
              {loading === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>
          </div>

          {notice ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {error}
            </div>
          ) : null}
        </section>

        {/* Rejected */}
        {rejected ? (
          <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <h2 className="text-base font-semibold text-rose-900">Submission rejected</h2>
            <p className="mt-2 text-sm text-rose-800">{rejected.reason}</p>
            {rejected.policy_category ? (
              <p className="mt-1 text-xs text-rose-700">Category: {rejected.policy_category}</p>
            ) : null}
          </section>
        ) : null}

        {/* Allowed */}
        {allowed ? (
          <section className="mt-6 rounded-2xl border bg-white p-8 shadow-sm">
            <div className="text-center">
              <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">Total Similar Texts</div>
              <div className="mt-3 text-6xl md:text-7xl font-extrabold tracking-tight text-gray-950 tabular-nums">
                {fmtInt(bigCount)}
              </div>
            </div>
          </section>
        ) : null}

        {allowed && allowed.trend?.length ? (
          <section className="mt-4 rounded-2xl border bg-white p-6 shadow-sm">
            {(() => {
              const granularity = allowed.trend_granularity;
              const n = new Date();
              const localToday = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;

              // Monday of current local week (ISO: Mon=0)
              const localMonday = (() => {
                const offset = n.getDay() === 0 ? 6 : n.getDay() - 1;
                const m = new Date(n);
                m.setDate(n.getDate() - offset);
                return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
              })();

              const localMonthPrefix = localToday.slice(0, 7); // "YYYY-MM"

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
                  return {
                    primary: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                    secondary: "",
                  };
                }
                // month
                return {
                  primary: d.toLocaleDateString(undefined, { month: "short" }),
                  secondary: `'${String(d.getFullYear()).slice(2)}`,
                };
              }

              function windowLabel(): string {
                const count = allowed.trend.length;
                if (granularity === "day") return `last ${count} days`;
                if (granularity === "week") return `last ${count} weeks`;
                return `last ${count} months`;
              }

              const maxCount = Math.max(...allowed.trend.map((p) => p.count), 1);
              const totalCount = allowed.trend.reduce((s, p) => s + p.count, 0);
              const rows = allowed.trend.map((point) => {
                const current = isCurrentPeriod(point.date);
                const labels = formatLabels(point.date);
                const primaryLabel = current ? currentPeriodLabel() : labels.primary;
                const secondaryLabel = current ? "" : labels.secondary;
                const heightPct = point.count > 0 ? Math.max((point.count / maxCount) * 100, 8) : 0;
                return { point, current, primaryLabel, secondaryLabel, tooltipLabel: labels.primary, heightPct };
              });

              return (
                <>
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                      When People Are Typing
                    </div>
                    <div className="text-xs text-gray-400 tabular-nums">
                      {fmtInt(totalCount)} posts · {windowLabel()}
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-1 h-28">
                    {rows.map(({ point, current, primaryLabel, tooltipLabel, heightPct }) => (
                      <div
                        key={point.date}
                        className="flex flex-1 flex-col items-center gap-1 h-full justify-end"
                      >
                        {point.count > 0 && (
                          <span className="text-[10px] font-semibold text-gray-400 tabular-nums">
                            {fmtInt(point.count)}
                          </span>
                        )}
                        {heightPct > 0 ? (
                          <div
                            className={`w-full rounded-t-md transition-all ${current ? "bg-indigo-400" : "bg-gray-200"}`}
                            style={{ height: `${heightPct}%` }}
                            title={`${tooltipLabel}: ${fmtInt(point.count)}`}
                          />
                        ) : (
                          <div className="w-full border-t border-dashed border-gray-200" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between gap-1">
                    {rows.map(({ point, current, primaryLabel, secondaryLabel }) => (
                      <div key={point.date} className="flex-1 text-center">
                        <div className={`text-[10px] leading-tight ${current ? "font-semibold text-indigo-500" : "text-gray-400"}`}>
                          {primaryLabel}
                        </div>
                        {secondaryLabel && (
                          <div className="text-[9px] text-gray-300 leading-tight">
                            {secondaryLabel}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </section>
        ) : null}

        {allowed ? (
          <section className="mt-4 rounded-2xl border bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Most Similar Texts
            </div>

            {mostSimilarGroups.length ? (
              <div className="mt-3 space-y-3">
                {mostSimilarGroups.map((g, idx) => {
                  return (
                    <div
                      key={`${g.text}-${idx}`}
                      className="rounded-2xl border border-gray-200 bg-white/80 p-4"
                    >
                      <div className="text-sm text-gray-900 whitespace-pre-wrap wrap-break-word">{g.text}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span>Similarity: {g.bestSimilarity}</span>
                        <span aria-hidden="true">•</span>
                        <span>Duplicates: {fmtInt(g.duplicates)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 text-sm text-gray-500">No similar posts found yet.</div>
            )}
          </section>
        ) : null}

        {mostRecentExamples.length ? (
          <section className="mt-4 rounded-2xl border bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Recent Similar Texts
            </div>
            <div className="mt-3 space-y-3">
              {mostRecentExamples.map((ex, idx) => {
                const when = new Date(ex.created_at);
                const whenLabel = Number.isFinite(when.getTime()) ? when.toLocaleString() : ex.created_at;

                return (
                  <div
                    key={`${ex.created_at}-${idx}`}
                    className="rounded-2xl border border-gray-200 bg-white/80 p-4"
                  >
                    <div className="text-sm text-gray-900 whitespace-pre-wrap wrap-break-word">{ex.text}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>{whenLabel}</span>
                      <span aria-hidden="true">•</span>
                      <span>Similarity: {ex.similarity}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
