"use client";

import { useEffect, useState } from "react";
import { ADMIN_TOKEN_STORAGE_KEY, DEV_MODE_STORAGE_KEY } from "@/lib/devMode";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type AdminPost = {
  id: string;
  text: string;
  location: string | null;
  created_at: string;
  upvotes: number;
  downvotes: number;
  status: "active" | "blocked";
};

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [devModeOnMainSite, setDevModeOnMainSite] = useState(false);
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    if (saved) setToken(saved);
    setDevModeOnMainSite(window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1");
  }, []);

  function saveToken(next: string) {
    setToken(next);
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, next);
  }

  function setDevMode(enabled: boolean) {
    setDevModeOnMainSite(enabled);
    if (enabled) {
      window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(DEV_MODE_STORAGE_KEY);
    }
  }

  async function search() {
    if (!token) {
      setError("Enter the admin token first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "50");
      const res = await fetch(`${API_BASE}/admin/posts?${params.toString()}`, {
        headers: { "X-Admin-Token": token },
      });
      if (res.status === 401) {
        setError("Unauthorized — check the admin token.");
        setPosts([]);
        return;
      }
      if (!res.ok) {
        setError(`Request failed (${res.status}).`);
        return;
      }
      const data = await res.json();
      setPosts(data.posts ?? []);
    } catch (err) {
      console.error(err);
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(post: AdminPost) {
    const nextStatus = post.status === "active" ? "blocked" : "active";
    setTogglingId(post.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/posts/${post.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": token,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.status === 401) {
        setError("Unauthorized — check the admin token.");
        return;
      }
      if (!res.ok) {
        setError(`Request failed (${res.status}).`);
        return;
      }
      const updated: AdminPost = await res.json();
      setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      console.error(err);
      setError("Couldn't reach the server.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-bold tracking-tight">Dev mode — post status</h1>
        <p className="mt-1 text-sm text-gray-500">
          Search posts and toggle Active/Blocked directly, bypassing community voting.
        </p>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400">
            Admin token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => saveToken(e.target.value)}
            placeholder="X-Admin-Token"
            className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />

          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={devModeOnMainSite}
              onChange={(e) => setDevMode(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Enable dev mode on the main site (adds Force Allow / Force Block on this browser)
          </label>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            Search text
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="e.g. dogs are the worst"
              className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={search}
              disabled={loading}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
        </div>

        <div className="mt-4 space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-gray-800">&ldquo;{post.text}&rdquo;</p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    post.status === "blocked"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {post.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Allow · {post.upvotes} &nbsp;·&nbsp; Block · {post.downvotes} &nbsp;·&nbsp;{" "}
                {post.id}
              </p>
              <button
                type="button"
                onClick={() => toggleStatus(post)}
                disabled={togglingId === post.id}
                className="mt-3 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
              >
                {togglingId === post.id
                  ? "Updating…"
                  : post.status === "active"
                  ? "Block"
                  : "Unblock"}
              </button>
            </div>
          ))}
          {!loading && posts.length === 0 && (
            <p className="text-center text-sm text-gray-400">No posts loaded yet.</p>
          )}
        </div>
      </div>
    </main>
  );
}
