import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  DEFAULT_WELCOME,
  QUESTIONNAIRE_VERSION,
  emptyEntry,
  entryRecordSchema,
  publicSettingsSchema,
  fileSchema,
  type SubmissionInput,
  type uploadSchema,
} from "./questions";
import { validateImage } from "./image-validation";
import { z } from "zod";
import { DemoError } from "./demo-mode";

type UploadInput = z.infer<typeof uploadSchema>;
const mediaPathSchema = z
  .string()
  .regex(/^media\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/);
const demoStateSchema = z
  .object({
    version: z.literal(1),
    settings: publicSettingsSchema.omit({ available: true }),
    entries: z.array(entryRecordSchema),
    attempts: z.record(
      z.uuid(),
      z.object({
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        expires: z.number().finite(),
        files: z.array(
          fileSchema.extend({
            path: mediaPathSchema,
            active: z.boolean(),
            uploaded: z.boolean(),
          }),
        ),
        entryId: z.uuid().optional(),
      }),
    ),
    pendingDeletions: z.array(mediaPathSchema).default([]),
  })
  .strict();
type DemoState = z.infer<typeof demoStateSchema>;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const extension = (mime: string) =>
  mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

function seed(): DemoState {
  const friends = [
    {
      name: "Aditi Sharma",
      nickname: "Adi",
      met: "The college canteen, over the last available samosa.",
      memory:
        "That rainy road trip when we missed our turn and found a much better adventure. We were soaking wet, hopelessly lost, and laughing the whole way.",
      song: "Ilahi — Arijit Singh",
      future: "Same time, same terrible jokes, ten years from now.",
    },
    {
      name: "Kabir Mehta",
      nickname: "Kabs",
      met: "A mutual friend’s birthday. We argued about the playlist and immediately became friends.",
      memory:
        "The midnight chai stop after our first big trek. Nobody had any energy left, but somehow we talked until sunrise.",
      song: "The Nights — Avicii",
      future: "Let’s finally take that trip we keep putting in the group chat.",
    },
    {
      name: "Meera Iyer",
      nickname: "Mimi",
      met: "We were assigned the same group project. I brought the notes; you brought snacks.",
      memory:
        "Cooking dinner for everyone and setting off the smoke alarm. We ordered pizza and called it a successful evening.",
      song: "Count on Me — Bruno Mars",
      future: "Stay kind, stay curious, and please learn one reliable recipe.",
    },
    {
      name: "Arjun Rao",
      nickname: "AJ",
      met: "On the cricket ground, when you needed one more player.",
      memory:
        "Our entirely unnecessary victory lap after winning that neighbourhood match by one run. We celebrated like we’d won a World Cup.",
      song: "Yaaron — KK",
      future:
        "Even when our knees give up, the post-match chai tradition stays.",
    },
    {
      name: "Isha Kapoor",
      nickname: "Ish",
      met: "In the queue at a music festival. We both knew every word to the opening song.",
      memory:
        "Singing our hearts out at the concert, losing our voices, and communicating only through dramatic gestures the next morning.",
      song: "A Sky Full of Stars — Coldplay",
      future:
        "More live music, fewer plans, and a standing invitation to be ourselves.",
    },
    {
      name: "Nikhil Verma",
      nickname: "Niks",
      met: "Our first week at work. You helped me find the meeting room I’d walked past three times.",
      memory:
        "That spontaneous weekend breakfast that somehow turned into an all-day walk around the city. The best plans are clearly the ones we don’t make.",
      song: "Safarnama — Lucky Ali",
      future:
        "Keep making time for the small, ordinary days. Those are the ones I’ll remember.",
    },
  ];
  return {
    version: 1,
    settings: { submissions_open: true, welcome_text: DEFAULT_WELCOME },
    attempts: {},
    pendingDeletions: [],
    entries: friends.map((friend, index) => ({
      ...structuredClone(emptyEntry),
      id: randomUUID(),
      name: friend.name,
      nickname: friend.nickname,
      questionnaire_version: QUESTIONNAIRE_VERSION,
      created_at: new Date(Date.now() - index * 86_400_000).toISOString(),
      answers: {
        ...emptyEntry.answers,
        how_we_met: friend.met,
        first_impression: "Easy to talk to. Hard to beat at telling a story.",
        favourite_memory: friend.memory,
        inside_joke: "Just five more minutes. Famous last words.",
        song: friend.song,
        three_words: "Curious, grateful, growing",
        future_message: friend.future,
      },
      entry_media: [],
    })),
  };
}

// One local Node process owns this store. Atomic JSON replacement and a queue
// keep overlapping submissions/settings writes from losing each other's data.
export class DemoStore {
  private tail: Promise<unknown> = Promise.resolve();
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }
  private async save(state: DemoState) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `state-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(state, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, join(this.directory, "state.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async load(): Promise<DemoState> {
    try {
      const parsed = demoStateSchema.safeParse(
        JSON.parse(await readFile(join(this.directory, "state.json"), "utf8")),
      );
      if (!parsed.success)
        throw new DemoError(
          503,
          "The local demo data needs repair. Its saved file has been left unchanged.",
        );
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const state = seed();
      await this.save(state);
      return state;
    }
  }
  private async cleanupDeletions(state: DemoState) {
    if (!state.pendingDeletions.length) return true;
    const results = await Promise.allSettled(
      state.pendingDeletions.map((path) =>
        rm(this.filePath(path), { force: true }),
      ),
    );
    const remaining = state.pendingDeletions.filter(
      (_, index) => results[index].status === "rejected",
    );
    if (remaining.length !== state.pendingDeletions.length) {
      state.pendingDeletions = remaining;
      await this.save(state);
    }
    return remaining.length === 0;
  }
  private transaction<T>(
    work: (state: DemoState) => T | Promise<T>,
    write = false,
  ): Promise<T> {
    const operation = this.tail.then(async () => {
      const state = await this.load();
      await this.cleanupDeletions(state);
      const result = await work(state);
      if (write) await this.save(state);
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private filePath(path: string) {
    if (!/^media\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(path))
      throw new DemoError(400, "Invalid photo path.");
    const absolute = resolve(this.directory, path);
    if (!absolute.startsWith(this.directory + sep))
      throw new DemoError(400, "Invalid photo path.");
    return absolute;
  }
  private attempt(state: DemoState, id: string, token: string) {
    const attempt = state.attempts[id];
    if (!attempt || attempt.hash !== hashToken(token))
      throw new DemoError(
        403,
        "This attempt could not be verified.",
        "INVALID_ATTEMPT",
      );
    if (!attempt.entryId && attempt.expires < Date.now())
      throw new DemoError(
        410,
        "This attempt expired. Please retry; your answers are safe.",
        "ATTEMPT_EXPIRED",
      );
    return attempt;
  }
  private assertOpen(state: DemoState) {
    if (!state.settings.submissions_open)
      throw new DemoError(
        409,
        "New entries are currently closed.",
        "SUBMISSIONS_CLOSED",
      );
  }
  settings() {
    return this.transaction((state) => ({
      ...state.settings,
      available: true,
    }));
  }
  updateSettings(input: Partial<DemoState["settings"]>) {
    return this.transaction((state) => {
      Object.assign(state.settings, input);
    }, true);
  }
  list(search = "", page = 1) {
    return this.transaction((state) => {
      const query = search.trim().slice(0, 100).toLocaleLowerCase();
      const entries = state.entries
        .filter((entry) =>
          `${entry.name} ${entry.nickname}`.toLocaleLowerCase().includes(query),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return {
        entries: entries.slice((page - 1) * 12, page * 12),
        total: entries.length,
        page,
      };
    });
  }
  get(id: string) {
    return this.transaction(
      (state) => state.entries.find((entry) => entry.id === id) ?? null,
    );
  }
  exportEntries(id?: string) {
    return this.transaction((state) =>
      state.entries.filter((entry) => !id || entry.id === id),
    );
  }
  async delete(id: string) {
    return this.transaction(async (state) => {
      const entry = state.entries.find((entry) => entry.id === id);
      state.entries = state.entries.filter((entry) => entry.id !== id);
      state.pendingDeletions = [
        ...new Set([
          ...state.pendingDeletions,
          ...(entry?.entry_media.map((media) => media.storage_path) || []),
        ]),
      ];
      // Hide the entry and persist cleanup work before touching its files.
      await this.save(state);
      return this.cleanupDeletions(state);
    });
  }
  prepare(input: UploadInput) {
    return this.transaction((state) => {
      let attempt = state.attempts[input.requestId];
      if (attempt) {
        attempt = this.attempt(state, input.requestId, input.attemptToken);
        if (attempt.entryId) return { submitted: true, files: [] };
      }
      this.assertOpen(state);
      if (!attempt)
        attempt = state.attempts[input.requestId] = {
          hash: hashToken(input.attemptToken),
          expires: Date.now() + 86_400_000,
          files: [],
        };
      attempt.files.forEach((file) => {
        file.active = false;
      });
      for (const incoming of input.files) {
        let file = attempt.files.find((file) => file.id === incoming.id);
        if (
          file &&
          (file.size !== incoming.size || file.mime !== incoming.mime)
        )
          throw new DemoError(
            400,
            "Please reselect this photo.",
            "INVALID_MEDIA",
          );
        if (!file) {
          if (attempt.files.length >= 12)
            throw new DemoError(
              400,
              "Start a fresh page to select more photos.",
              "INVALID_MEDIA",
            );
          file = {
            ...incoming,
            active: true,
            uploaded: false,
            path: `media/${input.requestId}/${incoming.id}.${extension(incoming.mime)}`,
          };
          attempt.files.push(file);
        }
        file.active = true;
      }
      return {
        submitted: false,
        files: attempt.files
          .filter((file) => file.active)
          .map((file) => ({
            id: file.id,
            uploaded: file.uploaded,
            url: `/api/demo/uploads/${file.id}?requestId=${input.requestId}&token=${input.attemptToken}`,
          })),
      };
    }, true);
  }
  putPhoto(
    requestId: string,
    token: string,
    fileId: string,
    bytes: Uint8Array,
    mime: string,
  ) {
    return this.transaction(async (state) => {
      const attempt = this.attempt(state, requestId, token);
      this.assertOpen(state);
      const file = attempt.files.find(
        (file) => file.id === fileId && file.active,
      );
      if (!file || attempt.entryId || file.mime !== mime)
        throw new DemoError(
          400,
          "This photo upload is no longer valid.",
          "INVALID_MEDIA",
        );
      try {
        await validateImage(bytes, {
          size_bytes: file.size,
          mime_type: file.mime,
        });
      } catch {
        throw new DemoError(
          400,
          "Please choose a valid JPEG, PNG, or WebP photo.",
          "INVALID_MEDIA",
        );
      }
      const destination = this.filePath(file.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      if (!file.uploaded) {
        try {
          await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          await validateImage(await readFile(destination), {
            size_bytes: file.size,
            mime_type: file.mime,
          });
        }
      }
      file.uploaded = true;
    }, true);
  }
  submit(input: SubmissionInput) {
    return this.transaction(async (state) => {
      const attempt = this.attempt(state, input.requestId, input.attemptToken);
      if (attempt.entryId) return { submitted: true };
      this.assertOpen(state);
      const active = attempt.files.filter((file) => file.active);
      if (
        active.length !== input.media.length ||
        input.media.some(
          (media) =>
            !active.some((file) => file.id === media.id && file.uploaded),
        )
      )
        throw new DemoError(
          400,
          "Please finish uploading your photos.",
          "UPLOAD_INCOMPLETE",
        );
      const id = randomUUID();
      const media = [];
      for (let index = 0; index < input.media.length; index++) {
        const item = input.media[index];
        const file = active.find((file) => file.id === item.id)!;
        await validateImage(await readFile(this.filePath(file.path)), {
          size_bytes: file.size,
          mime_type: file.mime,
        });
        media.push({
          id: file.id,
          entry_id: id,
          storage_path: file.path,
          caption: item.caption,
          size_bytes: file.size,
          mime_type: file.mime,
          sort_order: index,
        });
      }
      state.entries.unshift({
        ...input.entry,
        id,
        created_at: new Date().toISOString(),
        questionnaire_version: QUESTIONNAIRE_VERSION,
        entry_media: media,
      });
      attempt.entryId = id;
      return { submitted: true };
    }, true);
  }
  photo(id: string) {
    return this.transaction(async (state) => {
      const media = state.entries
        .flatMap((entry) => entry.entry_media)
        .find((media) => media.id === id);
      if (!media) throw new DemoError(404, "This photo could not be found.");
      return {
        bytes: await readFile(this.filePath(media.storage_path)),
        mime: media.mime_type,
      };
    });
  }
  download(path: string, signal?: AbortSignal) {
    return this.transaction(async (state) => {
      signal?.throwIfAborted();
      if (
        !state.entries.some((entry) =>
          entry.entry_media.some((media) => media.storage_path === path),
        )
      )
        throw new DemoError(404, "This photo could not be found.");
      return new Uint8Array(await readFile(this.filePath(path), { signal }));
    });
  }
}
