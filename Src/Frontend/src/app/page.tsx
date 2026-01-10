"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const USE_MOCK = false;
const API_BASE = "http://localhost:8000";

type TrendPoint = { date: string; count: number };

type SubmitResponse =
  | {
      status: "allowed";
      theme_label?: string;
      submitted_post: { id: string; text: string; created_at: string; similarity: number };
      similar_count: number;
      similarity_threshold: number;
      trend_7d: TrendPoint[];
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
    trend_7d: days,
    common_phrases: [
      "rent is insane",
      "unaffordable apartments",
      "landlords are squeezing people",
      "NYC housing is crazy",
    ],
    examples: [
      {
        text: "I can’t afford my apartment anymore. Rent keeps climbing.",
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

  useEffect(() => {
    // no-op for now
  }, []);

  const canPost = useMemo(() => text.trim().length >= 5 && loading === "idle", [text, loading]);
  const canAnalyze = useMemo(() => text.trim().length >= 10 && loading === "idle", [text, loading]);
  const canTypeAndAnalyze = useMemo(
    () => text.trim().length >= 10 && loading === "idle",
    [text, loading]
  );

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
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await res.json();

      if (data?.status === "rejected") {
        setError(data?.reason ?? "Rejected");
      } else if (data?.status === "ok") {
        setNotice("Posted successfully.");
        setText("");
      } else {
        setError("Unexpected response from server.");
      }
    } catch (err) {
      console.error(err);
      setError("Couldn’t reach backend. Is it running on :8000?");
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
      setError("Couldn’t reach backend. Is it running on :8000?");
    } finally {
      setLoading("idle");
    }
  }

  async function onTypeAndAnalyze() {
    if (!canTypeAndAnalyze) {
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
    setResult(null);
    setLoading("posting");

    const payload = { text: text.trim() };

    if (USE_MOCK) {
      await new Promise((res) => setTimeout(res, 250));
      setResult(mockResponse());
      setText("");
      setLoading("idle");
      return;
    }

    try {
      // 1) Type (persist)
      const postRes = await fetch(`${API_BASE}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const postData = await postRes.json();

      if (postData?.status === "rejected") {
        setError(postData?.reason ?? "Rejected");
        return;
      }
      if (postData?.status !== "ok") {
        setError("Unexpected response from server.");
        return;
      }

      // 2) Analyze (counts + examples)
      setLoading("analyzing");
      const analyzeRes = await fetch(`${API_BASE}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const analyzeData = await analyzeRes.json();
      setResult(analyzeData);
      setText("");
    } catch (err) {
      console.error(err);
      setError("Couldn’t reach backend. Is it running on :8000?");
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
          <div className="text-base font-extrabold tracking-tight text-gray-950">YouType</div>
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

          <button
            className="mt-4 w-full rounded-2xl border border-gray-400 bg-white px-4 py-3 text-base font-semibold text-gray-950 shadow-sm transition hover:bg-gray-50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:shadow-none data-[disabled=true]:border-gray-300"
            onClick={onTypeAndAnalyze}
            aria-disabled={!canTypeAndAnalyze}
            data-disabled={!canTypeAndAnalyze ? "true" : "false"}
            type="button"
          >
            {loading === "posting" || loading === "analyzing" ? "Working…" : "Type and Analyze"}
          </button>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
              <div className="mt-3 text-6xl md:text-7xl font-extrabold tracking-tight text-indigo-700 tabular-nums">
                {fmtInt(bigCount)}
              </div>
            </div>
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
