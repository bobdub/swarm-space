import asset from './brain-spaceship.asset.json';
// The asset gateway lives on project hosting, not Vite's sandbox fallback.
export const BRAIN_SPACESHIP_URL = `https://swarm-space.lovable.app${asset.url}`;