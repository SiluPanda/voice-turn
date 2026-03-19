# voice-turn — Task Breakdown

All tasks derived from [SPEC.md](./SPEC.md). Organized by implementation phase matching the spec's roadmap (Sections 18).

---

## Phase 0: Project Scaffolding and Dev Environment

- [ ] **Install dev dependencies** — Add `typescript@^5.3.0`, `vitest@^1.0.0`, `eslint@^8.0.0`, and `@types/node@^20.0.0` to `devDependencies` in `package.json`. Verify `npm install` succeeds. | Status: not_done

- [ ] **Configure Vitest** — Add a `vitest.config.ts` (or configure via `vite.config.ts`) so that `npm run test` discovers and runs tests from `src/__tests__/`. Ensure test timeouts are reasonable for timer-based tests. | Status: not_done

- [ ] **Configure ESLint** — Add `.eslintrc` (or equivalent) with a TypeScript-aware config. Verify `npm run lint` runs without errors on the empty project. | Status: not_done

- [ ] **Create directory structure** — Create all directories specified in SPEC Section 17: `src/endpointing/`, `src/barge-in/`, `src/pipeline/`, `src/__tests__/endpointing/`, `src/__tests__/barge-in/`, `src/__tests__/pipeline/`, `src/__tests__/mocks/`, `src/__tests__/integration/`. | Status: not_done

- [ ] **Verify build pipeline** — Run `npm run build` (tsc) and confirm it produces output in `dist/` with `.js`, `.d.ts`, and `.d.ts.map` files. Fix any tsconfig issues. | Status: not_done

---

## Phase 1: Types and Core Interfaces (v0.1.0)

### 1.1 Type Definitions (`src/types.ts`)

- [ ] **Define TurnState type** — Create the `TurnState` union type with six states: `'idle'`, `'user-speaking'`, `'user-paused'`, `'processing'`, `'ai-speaking'`, `'interrupted'`. (Spec Section 4, 5) | Status: not_done

- [ ] **Define STTProvider interface** — Implement the `STTProvider` interface with `start()`, `stop(): Promise<string>`, `pushAudio(audio: Uint8Array | Float32Array)`, `on(event, handler)`, `off(event, handler)`, and optional `warmup?()`. (Spec Section 10, 11) | Status: not_done

- [ ] **Define LLMProvider interface** — Implement the `LLMProvider` interface with `generate(transcript, context?, signal?): AsyncIterable<string>` and optional `warmup?()`. (Spec Section 10, 11) | Status: not_done

- [ ] **Define TTSProvider interface** — Implement the `TTSProvider` interface with `speak(text, signal?): TTSSpeakResult` and optional `warmup?()`. (Spec Section 10, 11) | Status: not_done

- [ ] **Define TTSSpeakResult interface** — Create `TTSSpeakResult` with `audio: ReadableStream<Uint8Array>` and `cancel(): void`. (Spec Section 10) | Status: not_done

- [ ] **Define ConversationContext interface** — Create `ConversationContext` with optional `systemPrompt`, `messages` array (`{role, content}`), and `metadata` record. (Spec Section 10) | Status: not_done

- [ ] **Define EndpointingConfig types** — Create the discriminated union `EndpointingConfig` with all five variants: `SilenceEndpointingConfig`, `VadEndpointingConfig`, `TranscriptEndpointingConfig`, `AdaptiveEndpointingConfig`, `CustomEndpointingConfig`. Include all fields with defaults documented in JSDoc. (Spec Section 6, 10) | Status: not_done

- [ ] **Define EndpointingContext interface** — Create `EndpointingContext` with `transcript`, `isFinal`, `silenceDurationMs`, `isSpeechActive`, `speechDurationMs`, `wordCount`, `conversationDurationMs`. (Spec Section 6) | Status: not_done

- [ ] **Define BargeInConfig types** — Create the discriminated union `BargeInConfig` with three variants: `FullBargeInConfig`, `SoftBargeInConfig`, `NoBargeInConfig`. Include all fields. (Spec Section 7, 10) | Status: not_done

- [ ] **Define BargeInEvent interface** — Create `BargeInEvent` with `fullResponse`, `spokenResponse`, `interruptedAtSentence`, `userSpeech`, `aiSpeechDurationMs`. (Spec Section 7) | Status: not_done

- [ ] **Define TurnManagerConfig interface** — Create `TurnManagerConfig` with all fields: `stt`, `llm`, `tts`, `endpointing?`, `bargeIn?`, `context?`, `minSpeechDurationMs?`, `minWordCount?`, `sentenceBoundaryPattern?`, `splitSentences?`, `pauseDetectionMs?`, `ttsBufferAhead?`, `maxSentenceQueueSize?`, `processingTimeoutMs?`, `llmTimeoutMs?`, `eagerLlmStart?`, `eagerLlmDelayMs?`, `signal?`. (Spec Section 10) | Status: not_done

- [ ] **Define TurnManager interface** — Create `TurnManager` with `start()`, `stop()`, `pushAudio()`, `getState()`, `setContext()`, typed `on()`/`off()`, `readonly isRunning`, `readonly lastTurnMetrics`. (Spec Section 10) | Status: not_done

- [ ] **Define TurnManagerEvents interface** — Create `TurnManagerEvents` with all event signatures: `userSpeechStart`, `userSpeechEnd`, `aiSpeechStart`, `aiSpeechEnd`, `bargeIn`, `stateChange`, `partialTranscript`, `transcript`, `response`, `audioOutput`, `turnComplete`, `error`. (Spec Section 10) | Status: not_done

- [ ] **Define TurnMetrics interface** — Create `TurnMetrics` with all timing fields: `endpointingMs`, `sttFinalizationMs`, `llmTtftMs`, `llmTotalMs`, `ttsFirstChunkMs`, `userToAiMs`, `totalResponseMs`, `sentenceCount`, `userWordCount`, `aiWordCount`, `wasInterrupted`. (Spec Section 9) | Status: not_done

- [ ] **Define TurnError interface** — Create `TurnError` with `stage` (`'stt' | 'llm' | 'tts' | 'endpointing' | 'internal'`), `cause: Error`, `message: string`, `stateAtError: TurnState`. (Spec Section 10) | Status: not_done

### 1.2 Typed Event Emitter (`src/events.ts`)

- [ ] **Implement typed event emitter** — Build a lightweight typed event emitter (~30 lines) using `Map<string, Set<Function>>` with `on()`, `off()`, and `emit()` methods. Must provide full TypeScript type safety for all events defined in `TurnManagerEvents`. Do not use Node.js `EventEmitter`. (Spec Section 16) | Status: not_done

- [ ] **Test event emitter** — Write unit tests: registering handlers, emitting events, removing handlers, multiple handlers per event, emitting with correct typed arguments, emitting unknown event is no-op, off() for unregistered handler is no-op. | Status: not_done

### 1.3 State Machine (`src/state-machine.ts`)

- [ ] **Implement state machine core** — Build the turn-taking state machine that tracks current state and validates/executes transitions. Initial state is `idle`. Only valid transitions (per Spec Section 5 table) are allowed. Invalid transitions emit an error. (Spec Section 5) | Status: not_done

- [ ] **Implement idle to user-speaking transition** — Triggered by speech detection. Actions: start STT provider, begin streaming audio to STT. | Status: not_done

- [ ] **Implement user-speaking to user-paused transition** — Triggered by silence detection (no speech for `pauseDetectionMs`, default 300ms). Actions: start endpointing timer, continue STT. | Status: not_done

- [ ] **Implement user-paused to user-speaking transition** — Triggered by speech resuming before endpointing timer expires. Actions: cancel endpointing timer, continue STT. | Status: not_done

- [ ] **Implement user-paused to processing transition** — Triggered by endpointing timer expiring. Actions: stop STT, finalize transcript, send to LLM. | Status: not_done

- [ ] **Implement processing to ai-speaking transition** — Triggered by first TTS audio chunk ready. Actions: begin audio playback, emit `aiSpeechStart`. | Status: not_done

- [ ] **Implement ai-speaking to idle transition** — Triggered by TTS playback complete. Actions: emit `aiSpeechEnd`, return to waiting. | Status: not_done

- [ ] **Implement ai-speaking to interrupted transition** — Triggered by user speech during AI playback (barge-in). Actions depend on barge-in mode. | Status: not_done

- [ ] **Implement interrupted to user-speaking transition** — Triggered by cancellation of AI speech/LLM/TTS complete. Actions: start STT for new user speech, emit `bargeIn`. | Status: not_done

- [ ] **Implement timeout and recovery transitions** — `processing` -> `idle` on LLM/TTS error or processing timeout. `ai-speaking` -> `idle` on playback error. `user-speaking` -> `idle` on STT error. Any state -> `idle` on `stop()`. (Spec Section 5) | Status: not_done

- [ ] **Enforce state invariants** — Ensure: exactly one state at a time; `user-speaking` and `ai-speaking` never simultaneous; `interrupted` is transient (always transitions to `user-speaking`); `processing` always leads to `ai-speaking` or `idle`; STT only active during `user-speaking`/`user-paused`; TTS only during `processing`/`ai-speaking`; LLM only during `processing`/`ai-speaking`. (Spec Section 5) | Status: not_done

- [ ] **Reject invalid state transitions** — When an invalid transition is attempted, emit an error event with descriptive message and do not change state. | Status: not_done

- [ ] **Test state machine — valid transitions** — Unit tests for every valid transition in the state table (Spec Section 5). Verify correct state after each transition and that appropriate events fire. | Status: not_done

- [ ] **Test state machine — invalid transitions** — Unit tests that verify invalid transitions (e.g., `idle` -> `processing`, `user-speaking` -> `ai-speaking`) are rejected and emit errors. | Status: not_done

- [ ] **Test state machine — stop() from every state** — Verify `stop()` transitions to `idle` from each of the six states and cleans up timers/operations. | Status: not_done

### 1.4 TurnManager Shell (`src/turn-manager.ts`)

- [ ] **Implement createTurnManager factory function** — Accept `TurnManagerConfig`, validate required fields (`stt`, `llm`, `tts`), apply defaults for all optional config (Spec Section 12 defaults table), instantiate and return a `TurnManager`. | Status: not_done

- [ ] **Implement start() method** — Transition from uninitialized to `idle`. Set `isRunning` to true. Begin accepting `pushAudio()` calls. | Status: not_done

- [ ] **Implement stop() method** — Cancel all in-flight operations (abort LLM, cancel TTS, stop STT). Clear all timers. Transition to `idle`. Set `isRunning` to false. Can be called from any state. | Status: not_done

- [ ] **Implement pushAudio() method** — Route audio data to STT provider and VAD system. No-op if not in `user-speaking` or `user-paused` state (or if not running). Must not crash if called before `start()`. (Spec Section 14 edge case) | Status: not_done

- [ ] **Implement getState() method** — Return the current `TurnState`. | Status: not_done

- [ ] **Implement setContext() method** — Update the `ConversationContext` passed to the LLM provider. Takes effect on the next LLM invocation. | Status: not_done

- [ ] **Implement isRunning property** — Read-only boolean reflecting whether `start()` has been called and `stop()` has not. | Status: not_done

- [ ] **Implement lastTurnMetrics property** — Read-only property returning `TurnMetrics` from the most recent completed turn, or `null` if no turn has completed. | Status: not_done

- [ ] **Wire event emitter to TurnManager** — Expose typed `on()` and `off()` methods that delegate to the internal event emitter. Return `this` from `on()`/`off()` for chaining. | Status: not_done

- [ ] **Apply default configuration values** — Set defaults for all optional config fields per Spec Section 12 defaults table: `endpointing: { strategy: 'silence', silenceMs: 800 }`, `bargeIn: { mode: 'full', minSpeechForBargeIn: 200 }`, `minSpeechDurationMs: 300`, `minWordCount: 0`, `sentenceBoundaryPattern: /(?<=[.!?])\s+/`, `pauseDetectionMs: 300`, `ttsBufferAhead: 1`, `maxSentenceQueueSize: 10`, `processingTimeoutMs: 30000`, `llmTimeoutMs: 15000`, `eagerLlmStart: false`, `eagerLlmDelayMs: 500`. | Status: not_done

### 1.5 Silence Endpointing (`src/endpointing/silence.ts`)

- [ ] **Implement silence-based endpointing** — When silence is detected, start a timer for `silenceMs` (default 800ms). If speech resumes, cancel the timer. If the timer expires, trigger end-of-turn (transition to `processing`). (Spec Section 6) | Status: not_done

- [ ] **Implement pause detection threshold** — Only consider silence as a potential endpoint if silence duration exceeds `pauseDetectionMs` (default 300ms). Shorter silences are ignored. | Status: not_done

- [ ] **Implement minimum speech duration guard** — User must have spoken for at least `minSpeechDurationMs` (default 300ms) before endpointing is considered. Brief sounds (coughs, mic bumps) do not trigger turn cycles. (Spec Section 6) | Status: not_done

- [ ] **Implement minimum word count guard** — Transcript must contain at least `minWordCount` (default 0, disabled) words before endpointing triggers. (Spec Section 6) | Status: not_done

- [ ] **Create endpointing dispatcher** — Implement `src/endpointing/index.ts` that selects the correct endpointing strategy based on `EndpointingConfig.strategy` and dispatches to the appropriate implementation. | Status: not_done

- [ ] **Test silence endpointing — basic trigger** — Verify turn ends after `silenceMs` of silence. Verify turn does NOT end if speech resumes before threshold. | Status: not_done

- [ ] **Test silence endpointing — different thresholds** — Test with 500ms, 800ms, 1500ms thresholds. Verify correct timing. | Status: not_done

- [ ] **Test silence endpointing — minimum speech duration** — Verify turns shorter than `minSpeechDurationMs` do not trigger endpointing. | Status: not_done

- [ ] **Test silence endpointing — minimum word count** — Verify turns with fewer words than `minWordCount` do not trigger endpointing. | Status: not_done

### 1.6 Public API Exports (`src/index.ts`)

- [ ] **Set up public exports** — Export `createTurnManager` function and all public types: `TurnState`, `STTProvider`, `LLMProvider`, `TTSProvider`, `TTSSpeakResult`, `ConversationContext`, `TurnManagerConfig`, `TurnManager`, `TurnManagerEvents`, `TurnMetrics`, `TurnError`, `BargeInEvent`, `EndpointingConfig` (and variants), `BargeInConfig` (and variants), `EndpointingContext`. (Spec Section 10) | Status: not_done

---

## Phase 2: Pipeline and Providers (v0.2.0)

### 2.1 Sentence Splitter (`src/pipeline/sentence-splitter.ts`)

- [ ] **Implement sentence boundary detector** — Build a streaming sentence splitter that buffers incoming LLM tokens and emits complete sentences when boundaries are detected. Default boundary pattern: `/(?<=[.!?])\s+/`. Flush remaining buffer on stream end. (Spec Section 8) | Status: not_done

- [ ] **Support configurable sentence boundary pattern** — Accept a custom `sentenceBoundaryPattern` regex from config. | Status: not_done

- [ ] **Support custom splitSentences function** — Accept a custom `splitSentences` function that overrides regex-based splitting. (Spec Section 10) | Status: not_done

- [ ] **Test sentence splitter — single sentence** — `"Hello."` produces `["Hello."]`. | Status: not_done

- [ ] **Test sentence splitter — multiple sentences** — `"Hello. How are you?"` produces `["Hello.", "How are you?"]`. | Status: not_done

- [ ] **Test sentence splitter — abbreviations** — `"Dr. Smith is here."` is handled correctly (not split at `"Dr."`). | Status: not_done

- [ ] **Test sentence splitter — trailing text without punctuation** — `"Hello world"` is emitted on stream end. | Status: not_done

- [ ] **Test sentence splitter — empty input** — No sentences emitted. | Status: not_done

- [ ] **Test sentence splitter — long single sentence** — Treated as one sentence, emitted on stream end. | Status: not_done

- [ ] **Test sentence splitter — streaming token accumulation** — Tokens arrive one at a time; sentences are emitted only when boundaries are detected. | Status: not_done

### 2.2 TTS Queue (`src/pipeline/tts-queue.ts`)

- [ ] **Implement TTS sentence queue** — Build a queue that accepts sentences from the sentence splitter and dispatches them to the TTS provider one at a time. Manage sequential playback: audio from sentence N finishes before sentence N+1 begins. (Spec Section 8) | Status: not_done

- [ ] **Implement TTS buffer-ahead** — Pre-synthesize the next `ttsBufferAhead` (default 1) sentences before the current sentence finishes playing. Prevents gaps between sentences. (Spec Section 8) | Status: not_done

- [ ] **Implement back-pressure** — When the sentence queue reaches `maxSentenceQueueSize` (default 10), pause consumption of LLM tokens. Resume when space is available. Prevents unbounded memory growth. (Spec Section 8) | Status: not_done

- [ ] **Implement TTS queue cancellation** — On barge-in or stop(), cancel all pending and in-flight TTS requests. Discard buffered audio. (Spec Section 7) | Status: not_done

- [ ] **Test TTS queue — sequential playback** — Sentences are played in order, each after the previous completes. | Status: not_done

- [ ] **Test TTS queue — buffer-ahead** — Next sentence synthesis starts before current sentence finishes. | Status: not_done

- [ ] **Test TTS queue — back-pressure** — LLM token consumption pauses when queue is full and resumes when space opens. | Status: not_done

- [ ] **Test TTS queue — cancellation** — All pending TTS requests are cancelled on barge-in. | Status: not_done

### 2.3 Pipeline Orchestration (`src/pipeline/index.ts`)

- [ ] **Implement STT-to-LLM connection** — When endpointing confirms end-of-turn, finalize STT transcript and pass to LLM provider's `generate()` method with conversation context and AbortSignal. (Spec Section 8) | Status: not_done

- [ ] **Implement LLM-to-TTS connection** — Consume LLM async iterable, pass tokens through sentence splitter, forward complete sentences to TTS queue. (Spec Section 8) | Status: not_done

- [ ] **Implement TTS-to-audioOutput connection** — As TTS produces audio chunks, emit them via the `audioOutput` event for the application to play. (Spec Section 8) | Status: not_done

- [ ] **Implement streaming at every stage** — Ensure LLM generation begins before STT fully finalizes (overlap), TTS begins before LLM finishes generating, and audio playback begins before TTS finishes synthesizing. (Spec Section 9) | Status: not_done

- [ ] **Implement transcript event forwarding** — Forward STT `partial` events as `partialTranscript` events and STT `transcript` events as `transcript` events on the TurnManager. | Status: not_done

- [ ] **Implement response event emission** — Emit `response` events as LLM response tokens accumulate. | Status: not_done

- [ ] **Test pipeline — full turn cycle** — Mock STT produces transcript -> LLM generates response -> sentence splitter splits -> TTS synthesizes -> audioOutput events fire. Verify correct event sequence. | Status: not_done

- [ ] **Test pipeline — streaming overlap** — Verify LLM starts before STT fully finalizes, TTS starts before LLM finishes. | Status: not_done

### 2.4 Full Barge-In (`src/barge-in/full.ts`)

- [ ] **Implement full barge-in handler** — When user speech is detected during `ai-speaking` and persists for `minSpeechForBargeIn` (default 200ms): (1) transition to `interrupted`, (2) stop TTS playback via `cancel()`, (3) cancel pending TTS synthesis, (4) abort LLM generation via AbortSignal, (5) start STT for new user speech, (6) transition to `user-speaking`, (7) emit `bargeIn` event. Target: under 200ms total interruption latency. (Spec Section 7) | Status: not_done

- [ ] **Implement barge-in cancellation sequence** — Execute the five-step cancellation sequence (stop TTS playback, cancel TTS synthesis, abort LLM, record interruption point, start STT). Target: under 100ms. (Spec Section 7) | Status: not_done

- [ ] **Implement BargeInEvent construction** — Populate `BargeInEvent` with `fullResponse`, `spokenResponse`, `interruptedAtSentence`, `userSpeech`, `aiSpeechDurationMs`. Track which sentences were spoken vs. unspoken. (Spec Section 7) | Status: not_done

- [ ] **Implement minSpeechForBargeIn guard** — User must produce at least `minSpeechForBargeIn` ms of speech before barge-in triggers. During confirmation window, AI continues speaking. Brief noise does not interrupt. (Spec Section 7) | Status: not_done

- [ ] **Create barge-in dispatcher** — Implement `src/barge-in/index.ts` that selects the correct barge-in handler based on `BargeInConfig.mode`. | Status: not_done

- [ ] **Test full barge-in — triggers after minSpeechForBargeIn** — User speech >= threshold triggers interruption. | Status: not_done

- [ ] **Test full barge-in — brief speech does not trigger** — User speech < `minSpeechForBargeIn` does not interrupt. | Status: not_done

- [ ] **Test full barge-in — LLM aborted** — Verify AbortSignal fires on LLM during barge-in. | Status: not_done

- [ ] **Test full barge-in — TTS cancelled** — Verify `cancel()` is called on TTS during barge-in. | Status: not_done

- [ ] **Test full barge-in — BargeInEvent metadata** — Verify event contains correct `spokenResponse`, `fullResponse`, `interruptedAtSentence`. | Status: not_done

### 2.5 Metrics (`src/metrics.ts`)

- [ ] **Implement latency measurement** — Track timestamps at each pipeline stage boundary and compute all `TurnMetrics` fields: `endpointingMs`, `sttFinalizationMs`, `llmTtftMs`, `llmTotalMs`, `ttsFirstChunkMs`, `userToAiMs`, `totalResponseMs`, `sentenceCount`, `userWordCount`, `aiWordCount`, `wasInterrupted`. (Spec Section 9) | Status: not_done

- [ ] **Emit turnComplete event** — Fire `turnComplete` with populated `TurnMetrics` after each completed turn (both normal completion and interrupted turns). | Status: not_done

- [ ] **Store lastTurnMetrics** — Update `lastTurnMetrics` property on the TurnManager after each completed turn. | Status: not_done

- [ ] **Test metrics — plausible values** — Verify all metrics are positive and in expected ranges with mock providers. | Status: not_done

- [ ] **Test metrics — userToAiMs approximation** — Verify `userToAiMs` approximately equals `endpointingMs + sttFinalizationMs + llmTtftMs + ttsFirstChunkMs`. | Status: not_done

- [ ] **Test metrics — interrupted turn** — Verify `wasInterrupted` is `true` and metrics reflect the interruption point. | Status: not_done

### 2.6 Mock Providers (`src/__tests__/mocks/`)

- [ ] **Implement MockSTTProvider** — Configurable mock that emits specific transcripts after configurable delays. Tracks `start()`/`stop()` calls for verification. Supports `partial` and `transcript` events. (Spec Section 14) | Status: not_done

- [ ] **Implement MockLLMProvider** — Configurable mock that returns specific responses with configurable TTFT and token rate. Tracks `generate()` calls and respects AbortSignal. Returns `AsyncIterable<string>`. (Spec Section 14) | Status: not_done

- [ ] **Implement MockTTSProvider** — Configurable mock that returns audio chunks with configurable synthesis latency. Tracks `speak()`/`cancel()` calls. Returns `TTSSpeakResult` with `ReadableStream<Uint8Array>`. (Spec Section 14) | Status: not_done

### 2.7 Pipeline Error Handling

- [ ] **Handle STT errors** — When STT provider throws or emits an error, emit `error` event with STT context and transition to `idle`. (Spec Section 8) | Status: not_done

- [ ] **Handle LLM errors** — When LLM provider throws or the async iterable errors, emit `error` event with LLM context and transition to `idle`. (Spec Section 8) | Status: not_done

- [ ] **Handle LLM timeout** — If no LLM tokens arrive within `llmTimeoutMs` (default 15000ms), abort the LLM request, emit `error` event, and transition to `idle`. (Spec Section 8) | Status: not_done

- [ ] **Handle TTS errors — skip failed sentence** — When TTS fails for one sentence, skip it. If more sentences remain, continue with the next. If no sentences remain, emit `error` and transition to `idle`. (Spec Section 8) | Status: not_done

- [ ] **Handle processing timeout** — If total processing exceeds `processingTimeoutMs` (default 30000ms), abort all operations, emit `error` event, and transition to `idle`. (Spec Section 5) | Status: not_done

- [ ] **Handle TTS playback error** — Emit `error` event and transition to `idle`. | Status: not_done

- [ ] **Ensure no stuck states** — All error paths must lead to `idle`. The turn manager must never enter an unrecoverable state. | Status: not_done

- [ ] **Test STT error recovery** — Verify error event fires with correct `stage: 'stt'` and state returns to `idle`. | Status: not_done

- [ ] **Test LLM error recovery** — Verify error event fires with correct `stage: 'llm'` and state returns to `idle`. | Status: not_done

- [ ] **Test LLM timeout** — Verify timeout fires after configured duration, aborts request, emits error, returns to `idle`. | Status: not_done

- [ ] **Test TTS error — skip sentence** — Verify failed sentence is skipped and remaining sentences continue. | Status: not_done

- [ ] **Test processing timeout** — Verify timeout fires after configured duration, aborts all operations, returns to `idle`. | Status: not_done

- [ ] **Test error metadata** — All emitted errors include correct `stage`, `cause`, `message`, and `stateAtError`. | Status: not_done

---

## Phase 3: Advanced Endpointing and Barge-In (v0.3.0)

### 3.1 VAD-Based Endpointing (`src/endpointing/vad.ts`)

- [ ] **Implement VAD-based endpointing** — Use the application-provided `vadCallback` (per-frame speech detection) or push-based VAD events (`speechStart`, `speechEnd`). When VAD reports no speech for `silenceMs`, trigger end-of-turn. More accurate than energy-based detection. (Spec Section 6) | Status: not_done

- [ ] **Test VAD endpointing — basic trigger** — VAD reports no speech -> silence threshold reached -> turn ends. | Status: not_done

- [ ] **Test VAD endpointing — speech resumes** — VAD reports no speech, then speech resumes before threshold -> timer cancelled. | Status: not_done

### 3.2 Transcript-Based Endpointing (`src/endpointing/transcript.ts`)

- [ ] **Implement transcript-based endpointing** — When a final transcript is received ending with sentence-ending punctuation (matching `sentenceEndPattern`, default `/[.?!]\s*$/`), use a reduced silence threshold (`transcriptEndMs`, default 400ms) instead of the normal `silenceMs` (default 800ms). (Spec Section 6) | Status: not_done

- [ ] **Test transcript endpointing — reduced threshold** — Final transcript ending with `.` + silence -> turn ends at `transcriptEndMs`. | Status: not_done

- [ ] **Test transcript endpointing — normal threshold** — Transcript without sentence-ending punctuation -> normal `silenceMs` threshold. | Status: not_done

- [ ] **Test transcript endpointing — configurable pattern** — Custom `sentenceEndPattern` regex is respected. | Status: not_done

### 3.3 Adaptive Endpointing (`src/endpointing/adaptive.ts`)

- [ ] **Implement adaptive endpointing** — Track a sliding window of the last N (`windowSize`, default 5) in-turn pause durations. Compute `adaptiveThreshold = max(minSilenceMs, min(maxSilenceMs, mean(recentPauses) * adaptiveMultiplier))`. Use this dynamic threshold instead of a fixed one. (Spec Section 6) | Status: not_done

- [ ] **Test adaptive endpointing — threshold adjusts** — After several short pauses, threshold decreases. After long pauses, threshold increases. | Status: not_done

- [ ] **Test adaptive endpointing — bounded** — Threshold never goes below `minSilenceMs` or above `maxSilenceMs`. | Status: not_done

- [ ] **Test adaptive endpointing — window size** — Only the last N pauses affect the threshold. | Status: not_done

### 3.4 Custom Endpointing (`src/endpointing/custom.ts`)

- [ ] **Implement custom endpointing wrapper** — Accept a user-provided `shouldEndTurn(context: EndpointingContext) => boolean` function. Call it with a populated `EndpointingContext` on each evaluation tick. If it returns `true`, trigger end-of-turn. (Spec Section 6) | Status: not_done

- [ ] **Test custom endpointing — function called with correct context** — Verify `EndpointingContext` fields are correctly populated. | Status: not_done

- [ ] **Test custom endpointing — return value controls behavior** — `true` ends turn; `false` continues. | Status: not_done

### 3.5 Soft Barge-In (`src/barge-in/soft.ts`)

- [ ] **Implement soft barge-in handler** — When user speech is detected during `ai-speaking`, note the start but do not immediately interrupt. If user continues speaking for `softBargeInMs` (default 500ms), confirm barge-in and execute the full interruption sequence. If user stops before threshold, treat as non-interrupting vocalization and continue AI playback. (Spec Section 7) | Status: not_done

- [ ] **Test soft barge-in — speech >= threshold triggers** — User speaks for 500ms+ -> barge-in confirmed. | Status: not_done

- [ ] **Test soft barge-in — speech < threshold ignored** — User speaks briefly -> AI continues uninterrupted. | Status: not_done

### 3.6 No Barge-In (`src/barge-in/none.ts`)

- [ ] **Implement no barge-in handler** — User speech during `ai-speaking` is completely ignored. AI completes its full response, then returns to `idle`. (Spec Section 7) | Status: not_done

- [ ] **Test no barge-in — speech ignored** — User speech during AI playback does not interrupt or trigger events. | Status: not_done

### 3.7 Eager LLM Start

- [ ] **Implement eager LLM start** — When `eagerLlmStart` is `true`, send a preliminary transcript to the LLM after `eagerLlmDelayMs` (default 500ms) of silence during `user-paused`, before endpointing is confirmed. If the user resumes speaking, abort the speculative LLM request. If endpointing confirms, the LLM already has a head start. (Spec Section 9) | Status: not_done

- [ ] **Test eager LLM — head start on confirmed turn** — LLM generation begins early, endpointing confirms, LLM result is used. | Status: not_done

- [ ] **Test eager LLM — abort on speech resume** — User resumes speaking -> speculative LLM request is aborted. | Status: not_done

- [ ] **Test eager LLM — disabled by default** — Verify `eagerLlmStart: false` does not trigger speculative generation. | Status: not_done

---

## Phase 4: Polish and Production Readiness (v1.0.0)

### 4.1 Edge Case Hardening

- [ ] **Handle user speaks very briefly (< minSpeechDurationMs)** — No turn cycle triggered. System returns to `idle` without invoking LLM/TTS. (Spec Section 14 edge cases) | Status: not_done

- [ ] **Handle user speaks with no pauses for 60 seconds** — STT handles long continuous speech without errors or memory issues. | Status: not_done

- [ ] **Handle LLM returns empty response** — No TTS called. Emit `aiSpeechEnd` with empty string. Return to `idle` gracefully. | Status: not_done

- [ ] **Handle LLM returns single-word response** — Treated as one sentence. TTS synthesizes it normally. | Status: not_done

- [ ] **Handle TTS called with very long sentence (1000+ characters)** — Handled without timeout or memory issues. | Status: not_done

- [ ] **Handle rapid barge-in** — User interrupts within 100ms of AI starting to speak. Full cancellation sequence executes cleanly. | Status: not_done

- [ ] **Handle double barge-in** — User interrupts, AI starts new response, user interrupts again. Second barge-in is handled correctly without state corruption. | Status: not_done

- [ ] **Handle stop() during each state** — Verify all cleanup paths work from every state: `idle`, `user-speaking`, `user-paused`, `processing`, `ai-speaking`, `interrupted`. | Status: not_done

- [ ] **Handle stop() during processing while LLM is generating** — LLM is aborted via AbortSignal. | Status: not_done

- [ ] **Handle pushAudio() before start()** — No crash. Audio is silently ignored. | Status: not_done

- [ ] **Handle provider throws synchronously in start()** — Error event emitted, state returns to `idle`. | Status: not_done

### 4.2 AbortSignal Support

- [ ] **Implement external AbortSignal** — Accept an `AbortSignal` via `TurnManagerConfig.signal`. When the signal fires, execute a full `stop()` sequence (cancel all in-flight operations, clean up resources, transition to `idle`). (Spec Section 10) | Status: not_done

- [ ] **Test AbortSignal — cancels running manager** — External abort stops the manager from any state. | Status: not_done

- [ ] **Test AbortSignal — cleanup is complete** — All timers, connections, and in-flight operations are properly cleaned up. | Status: not_done

### 4.3 Provider Warmup

- [ ] **Implement provider warmup calls** — During idle periods, call `warmup()` on providers that have the method defined. Reduces cold-start latency on the next turn. (Spec Section 9) | Status: not_done

- [ ] **Test provider warmup — called during idle** — Verify `warmup()` is called on providers that implement it. | Status: not_done

- [ ] **Test provider warmup — optional** — Verify no crash when providers do not implement `warmup()`. | Status: not_done

### 4.4 Integration Tests

- [ ] **Integration test — end-to-end turn cycle** — Wire up mock STT, LLM, and TTS providers. Simulate user speech -> silence -> LLM response -> TTS audio. Verify full event sequence: `stateChange(idle, user-speaking)`, `userSpeechStart`, `stateChange(user-speaking, user-paused)`, `stateChange(user-paused, processing)`, `userSpeechEnd`, `stateChange(processing, ai-speaking)`, `aiSpeechStart`, `audioOutput` (multiple), `stateChange(ai-speaking, idle)`, `aiSpeechEnd`, `turnComplete`. (Spec Section 14) | Status: not_done

- [ ] **Integration test — end-to-end barge-in cycle** — Simulate user speech -> silence -> LLM response -> TTS starts -> user interrupts. Verify barge-in event fires with correct metadata, LLM generation aborted, TTS cancelled, system transitions to listening to new user speech. (Spec Section 14) | Status: not_done

- [ ] **Integration test — multi-turn conversation** — Simulate 3-5 consecutive turns. Verify each turn produces correct events and metrics. Verify state machine returns to `idle` between turns. (Spec Section 14) | Status: not_done

- [ ] **Integration test — error recovery** — Simulate errors at each pipeline stage (STT, LLM, TTS). Verify system recovers to `idle` and can process subsequent turns. | Status: not_done

- [ ] **Integration test — latency measurement** — Verify `TurnMetrics` values are plausible (positive, in expected ranges). Verify `userToAiMs` approximately equals sum of stage latencies. (Spec Section 14) | Status: not_done

### 4.5 Performance Verification

- [ ] **Verify state machine transition overhead < 1ms** — Benchmark internal state transitions to confirm negligible overhead. (Spec Section 15) | Status: not_done

- [ ] **Verify sentence boundary detection overhead < 1ms** — Benchmark per-token processing overhead. (Spec Section 15) | Status: not_done

- [ ] **Verify event emission overhead < 1ms** — Benchmark per-event overhead. (Spec Section 15) | Status: not_done

- [ ] **Verify memory per TurnManager instance < 100KB** — Measure memory footprint of an idle TurnManager. (Spec Section 15) | Status: not_done

- [ ] **Verify total pipeline overhead < 5ms per turn** — Measure the turn manager's own processing overhead (excluding provider latencies). (Spec Section 15) | Status: not_done

### 4.6 Documentation

- [ ] **Write README.md** — Comprehensive README covering: overview, installation (`npm install voice-turn`), quick start example, all configuration options with defaults, provider interface documentation with examples (OpenAI Whisper STT, Deepgram STT, Anthropic LLM, OpenAI LLM, OpenAI TTS, ElevenLabs TTS), all endpointing strategies with configuration examples, all barge-in modes, latency optimization tips, event reference, TurnMetrics reference, integration examples with monorepo packages (audio-chunker, tts-queue, stream-tokens). Cover use cases: voice assistant, call center, accessibility, language learning. (Spec Sections 10-13, 19) | Status: not_done

- [ ] **Add JSDoc to all public API exports** — Every exported type, interface, function, and method must have JSDoc comments matching the spec descriptions. | Status: not_done

### 4.7 Build and Publish Preparation

- [ ] **Verify package.json is complete** — Ensure `name`, `version`, `description`, `main`, `types`, `files`, `scripts`, `engines`, `license`, `keywords`, `publishConfig` are all correct. Add relevant keywords (voice, turn-taking, conversation, speech, AI, STT, TTS, LLM). (Spec Section 10) | Status: not_done

- [ ] **Verify npm pack output** — Run `npm pack --dry-run` and verify only `dist/` is included. No source files, test files, or config files leak into the package. | Status: not_done

- [ ] **Verify zero runtime dependencies** — Confirm `package.json` has no `dependencies` field (or it is empty). All code is self-contained. (Spec Section 16) | Status: not_done

- [ ] **Verify TypeScript declaration files** — Run `npm run build` and confirm `.d.ts` files are generated in `dist/`. Verify a consuming project can import types correctly. | Status: not_done

- [ ] **Run full test suite** — `npm run test` passes with 100% of tests passing. | Status: not_done

- [ ] **Run lint** — `npm run lint` passes with no errors. | Status: not_done

- [ ] **Run build** — `npm run build` succeeds with no errors. | Status: not_done

- [ ] **Version bump for release** — Bump version in `package.json` to the appropriate semver version for each phase milestone. | Status: not_done
