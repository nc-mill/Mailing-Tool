export const ONBOARDING_STEP_IDS = [
  'sending',
  'contacts',
  'template',
  'testSend',
  'firstCampaign',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type OnboardingStep = {
  id: OnboardingStepId;
  done: boolean;
  /** Cesta primární akce, relativní k projektu. */
  href: string;
  /** Cesta sekundární akce, jen u kroku contacts (ukázková data). */
  secondaryHref: string | null;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  finished: boolean;
  hidden: boolean;
  /** Jednorázová gratulace se zavírá nadobro, na rozdíl od skrytí panelu. */
  finishedDismissed: boolean;
};
