import { z } from "zod";

export const QUESTIONNAIRE_VERSION = 1;
export const MAX_PHOTOS = 3;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const BOOK_TITLE = "Raghav’s Slambook";
export const DEFAULT_WELCOME =
  "Some of my favourite stories have you in them. Let’s keep a little piece of those days — the first hellos, the ridiculous laughs, and everything in between.";

export const questions = [
  {
    key: "how_we_met",
    label: "How did our paths cross?",
    description: "The place, the people, or the happy accident.",
    required: true,
    placeholder: "It all started…",
    step: 1,
  },
  {
    key: "first_impression",
    label: "What do you remember about our first hello?",
    description: "First impressions, awkward introductions — all welcome.",
    required: false,
    placeholder: "I remember thinking…",
    step: 1,
  },
  {
    key: "favourite_memory",
    label: "What’s a favourite memory we share?",
    description: "A trip, a hangout, or a day that still makes you laugh.",
    required: true,
    placeholder: "I’ll never forget the time…",
    step: 2,
  },
  {
    key: "inside_joke",
    label: "A funny incident or an inside joke?",
    description: "The one that still makes you laugh.",
    required: false,
    placeholder: "You already know what I’m going to say…",
    step: 2,
  },
  {
    key: "song",
    label: "A song that takes you back?",
    description: "A track from a trip, a hangout, or a shared memory.",
    required: false,
    placeholder: "Song title and artist…",
    step: 2,
  },
  {
    key: "unsaid_note",
    label: "Anything left unsaid?",
    description: "Something you’ve always wanted to tell me, but never could.",
    required: false,
    placeholder: "I’ve been meaning to tell you…",
    step: 2,
  },
  {
    key: "three_words",
    label: "You, in three words. Right now.",
    description: "A tiny time capsule of who you are today.",
    required: false,
    placeholder: "Curious, caffeinated, figuring-it-out…",
    step: 3,
  },
  {
    key: "future_message",
    label: "Leave a note for a few years from now.",
    description: "A plan, a prediction, or a reminder for later.",
    required: false,
    placeholder: "A few years from now…",
    step: 3,
  },
] as const;
export type AnswerKey = (typeof questions)[number]["key"];
const longAnswer = z
  .string()
  .trim()
  .max(2000, "Keep this answer to 2,000 characters.");
const requiredAnswer = longAnswer.min(1, "A little answer here, please.");
export const answersSchema = z
  .object({
    how_we_met: requiredAnswer,
    first_impression: longAnswer,
    favourite_memory: requiredAnswer,
    inside_joke: longAnswer,
    song: longAnswer,
    // Additive optional question: older entries and open tabs remain valid.
    unsaid_note: longAnswer.default(""),
    three_words: longAnswer,
    future_message: longAnswer,
  })
  .strict();
export const entrySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Tell me your name.")
      .max(100, "Use 100 characters or fewer."),
    nickname: z.string().trim().max(100, "Use 100 characters or fewer."),
    contact_handle: z.string().trim().max(250, "Use 250 characters or fewer."),
    answers: answersSchema,
  })
  .strict();
export type EntryInput = z.infer<typeof entrySchema>;
export const emptyEntry: EntryInput = {
  name: "",
  nickname: "",
  contact_handle: "",
  answers: {
    how_we_met: "",
    first_impression: "",
    favourite_memory: "",
    inside_joke: "",
    song: "",
    unsaid_note: "",
    three_words: "",
    future_message: "",
  },
};
export const attemptSchema = z.object({
  requestId: z.uuid(),
  attemptToken: z.string().regex(/^[a-f0-9]{64}$/, "Invalid submission token."),
});
export const fileSchema = z
  .object({
    id: z.uuid(),
    size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
    mime: z.enum(IMAGE_TYPES),
  })
  .strict();
export const uploadSchema = attemptSchema
  .extend({
    files: z
      .array(fileSchema)
      .max(MAX_PHOTOS)
      .refine(
        (files) => new Set(files.map((f) => f.id)).size === files.length,
        "Duplicate photo identifiers.",
      ),
  })
  .strict();
export const submissionSchema = attemptSchema
  .extend({
    entry: entrySchema,
    media: z
      .array(
        z
          .object({ id: z.uuid(), caption: z.string().trim().max(250) })
          .strict(),
      )
      .max(MAX_PHOTOS)
      .refine(
        (media) => new Set(media.map((f) => f.id)).size === media.length,
        "Duplicate photo identifiers.",
      ),
    website: z.literal("").optional(),
  })
  .strict();
export type SubmissionInput = z.infer<typeof submissionSchema>;
export const okResponseSchema = z.object({ ok: z.literal(true) });
export const deleteResponseSchema = z.object({
  deleted: z.literal(true),
  photosRemoved: z.boolean(),
});
export const submittedResponseSchema = z.object({ submitted: z.literal(true) });
export const uploadResponseSchema = z.object({
  submitted: z.boolean(),
  files: z
    .array(
      z
        .object({
          id: z.uuid(),
          uploaded: z.boolean(),
          url: z.string().min(1).optional(),
        })
        .refine((file) => file.uploaded || Boolean(file.url)),
    )
    .max(MAX_PHOTOS),
});
const mediaRecordSchema = z.object({
  id: z.uuid(),
  entry_id: z.uuid(),
  storage_path: z.string().min(1),
  caption: z.string(),
  size_bytes: z.number().int().positive(),
  mime_type: z.enum(IMAGE_TYPES),
  sort_order: z.number().int().nonnegative(),
});
export type MediaRecord = z.infer<typeof mediaRecordSchema>;
export const entryRecordSchema = entrySchema
  .extend({
    id: z.uuid(),
    created_at: z.iso.datetime({ offset: true }),
    questionnaire_version: z.number().int().positive(),
    entry_media: z.array(mediaRecordSchema),
  })
  .strip();
export type EntryRecord = z.infer<typeof entryRecordSchema>;
export const entryResponseSchema = z.object({ entry: entryRecordSchema });
export const entryListResponseSchema = z.object({
  entries: z.array(
    entryRecordSchema.extend({
      entry_media: z.array(z.object({ id: z.uuid() })),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
});
export const publicSettingsSchema = z.object({
  submissions_open: z.boolean(),
  welcome_text: z.string(),
  available: z.boolean(),
});
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
export const sessionResponseSchema = z.object({
  settings: publicSettingsSchema,
  demo: z.boolean().optional(),
});

export function isOwnerIdentity(
  userId: string | undefined,
  ownerId: string | undefined,
): boolean {
  return Boolean(userId && ownerId && userId === ownerId);
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}
