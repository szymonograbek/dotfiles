export type EvalCheck = {
  name: string;
  passed: boolean;
  message: string;
};

export type DeterministicResult = {
  score: number;
  details: string;
  checks: EvalCheck[];
};

export type SemanticResult = {
  score: number;
  feedback: string;
};

export type QualityGate = {
  name: string;
  score: number;
  minimum: number;
  feedback: string;
};

export type TrialResult = {
  trial: number;
  deterministic: DeterministicResult;
  semantic: SemanticResult;
  qualityGates?: QualityGate[];
  score: number;
  workspace: string;
};

export type TrialOptions = {
  trial: number;
  resultDir: string;
  skillDir: string;
  skillEvalsDir: string;
};

export type SkillEvaluation = {
  name: string;
  weights: {
    deterministic: number;
    semantic: number;
  };
  runTrial(options: TrialOptions): Promise<TrialResult>;
};
