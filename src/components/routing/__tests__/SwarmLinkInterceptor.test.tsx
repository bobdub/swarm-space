import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SwarmLinkInterceptor } from '../SwarmLinkInterceptor';
import { SwarmLink } from '../SwarmLink';

function MeetingProbe() {
  // Stands in for app-root hosts (BrainSyncHost, PersistentAudioLayer) that
  // must survive navigation; a full page load would remount everything.
  return <span data-testid="meeting">alive</span>;
}
function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname}{loc.search}</span>;
}

function renderApp(content: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={['/brain']}>
      <SwarmLinkInterceptor />
      <MeetingProbe />
      <Where />
      <Routes>
        <Route path="/brain" element={content} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SWARM links during a Brain meeting', () => {
  it('navigates in-app for plain same-origin anchors without reloading', () => {
    renderApp(<a href={`${window.location.origin}/posts/abc`}>post</a>);
    const meeting = screen.getByTestId('meeting');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { screen.getByText('post').dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByTestId('where').textContent).toBe('/posts/abc');
    expect(screen.getByTestId('meeting')).toBe(meeting);
  });

  it('routes links from Brain chat markdown in-app', () => {
    renderApp(
      <ReactMarkdown components={{ a: SwarmLink }}>
        {'see [alice](https://swarm-space.lovable.app/u/alice?tab=posts)'}
      </ReactMarkdown>,
    );
    fireEvent.click(screen.getByText('alice'));
    expect(screen.getByTestId('where').textContent).toBe('/u/alice?tab=posts');
  });

  it('opens external links in a new tab and stays put', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderApp(<a href="https://example.com/page">ext</a>);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByText('ext').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
    expect(screen.getByTestId('where').textContent).toBe('/brain');
  });

  it('renders external chat links with target=_blank', () => {
    renderApp(<ReactMarkdown components={{ a: SwarmLink }}>{'[gh](https://github.com)'}</ReactMarkdown>);
    const a = screen.getByText('gh');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('leaves modified clicks to the browser', () => {
    renderApp(<a href="/posts/abc">post</a>);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    screen.getByText('post').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(screen.getByTestId('where').textContent).toBe('/brain');
  });
});
