"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

  const bigCount = useCountUp(allowed?.similar_count ?? 0, { durationMs: 1100 });

  // (UI simplified): we no longer render trend/phrases/examples in this minimal count view.

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
              <div className="text-sm font-semibold uppercase tracking-wide text-gray-500">Similar posts</div>
              <div className="mt-3 text-6xl md:text-7xl font-extrabold tracking-tight text-indigo-700 tabular-nums">
                {fmtInt(bigCount)}
              </div>
              <div className="mt-2 text-sm text-gray-600">Counted from your saved history.</div>
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border bg-white p-5 text-sm text-gray-700 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">How it works</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Post stores text</li>
              <li>Backend checks quality + moderation</li>
              <li>Analyze shows how many similar posts exist</li>
            </ul>
          </section>
        )}

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
      </div>
    </main>
  );
}
