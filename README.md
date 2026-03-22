# voice-turn

Turn-taking manager for voice AI conversations.

[![npm version](https://img.shields.io/npm/v/voice-turn.svg)](https://www.npmjs.com/package/voice-turn)
[![npm downloads](https://img.shields.io/npm/dt/voice-turn.svg)](https://www.npmjs.com/package/voice-turn)
[![license](https://img.shields.io/npm/l/voice-turn.svg)](https://github.com/SiluPanda/voice-turn/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/voice-turn.svg)](https://nodejs.org/)

Coordinates STT (speech-to-text), LLM, and TTS (text-to-speech) providers through a six-state finite state machine with silence-based endpointing, barge-in detection, and sentence-level streaming. Replaces the 300-500 lines of state management, timer coordination, and edge-case handling that every voice AI application otherwise implements from scratch.

Zero runtime dependencies. Provider-agnostic -- bring your own STT, LLM, and TTS.

---

## Installation

```bash
npm install voice-turn
```

Requires Node.js 18 or later.

---

## Quick Start

```typescript
import { createTurnManager } from 'voice-turn';
import type { STTProvider, LLMProvider, TTSProvider } from 'voice-turn';

// Implement the three provider interfaces for your stack
const stt: STTProvider = createYourSTTProvider();
const llm: LLMProvider = createYourLLMProvider();
const tts: TTSProvider = createYourTTSProvider();

const manager = createTurnManager({
  stt,
  llm,
  tts,
  endpointing: { silenceMs: 800, minSpeechMs: 300 },
  bargeIn: { enabled: true, minInterruptionMs: 200 },
  splitSentences: true,
});

manager.on('stateChange', (next, prev) => {
  console.log(`${prev} -> ${next}`);
});

manager.on('transcript', (text) => {
  console.log('User said:', text);
});

manager.on('response', (text) => {
  console.log('AI response so far:', text);
});

manager.on('turnComplete', () => {
  console.log('Turn complete');
});

manager.on('error', (err) => {
  console.error('Turn error:', err.message);
});

manager.start();

// Feed audio frames from your microphone or audio source
microphone.on('data', (chunk: Uint8Array) => {
  manager.pushAudio(chunk);
});

// Later, stop the manager
manager.stop();
```

---

## Features

- **Six-state finite state machine** -- Models the full conversational lifecycle: `idle`, `user-speaking`, `user-paused`, `processing`, `ai-speaking`, and `interrupted`. Every transition is validated; invalid transitions are silently rejected.
- **Silence-based endpointing** -- Detects when the user has finished speaking using a configurable silence threshold. Short utterances below a minimum speech duration are discarded to filter out coughs, mic bumps, and background noise.
- **Barge-in detection** -- Automatically detects when the user speaks over the AI's response. Cancels in-flight LLM generation and TTS synthesis, then resumes listening. Configurable minimum interruption duration prevents false triggers from transient noise.
- **Sentence-level streaming** -- Splits the LLM's streaming response at sentence boundaries and sends each sentence to TTS independently. The first sentence begins playing while later sentences are still generating, minimizing perceived latency.
- **Abbreviation-aware sentence splitting** -- Recognizes common abbreviations (Dr., Mr., Mrs., Prof., etc.) to avoid incorrect sentence breaks.
- **Full pipeline coordination** -- Manages the STT-to-LLM-to-TTS pipeline end-to-end. Handles streaming at every stage, abort signal propagation, processing timeouts, and graceful error recovery.
- **Turn metrics** -- Tracks speech duration, processing duration, time-to-first-audio (TTFA), and total turn time for every completed turn.
- **Typed event emitter** -- All events are fully typed. The `on()` method returns an unsubscribe function for ergonomic cleanup.
- **Provider-agnostic** -- Works with any STT, LLM, or TTS service. Implement three simple interfaces and plug them in.
- **Zero runtime dependencies** -- Ships only compiled TypeScript. No transitive dependency tree.
- **AbortSignal support** -- Pass an external `AbortSignal` to cancel the entire turn manager from outside.
- **Conversation context management** -- Maintains conversation history automatically across turns. Update the system prompt or metadata at any time with `setContext()`.

---

## State Machine

```
idle
 +---(audio-detected)-----------> user-speaking
                                       |
                                 (silence-detected)
                                       |
                                       v
                                  user-paused <--(audio-resumed)--+
                                       |                          |
                                 (endpoint-confirmed)             |
                                       |                          |
                                       v                          |
                                  processing                      |
                                       |                          |
                                 (response-ready)                 |
                                       |                          |
                                       v                          |
                                  ai-speaking ---(barge-in)---> interrupted
                                       |                          |
                                 (speech-complete)          (resume-listening)
                                       |                          |
                                       +----------> idle <--------+
```

All states except `idle` also support a `stop` transition directly back to `idle`.

### Transition Table

| From | To | Trigger |
|---|---|---|
| `idle` | `user-speaking` | Audio detected |
| `user-speaking` | `user-paused` | Silence detected |
| `user-speaking` | `processing` | Endpoint detected |
| `user-paused` | `user-speaking` | Audio resumed |
| `user-paused` | `processing` | Endpoint confirmed (silence exceeds threshold) |
| `processing` | `ai-speaking` | LLM response ready |
| `processing` | `idle` | Processing complete or error |
| `ai-speaking` | `idle` | Speech complete |
| `ai-speaking` | `interrupted` | Barge-in detected |
| `interrupted` | `user-speaking` | Resume listening |
| Any (except `idle`) | `idle` | `stop()` called |

---

## API Reference

### `createTurnManager(config: TurnManagerConfig): TurnManager`

Factory function that creates and returns a `TurnManager` instance. This is the primary entry point.

```typescript
import { createTurnManager } from 'voice-turn';

const manager = createTurnManager({
  stt: mySTTProvider,
  llm: myLLMProvider,
  tts: myTTSProvider,
});
```

### `TurnManager`

The turn manager instance returned by `createTurnManager()`.

#### `start(): void`

Starts the turn manager. Transitions to the `idle` state, registers event listeners on the STT provider, and begins accepting audio input via `pushAudio()`.

```typescript
manager.start();
```

#### `stop(): void`

Stops the turn manager. Cancels all in-flight operations (aborts LLM generation, cancels TTS synthesis, stops STT), clears all timers, removes STT event listeners, and transitions to `idle`. Safe to call from any state.

```typescript
manager.stop();
```

#### `pushAudio(audio: Uint8Array | Float32Array): void`

Feeds an audio frame to the turn manager. The audio is forwarded to the STT provider and evaluated for barge-in detection when the AI is speaking. No-op if the manager is not running.

```typescript
manager.pushAudio(new Float32Array(audioBuffer));
```

#### `getState(): TurnState`

Returns the current state of the turn manager.

```typescript
const state = manager.getState(); // 'idle' | 'user-speaking' | 'user-paused' | 'processing' | 'ai-speaking' | 'interrupted'
```

#### `setContext(context: ConversationContext): void`

Replaces the conversation context. Takes effect on the next LLM invocation.

```typescript
manager.setContext({
  systemPrompt: 'You are a helpful assistant.',
  history: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ],
  metadata: { userId: 'abc123' },
});
```

#### `on<K extends keyof TurnManagerEvents>(event: K, handler: (...args: TurnManagerEvents[K]) => void): () => void`

Registers an event listener. Returns an unsubscribe function.

```typescript
const unsub = manager.on('transcript', (text) => {
  console.log(text);
});

// Later, remove the listener
unsub();
```

#### `off<K extends keyof TurnManagerEvents>(event: K, handler: (...args: TurnManagerEvents[K]) => void): void`

Removes a previously registered event listener.

```typescript
manager.off('transcript', myHandler);
```

#### `isRunning: boolean` (read-only)

Whether the manager is currently running (between `start()` and `stop()` calls).

#### `lastTurnMetrics: TurnMetrics | null` (read-only)

Metrics from the most recently completed turn, or `null` if no turn has completed yet.

---

### `isValidTransition(from: TurnState, to: TurnState): boolean`

Checks whether a state transition is valid according to the turn-taking state machine.

```typescript
import { isValidTransition } from 'voice-turn';

isValidTransition('idle', 'user-speaking');  // true
isValidTransition('idle', 'ai-speaking');    // false
```

### `getValidTransitions(from: TurnState): TurnState[]`

Returns all valid target states from a given state.

```typescript
import { getValidTransitions } from 'voice-turn';

getValidTransitions('ai-speaking'); // ['idle', 'interrupted']
```

### `splitSentences(text: string): string[]`

Splits text into sentences at `.`, `!`, or `?` boundaries followed by whitespace. Recognizes common abbreviations (Dr., Mr., Mrs., Prof., Jr., Sr., etc.) to avoid false splits. Filters out fragments shorter than 10 characters.

```typescript
import { splitSentences } from 'voice-turn';

splitSentences('Dr. Smith is here. How are you?');
// ['Dr. Smith is here.', 'How are you?']

splitSentences('Hi.');
// [] (filtered: below 10-character minimum)
```

### `TypedEventEmitter<Events>`

A lightweight, generic typed event emitter class. Used internally by the turn manager and available for custom use.

```typescript
import { TypedEventEmitter } from 'voice-turn';

type MyEvents = {
  data: [number];
  done: [];
};

const emitter = new TypedEventEmitter<MyEvents>();
const unsub = emitter.on('data', (n) => console.log(n));
emitter.emit('data', 42);
unsub();
```

#### Methods

- `on<K>(event: K, handler: (...args: Events[K]) => void): () => void` -- Register a listener. Returns an unsubscribe function.
- `off<K>(event: K, handler: (...args: Events[K]) => void): void` -- Remove a listener.
- `emit<K>(event: K, ...args: Events[K]): void` -- Emit an event to all registered listeners.

---

## Configuration

### `TurnManagerConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `stt` | `STTProvider` | (required) | Speech-to-text provider |
| `llm` | `LLMProvider` | (required) | Large language model provider |
| `tts` | `TTSProvider` | (required) | Text-to-speech provider |
| `endpointing` | `EndpointingConfig` | `{}` | Endpointing configuration |
| `bargeIn` | `BargeInConfig` | `{}` | Barge-in configuration |
| `context` | `ConversationContext` | `{}` | Initial conversation context |
| `splitSentences` | `boolean` | `true` | Split LLM output at sentence boundaries for incremental TTS |
| `processingTimeoutMs` | `number` | `30000` | Maximum time for the LLM + TTS pipeline before aborting |
| `signal` | `AbortSignal` | -- | External abort signal for cancellation |

### `EndpointingConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `silenceMs` | `number` | `800` | Silence duration in milliseconds to confirm end of speech |
| `minSpeechMs` | `number` | `300` | Minimum speech duration to count as a real utterance |

### `BargeInConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Whether barge-in detection is active |
| `minInterruptionMs` | `number` | `200` | Minimum speaking duration to trigger a barge-in |

### `ConversationContext`

| Property | Type | Default | Description |
|---|---|---|---|
| `history` | `Array<{ role: 'user' \| 'assistant'; content: string }>` | -- | Conversation history |
| `systemPrompt` | `string` | -- | System prompt for the LLM |
| `metadata` | `Record<string, unknown>` | -- | Arbitrary metadata passed to the LLM provider |

---

## Provider Interfaces

### `STTProvider`

Wraps any speech-to-text service. Must emit three events: `'partial'` (interim transcript text), `'speech-start'`, and `'speech-end'`.

```typescript
interface STTProvider {
  start(): void;
  stop(): Promise<string>;
  pushAudio(audio: Uint8Array | Float32Array): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  warmup?(): Promise<void>;
}
```

| Method | Description |
|---|---|
| `start()` | Begin accepting audio and producing transcription events |
| `stop()` | Stop transcription and return the final transcript |
| `pushAudio(audio)` | Feed an audio frame (PCM data as `Uint8Array` or `Float32Array`) |
| `on(event, handler)` | Register an event listener (`'partial'`, `'speech-start'`, `'speech-end'`) |
| `off(event, handler)` | Remove an event listener |
| `warmup()` | Optional. Pre-initialize the provider to reduce first-call latency |

### `LLMProvider`

Wraps any large language model service. Must return an async iterable of string tokens.

```typescript
interface LLMProvider {
  generate(
    transcript: string,
    context?: ConversationContext,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
  warmup?(): Promise<void>;
}
```

| Method | Description |
|---|---|
| `generate(transcript, context?, signal?)` | Stream a response for the given transcript and context. Respect the abort signal for cancellation. |
| `warmup()` | Optional. Pre-initialize the provider to reduce first-call latency |

### `TTSProvider`

Wraps any text-to-speech service. Must return a readable audio stream with a cancel function.

```typescript
interface TTSProvider {
  speak(text: string, signal?: AbortSignal): TTSSpeakResult;
  warmup?(): Promise<void>;
}

interface TTSSpeakResult {
  audio: ReadableStream<Uint8Array>;
  cancel(): void;
}
```

| Method | Description |
|---|---|
| `speak(text, signal?)` | Synthesize the given text into audio. Return a stream and a cancel function. |
| `warmup()` | Optional. Pre-initialize the provider to reduce first-call latency |

---

## Events

| Event | Arguments | Description |
|---|---|---|
| `stateChange` | `(newState: TurnState, prevState: TurnState)` | A state transition occurred |
| `userSpeechStart` | `()` | The user started speaking |
| `userSpeechEnd` | `()` | The user finished speaking (endpoint detected) |
| `aiSpeechStart` | `()` | The AI started speaking |
| `aiSpeechEnd` | `()` | The AI finished speaking |
| `bargeIn` | `({ interruptedText: string })` | The user interrupted the AI mid-response |
| `partialTranscript` | `(text: string)` | Interim STT result |
| `transcript` | `(text: string)` | Final user transcript for this turn |
| `response` | `(text: string)` | Accumulated LLM response text (emitted progressively) |
| `turnComplete` | `()` | A full turn cycle completed |
| `error` | `(error: Error)` | An error occurred during processing |

---

## Error Handling

Errors during any pipeline stage are caught and emitted via the `error` event. The manager transitions back to `idle` after an error, allowing the conversation to continue.

```typescript
manager.on('error', (err) => {
  console.error('Pipeline error:', err.message);
  // The manager is back in 'idle' state and ready for the next turn
});
```

### Processing Timeout

If the LLM + TTS pipeline exceeds `processingTimeoutMs` (default 30 seconds), the in-flight request is aborted and an error is emitted.

```typescript
const manager = createTurnManager({
  stt, llm, tts,
  processingTimeoutMs: 10000, // 10-second timeout
});
```

### External Cancellation

Pass an `AbortSignal` to cancel all operations from outside:

```typescript
const controller = new AbortController();

const manager = createTurnManager({
  stt, llm, tts,
  signal: controller.signal,
});

manager.start();

// Cancel everything
controller.abort();
```

### STT Errors

If the STT provider throws during `stop()`, the error is caught, emitted, and the manager returns to `idle`.

### Graceful Shutdown

Calling `stop()` from any state aborts all in-flight LLM requests, cancels TTS synthesis, stops the STT provider, clears all timers, and transitions to `idle`.

---

## Advanced Usage

### Custom Endpointing Thresholds

Tune endpointing for your use case. Shorter silence thresholds feel more responsive but risk cutting the user off mid-pause. Longer thresholds are safer but introduce latency.

```typescript
// Fast response -- good for short commands
const manager = createTurnManager({
  stt, llm, tts,
  endpointing: { silenceMs: 500, minSpeechMs: 200 },
});

// Patient listening -- good for longer utterances
const manager = createTurnManager({
  stt, llm, tts,
  endpointing: { silenceMs: 1500, minSpeechMs: 500 },
});
```

### Disabling Barge-In

For scenarios where the AI should not be interrupted (e.g., reading important information):

```typescript
const manager = createTurnManager({
  stt, llm, tts,
  bargeIn: { enabled: false },
});
```

### Disabling Sentence Splitting

If your TTS provider handles long text efficiently or you prefer to send the full response at once:

```typescript
const manager = createTurnManager({
  stt, llm, tts,
  splitSentences: false,
});
```

### Turn Metrics

Access latency metrics after each completed turn:

```typescript
manager.on('turnComplete', () => {
  const metrics = manager.lastTurnMetrics;
  if (metrics) {
    console.log(`Speech duration: ${metrics.speechDurationMs}ms`);
    console.log(`Processing time: ${metrics.processingDurationMs}ms`);
    console.log(`Time to first audio: ${metrics.ttfaMs}ms`);
    console.log(`Total turn time: ${metrics.totalTurnMs}ms`);
  }
});
```

### `TurnMetrics`

| Property | Type | Description |
|---|---|---|
| `speechDurationMs` | `number` | How long the user spoke |
| `processingDurationMs` | `number` | Total LLM + TTS pipeline duration |
| `ttfaMs` | `number` | Time from processing start to first audio output |
| `totalTurnMs` | `number` | Wall-clock time for the entire turn |

### Dynamic Context Updates

Update the conversation context between turns without restarting:

```typescript
manager.on('turnComplete', () => {
  manager.setContext({
    systemPrompt: 'You are a helpful assistant.',
    history: getConversationHistory(),
    metadata: { turnCount: getTurnCount() },
  });
});
```

### Validating State Transitions

Use the state machine utilities for custom UI logic or debugging:

```typescript
import { isValidTransition, getValidTransitions } from 'voice-turn';

// Check if a specific transition is allowed
if (isValidTransition('ai-speaking', 'interrupted')) {
  console.log('Barge-in is a valid transition from ai-speaking');
}

// List all possible next states
const nextStates = getValidTransitions('processing');
// ['ai-speaking', 'idle']
```

### Implementing an STT Provider

Example wrapping a hypothetical STT SDK:

```typescript
import type { STTProvider } from 'voice-turn';

function createMySTTProvider(): STTProvider {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  function emit(event: string, ...args: unknown[]) {
    for (const handler of listeners.get(event) ?? []) {
      handler(...args);
    }
  }

  let transcript = '';

  return {
    start() {
      transcript = '';
      // Initialize your STT SDK here
    },
    async stop() {
      // Finalize and return the complete transcript
      return transcript;
    },
    pushAudio(audio) {
      // Feed audio to your STT SDK
      // When interim results arrive, call:
      //   emit('partial', interimText)
      // When speech is detected, call:
      //   emit('speech-start')
      // When silence is detected, call:
      //   emit('speech-end')
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
  };
}
```

### Implementing an LLM Provider

Example wrapping an OpenAI-compatible streaming API:

```typescript
import type { LLMProvider, ConversationContext } from 'voice-turn';

function createMyLLMProvider(apiKey: string): LLMProvider {
  return {
    async *generate(transcript, context, signal) {
      const messages = [
        ...(context?.systemPrompt
          ? [{ role: 'system' as const, content: context.systemPrompt }]
          : []),
        ...(context?.history ?? []),
        { role: 'user' as const, content: transcript },
      ];

      const response = await fetch('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages, stream: true }),
        signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE and yield text tokens
        yield chunk;
      }
    },
  };
}
```

---

## TypeScript

This package is written in TypeScript and ships with full type declarations. All public types are exported from the package root:

```typescript
import type {
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
} from 'voice-turn';
```

The `TypedEventEmitter` class is exported as a value for direct use in application code.

---

## License

MIT
