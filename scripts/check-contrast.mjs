import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import postcss from "postcss";

const globalCss = postcss.parse(await readFile("src/app/globals.css", "utf8"));
const auroraCss = postcss.parse(
  await readFile("src/components/aurora-background.module.css", "utf8"),
);
function declarations(css, selector) {
  const result = {};
  css.walkRules(selector, (rule) => {
    if (rule.parent.type !== "root") return;
    rule.walkDecls((decl) => (result[decl.prop] = decl.value));
  });
  return result;
}
const tokens = declarations(globalCss, ":root");
const resolve = (value) =>
  value.replace(/var\((--[\w-]+)\)/g, (_, name) => tokens[name]);
function rgb(value) {
  const hex = resolve(value);
  assert.match(hex, /^#[\da-f]{6}$/i, "Expected an opaque sRGB colour");
  return [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  );
}
function luminance(colour) {
  const linear = colour.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

// Scope: the chapter cards, whose text inherits the same opaque ink colour.
// The solid pastel base is overlaid only with soft-light grain.
// An opaque inherited base is essential: blending against transparency would
// require a different calculation.
assert.equal(
  declarations(auroraCss, ".chapter")["background-color"],
  "inherit",
);
assert.equal(declarations(auroraCss, ".grain")["mix-blend-mode"], "soft-light");
const grainOpacity = Number(declarations(auroraCss, ".chapter .grain").opacity);
assert.ok(grainOpacity >= 0 && grainOpacity <= 1);
const ink = rgb(declarations(globalCss, ".form-title").color);
const rows = [];
for (const palette of ["pink", "yellow", "violet", "mint"]) {
  const card = declarations(globalCss, `.title-${palette}`);
  const base = rgb(card.background);
  // W3C soft-light at its darkest possible source (black) is B(Cb,0)=Cb².
  // Composite at the CSS grain opacity, then round downward to 8-bit sRGB.
  const darkest = base.map(
    (channel) =>
      Math.floor(
        255 * ((1 - grainOpacity) * channel + grainOpacity * channel ** 2),
      ) / 255,
  );
  const contrast = (luminance(darkest) + 0.05) / (luminance(ink) + 0.05);
  assert.ok(luminance(darkest) > luminance(ink));
  rows.push({
    palette,
    "conservative contrast floor": `${(Math.floor(contrast * 100) / 100).toFixed(2)}:1`,
    "14px label / 16px body (AA 4.5:1)": contrast >= 4.5 ? "PASS" : "FAIL",
    "36px heading (AA 3:1)": contrast >= 3 ? "PASS" : "FAIL",
  });
  assert.ok(contrast >= 4.5, `${palette} fails normal-text AA contrast`);
}
console.table(rows);
console.log(
  "CSS colour/compositing bounds for the solid pastel cards, including black grain at its full opacity. This is not a browser-rendered or whole-site accessibility audit.",
);
