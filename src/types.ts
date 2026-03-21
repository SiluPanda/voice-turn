export type TurnState = 'idle' | 'user-speaking' | 'user-paused' | 'processing' | 'ai-speaking' | 'interrupted'

export interface STTProvider {
  start(): void
  stop(): Promise<string>
  pushAudio(audio: Uint8Array | Float32Array): void
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  warmup?(): Promise<void>
}

export interface LLMProvider {
  generate(transcript: string, context?: ConversationContext, signal?: AbortSignal): AsyncIterable<string>
  warmup?(): Promise<void>
}

export interface TTSProvider {
  speak(text: string, signal?: AbortSignal): TTSSpeakResult
  warmup?(): Promise<void>
}

export interface TTSSpeakResult {
  audio: ReadableStream<Uint8Array>
  cancel(): void
}

export interface ConversationContext {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  systemPrompt?: string
  metadata?: Record<string, unknown>
}

export interface EndpointingConfig {
  silenceMs?: number       // default 800ms — silence threshold to detect end of speech
  minSpeechMs?: number     // default 300ms — min speech duration to count as real utterance
}

export interface BargeInConfig {
  enabled?: boolean        // default true
  minInterruptionMs?: number  // default 200ms — min speaking duration to trigger barge-in
}

export interface TurnManagerConfig {
  stt: STTProvider
  llm: LLMProvider
  tts: TTSProvider
  endpointing?: EndpointingConfig
  bargeIn?: BargeInConfig
  context?: ConversationContext
  splitSentences?: boolean    // default true
  processingTimeoutMs?: number  // default 30000
  signal?: AbortSignal
}

export interface TurnMetrics {
  speechDurationMs: number
  processingDurationMs: number
  ttfaMs: number             // time to first audio
  totalTurnMs: number
}

export interface TurnManagerEvents {
  userSpeechStart: []
  userSpeechEnd: []
  aiSpeechStart: []
  aiSpeechEnd: []
  bargeIn: [{ interruptedText: string }]
  stateChange: [newState: TurnState, prevState: TurnState]
  partialTranscript: [text: string]
  transcript: [text: string]
  response: [text: string]
  turnComplete: []
  error: [error: Error]
}

export interface TurnManager {
  start(): void
  stop(): void
  pushAudio(audio: Uint8Array | Float32Array): void
  getState(): TurnState
  setContext(context: ConversationContext): void
  on<K extends keyof TurnManagerEvents & string>(event: K, handler: (...args: TurnManagerEvents[K]) => void): () => void
  off<K extends keyof TurnManagerEvents & string>(event: K, handler: (...args: TurnManagerEvents[K]) => void): void
  readonly isRunning: boolean
  readonly lastTurnMetrics: TurnMetrics | null
}
