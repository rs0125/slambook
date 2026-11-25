"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  api,
  compressPhoto,
  newAttempt,
  RequestError,
  uploadPhoto,
} from "@/lib/browser-api";
import {
  emptyEntry,
  entrySchema,
  fieldErrors,
  questions,
  attemptSchema,
  MAX_PHOTOS,
  uploadResponseSchema,
  submittedResponseSchema,
  publicSettingsSchema,
  type EntryInput,
  type PublicSettings,
} from "@/lib/questions";
import { Icon, BrandMark } from "@/components/icons";
import { EntryContent } from "@/components/entry-content";
import { AuroraBackground } from "@/components/aurora-background";
import { clearSubmittedDraft, DRAFT_KEY } from "@/lib/draft";

const steps = [
  {
    title: "Hello, familiar face.",
    nav: "First hellos",
    description: "Let’s start at the beginning.",
    color: "pink",
  },
  {
    title: "The good old days.",
    nav: "Our memories",
    description:
      "The big adventures. The small moments. The things that stuck.",
    color: "yellow",
  },
  {
    title: "A little time capsule.",
    nav: "Looking ahead",
    description: "A snapshot of you today, and something to look back on.",
    color: "violet",
  },
  {
    title: "The finishing touches.",
    nav: "Little extras",
    description:
      "A photo, a way to keep in touch. All of this part is optional.",
    color: "mint",
  },
  {
    title: "A page worth keeping.",
    nav: "Your preview",
    description:
      "Take a little look. Sound like you? Then it’s ready for the book.",
    color: "pink",
  },
];
type Photo = {
  id: string;
  file: File;
  url: string;
  caption: string;
  progress: number;
};
type Attempt = ReturnType<typeof newAttempt>;
type TextFieldProps = {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  value: string;
  max: number;
  required?: boolean;
  multiline?: boolean;
  error?: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
};
function TextField({
  id,
  label,
  description,
  value,
  max,
  required,
  multiline,
  error,
  onChange,
  ...rest
}: TextFieldProps) {
  const common = {
    id,
    value,
    maxLength: max,
    required,
    "aria-invalid": Boolean(error),
    "aria-describedby": `${description ? `${id}-description ` : ""}${id}-help${error ? ` ${id}-error` : ""}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    ...rest,
  };
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        <span className={required ? "required-label" : "optional-label"}>
          {required ? "Required" : "Optional"}
        </span>
      </label>
      {description && (
        <p id={`${id}-description`} className="field-description">
          {description}
        </p>
      )}
      {multiline ? (
        <textarea {...common} rows={4} />
      ) : (
        <input {...common} type="text" />
      )}
      <div className="field-bottom">
        <span id={`${id}-help`} className="character-count">
          {value.length.toLocaleString()} / {max.toLocaleString()}
        </span>
        {error && (
          <span id={`${id}-error`} className="field-error">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
export function SignForm() {
  const [entry, setEntry] = useState<EntryInput>(emptyEntry);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [photoReminder, setPhotoReminder] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const mounted = useRef(false);
  const photoRevision = useRef(0);
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let restoredAttempt: Attempt | null = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          saved.version === 1 &&
          saved.entry &&
          typeof saved.entry === "object"
        ) {
          const clean = structuredClone(emptyEntry);
          for (const key of ["name", "nickname", "contact_handle"] as const)
            if (typeof saved.entry[key] === "string")
              clean[key] = saved.entry[key].slice(
                0,
                key === "contact_handle" ? 250 : 100,
              );
          for (const q of questions)
            if (typeof saved.entry.answers?.[q.key] === "string")
              clean.answers[q.key] = saved.entry.answers[q.key].slice(0, 2000);
          setEntry(clean);
          setRestored(
            Boolean(
              clean.name ||
              clean.nickname ||
              clean.contact_handle ||
              Object.values(clean.answers).some(Boolean),
            ),
          );
          setPhotoReminder(Boolean(saved.hadPhotos));
          const parsed = attemptSchema.safeParse(saved.attempt);
          if (parsed.success) restoredAttempt = parsed.data;
        }
      }
    } catch {
      setStorageOk(false);
    }
    setAttempt(restoredAttempt || newAttempt());
    setReady(true);
    api(
      "/api/settings",
      { signal: controller.signal },
      { schema: publicSettingsSchema },
    )
      .then((result) => {
        if (!controller.signal.aborted) setSettings(result);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSettings({
          available: false,
          submissions_open: false,
          welcome_text: "",
        });
      });
    return () => {
      mounted.current = false;
      photoRevision.current++;
      controller.abort();
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    };
  }, []);
  useEffect(() => {
    photosRef.current = photos;
    if (!ready || doneRef.current) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          version: 1,
          entry,
          attempt,
          hadPhotos: photos.length > 0 || photoReminder,
        }),
      );
      setStorageOk(true);
    } catch {
      setStorageOk(false);
    }
  }, [entry, attempt, photos, ready, done, photoReminder]);
  useEffect(() => {
    if (done) heading.current?.focus({ preventScroll: true });
  }, [done]);
  useEffect(() => {
    if (!busy && !processing && !photos.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, processing, photos.length]);

  function update(key: keyof Omit<EntryInput, "answers">, value: string) {
    setEntry((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
  }
  function move(next: number) {
    if (busyRef.current || processingRef.current) return;
    if (next > step) {
      const validation = entrySchema.safeParse(entry);
      if (!validation.success) {
        const all = fieldErrors(validation.error);
        const relevant = Object.fromEntries(
          Object.entries(all).filter(
            ([key]) =>
              next === 4 ||
              key === "name" ||
              key === "nickname" ||
              (step >= 0 && key === "answers.how_we_met") ||
              (step >= 1 && key === "answers.favourite_memory"),
          ),
        );
        if (Object.keys(relevant).length) {
          setErrors(relevant);
          const first = Object.keys(relevant)[0];
          const invalidStep =
            first === "name" || first === "nickname"
              ? 0
              : (questions.find((q) => `answers.${q.key}` === first)?.step ??
                  4) - 1;
          setStep(Math.min(step, invalidStep));
          setTimeout(
            () => document.getElementById(first.replace(".", "-"))?.focus(),
            50,
          );
          return;
        }
      }
    }
    setStep(next);
    setFurthest((value) => Math.max(value, next));
    setError("");
    requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  async function addPhotos(files: FileList | null) {
    if (!files?.length || processingRef.current || busyRef.current) return;
    setPhotoError("");
    if (files.length + photosRef.current.length > MAX_PHOTOS) {
      setPhotoError(
        "There’s room for up to 3 photos. Choose a few favourites.",
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    processingRef.current = true;
    const current = ++photoRevision.current;
    setProcessing(true);
    const prepared: Photo[] = [];
    let attached = false;
    try {
      for (const original of Array.from(files)) {
        const file = await compressPhoto(original);
        if (!mounted.current || current !== photoRevision.current) return;
        prepared.push({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          caption: "",
          progress: 0,
        });
      }
      photosRef.current = [...photosRef.current, ...prepared];
      setPhotos(photosRef.current);
      attached = true;
      setPhotoReminder(false);
    } catch (err) {
      if (mounted.current && current === photoRevision.current)
        setPhotoError(
          err instanceof Error ? err.message : "This photo couldn’t be opened.",
        );
    } finally {
      if (!attached)
        prepared.forEach((photo) => URL.revokeObjectURL(photo.url));
      if (mounted.current && current === photoRevision.current) {
        processingRef.current = false;
        setProcessing(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  }
  function removePhoto(id: string) {
    if (busyRef.current || processingRef.current) return;
    const photo = photosRef.current.find((photo) => photo.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    photosRef.current = photosRef.current.filter((photo) => photo.id !== id);
    setPhotos(photosRef.current);
    setPhotoReminder(false);
  }
  function finish() {
    doneRef.current = true;
    let cleared = true;
    try {
      if (attempt) clearSubmittedDraft(localStorage, attempt, entry);
    } catch {
      cleared = false;
    }
    if (!mounted.current) return;
    setDone(true);
    setStatus("");
    setStorageOk(cleared);
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    photosRef.current = [];
    setPhotos([]);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function submit() {
    if (busyRef.current || doneRef.current || !attempt || processingRef.current)
      return;
    const parsed = entrySchema.safeParse(entry);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setStep(0);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("Getting your page ready…");
    try {
      const result = await api(
        "/api/uploads",
        {
          method: "POST",
          body: JSON.stringify({
            ...attempt,
            files: photos.map((photo) => ({
              id: photo.id,
              size: photo.file.size,
              mime: photo.file.type,
            })),
          }),
        },
        { schema: uploadResponseSchema },
      );
      if (result.submitted) {
        finish();
        return;
      }
      for (let index = 0; index < photos.length; index++) {
        const photo = photos[index];
        const authorized = result.files.find((file) => file.id === photo.id);
        if (!authorized)
          throw new Error("Couldn’t prepare this photo. Please try again.");
        if (!authorized.uploaded) {
          if (!authorized.url)
            throw new Error("Couldn’t prepare this photo. Please try again.");
          setStatus(`Uploading photo ${index + 1} of ${photos.length}…`);
          await uploadPhoto(
            authorized.url,
            photo.file,
            (progress) =>
              setPhotos((previous) =>
                previous.map((p) =>
                  p.id === photo.id ? { ...p, progress } : p,
                ),
              ),
            attempt.attemptToken,
          );
        }
        setPhotos((previous) =>
          previous.map((p) =>
            p.id === photo.id ? { ...p, progress: 100 } : p,
          ),
        );
      }
      setStatus("Tucking your page into the book…");
      await api(
        "/api/submissions",
        {
          method: "POST",
          body: JSON.stringify({
            ...attempt,
            entry: parsed.data,
            media: photos.map((photo) => ({
              id: photo.id,
              caption: photo.caption,
            })),
            website: "",
          }),
        },
        { schema: submittedResponseSchema, timeoutMs: 70_000 },
      );
      finish();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That didn’t go through. Please try again.",
      );
      if (
        err instanceof RequestError &&
        (err.code === "ATTEMPT_EXPIRED" || err.code === "INVALID_ATTEMPT")
      ) {
        setAttempt(newAttempt());
        setPhotos((previous) =>
          previous.map((photo) => ({
            ...photo,
            id: crypto.randomUUID(),
            progress: 0,
          })),
        );
      }
      if (err instanceof RequestError && err.fields) setErrors(err.fields);
      if (err instanceof RequestError && err.code === "SUBMISSIONS_CLOSED")
        setSettings((previous) => ({
          available: true,
          submissions_open: false,
          welcome_text: previous?.welcome_text || "",
        }));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStatus("");
    }
  }
  function reset() {
    if (busyRef.current || processingRef.current) return;
    photoRevision.current++;
    setEntry(structuredClone(emptyEntry));
    setAttempt(newAttempt());
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    photosRef.current = [];
    setPhotos([]);
    setPhotoReminder(false);
    setRestored(false);
    setErrors({});
    setError("");
    setPhotoError("");
    setStep(0);
    setFurthest(0);
    setResetOpen(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
      setStorageOk(true);
    } catch {
      setStorageOk(false);
    }
    heading.current?.focus();
  }

  if (done)
    return (
      <section className="confirmation">
        <div className="confirmation-art">
          <BrandMark size={80} />
          <span className="confirmation-check">
            <Icon name="check" width="24" height="24" />
          </span>
        </div>
        <h1 ref={heading} tabIndex={-1}>
          You’re part of
          <br />
          the story.
        </h1>
        <p>
          Thanks, {entry.nickname || entry.name}, for adding your stories to the
          book.
        </p>
        <p className="confirmation-privacy">
          <Icon name="lock" width="16" height="16" />
          <span>Only Raghav can see your answers and photos.</span>
        </p>
        <Link href="/" className="button button-primary">
          Back home
        </Link>
        {!storageOk && (
          <p className="caption" role="status">
            Your page was sent. This browser couldn’t clear its local draft;
            please clear site data on a shared device.
          </p>
        )}
      </section>
    );
  if (settings?.available && !settings.submissions_open)
    return (
      <section className="center-page">
        <Icon name="book" width="56" height="56" />
        <p className="eyebrow">THE BOOK IS RESTING FOR A BIT</p>
        <h1>
          A little pause
          <br />
          between pages.
        </h1>
        <p>
          Raghav has closed new entries for now.
          <br />
          If you started a draft, your text is still on this device.
        </p>
        <Link className="button button-primary" href="/">
          Back to the beginning
        </Link>
      </section>
    );

  return (
    <div className="sign-layout">
      <aside className="form-sidebar">
        <h2>A few memories</h2>
        <nav className="step-nav" aria-label="Your entry progress">
          <ol>
            {steps.map((item, index) => (
              <li key={item.nav}>
                <button
                  type="button"
                  disabled={index > furthest || busy || processing}
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => move(index)}
                >
                  <span
                    className={`step-marker ${index < step ? "completed" : ""}`}
                  >
                    {index < step ? (
                      <Icon name="check" width="16" height="16" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>{item.nav}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="sidebar-note">
          <Icon name="lock" />
          <p>Only Raghav can read this.</p>
        </div>
      </aside>
      <div className="form-main">
        <div className="mobile-progress">
          <span>
            {step === 4 ? "One last look" : `Part ${step + 1} of 4`}{" "}
            <strong>{steps[step].nav}</strong>
          </span>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={step + 1}
            aria-label="Entry progress"
          >
            {steps.map((_, index) => (
              <span className={index <= step ? "filled" : ""} key={index} />
            ))}
          </div>
        </div>
        <div className={`form-title title-${steps[step].color}`}>
          <AuroraBackground variant="chapter" />
          <span className="form-title-icon">
            <Icon
              name={
                step === 0
                  ? "pen"
                  : step === 1
                    ? "heart"
                    : step === 2
                      ? "spark"
                      : step === 3
                        ? "camera"
                        : "book"
              }
              width="25"
              height="25"
            />
          </span>
          <p className="eyebrow">
            {step === 4
              ? "YOUR PREVIEW"
              : `CHAPTER ${step + 1} · ${steps[step].nav.toUpperCase()}`}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {steps[step].title}
          </h1>
          <p>{steps[step].description}</p>
        </div>
        {!ready ? (
          <p className="loading-state" role="status">
            Opening a fresh page…
          </p>
        ) : (
          <>
            {restored && (
              <div className="notice notice-success" role="status">
                <Icon name="check" />
                <span>
                  Welcome back. Your text draft is right where you left it.
                </span>
                <button
                  className="icon-button"
                  aria-label="Dismiss draft notice"
                  onClick={() => setRestored(false)}
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            {settings && !settings.available && (
              <div className="notice">
                <Icon name="book" />
                <span>
                  The book is getting ready. You can write a draft now; sending
                  will be available once Raghav finishes setting it up.
                </span>
              </div>
            )}
            {!storageOk && (
              <div className="notice notice-warning" role="alert">
                This browser couldn’t save your draft. Please keep this page
                open until you’ve sent it.
              </div>
            )}
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (step < 4) move(step + 1);
                else void submit();
              }}
            >
              <fieldset disabled={busy || processing} className="form-fields">
                {step === 0 && (
                  <>
                    <TextField
                      id="name"
                      label="What should I call you?"
                      placeholder="Your name"
                      value={entry.name}
                      max={100}
                      required
                      autoComplete="name"
                      error={errors.name}
                      onChange={(value) => update("name", value)}
                    />
                    <TextField
                      id="nickname"
                      label="Or, as I probably know you…"
                      placeholder="Your nickname"
                      value={entry.nickname}
                      max={100}
                      autoComplete="nickname"
                      error={errors.nickname}
                      onChange={(value) => update("nickname", value)}
                    />
                  </>
                )}
                {questions
                  .filter((q) => q.step === step + 1)
                  .map((q) => (
                    <TextField
                      key={q.key}
                      id={`answers-${q.key}`}
                      label={q.label}
                      description={q.description}
                      placeholder={q.placeholder}
                      value={entry.answers[q.key]}
                      required={q.required}
                      multiline={q.key !== "song" && q.key !== "three_words"}
                      max={2000}
                      error={errors[`answers.${q.key}`]}
                      onChange={(value) => {
                        setEntry((previous) => ({
                          ...previous,
                          answers: { ...previous.answers, [q.key]: value },
                        }));
                        setErrors((previous) => ({
                          ...previous,
                          [`answers.${q.key}`]: "",
                        }));
                      }}
                    />
                  ))}
                {step === 3 && (
                  <>
                    <div className="field">
                      <div className="field-label">
                        Photos from the good times
                        <span className="optional-label">Optional</span>
                      </div>
                      <p className="field-description">
                        Up to 3 little windows into the good times.
                      </p>
                      <input
                        ref={fileInput}
                        id="photos"
                        aria-label="Photos from the good times"
                        aria-describedby="photo-help"
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        className="visually-hidden"
                        tabIndex={-1}
                        onChange={(event) => void addPhotos(event.target.files)}
                      />
                      {photos.length < MAX_PHOTOS && (
                        <button
                          type="button"
                          className="upload-zone"
                          onClick={() => fileInput.current?.click()}
                        >
                          <Icon name="camera" width="32" height="32" />
                          <strong>
                            {processing
                              ? "Getting your photos ready…"
                              : "Pick a few favourites"}
                          </strong>
                          <span>Choose from your gallery</span>
                          <small>
                            JPEG, PNG or WebP · Automatically resized to under 2
                            MB
                          </small>
                        </button>
                      )}
                      {photoError && (
                        <p role="alert" className="field-error">
                          {photoError}
                        </p>
                      )}
                      {photoReminder && (
                        <div className="notice">
                          Your text was saved, but photos need to be selected
                          again after a refresh.
                        </div>
                      )}
                      <div className="photo-list">
                        {photos.map((photo, index) => (
                          <div className="photo-editor" key={photo.id}>
                            <img
                              src={photo.url}
                              alt={`Selected photo ${index + 1}`}
                              width="100"
                              height="100"
                            />
                            <div>
                              <label htmlFor={`caption-${photo.id}`}>
                                A caption for this one{" "}
                                <span className="optional-label">Optional</span>
                              </label>
                              <input
                                id={`caption-${photo.id}`}
                                type="text"
                                value={photo.caption}
                                maxLength={250}
                                placeholder="Where was this again?"
                                onChange={(event) =>
                                  setPhotos((previous) =>
                                    previous.map((item) =>
                                      item.id === photo.id
                                        ? {
                                            ...item,
                                            caption: event.target.value,
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                              <span className="caption">
                                {Math.round(photo.file.size / 1024)} KB · Ready
                                to upload
                              </span>
                            </div>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove photo ${index + 1}`}
                              onClick={() => removePhoto(photo.id)}
                            >
                              <Icon name="close" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p id="photo-help" className="caption photo-help">
                        Text saves on this device. Photos may need to be
                        selected again after a refresh.
                      </p>
                    </div>
                    <TextField
                      id="contact_handle"
                      label="Let’s keep in touch."
                      description="An Instagram handle, email, or another way to find you. Only Raghav can see this."
                      placeholder="@you, or wherever you are"
                      value={entry.contact_handle}
                      max={250}
                      onChange={(value) => update("contact_handle", value)}
                      error={errors.contact_handle}
                    />
                  </>
                )}
                {step === 4 && (
                  <div className="preview-page">
                    <div className="preview-label">
                      <Icon name="book" />
                      <span>YOUR PAGE IN RAGHAV’S SLAMBOOK</span>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => move(0)}
                      >
                        Edit answers
                      </button>
                    </div>
                    <EntryContent entry={entry} />
                    {photos.length > 0 && (
                      <section className="preview-photos">
                        <h3>Photos &amp; memories</h3>
                        <div>
                          {photos.map((photo, index) => (
                            <figure key={photo.id}>
                              <img
                                src={photo.url}
                                alt={
                                  photo.caption ||
                                  `Your selected photo ${index + 1}`
                                }
                                width="600"
                                height="450"
                              />
                              {photo.caption && (
                                <figcaption>{photo.caption}</figcaption>
                              )}
                              {busy && (
                                <progress
                                  max={100}
                                  value={photo.progress}
                                  aria-label={`Photo ${index + 1} upload progress`}
                                />
                              )}
                            </figure>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </fieldset>
              {step === 4 && (
                <div className="privacy-note">
                  <Icon name="lock" />
                  <div>
                    <strong>A private page, shared with Raghav.</strong>
                    <p>
                      Your answers and photos are visible only to Raghav. If
                      he’d ever like to feature a memory publicly in the future,
                      he’ll ask your permission first.
                    </p>
                    <p className="caption">
                      Anyone with this link can leave a page; names aren’t
                      verified.
                    </p>
                  </div>
                </div>
              )}
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
              {busy && (
                <p className="submission-status" role="status">
                  <span className="spinner" />
                  {status}
                </p>
              )}
              <div className="form-actions">
                {step > 0 && (
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy || processing}
                    onClick={() => move(step - 1)}
                  >
                    Back
                  </button>
                )}
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={busy || processing}
                >
                  {busy
                    ? "Sending your page…"
                    : processing
                      ? "Preparing photos…"
                      : step === 4
                        ? "Send my page"
                        : step === 3
                          ? "Preview my page"
                          : "Keep going"}
                  {step === 4 && !busy && (
                    <Icon name="heart" width="18" height="18" />
                  )}
                </button>
              </div>
            </form>
            <div className="draft-footer">
              <span>
                <Icon
                  name={storageOk ? "check" : "book"}
                  width="15"
                  height="15"
                />
                {storageOk ? "Draft saved" : "Draft saving unavailable"}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={busy || processing}
                onClick={() => setResetOpen(true)}
              >
                Start fresh
              </button>
            </div>
            {resetOpen && (
              <div className="reset-confirm" role="alert">
                <p>
                  Clear your saved answers and selected photos? This starts a
                  fresh page.
                </p>
                <div className="button-row">
                  <button
                    className="button button-danger"
                    disabled={busy || processing}
                    onClick={reset}
                  >
                    Yes, start fresh
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy || processing}
                    onClick={() => setResetOpen(false)}
                  >
                    Keep my draft
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
