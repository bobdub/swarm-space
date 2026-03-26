const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

const smooth = (next: number, previous?: number): number => {
  if (typeof previous !== 'number') {
    return clamp(next);
  }
  return clamp((previous * 0.4) + (next * 0.6));
};

export interface UqrcEthicsTelemetry {
  successRate: number;
  failureRate: number;
  rendezvousRate: number;
  throughputBalance: number;
  activityDensity: number;
  redundancy: number;
  entropy: number;
}

export interface UqrcEthicsAxiomVector {
  axiom0_0: number;
  axiom0_1: number;
  axiom0_2: number;
  axiom0_3: number;
  axiom0_4: number;
  axiom0_5: number;
  axiom0_6: number;
  axiom0_7: number;
  axiom0_8: number;
  axiom0_9: number;
  axiom1_0: number;
  axiom1_1: number;
  axiom1_2: number;
  axiom1_3: number;
  axiom1_4: number;
}

export interface UqrcEthicsEmberVector {
  ember0_0: number;
  ember0_1: number;
  ember0_2: number;
  ember0_3: number;
  ember0_4: number;
  ember0_5: number;
  ember0_6: number;
  ember0_7: number;
  ember0_8: number;
  ember0_9: number;
}

export interface UqrcMeaningManifoldState {
  harmonicSymmetry: number;
  contactNuance: number;
  memoryContinuity: number;
  imaginationFreedom: number;
  truthVisibility: number;
  verifiability: number;
}

export interface UqrcEthicsState {
  harmRisk: number;
  confidence: number;
  interventionLevel: number;
  meaningManifold: UqrcMeaningManifoldState;
  axioms: UqrcEthicsAxiomVector;
  embers: UqrcEthicsEmberVector;
}

export const DEFAULT_UQRC_ETHICS_STATE: UqrcEthicsState = {
  harmRisk: 0.2,
  confidence: 0.7,
  interventionLevel: 0.2,
  meaningManifold: {
    harmonicSymmetry: 0.65,
    contactNuance: 0.6,
    memoryContinuity: 0.65,
    imaginationFreedom: 0.7,
    truthVisibility: 0.65,
    verifiability: 0.7,
  },
  axioms: {
    axiom0_0: 0.65,
    axiom0_1: 0.6,
    axiom0_2: 0.7,
    axiom0_3: 0.65,
    axiom0_4: 0.65,
    axiom0_5: 0.65,
    axiom0_6: 0.65,
    axiom0_7: 0.7,
    axiom0_8: 0.65,
    axiom0_9: 0.65,
    axiom1_0: 0.7,
    axiom1_1: 0.7,
    axiom1_2: 0.7,
    axiom1_3: 0.7,
    axiom1_4: 0.7,
  },
  embers: {
    ember0_0: 0.7,
    ember0_1: 0.7,
    ember0_2: 0.7,
    ember0_3: 0.7,
    ember0_4: 0.7,
    ember0_5: 0.7,
    ember0_6: 0.7,
    ember0_7: 0.6,
    ember0_8: 0.65,
    ember0_9: 0.5,
  },
};

const mean = (...values: number[]): number => clamp(values.reduce((sum, value) => sum + value, 0) / values.length);

export function deriveUqrcEthicsState(
  telemetry: UqrcEthicsTelemetry,
  previous: UqrcEthicsState = DEFAULT_UQRC_ETHICS_STATE,
): UqrcEthicsState {
  const successRate = clamp(telemetry.successRate);
  const failureRate = clamp(telemetry.failureRate);
  const rendezvousRate = clamp(telemetry.rendezvousRate);
  const throughputBalance = clamp(telemetry.throughputBalance);
  const activityDensity = clamp(telemetry.activityDensity);
  const redundancy = clamp(telemetry.redundancy);
  const entropy = clamp(telemetry.entropy);

  const axioms: UqrcEthicsAxiomVector = {
    axiom0_0: smooth(mean(1 - entropy, throughputBalance), previous.axioms.axiom0_0),
    axiom0_1: smooth(mean(successRate, rendezvousRate, 1 - failureRate), previous.axioms.axiom0_1),
    axiom0_2: smooth(mean(1 - failureRate, redundancy, activityDensity), previous.axioms.axiom0_2),
    axiom0_3: smooth(mean(1 - entropy, 1 - failureRate, successRate), previous.axioms.axiom0_3),
    axiom0_4: smooth(mean(redundancy, throughputBalance, 1 - entropy), previous.axioms.axiom0_4),
    axiom0_5: smooth(mean(redundancy, 1 - failureRate, rendezvousRate), previous.axioms.axiom0_5),
    axiom0_6: smooth(mean(1 - failureRate, activityDensity, throughputBalance), previous.axioms.axiom0_6),
    axiom0_7: smooth(mean(activityDensity, successRate, 1 - entropy), previous.axioms.axiom0_7),
    axiom0_8: smooth(mean(activityDensity, redundancy, 1 - failureRate), previous.axioms.axiom0_8),
    axiom0_9: smooth(mean(redundancy, 1 - entropy, throughputBalance), previous.axioms.axiom0_9),
    axiom1_0: smooth(mean(1 - entropy, successRate, redundancy), previous.axioms.axiom1_0),
    axiom1_1: smooth(mean(successRate, rendezvousRate, throughputBalance), previous.axioms.axiom1_1),
    axiom1_2: smooth(mean(successRate, throughputBalance, 1 - failureRate), previous.axioms.axiom1_2),
    axiom1_3: smooth(mean(activityDensity, 1 - failureRate, successRate), previous.axioms.axiom1_3),
    axiom1_4: smooth(mean(successRate, rendezvousRate, throughputBalance), previous.axioms.axiom1_4),
  };

  const embers: UqrcEthicsEmberVector = {
    ember0_0: smooth(mean(axioms.axiom0_0, axioms.axiom1_0), previous.embers.ember0_0),
    ember0_1: smooth(mean(axioms.axiom0_1, axioms.axiom1_1), previous.embers.ember0_1),
    ember0_2: smooth(mean(axioms.axiom0_2, axioms.axiom1_2), previous.embers.ember0_2),
    ember0_3: smooth(mean(axioms.axiom0_3, axioms.axiom1_0), previous.embers.ember0_3),
    ember0_4: smooth(mean(axioms.axiom0_4, axioms.axiom1_2), previous.embers.ember0_4),
    ember0_5: smooth(mean(axioms.axiom0_5, axioms.axiom1_3), previous.embers.ember0_5),
    ember0_6: smooth(mean(axioms.axiom0_6, axioms.axiom1_1), previous.embers.ember0_6),
    ember0_7: smooth(mean(axioms.axiom0_7, 1 - entropy), previous.embers.ember0_7),
    ember0_8: smooth(mean(axioms.axiom0_8, redundancy), previous.embers.ember0_8),
    ember0_9: smooth(mean(axioms.axiom0_9, activityDensity), previous.embers.ember0_9),
  };

  const meaningManifold: UqrcMeaningManifoldState = {
    harmonicSymmetry: mean(axioms.axiom0_0, embers.ember0_0, 1 - entropy),
    contactNuance: mean(axioms.axiom0_1, embers.ember0_1, rendezvousRate),
    memoryContinuity: mean(axioms.axiom0_3, axioms.axiom0_4, embers.ember0_6),
    imaginationFreedom: mean(axioms.axiom0_6, axioms.axiom0_7, axioms.axiom0_8),
    truthVisibility: mean(axioms.axiom1_0, axioms.axiom1_1, axioms.axiom1_2),
    verifiability: mean(axioms.axiom1_2, axioms.axiom1_4, throughputBalance),
  };

  const confidence = clamp(mean(
    meaningManifold.truthVisibility,
    meaningManifold.verifiability,
    embers.ember0_4,
    embers.ember0_5,
  ));

  const harmRisk = clamp(mean(
    failureRate,
    1 - embers.ember0_2,
    1 - meaningManifold.harmonicSymmetry,
    entropy,
  ));

  const interventionLevel = clamp(mean(
    harmRisk,
    1 - confidence,
    1 - embers.ember0_6,
  ));

  return {
    harmRisk,
    confidence,
    interventionLevel,
    meaningManifold,
    axioms,
    embers,
  };
}
