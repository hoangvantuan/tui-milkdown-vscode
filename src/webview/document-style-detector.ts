/** Detected dominant formatting style from original markdown */
export interface DocStyle {
  bullet: string;   // '-' | '*' | '+'
  emphasis: string; // '*' | '_'
  strong: string;   // '**' | '__'
  fence: string;    // '`' | '~'
  hr: string;       // '---' | '***' | '___'
}

const DEFAULT_STYLE: DocStyle = {
  bullet: '-', emphasis: '*', strong: '**', fence: '`', hr: '---',
};

let currentDocStyle: DocStyle = { ...DEFAULT_STYLE };

export function getDocStyle(): DocStyle {
  return currentDocStyle;
}

/**
 * Detect dominant formatting style from markdown source.
 * Called once on document load and on external updates.
 */
export function detectDocStyle(md: string): DocStyle {
  // Bullet: first unordered list item
  const bullet = md.match(/^[ \t]*([-*+]) /m)?.[1] || DEFAULT_STYLE.bullet;

  // Emphasis: first *text* or _text_ (avoid ** and __)
  const emMatch = md.match(/(?<![*_])([*_])(?![*_\s])(?:(?!\1).)+?\1(?![*_])/);
  const emphasis = emMatch?.[1] || DEFAULT_STYLE.emphasis;

  // Strong: first ** or __
  const strongMatch = md.match(/(\*\*|__)(?!\s)/);
  const strong = strongMatch?.[1] || DEFAULT_STYLE.strong;

  // Fence: first ``` or ~~~
  const fenceMatch = md.match(/^(`{3,}|~{3,})/m);
  const fence = fenceMatch?.[1]?.[0] || DEFAULT_STYLE.fence;

  // HR: first ---, ***, ___
  const hrMatch = md.match(/^([-*_])\1{2,}\s*$/m);
  const hr = hrMatch ? hrMatch[1].repeat(3) : DEFAULT_STYLE.hr;

  currentDocStyle = { bullet, emphasis, strong, fence, hr };
  return currentDocStyle;
}
