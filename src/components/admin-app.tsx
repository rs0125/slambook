"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, RequestError } from "@/lib/browser-api";
import {
  okResponseSchema,
  deleteResponseSchema,
  entryResponseSchema,
  entryListResponseSchema,
  sessionResponseSchema,
  type EntryRecord,
  type PublicSettings,
} from "@/lib/questions";
import { BrandMark, Icon } from "@/components/icons";
import { EntryContent } from "@/components/entry-content";

type EntrySummary = Omit<EntryRecord, "entry_media"> & {
  entry_media: { id: string }[];
};
type EntryList = { entries: EntrySummary[]; total: number; page: number };
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function AdminApp({
  entryId,
  configured,
}: {
  entryId?: string;
  configured: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState<
    "loading" | "signed-out" | "owner" | "error"
  >("loading");
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [demo, setDemo] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<EntryList | null>(null);
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState<EntryRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcome, setWelcome] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const sessionRequest = useRef<AbortController | null>(null);
  const loadSession = useCallback(async () => {
    sessionRequest.current?.abort();
    const controller = new AbortController();
    sessionRequest.current = controller;
    setError("");
    setSession("loading");
    try {
      const result = await api(
        "/api/admin/session",
        { signal: controller.signal },
        { schema: sessionResponseSchema },
      );
      if (controller.signal.aborted) return;
      setSettings(result.settings);
      setDemo(Boolean(result.demo));
      setWelcome(result.settings.welcome_text);
      setSession("owner");
    } catch (err) {
      if (controller.signal.aborted) return;
      if (
        err instanceof RequestError &&
        (err.status === 401 || err.status === 403)
      )
        setSession("signed-out");
      else {
        setSession("error");
        setError(
          err instanceof Error ? err.message : "Couldn’t open your book.",
        );
      }
    }
  }, []);
  useEffect(() => {
    void loadSession();
    return () => sessionRequest.current?.abort();
  }, [loadSession]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (session !== "owner") return;
    const controller = new AbortController();
    setLoading(true);
    setReadFailed(false);
    setError("");
    setEntry(null);
    setList(null);
    setConfirmDelete(false);
    const request = entryId
      ? api(
          `/api/admin/entries/${entryId}`,
          { signal: controller.signal },
          { schema: entryResponseSchema },
        )
      : api(
          `/api/admin/entries?q=${encodeURIComponent(query)}&page=${page}`,
          { signal: controller.signal },
          { schema: entryListResponseSchema },
        );
    request
      .then((result) => {
        if (controller.signal.aborted) return;
        if ("entry" in result) setEntry(result.entry);
        else {
          const lastPage = Math.max(1, Math.ceil(result.total / 12));
          if (page > lastPage) setPage(lastPage);
          else setList(result);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (
          err instanceof RequestError &&
          (err.status === 401 || err.status === 403)
        ) {
          setSession("signed-out");
          setEntry(null);
          setList(null);
        } else {
          setReadFailed(true);
          setError(
            err instanceof Error ? err.message : "Couldn’t load your entries.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [session, query, page, entryId, readAttempt]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
        { schema: okResponseSchema },
      );
      setPassword("");
      await loadSession();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sign-in didn’t work. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/auth/logout",
        { method: "POST", body: "{}" },
        { schema: okResponseSchema },
      );
      setSession("signed-out");
      setList(null);
      setEntry(null);
      setPassword("");
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t sign out.");
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings(input: {
    submissions_open?: boolean;
    welcome_text?: string;
  }) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(
        "/api/admin/settings",
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
        { schema: okResponseSchema },
      );
      setSettings((previous) =>
        previous ? { ...previous, ...input } : previous,
      );
      setConfirmClose(false);
      setWelcomeOpen(false);
      setMessage(
        input.welcome_text !== undefined
          ? "Your welcome note has been updated."
          : input.submissions_open
            ? "Your book is open for new memories."
            : "New submissions are now closed.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn’t save that change.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeEntry() {
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/admin/entries/${entryId}`,
        {
          method: "DELETE",
          body: "{}",
        },
        { schema: deleteResponseSchema },
      );
      router.replace("/admin?deleted=1");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn’t delete this entry.",
      );
      setBusy(false);
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sign`);
      setMessage("Your signing link is copied. Share it with your friends.");
    } catch {
      setMessage(`Your signing link: ${window.location.origin}/sign`);
    }
  }

  if (session === "loading")
    return (
      <div className="center-page" role="status">
        <span className="spinner" />
        <p>Opening your corner of the book…</p>
      </div>
    );
  if (session === "error")
    return (
      <div className="center-page">
        <h1>A little connection hiccup.</h1>
        <p role="alert">{error}</p>
        <button
          className="button button-primary"
          onClick={() => void loadSession()}
        >
          Try again
        </button>
      </div>
    );
  if (session === "signed-out")
    return (
      <section className="login-layout">
        <div className="login-intro">
          <span className="brand-mark">
            <BrandMark size={54} />
          </span>
          <p className="eyebrow">A QUIET CORNER, JUST FOR YOU</p>
          <h1>
            All your people.
            <br />
            All those stories.
          </h1>
          <p>
            Welcome back, Raghav. Your little collection
            <br className="desktop-break" /> of the good stuff is waiting.
          </p>
          <div className="login-doodle">
            <Icon name="book" width="140" height="140" strokeWidth="0.8" />
          </div>
        </div>
        <div className="login-card">
          <span className="round-icon">
            <Icon name="lock" width="24" height="24" />
          </span>
          <h2>Owner’s corner</h2>
          <p>Sign in to open your private collection.</p>
          {!configured && (
            <div className="notice">
              Owner sign-in will be available once your Supabase project and
              owner account are connected. See the project README for setup.
            </div>
          )}
          <form onSubmit={(event) => void login(event)}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                maxLength={254}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
                maxLength={200}
                disabled={busy}
              />
            </div>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary full-width"
              disabled={busy}
            >
              {busy ? "Opening your book…" : "Open my book"}
            </button>
          </form>
          <p className="login-hint">
            <Icon name="lock" width="14" height="14" /> Only the book’s owner
            can sign in.
          </p>
          <Link className="text-link" href="/sign">
            Here to leave a memory? Sign the book.
          </Link>
        </div>
      </section>
    );

  return (
    <div className="admin-layout">
      <div className="admin-topbar">
        <Link href="/admin" className="admin-label">
          <Icon name="book" /> YOUR PRIVATE COLLECTION
        </Link>
        {demo ? (
          <Link className="button button-ghost" href="/">
            Back to the book
          </Link>
        ) : (
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={() => void logout()}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        )}
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          {readFailed && (
            <button
              className="button button-outline"
              onClick={() => setReadAttempt((value) => value + 1)}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="notice notice-success" role="status">
          {message}
        </div>
      )}
      {entryId ? (
        <>
          <Link href="/admin" className="back-link">
            Back to all memories
          </Link>
          {loading ? (
            <p className="loading-state" role="status">
              Turning to their page…
            </p>
          ) : (
            entry && (
              <>
                <div className="entry-header">
                  <div>
                    <p className="eyebrow">
                      MEMORIES FROM {entry.name.toLocaleUpperCase()}
                    </p>
                    <h1>A page from {entry.nickname || entry.name}.</h1>
                    <p>Added on {dateLabel(entry.created_at)}</p>
                  </div>
                  <a
                    className="button button-secondary"
                    href={`/api/admin/export?id=${entry.id}`}
                    download
                  >
                    <Icon name="download" />
                    Export this page
                  </a>
                </div>
                <div className="admin-entry-paper">
                  <EntryContent entry={entry} />
                  {entry.entry_media.length > 0 && (
                    <section className="preview-photos">
                      <h3>Photos &amp; memories</h3>
                      <div>
                        {entry.entry_media.map((media, i) => (
                          <figure key={media.id}>
                            <a
                              href={`/api/admin/media/${media.id}`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open photo ${i + 1} at full size`}
                            >
                              <img
                                src={`/api/admin/media/${media.id}`}
                                alt={
                                  media.caption ||
                                  `Photo ${i + 1} from ${entry.name}`
                                }
                                loading="lazy"
                                width="800"
                                height="600"
                              />
                            </a>
                            {media.caption && (
                              <figcaption>{media.caption}</figcaption>
                            )}
                          </figure>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
                <div className="delete-area">
                  <div>
                    <h3>Remove this page</h3>
                    <p>
                      Deleting removes the answers and their photos from your
                      book.
                    </p>
                  </div>
                  <button
                    className="button button-danger-outline"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    <Icon name="trash" />
                    Delete entry
                  </button>
                </div>
                {confirmDelete && (
                  <div className="reset-confirm" role="alert">
                    <p>
                      Delete {entry.name}’s entry and all attached photos? This
                      cannot be undone.
                    </p>
                    <div className="button-row">
                      <button
                        className="button button-danger"
                        disabled={busy}
                        onClick={() => void removeEntry()}
                      >
                        {busy ? "Deleting…" : "Delete permanently"}
                      </button>
                      <button
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setConfirmDelete(false)}
                      >
                        Keep this memory
                      </button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </>
      ) : (
        <>
          <div className="admin-heading">
            <div>
              <p className="eyebrow">WELCOME BACK, RAGHAV</p>
              <h1>
                The good stuff,
                <br />
                all in one place.
              </h1>
              <p>Your friends. Their words. Plenty to look back on.</p>
            </div>
            <div className="button-row">
              <button
                className="button button-primary"
                onClick={() => void copyLink()}
              >
                <Icon name="copy" />
                Copy signing link
              </button>
              <a
                className="button button-secondary"
                href="/api/admin/export"
                download
              >
                <Icon name="download" />
                Export book
              </a>
            </div>
          </div>
          <div className="book-controls">
            <div className="book-state">
              <span
                className={`status-dot ${settings?.submissions_open ? "status-open" : ""}`}
              />
              <div>
                <strong>
                  {settings?.submissions_open
                    ? "Open for new memories"
                    : "Taking a little pause"}
                </strong>
                <p>
                  {settings?.submissions_open
                    ? "Anyone with your link can leave a page."
                    : "Friends can’t submit while the book is closed."}
                </p>
              </div>
            </div>
            <div className="button-row">
              <button
                className="button button-ghost"
                disabled={busy}
                onClick={() => setWelcomeOpen(!welcomeOpen)}
              >
                Edit welcome note
              </button>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() =>
                  settings?.submissions_open
                    ? setConfirmClose(true)
                    : void saveSettings({ submissions_open: true })
                }
              >
                {settings?.submissions_open
                  ? "Close submissions"
                  : "Open submissions"}
              </button>
            </div>
          </div>
          {confirmClose && (
            <div className="reset-confirm" role="alert">
              <p>
                Close the book to new submissions? Friends who are still writing
                will be asked to come back later. You can reopen it any time.
              </p>
              <div className="button-row">
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void saveSettings({ submissions_open: false })}
                >
                  Yes, close submissions
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setConfirmClose(false)}
                >
                  Keep it open
                </button>
              </div>
            </div>
          )}
          {welcomeOpen && (
            <form
              className="welcome-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void saveSettings({ welcome_text: welcome });
              }}
            >
              <label htmlFor="welcome">Your note on the welcome page</label>
              <textarea
                id="welcome"
                rows={4}
                maxLength={2000}
                value={welcome}
                onChange={(e) => setWelcome(e.target.value)}
                required
                disabled={busy}
              />
              <div className="button-row">
                <button className="button button-primary" disabled={busy}>
                  Save welcome note
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setWelcome(settings?.welcome_text || "");
                    setWelcomeOpen(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="collection-toolbar">
            <h2>
              Your memories <span>{list?.total ?? "—"}</span>
            </h2>
            <div className="search-input">
              <Icon name="search" />
              <label htmlFor="search" className="visually-hidden">
                Search entries by name or nickname
              </label>
              <input
                id="search"
                type="search"
                placeholder="Find a familiar name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>
          {loading ? (
            <div className="loading-state" role="status">
              Finding your memories…
            </div>
          ) : list && list.entries.length === 0 ? (
            <section className="empty-collection">
              <span className="empty-icon">
                <Icon name={query ? "search" : "book"} width="44" height="44" />
              </span>
              <h2>
                {query
                  ? "No familiar faces by that name."
                  : "The best pages are still unwritten."}
              </h2>
              <p>
                {query
                  ? "Try another name or nickname."
                  : "Share your signing link with a friend. Their first memory will appear right here."}
              </p>
              {query ? (
                <button
                  className="button button-secondary"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              ) : (
                <button
                  className="button button-primary"
                  onClick={() => void copyLink()}
                >
                  Copy signing link
                </button>
              )}
            </section>
          ) : (
            <div className="entries-grid">
              {list?.entries.map((item) => (
                <Link
                  href={`/admin/entries/${item.id}`}
                  className="entry-card card-pink"
                  key={item.id}
                >
                  <div className="entry-card-top">
                    <span className="entry-avatar">
                      {item.name.slice(0, 1).toLocaleUpperCase()}
                    </span>
                    <span className="caption">
                      {dateLabel(item.created_at)}
                    </span>
                  </div>
                  <h3>{item.name}</h3>
                  {item.nickname && (
                    <span className="entry-nickname">
                      You know them as {item.nickname}
                    </span>
                  )}
                  <p className="entry-excerpt">
                    {item.answers.favourite_memory}
                  </p>
                  <div className="entry-card-bottom">
                    <span>Open their page</span>
                    <span>
                      <Icon name="camera" width="16" height="16" />
                      {item.entry_media.length}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {list && list.total > 12 && (
            <nav className="pagination" aria-label="Entry pages">
              <button
                className="button button-secondary"
                disabled={page === 1 || loading}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.ceil(list.total / 12)}
              </span>
              <button
                className="button button-secondary"
                disabled={page >= Math.ceil(list.total / 12) || loading}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
          <p className="collection-privacy">
            <Icon name="lock" width="16" height="16" /> Every page here is
            private. Nothing is published on your homepage.
          </p>
        </>
      )}
    </div>
  );
}
