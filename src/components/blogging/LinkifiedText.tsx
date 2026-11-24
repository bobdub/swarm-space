import { Fragment } from "react";
import { SwarmLink } from "@/components/routing/SwarmLink";
import { splitLinks } from "@/lib/blogging/links";
import { cn } from "@/lib/utils";

interface LinkifiedTextProps {
  text: string;
  /** Extra classes for each link. */
  linkClassName?: string;
}

/**
 * Plain text with every URL turned into a clickable link. Links keep their
 * original case even inside uppercase headings.
 */
export function LinkifiedText({ text, linkClassName }: LinkifiedTextProps) {
  return (
    <>
      {splitLinks(text).map((piece, index) =>
        piece.kind === "url" ? (
          <SwarmLink
            key={`${index}-${piece.href}`}
            href={piece.href}
            className={cn(
              "normal-case break-all text-[hsl(174,59%,76%)] underline decoration-[hsla(174,59%,56%,0.4)] underline-offset-4 hover:decoration-[hsl(174,59%,76%)]",
              linkClassName,
            )}
          >
            {piece.text}
          </SwarmLink>
        ) : (
          <Fragment key={index}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

export default LinkifiedText;
