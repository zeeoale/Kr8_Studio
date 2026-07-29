import { SOURCE_CAPABILITIES } from './sourceProvider.js';

export const ACE_STEP_PROVIDER = {
  id: 'ace-step',
  name: 'ACE-Step',
  status: 'planned',
  capabilities: [
    SOURCE_CAPABILITIES.audio,
    SOURCE_CAPABILITIES.metadata,
    SOURCE_CAPABILITIES.stems
  ],
  async resolve() {
    throw new Error('ACE-StepProvider is a documented placeholder. Import flow is not implemented yet.');
  }
};
