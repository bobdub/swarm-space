/**
 * SwarmLink — anchor for user-supplied URLs (chat markdown, post text).
 * SWARM links render as in-app router links so they never reload the page
 * (which would end a Brain meeting); everything else opens in a new tab.
 */
import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { resolveSwarmPath } from '@/lib/routing/swarmLinks';

export type SwarmLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** react-markdown passes its AST node; it must not reach the DOM. */
  node?: unknown;
};

export function SwarmLink({ href, children, node: _node, target: _target, rel: _rel, ...rest }: SwarmLinkProps) {
  const path = resolveSwarmPath(href);
  if (path !== null) {
    return (
      <Link to={path} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

export default SwarmLink;
