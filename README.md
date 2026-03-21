# voice-turn

Turn-taking manager for voice AI conversations. Coordinates STT (speech-to-text), LLM, and TTS (text-to-speech) providers through a 6-state finite state machine with endpointing, barge-in detection, and sentence-level streaming.

## Install

```bash
npm install voice-turn
```

Zero runtime dependencies.

## Quick start

```typescript
import { createTurnManager } from 'voice-turn'

// Implement the provider interfaces for your stack
const tm = createTurnManager({
  stt: mySttProvider,
  llm: myLlmProvider,
  tts: myTtsProvider,
  endpointing: { silenceMs: 800, minSpeechMs: 300 },
  bargeIn: { enabled: true, minInterruptionMs: 200 },
  splitSentences: true,
})

tm.on('stateChange', (next, prev) => console.log(`${prev} -> ${next}`))
tm.on('transcript', (text) => console.log('User said:', text))
tm.on('response', (text) => console.log('AI response so far:', text))
tm.on('turnComplete', () => console.log('Turn done'))

tm.start()

// Feed audio frames from microphone
microphone.on('data', (chunk) => tm.pushAudio(chunk))
```

## State machine

```
idle
 └─(audio-detected)──────► user-speaking
                                │
                          (silence-detected)
                                │
                                ▼
                           user-paused ◄─(audio-resumed)─┐
                                │                         │
                          (endpoint-confirmed)            │
                                │                         │
                                ▼                         │
                           processing                     │
                                │                         │
                       (response-ready)                   │
                                │                         │
                                ▼                         │
                           ai-speaking ─(barge-in)─► interrupted
                                │                         │
                         (speech-complete)          (resume-listening)
                                │                         │
                                └──────────► idle ◄───────┘
```

All states except `idle` also have a `stop` transition directly back to `idle`.

## Provider interfaces

### STTProvider

```typescript
interface STTProvider {
  start(): void
  stop(): Promise<string>               // returns full transcript
  pushAudio(audio: Uint8Array | Float32Array): void
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  warmup?(): Promise<void>
}
```

Expected events: `'partial'` (interim text), `'speech-start'`, `'speech-end'`.

### LLMProvider

```typescript
interface LLMProvider {
  generate(
    transcript: string,
    context?: ConversationContext,
    signal?: AbortSignal,
  ): AsyncIterable<string>
  warmup?(): Promise<void>
}
```

### TTSProvider

```typescript
interface TTSProvider {
  speak(text: string, signal?: AbortSignal): TTSSpeakResult
  warmup?(): Promise<void>
}

interface TTSSpeakResult {
  audio: ReadableStream<Uint8Array>
  cancel(): void
}
```

## Events

| Event | Args | Description |
|---|---|---|
| `stateChange` | `(newState, prevState)` | State transition occurred |
| `userSpeechStart` | `()` | User started speaking |
| `userSpeechEnd` | `()` | User finished speaking (endpoint detected) |
| `aiSpeechStart` | `()` | AI started speaking |
| `aiSpeechEnd` | `()` | AI finished speaking |
| `bargeIn` | `({ interruptedText })` | User interrupted AI mid-response |
| `partialTranscript` | `(text)` | Interim STT result |
| `transcript` | `(text)` | Final transcript for this turn |
| `response` | `(text)` | Accumulated LLM response so far |
| `turnComplete` | `()` | Full turn cycle complete |
| `error` | `(error)` | Error during processing |

## Configuration

```typescript
interface TurnManagerConfig {
  stt: STTProvider
  llm: LLMProvider
  tts: TTSProvider
  endpointing?: {
    silenceMs?: number       // default 800 — silence to end utterance
    minSpeechMs?: number     // default 300 — minimum valid utterance
  }
  bargeIn?: {
    enabled?: boolean        // default true
    minInterruptionMs?: number  // default 200
  }
  context?: ConversationContext  // initial context / history
  splitSentences?: boolean       // default true — speak sentence-by-sentence
  processingTimeoutMs?: number   // default 30000
  signal?: AbortSignal           // external cancellation
}
```

## TurnMetrics

After each completed turn, `tm.lastTurnMetrics` contains:

```typescript
interface TurnMetrics {
  speechDurationMs: number      // how long user spoke
  processingDurationMs: number  // LLM + TTS pipeline duration
  ttfaMs: number                // time to first audio from processing start
  totalTurnMs: number           // wall time for the whole turn
}
```

## License

MIT
