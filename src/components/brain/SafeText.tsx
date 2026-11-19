import { Suspense, type ComponentProps } from 'react';
import { Text as DreiText } from '@react-three/drei';

/**
 * 3D text that can never hold up the rest of the page.
 *
 * drei's <Text> suspends until its font is ready, and the font comes from a
 * CDN. Without a boundary of its own, that suspension reaches the <Canvas>,
 * which then holds the whole DOM tree around it in a "loading" state: every
 * update from the network (chat lines, people joining, presence) is rendered
 * and thrown away until the font arrives, and only clicks or typing get
 * through. On a slow or blocked CDN that is forever. Here the label simply
 * appears once its font has loaded.
 */
export function Text(props: ComponentProps<typeof DreiText>): JSX.Element {
  return (
    <Suspense fallback={null}>
      <DreiText {...props} />
    </Suspense>
  );
}
