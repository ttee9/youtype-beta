"use client";

import { useEffect, useState } from "react";
import YouTypeApp from "@/components/YouTypeApp";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const ADMIN_TOKEN_STORAGE_KEY = "youtype_admin_token";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [validating, setValidating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY));
    setCheckedStorage(true);
  }, []);

  async function submitToken() {
    if (!inputValue) {
      setModalError("Enter the admin token.");
      return;
    }
    setValidating(true);
    setModalError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/posts?limit=1`, {
        headers: { "X-Admin-Token": inputValue },
      });
      if (res.status === 401) {
        setModalError("Invalid token.");
        return;
      }
      if (!res.ok) {
        setModalError(`Request failed (${res.status}).`);
        return;
      }
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, inputValue);
      setToken(inputValue);
      setInputValue("");
    } catch (err) {
      console.error(err);
      setModalError("Couldn't reach the server.");
    } finally {
      setValidating(false);
    }
  }

  function logOut() {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setToken(null);
  }

  if (!checkedStorage) return null;

  if (!token) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
          <h1 className="text-lg font-bold text-gray-900">Admin token required</h1>
          <p className="mt-1 text-sm text-gray-500">Enter the admin token to access dev mode.</p>
          <input
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitToken()}
            placeholder="X-Admin-Token"
            autoFocus
            className="mt-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          {modalError && <p className="mt-2 text-xs text-rose-600">{modalError}</p>}
          <button
            type="button"
            onClick={submitToken}
            disabled={validating}
            className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {validating ? "Checking…" : "Enter"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={logOut}
        className="fixed right-4 top-4 z-40 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500 shadow-sm transition hover:bg-gray-50"
      >
        Log out (dev)
      </button>
      <YouTypeApp devMode adminToken={token} />
    </div>
  );
}
