"use client";

import { useEffect, useMemo, useState } from "react";

const USE_MOCK = false;
const API_BASE = "http://localhost:8000";

type TrendPoint = { date: string; count: number };

type SubmitResponse =
  | {
      status: "allowed";
      theme_label?: string;
      similar_count: number;
      similarity_threshold: number;
      trend_7d: TrendPoint[];
      common_phrases: string[];
      examples: { text: string; similarity: number; created_at: string }[];
    }
  | { status: "rejected"; reason: string; policy_category?: string };

type PostOut = {
  id: string;
  text: string;
  location?: string | null;
  created_at: string;
};

type PostsResponse = {
  count: number;
  posts: PostOut[];
};

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
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function formatShortDate(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export default function Page() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState<"idle" | "posting" | "analyzing">("idle");
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [recent, setRecent] = useState<PostOut[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshRecent() {
    try {
      const res = await fetch(`${API_BASE}/posts`, { cache: "no-store" });
      const data = (await res.json()) as PostsResponse;
      setRecent(Array.isArray(data.posts) ? data.posts : []);
    } catch {
      // ignore; backend might not be running yet
    }
  }

  useEffect(() => {
    if (!USE_MOCK) refreshRecent();
  }, []);

  const canPost = useMemo(() => text.trim().length >= 5 && loading === "idle", [text, loading]);
  const canAnalyze = useMemo(() => text.trim().length >= 10 && loading === "idle", [text, loading]);

  async function onPost() {
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
        await refreshRecent();
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
      await refreshRecent();
    } catch (err) {
      console.error(err);
      setError("Couldn’t reach backend. Is it running on :8000?");
    } finally {
      setLoading("idle");
    }
  }

  const allowed = result && result.status === "allowed" ? result : null;
  const rejected = result && result.status === "rejected" ? result : null;

  const trendMax = useMemo(() => {
    if (!allowed) return 1;
    return Math.max(1, ...allowed.trend_7d.map((t) => t.count));
  }, [allowed]);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Semantic Theme</h1>
          <p className="mt-2 text-base text-gray-700">Upload text, then either post it or analyze it.</p>
          <div className="mt-3 text-sm text-gray-600">
            Mode: <span className="font-medium">{USE_MOCK ? "Mock data" : "Live backend"}</span>
          </div>
        </header>

        {/* Input */}
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <label className="block text-sm font-semibold text-gray-900">Upload text</label>
          <textarea
            className="mt-2 w-full resize-none rounded-xl border bg-white p-4 text-base leading-relaxed outline-none focus:ring-2 focus:ring-indigo-200"
            rows={6}
            placeholder="e.g., Rent in NYC is getting out of control…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              className="w-full rounded-xl border bg-white px-4 py-3 text-base font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
              onClick={onPost}
              disabled={!canPost}
              type="button"
            >
              {loading === "posting" ? "Posting…" : "Post"}
            </button>

            <button
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              onClick={onAnalyze}
              disabled={!canAnalyze}
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

        {/* Persisted submissions */}
        {!USE_MOCK ? (
          <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Recent submissions</h2>
              <button
                className="rounded-lg border bg-gray-50 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
                onClick={refreshRecent}
                type="button"
              >
                Refresh
              </button>
            </div>

            {recent.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No saved posts yet (or backend isn’t running).</p>
            ) : (
              <div className="mt-3 space-y-3">
                {recent.slice(0, 8).map((p) => (
                  <article key={p.id} className="rounded-xl border bg-white p-4">
                    <p className="text-sm text-gray-900 line-clamp-3 whitespace-pre-wrap">{p.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span>{new Date(p.created_at).toLocaleString()}</span>
                      {p.location ? (
                        <>
                          <span>•</span>
                          <span className="rounded-full bg-gray-100 px-2 py-1">{p.location}</span>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

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
          <section className="mt-6 space-y-5">
            {/* Summary */}
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl md:text-2xl font-bold">{allowed.theme_label ?? "Semantic theme"}</h2>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-xs font-semibold text-gray-600">Similar posts</div>
                  <div className="mt-1 text-2xl font-bold">{fmtInt(allowed.similar_count)}</div>
                </div>

                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-xs font-semibold text-gray-600">Threshold</div>
                  <div className="mt-1 text-2xl font-bold">{allowed.similarity_threshold.toFixed(2)}</div>
                </div>

                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-xs font-semibold text-gray-600">Updated</div>
                  <div className="mt-1 text-sm font-medium text-gray-800">{new Date().toLocaleString()}</div>
                </div>
              </div>
            </div>

            {/* Trend + Phrases */}
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">Trend (last 7 days)</h3>
                <div className="mt-3 space-y-2">
                  {allowed.trend_7d.map((t) => {
                    const w = `${Math.round(clamp01(t.count / trendMax) * 100)}%`;
                    return (
                      <div key={t.date} className="grid grid-cols-[64px_1fr_36px] items-center gap-3">
                        <div className="text-xs text-gray-600">{formatShortDate(t.date)}</div>
                        <div className="h-2 rounded-full bg-gray-100">
                          <div className="h-2 rounded-full bg-indigo-500" style={{ width: w }} />
                        </div>
                        <div className="text-xs font-semibold text-gray-700 text-right">{t.count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">Common phrasing</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {allowed.common_phrases.slice(0, 12).map((p, i) => (
                    <span
                      key={`${p}-${i}`}
                      className="rounded-full border bg-gray-50 px-3 py-1 text-sm text-gray-800"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Examples */}
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900">Top matching examples</h3>
              <div className="mt-3 space-y-3">
                {allowed.examples.slice(0, 5).map((ex, idx) => (
                  <article key={idx} className="rounded-xl border bg-white p-4">
                    <p className="text-base leading-relaxed">{ex.text}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">
                        similarity {ex.similarity.toFixed(2)}
                      </span>
                      <span>•</span>
                      <span>{new Date(ex.created_at).toLocaleString()}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border bg-white p-5 text-sm text-gray-700 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">How it works</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Submit text (and optional location)</li>
              <li>Backend checks quality + moderation</li>
              <li>You get similar posts, trend, common phrasing, and examples</li>
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
