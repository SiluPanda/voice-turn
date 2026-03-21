// voice-turn - Turn-taking manager for voice AI conversations
export { createTurnManager } from './turn-manager.js'
export { TypedEventEmitter } from './events.js'
export { isValidTransition, getValidTransitions } from './state-machine.js'
export { splitSentences } from './sentence-splitter.js'
export type {
  TurnState,
  TurnManager,
  TurnManagerConfig,
  TurnManagerEvents,
  TurnMetrics,
  STTProvider,
  LLMProvider,
  TTSProvider,
  TTSSpeakResult,
  ConversationContext,
  EndpointingConfig,
  BargeInConfig,
} from './types.js'
