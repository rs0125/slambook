import { questions, type EntryInput } from "@/lib/questions";
import { Icon } from "@/components/icons";

export function EntryContent({ entry }: { entry: EntryInput }) {
  return (
    <div className="entry-content">
      <div className="entry-person">
        <span className="person-initial">
          {entry.name.slice(0, 1).toLocaleUpperCase()}
        </span>
        <div>
          <h2>{entry.name}</h2>
          {entry.nickname && <p>Also known as {entry.nickname}</p>}
        </div>
      </div>
      {questions
        .filter((q) => entry.answers[q.key])
        .map((q) => (
          <section className={`answer-block answer-step-${q.step}`} key={q.key}>
            <h3>{q.label}</h3>
            <p>{entry.answers[q.key]}</p>
          </section>
        ))}
      {entry.contact_handle && (
        <section className="contact-block">
          <h3>
            <Icon name="lock" width="16" height="16" /> Keeping in touch
          </h3>
          <p>{entry.contact_handle}</p>
          <span className="caption">Private contact detail</span>
        </section>
      )}
    </div>
  );
}
