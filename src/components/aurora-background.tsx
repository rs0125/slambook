import Aurora from "./aurora/Aurora";
import styles from "./aurora-background.module.css";

const pageAuroras = {
  cover: {
    colorStops: ["#b993e5", "#ecc0e1", "#f3bfa7"],
    amplitude: 0.65,
    blend: 1,
    height: 0.48,
    speed: 1.1,
    scale: 0.75,
    glow: 0.9,
    opacity: 0.8,
  },
  form: {
    colorStops: ["#c2a1e5", "#edbbdf", "#d4bfee"],
    amplitude: 0.7,
    blend: 1,
    height: 0.46,
    speed: 1.2,
    scale: 0.6,
    glow: 0.85,
    opacity: 0.58,
  },
};

export function AuroraBackground({
  variant = "cover",
}: {
  variant?: "cover" | "form" | "chapter";
}) {
  const treatment =
    variant === "form"
      ? styles.subdued
      : variant === "chapter"
        ? styles.chapter
        : styles.cover;
  return (
    <div className={`${styles.aurora} ${treatment}`} aria-hidden="true">
      {variant !== "chapter" && (
        <Aurora
          {...pageAuroras[variant]}
          direction="bottom"
          lightMode={false}
          layers={1}
          brightness={1}
          mouseInteraction={false}
          intro={false}
          dpr={1.5}
        />
      )}
      <div className={styles.grain} />
    </div>
  );
}
