import { useMemo } from "react";
import katex from "katex";

export default function Tex({ latex, inline = false }: { latex: string; inline?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(latex, { displayMode: !inline, throwOnError: false }),
    [latex, inline]
  );
  return inline ? (
    <span className="tex" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="tex" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
