/** Compare which peers the main mesh reached against a raw Test Mode run. */
export interface ConnectionComparison {
  both: string[];
  meshOnly: string[];
  testOnly: string[];
}

export function compareConnections(meshPeers: readonly string[], testPeers: readonly string[]): ConnectionComparison {
  const mesh = new Set(meshPeers.map(id => id.trim()).filter(Boolean));
  const test = new Set(testPeers.map(id => id.trim()).filter(Boolean));
  return {
    both: [...mesh].filter(id => test.has(id)).sort(),
    meshOnly: [...mesh].filter(id => !test.has(id)).sort(),
    testOnly: [...test].filter(id => !mesh.has(id)).sort(),
  };
}
