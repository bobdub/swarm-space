/**
 * SwarmLinkInterceptor — mount ONCE inside the router.
 *
 * Catches clicks on plain `<a>` elements anywhere in the app (markdown in
 * Brain chat, links in post text, profile websites…) that React Router does
 * not already handle:
 *   • SWARM links (same origin or a known SWARM host) navigate in-app, so
 *     the WebRTC mesh and any running Brain meeting stay alive. The Brain
 *     sync dock keeps the call going on the page you land on.
 *   • External http(s) links always open separately, in a new tab.
 *
 * Modified clicks (ctrl/cmd/shift/alt, middle button), `download` links and
 * anchors marked `data-swarm-native` are left to the browser.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isExternalWebLink, isModifiedClick, resolveSwarmPath } from '@/lib/routing/swarmLinks';

export function SwarmLinkInterceptor(): null {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || isModifiedClick(event)) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.hasAttribute('download') || anchor.dataset.swarmNative !== undefined) return;

      const href = anchor.getAttribute('href');
      const path = resolveSwarmPath(href);
      if (path !== null) {
        event.preventDefault();
        navigate(path);
        return;
      }

      if (isExternalWebLink(href) && anchor.target !== '_blank') {
        event.preventDefault();
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);

  return null;
}

export default SwarmLinkInterceptor;
