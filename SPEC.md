# voice-turn -- Specification

## 1. Overview

`voice-turn` is a turn-taking orchestration library for voice AI applications. It manages the conversational state machine that governs when the user is speaking, when the AI is speaking, and how transitions between those states occur. Given pluggable STT (speech-to-text), LLM (large language model), and TTS (text-to-speech) providers, it detects when the user has finished speaking (endpointing), coordinates the STT-to-LLM-to-TTS pipeline, handles barge-in interruptions when the user speaks over the AI, and emits events at each state transition so the application can update its UI and audio routing. The result is a single `TurnManager` instance that replaces the 300-500 lines of state management, timer coordination, and edge-case handling that every voice AI application otherwise implements from scratch.

The gap this package fills is specific and well-defined. Individual STT SDKs (OpenAI Whisper, Deepgram, Google Cloud Speech-to-Text) provide raw audio-to-text transcription. Individual TTS SDKs (OpenAI TTS, ElevenLabs, Google Cloud Text-to-Speech) provide raw text-to-audio synthesis. LLM SDKs (OpenAI, Anthropic, Google) provide text-to-text generation. None of these handle the conversational orchestration layer: determining when the user's turn has ended, deciding when to stop the AI's audio playback because the user interrupted, managing the pipeline timing so that the AI responds within 1 second of the user finishing their sentence, or recovering gracefully when the user interrupts mid-response. This orchestration logic is the difference between a voice assistant that feels natural and one that feels robotic -- and every team building a voice AI application writes this logic from scratch.

Existing tools address parts of this problem but not the whole. OpenAI's Realtime API bundles turn-taking into a proprietary, OpenAI-only WebSocket protocol -- it cannot be used with Anthropic models, open-source models, or alternative STT/TTS providers. LiveKit is an infrastructure platform for real-time audio/video that provides transport but not conversational state management. Pipecat and Vocode are Python frameworks that include turn-taking logic but are Python-only, framework-level (not library-level), and tightly coupled to their own pipeline abstractions. In the JavaScript/TypeScript ecosystem, there is no standalone, provider-agnostic library that manages turn-taking as an independent concern. `voice-turn` fills this gap: a focused library that accepts any STT, LLM, and TTS provider through simple interfaces and handles all turn-taking logic.

`voice-turn` provides a TypeScript API only (no CLI). The primary entry point is `createTurnManager(config)`, which returns a `TurnManager` instance. The manager maintains a state machine with six states (`idle`, `user-speaking`, `user-paused`, `processing`, `ai-speaking`, `interrupted`), exposes an event emitter interface for state transitions and pipeline events, and provides methods for starting, stopping, and querying the conversation. All pipeline coordination -- streaming STT, streaming LLM generation, streaming TTS with sentence-boundary splitting, barge-in cancellation -- is handled internally. The application provides audio input, receives audio output, and responds to events.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createTurnManager(config)` function that accepts pluggable STT, LLM, and TTS provider interfaces and returns a `TurnManager` instance that orchestrates conversational turn-taking.
- Implement a complete turn-taking state machine with six states (`idle`, `user-speaking`, `user-paused`, `processing`, `ai-speaking`, `interrupted`) and well-defined transitions between them.
- Provide configurable endpointing (end-of-turn detection) with multiple strategies: silence-duration threshold (default), VAD-based, streaming transcript-based, and custom user-provided functions.
- Support three barge-in modes: `full` (immediately stop AI speech and start listening), `soft` (wait briefly to confirm the user is actually interrupting before stopping), and `none` (ignore user speech during AI turn).
- Coordinate the STT-to-LLM-to-TTS pipeline with streaming at every stage: start LLM generation before STT fully finalizes, start TTS before LLM finishes generating, and start audio playback before TTS finishes synthesizing.
- Split LLM output at sentence boundaries before sending to TTS, so that the first sentence of the AI's response can be spoken while later sentences are still being generated.
- Emit typed events for all state transitions and pipeline milestones: `userSpeechStart`, `userSpeechEnd`, `aiSpeechStart`, `aiSpeechEnd`, `bargeIn`, `stateChange`, `transcript`, `response`, `error`.
- Provide latency measurement and reporting: track time from user speech end to AI speech start (total round-trip latency), and time spent in each pipeline stage (endpointing, STT, LLM TTFT, TTS).
- Handle cancellation and cleanup: when a barge-in occurs, cancel in-flight LLM requests, stop TTS synthesis, and stop audio playback. When `stop()` is called, clean up all resources.
- Support an `AbortSignal` for external cancellation of the entire turn manager.
- Target Node.js 18+ and modern JavaScript runtimes. No browser-specific APIs in the core library.

### Non-Goals

- **Not an STT engine.** This package does not transcribe audio. It accepts an `STTProvider` interface that wraps any STT SDK. The provider handles the actual speech-to-text conversion. Use the OpenAI Whisper SDK, Deepgram SDK, Google Cloud Speech client, or any other STT service to implement the provider.
- **Not a TTS engine.** This package does not synthesize speech. It accepts a `TTSProvider` interface that wraps any TTS SDK. The provider handles the actual text-to-speech conversion. Use the OpenAI TTS SDK, ElevenLabs SDK, Google Cloud Text-to-Speech client, or any other TTS service to implement the provider.
- **Not an LLM client.** This package does not call LLM APIs. It accepts an `LLMProvider` interface that wraps any LLM SDK. The provider handles the actual text generation. Use the OpenAI SDK, Anthropic SDK, or any other LLM client to implement the provider.
- **Not an audio transport layer.** This package does not capture microphone input, play audio through speakers, or manage WebSocket connections for audio streaming. Audio I/O is the application's responsibility. The application feeds audio data to the turn manager and receives synthesized audio data from it.
- **Not a VAD library.** This package can consume VAD signals for endpointing, but it does not implement voice activity detection algorithms. For VAD, use `@ricky0123/vad-node` (Silero VAD), `node-vad` (WebRTC VAD), or the VAD facilities provided by the STT provider. The `audio-chunker` package in this monorepo provides VAD integration.
- **Not a conversation history manager.** This package manages the real-time turn-taking state during a conversation. It does not maintain a conversation history, manage context windows, or implement memory. The application maintains conversation history and passes the relevant context to the LLM provider.
- **Not a full voice AI framework.** This package is a library, not a framework. It provides the turn-taking primitive and lets the application control everything else: audio capture, audio playback, UI updates, conversation history, error recovery strategy, and provider selection. It does not impose opinions on application architecture.
- **Not a real-time audio codec or media server.** This package does not transcode audio, manage RTP streams, or implement WebRTC. For real-time media infrastructure, use LiveKit, Twilio, or Daily.

---

## 3. Target Users and Use Cases

### Voice Assistant Builders

Developers building conversational voice assistants (smart speakers, mobile voice interfaces, desktop voice companions) that need natural turn-taking. The assistant must detect when the user has finished speaking, process their request through an LLM, and speak the response -- all while handling the user interrupting to correct or redirect the conversation. A typical integration replaces custom state machine code with `const manager = createTurnManager({ stt, llm, tts, endpointingMs: 800 })`.

### Call Center AI

Teams building AI agents that handle phone calls for customer service, appointment scheduling, or order management. Phone conversations demand natural turn-taking: the caller expects immediate feedback, long pauses feel broken, and the ability to interrupt is essential (callers frequently say "no, not that" mid-response). Call center AI also requires low latency (under 1 second response time) to feel conversational rather than robotic.

### Interactive Voice Response (IVR) Systems

Developers modernizing traditional IVR systems (press 1 for billing, press 2 for support) with natural language voice interfaces. Users speak their intent instead of pressing buttons, and the system responds with spoken answers. Turn-taking must handle the noisy telephone environment, short user utterances ("yes", "no", "billing"), and long system responses (reading account details).

### Accessibility Tools

Teams building voice-controlled interfaces for users with visual impairments or motor disabilities. The voice interface must be responsive (no long pauses), must handle the user's natural speech patterns (pauses to think, corrections, interruptions), and must clearly indicate when the AI is listening versus speaking.

### Interactive Tutoring and Language Learning

Developers building conversational tutoring systems where a student speaks with an AI tutor. The tutor asks questions, listens to the student's answer, provides feedback, and asks follow-up questions. Turn-taking must handle the student pausing to think (longer silence thresholds), the student interrupting to ask for clarification, and the tutor's potentially long explanations.

### Voice-Enabled Games and Entertainment

Developers building games or entertainment applications where the user converses with an AI character. The character must respond naturally, handle interruptions, and maintain conversational flow. Latency is critical for immersion -- the character should respond within 1 second.

### Prototype and Hackathon Builders

Individual developers or small teams rapidly prototyping voice AI applications. They need a drop-in turn-taking solution that works out of the box with minimal configuration, letting them focus on the application logic rather than state machine engineering.

---

## 4. Core Concepts

### Turn

A turn is a single stretch of speech by one participant in a conversation. In a two-party voice AI conversation, turns alternate between the user and the AI. The user speaks (user turn), then the AI speaks (AI turn), then the user speaks again, and so on. A turn begins when the participant starts speaking and ends when they stop. The gap between turns -- the transition from one speaker to the next -- is where the complexity lies: determining that a speaker has finished, processing their speech, and beginning the next speaker's turn.

### Turn State

A turn state is a discrete phase in the conversational state machine. At any moment, the conversation is in exactly one state. The six states are:

- **`idle`**: No one is speaking. The system is waiting for the user to begin speaking. This is the initial state and the state between conversational exchanges.
- **`user-speaking`**: The user is actively speaking. Audio is being captured and streamed to the STT provider. The STT provider may be returning partial transcripts.
- **`user-paused`**: The user has stopped producing speech (silence detected), but the system has not yet committed to the end of the user's turn. This is the endpointing decision window: is the user done, or just pausing to think?
- **`processing`**: The user's turn has definitively ended. The transcript is being sent to the LLM, and the LLM is generating a response. This state covers the latency between the user finishing and the AI beginning to speak.
- **`ai-speaking`**: The AI's response is being spoken via TTS. Audio is being played back to the user.
- **`interrupted`**: The user has spoken during the AI's turn (barge-in detected). The AI's speech is being cancelled, and the system is transitioning back to listening to the user. This is a transient state that quickly transitions to `user-speaking`.

### Endpointing

Endpointing is the process of determining when the user has finished their turn. This is the single hardest problem in voice AI turn-taking. End too quickly (short silence threshold) and the system cuts the user off mid-thought when they pause to think. End too slowly (long silence threshold) and the system feels sluggish -- the user finishes speaking and waits in awkward silence before the AI responds. Human conversations naturally have turn-taking gaps of 200-500 milliseconds. Voice AI systems must match this timing to feel natural.

### Barge-In

Barge-in (also called interruption) occurs when the user speaks while the AI is speaking. This is a normal part of conversation: users interrupt to correct the AI, redirect the conversation, or signal that they have enough information and want to move on. The system must detect the user's speech, decide whether it constitutes a genuine interruption (as opposed to background noise or a brief acknowledgment like "uh huh"), stop the AI's audio playback, cancel any in-flight LLM generation, and switch to listening to the user.

### Pipeline Stages

The voice AI pipeline has three stages that execute sequentially for each turn:

1. **STT (Speech-to-Text)**: The user's audio is transcribed into text. This stage runs during `user-speaking` and produces a transcript.
2. **LLM (Large Language Model)**: The transcript (plus conversation context) is sent to an LLM, which generates a text response. This stage runs during `processing`.
3. **TTS (Text-to-Speech)**: The LLM's text response is synthesized into audio. This stage runs during `processing` (initial synthesis) and overlaps with `ai-speaking` (playback begins before synthesis completes).

### Latency Budget

The latency budget is the total time from the user finishing their turn to the AI beginning to speak. For natural conversation, this should be under 1000 milliseconds. The budget is divided among the pipeline stages:

| Stage | Budget | Description |
|-------|--------|-------------|
| Endpointing | 300-800 ms | Silence duration before committing to end-of-turn |
| STT finalization | 100-300 ms | Final transcript after silence detected |
| LLM time-to-first-token | 200-500 ms | Time for the LLM to begin generating |
| TTS synthesis | 100-300 ms | Time to synthesize the first sentence of audio |
| Total | 700-1900 ms | End-to-end latency |

The endpointing duration is the largest contributor and the most tunable. Shorter endpointing is faster but risks false positives (cutting the user off). Longer endpointing is safer but feels slow.

### Sentence Boundary Splitting

To minimize latency, the LLM's streaming response is split into sentences as they complete. Each complete sentence is immediately sent to TTS for synthesis, rather than waiting for the entire response. The first sentence begins playing as soon as its audio is ready, while later sentences continue generating and synthesizing in the background. This pipelining reduces perceived latency by overlapping LLM generation and TTS synthesis.

---

## 5. Turn State Machine

### State Diagram

```
                          ┌─────────────────────────────────────┐
                          │                                     │
                          ▼                                     │
                    ┌──────────┐   user speech          ┌──────┴─────┐
          ┌────────│   idle   │──────detected──────────>│   user-    │
          │        └──────────┘                          │  speaking  │◄───┐
          │              ▲                               └──────┬─────┘    │
          │              │                                      │          │
          │              │                          silence     │          │
          │         ai speech                       detected    │          │
          │          ends                                       │          │
          │              │                                      ▼          │
          │        ┌─────┴──────┐                        ┌──────────┐     │
          │        │    ai-     │                        │   user-  │     │
          │        │  speaking  │                        │  paused  │     │
          │        └─────┬──────┘                        └────┬──┬──┘     │
          │              ▲                                    │  │        │
          │              │                    silence exceeds  │  │ speech │
          │         first TTS                   threshold ────┘  │ resumes│
          │         audio ready                                  │        │
          │              │                                       └────────┘
          │        ┌─────┴──────┐                        ┌──────────┐
          │        │            │◄────── user turn ──────│          │
          │        │ processing │        confirmed       │          │
          │        │            │                        │          │
          │        └────────────┘                        └──────────┘
          │
          │
          │        ┌────────────┐
          │        │            │   user speech during
          └────────│interrupted │◄──── ai-speaking
                   │            │
                   └──────┬─────┘
                          │
                          │  cancellation complete,
                          │  switch to listening
                          │
                          ▼
                   ┌──────────────┐
                   │ user-speaking │
                   └──────────────┘
```

### State Transitions

| From | To | Trigger | Actions |
|------|----|---------|---------|
| `idle` | `user-speaking` | VAD or audio energy detects user speech | Start STT provider, begin streaming audio to STT |
| `user-speaking` | `user-paused` | Silence detected (no speech for `pauseDetectionMs`, default 300ms) | Start endpointing timer, continue STT (may receive final results) |
| `user-paused` | `user-speaking` | Speech resumes before endpointing timer expires | Cancel endpointing timer, continue STT |
| `user-paused` | `processing` | Endpointing timer expires (silence exceeds `endpointingMs`) | Stop STT provider, finalize transcript, send to LLM |
| `processing` | `ai-speaking` | First TTS audio chunk is ready for playback | Begin audio playback, emit `aiSpeechStart` |
| `ai-speaking` | `idle` | TTS audio playback completes | Emit `aiSpeechEnd`, return to waiting |
| `ai-speaking` | `interrupted` | User speech detected during AI playback (barge-in) | Depends on barge-in mode (see Barge-In Handling) |
| `interrupted` | `user-speaking` | Cancellation of AI speech/LLM/TTS complete | Start STT for new user speech, emit `bargeIn` |

### Timeout and Recovery Transitions

| From | To | Trigger | Actions |
|------|----|---------|---------|
| `processing` | `idle` | LLM or TTS error | Emit `error` event, return to idle |
| `processing` | `idle` | Processing timeout exceeded (`processingTimeoutMs`, default 30000ms) | Emit `error` event with timeout, return to idle |
| `ai-speaking` | `idle` | TTS playback error | Stop playback, emit `error` event, return to idle |
| `user-speaking` | `idle` | STT error | Stop STT, emit `error` event, return to idle |
| Any state | `idle` | `stop()` called | Cancel all in-flight operations, clean up resources |

### State Invariants

- The system is in exactly one state at any time.
- `user-speaking` and `ai-speaking` never occur simultaneously (full-duplex audio routing is the application's concern, but the state machine tracks whose turn it is).
- The `interrupted` state is transient: it always transitions to `user-speaking` within a few milliseconds (the time needed to cancel AI output).
- The `processing` state always transitions to either `ai-speaking` (success) or `idle` (error/timeout).
- STT is only active during `user-speaking` and `user-paused`.
- TTS is only active during `processing` (initial synthesis) and `ai-speaking` (playback).
- LLM is only active during `processing` and `ai-speaking` (streaming generation may continue while early sentences are being spoken).

---

## 6. Endpointing

### The Endpointing Problem

When a user speaks to a voice assistant, they pause for many reasons: to think, to breathe, to formulate the next part of their sentence, or because they are genuinely done speaking. The endpointing system must distinguish "pause within a turn" from "end of turn." Every false positive (declaring end-of-turn during a mid-sentence pause) produces an incorrect, partial transcription that the LLM responds to inappropriately. Every false negative (failing to detect end-of-turn) produces an uncomfortable delay where the user waits in silence for the AI to respond.

Human conversational turn-taking relies on a combination of prosodic cues (falling intonation at the end of a statement, rising intonation for a question), syntactic cues (complete sentences), semantic cues (the statement conveys a complete thought), and gaze/gesture cues (unavailable in audio-only interfaces). Voice AI systems must approximate this multi-signal detection with the limited information available: audio energy, VAD output, and partial transcripts.

### Silence-Based Endpointing (Default)

The simplest and most common endpointing strategy. When the STT provider or VAD signals that speech has stopped, a timer starts. If speech does not resume within the configured threshold (`endpointingMs`), the user's turn is declared complete.

**How it works:**

1. During `user-speaking`, the system monitors for silence (via VAD callback or STT silence events).
2. When silence is detected, the state transitions to `user-paused` and a timer starts.
3. If speech resumes before the timer expires, the timer is cancelled and the state returns to `user-speaking`.
4. If the timer expires, the state transitions to `processing`.

**Configuration:**

```typescript
createTurnManager({
  // ...providers
  endpointing: {
    strategy: 'silence',
    silenceMs: 800,  // Default: 800ms of silence = end of turn
  },
});
```

**Tradeoffs:**

| Threshold | Effect |
|-----------|--------|
| 300-500 ms | Very responsive but high false-positive rate. Cuts off users who pause briefly between clauses. Suitable for simple yes/no interactions. |
| 600-900 ms | Balanced. Handles most natural pauses but may occasionally cut off slow speakers. Good default for general-purpose voice assistants. |
| 1000-1500 ms | Conservative. Rarely cuts off users but feels slow. Suitable for complex queries where users need time to formulate thoughts (e.g., tutoring). |
| 2000+ ms | Very conservative. Feels sluggish for most interactions but may be appropriate for accessibility use cases or non-native speakers. |

### VAD-Based Endpointing

Uses voice activity detection signals directly. When VAD reports that voice activity has ceased and the silence exceeds the threshold, the turn ends. This is more accurate than simple audio energy thresholds because VAD models (especially neural VAD like Silero) can distinguish speech from background noise, music, and non-speech sounds.

**How it works:**

The application provides a `vadCallback` that the turn manager invokes to check whether the current audio frame contains speech. Alternatively, the application pushes VAD events (`speechStart`, `speechEnd`) to the turn manager.

```typescript
createTurnManager({
  // ...providers
  endpointing: {
    strategy: 'vad',
    silenceMs: 800,
    vadCallback: (audioFrame: Float32Array) => boolean,  // true = speech detected
  },
});
```

### Transcript-Based Endpointing

Uses the STT provider's streaming transcript to make endpointing decisions. Many STT providers distinguish between "partial" (interim) and "final" (committed) transcripts. A "final" transcript with a sentence-ending punctuation mark (period, question mark, exclamation mark) is a strong signal that the user has completed a sentence. Combined with a short silence, this can trigger end-of-turn faster than silence alone.

**How it works:**

1. The STT provider emits partial transcripts during speech and final transcripts when it commits a segment.
2. When a final transcript is received that ends with sentence-ending punctuation and silence is detected, the endpointing timer uses a shorter threshold (`transcriptEndMs`, default 400ms instead of 800ms).
3. This allows faster turn transitions when the STT provider is confident that a sentence is complete.

```typescript
createTurnManager({
  // ...providers
  endpointing: {
    strategy: 'transcript',
    silenceMs: 800,            // Normal silence threshold
    transcriptEndMs: 400,      // Reduced threshold after sentence-ending transcript
    sentenceEndPattern: /[.?!]\s*$/,  // Pattern to detect sentence endings
  },
});
```

### Adaptive Endpointing

Adjusts the silence threshold dynamically based on the conversation's pace and the user's speaking patterns. If the user has been speaking in short, rapid utterances, the threshold is reduced. If the user has been speaking in long, thoughtful sentences with pauses, the threshold is increased.

**Algorithm:**

```
recentPauses = sliding window of last N pause durations within user turns
averagePause = mean(recentPauses)
adaptiveThreshold = max(minThreshold, min(maxThreshold, averagePause * multiplier))
```

```typescript
createTurnManager({
  // ...providers
  endpointing: {
    strategy: 'adaptive',
    minSilenceMs: 500,         // Never endpoint faster than 500ms
    maxSilenceMs: 1500,        // Never wait longer than 1500ms
    adaptiveMultiplier: 2.0,   // Threshold = 2x average in-turn pause
    windowSize: 5,             // Consider last 5 pauses
  },
});
```

### Custom Endpointing

The application provides a custom endpointing function that receives the current state (partial transcript, silence duration, VAD status) and returns a boolean indicating whether the turn should end. This enables application-specific logic: domain-specific sentence detection, integration with custom NLU models, or hybrid strategies.

```typescript
createTurnManager({
  // ...providers
  endpointing: {
    strategy: 'custom',
    shouldEndTurn: (context: EndpointingContext) => boolean,
  },
});
```

The `EndpointingContext` contains:

```typescript
interface EndpointingContext {
  /** Current partial or final transcript. */
  transcript: string;

  /** Whether the transcript is final (committed by STT). */
  isFinal: boolean;

  /** Duration of current silence in milliseconds. */
  silenceDurationMs: number;

  /** Whether VAD currently detects speech. */
  isSpeechActive: boolean;

  /** Total duration of user speech in this turn. */
  speechDurationMs: number;

  /** Number of words in the current transcript. */
  wordCount: number;

  /** Duration of the entire conversation so far. */
  conversationDurationMs: number;
}
```

### False Positive Mitigation

Even with optimal thresholds, false positives occur. `voice-turn` provides two mechanisms to reduce their impact:

1. **Minimum speech duration**: The user must have spoken for at least `minSpeechDurationMs` (default 300ms) before endpointing is considered. This prevents the system from treating very brief sounds (coughs, "um", mic bumps) as complete turns.

2. **Minimum word count**: The transcript must contain at least `minWordCount` (default 0, disabled) words before endpointing triggers. This prevents the system from treating single-word fragments as complete turns in scenarios where longer utterances are expected.

---

## 7. Barge-In Handling

### What Is Barge-In

Barge-in occurs when the user speaks while the AI is speaking (during `ai-speaking` state). In natural conversation, people interrupt each other constantly: to agree ("right, right"), to redirect ("actually, I meant"), to correct ("no, the other one"), or to signal understanding ("got it, thanks"). A voice AI system that ignores barge-in forces the user to sit through the AI's entire response before speaking, which is deeply unnatural and frustrating.

### Full Barge-In (Default)

When user speech is detected during `ai-speaking`, the system immediately:

1. Transitions to `interrupted` state.
2. Stops TTS audio playback (mid-word if necessary).
3. Cancels any pending TTS synthesis requests.
4. Aborts the in-flight LLM generation (if still streaming).
5. Starts the STT provider to listen to the user's new speech.
6. Transitions to `user-speaking` state.
7. Emits a `bargeIn` event with metadata about where in the AI's response the interruption occurred.

**Total interruption latency target**: Under 200ms from detecting user speech to stopping AI audio and beginning to listen.

```typescript
createTurnManager({
  // ...providers
  bargeIn: {
    mode: 'full',
    minSpeechForBargeIn: 200,  // Require 200ms of user speech to confirm barge-in
  },
});
```

The `minSpeechForBargeIn` parameter prevents false barge-ins from brief noise. The user must produce at least this duration of detected speech before the barge-in is triggered. During this confirmation window, the AI continues speaking.

### Soft Barge-In

A more cautious barge-in mode. When user speech is detected during `ai-speaking`:

1. The system notes the speech start but does not immediately interrupt.
2. If the user continues speaking for at least `softBargeInMs` (default 500ms), the barge-in is confirmed and the full interruption sequence executes.
3. If the user's speech stops before `softBargeInMs`, it is treated as a non-interrupting vocalization (acknowledgment, background noise) and the AI continues speaking.

This mode is useful for scenarios where users frequently produce brief acknowledgments ("uh huh", "okay", "right") while the AI is speaking, which should not interrupt the response.

```typescript
createTurnManager({
  // ...providers
  bargeIn: {
    mode: 'soft',
    softBargeInMs: 500,   // User must speak for 500ms to trigger interruption
  },
});
```

### No Barge-In

User speech during `ai-speaking` is ignored. The AI completes its full response before returning to `idle` and listening for the next user turn. This mode is appropriate for scenarios where the AI delivers critical information that should not be interrupted (safety instructions, legal disclaimers) or where the audio environment is too noisy for reliable barge-in detection.

```typescript
createTurnManager({
  // ...providers
  bargeIn: {
    mode: 'none',
  },
});
```

### Barge-In Cancellation Sequence

When a barge-in is confirmed (in `full` or `soft` mode), the following cancellation sequence executes:

1. **Stop TTS playback**: The application's audio output is signalled to stop immediately via the `TTSProvider.cancel()` method. Any buffered audio is discarded.
2. **Cancel TTS synthesis**: Any in-flight TTS synthesis requests (sentences queued but not yet synthesized, or synthesis in progress) are cancelled via `AbortController`.
3. **Abort LLM generation**: If the LLM is still streaming response tokens, the generation is aborted via the `AbortController` passed to the `LLMProvider.generate()` call.
4. **Record interruption point**: The system records how much of the AI's response was spoken before interruption (the last completed sentence) for the application's reference.
5. **Start STT**: The STT provider is started to begin transcribing the user's new speech.

The entire cancellation sequence targets completion within 100ms.

### State Recovery After Interruption

After a barge-in, the conversation state is clean: the system is listening to the user as if starting a fresh user turn. The application receives the `bargeIn` event, which includes:

```typescript
interface BargeInEvent {
  /** The full AI response text that was being spoken. */
  fullResponse: string;

  /** The portion of the response that was actually spoken before interruption. */
  spokenResponse: string;

  /** The sentence index where the interruption occurred (0-based). */
  interruptedAtSentence: number;

  /** The user's speech that triggered the barge-in (partial transcript). */
  userSpeech: string;

  /** Time in milliseconds that the AI had been speaking before interruption. */
  aiSpeechDurationMs: number;
}
```

The application can use this information to adjust conversation context. For example, if the AI was reading a list and was interrupted after item 3 of 10, the application can note that items 4-10 were not delivered.

---

## 8. Pipeline Coordination

### Pipeline Overview

The STT-to-LLM-to-TTS pipeline processes each user turn:

```
┌─────────┐        ┌─────────┐        ┌─────────┐        ┌──────────┐
│  User    │ audio  │  STT    │ text   │  LLM    │ text   │   TTS    │ audio
│  Audio   │───────>│Provider │───────>│Provider │───────>│ Provider │───────> Speaker
│  Input   │        │         │        │         │        │          │
└─────────┘        └─────────┘        └─────────┘        └──────────┘
                   Streaming          Streaming           Streaming
                   transcripts       tokens/sentences     audio chunks
```

Each stage operates in streaming mode: it begins producing output before its input is complete. This pipelining is critical for latency: waiting for each stage to fully complete before starting the next would add unacceptable delay.

### STT Stage

The STT stage runs during `user-speaking` and `user-paused`. It receives audio data from the application (via `manager.pushAudio(audioData)`) and produces transcripts via the `STTProvider` interface.

**Streaming behavior:**

- The STT provider emits `partial` events as interim (non-final) transcripts update. These provide real-time feedback for the application's UI (showing what the user is saying as they speak).
- The STT provider emits `transcript` events as final (committed) transcripts. These are accumulated into the full transcript for the user's turn.
- When the turn ends (endpointing triggers), the turn manager calls `stt.stop()` to signal the provider to finalize and flush any remaining transcript.

**Latency contribution:** The STT stage adds latency between the user finishing speaking and the final transcript being available. Most streaming STT providers finalize within 100-300ms of the last audio frame. The turn manager waits for the final transcript before sending to the LLM, but endpointing already provides a silence window during which the STT can finalize.

### LLM Stage

The LLM stage runs during `processing`. It receives the final transcript (plus any conversation context the application provides) and produces a text response via the `LLMProvider` interface.

**Streaming behavior:**

- The LLM provider's `generate()` method returns an `AsyncIterable<string>` that yields response tokens as they are generated.
- The turn manager accumulates tokens into a buffer and detects sentence boundaries (periods, question marks, exclamation marks followed by a space or end of stream).
- When a complete sentence is detected, it is immediately forwarded to the TTS stage. This means the first sentence begins TTS synthesis while the LLM is still generating subsequent sentences.

**Sentence boundary detection:**

The turn manager uses a simple, configurable sentence boundary detector:

```
Default pattern: /(?<=[.!?])\s+/
```

The detector buffers incoming LLM tokens until a sentence boundary is found. When found, the completed sentence is emitted to TTS and the buffer is cleared. When the LLM stream ends, any remaining buffered text is emitted as the final sentence.

The sentence boundary pattern is configurable via `sentenceBoundaryPattern` in the config. The application can provide a custom pattern or a custom `splitSentences` function for languages or formats where the default pattern is insufficient.

**Latency contribution:** The LLM's time-to-first-token (TTFT) is the primary latency cost of this stage. Modern LLMs have TTFT of 200-500ms. The first complete sentence typically arrives within 500-1000ms of the request being sent.

### TTS Stage

The TTS stage overlaps with `processing` and `ai-speaking`. It receives sentences from the LLM stage and produces audio data via the `TTSProvider` interface.

**Streaming behavior:**

- The TTS provider's `speak(text)` method returns an object containing a `ReadableStream<Uint8Array>` of audio data and a `cancel()` method.
- The turn manager manages a queue of TTS requests, one per sentence. The first sentence is sent to TTS immediately. Subsequent sentences are sent as prior TTS requests complete or based on buffering strategy.
- Audio data from TTS is emitted via the `audioOutput` event for the application to play.

**Sentence queuing:**

```
LLM generates: "Hello! How can I help you today? I'm ready to assist."
                 ↓              ↓                    ↓
Sentence 1: "Hello!"     Sentence 2: "How can..."   Sentence 3: "I'm ready..."
     ↓                       ↓                           ↓
TTS request 1          TTS request 2                TTS request 3
     ↓                       ↓                           ↓
Audio chunk 1          Audio chunk 2                Audio chunk 3
     ↓                       ↓                           ↓
[  Play immediately  ] [ Play when 1 finishes ]   [ Play when 2 finishes ]
```

**Pre-buffering:** To prevent gaps between sentences during playback, the turn manager starts TTS synthesis for the next sentence before the current sentence's audio has finished playing. The `ttsBufferAhead` config option controls how many sentences are pre-synthesized (default: 1).

**Latency contribution:** TTS synthesis latency varies by provider (100-500ms for the first audio chunk). Streaming TTS providers start returning audio before the full sentence is synthesized, which reduces perceived latency.

### Back-Pressure

If the LLM generates sentences faster than TTS can synthesize them, sentences are buffered in an internal queue. The queue has a configurable maximum size (`maxSentenceQueueSize`, default 10). If the queue fills, the turn manager applies back-pressure by pausing consumption of LLM tokens (stopping the `for await` loop on the LLM's async iterable). This prevents unbounded memory growth from a fast LLM paired with a slow TTS provider.

### Pipeline Error Handling

Errors at any stage are handled without crashing the turn manager:

| Stage | Error | Recovery |
|-------|-------|----------|
| STT | Provider throws or emits error | Emit `error` event with STT context. Transition to `idle`. |
| LLM | Provider throws or stream errors | Emit `error` event with LLM context. Transition to `idle`. |
| LLM | Timeout (no tokens within `llmTimeoutMs`) | Abort LLM request. Emit `error` event. Transition to `idle`. |
| TTS | Provider throws or synthesis fails | Skip the failed sentence. If more sentences remain, continue with the next. If no sentences remain, emit `error` event and transition to `idle`. |
| TTS | Audio playback error | Emit `error` event. Transition to `idle`. |

The turn manager never enters a stuck state. All error paths lead to `idle`, from which the next user turn can begin normally.

---

## 9. Latency Optimization

### Streaming at Every Stage

The most important latency optimization is streaming: each pipeline stage begins producing output before its input is complete. Without streaming, the pipeline is sequential:

```
Sequential (bad):
User done → [wait for full STT] → [wait for full LLM] → [wait for full TTS] → AI speaks
Total: 3-10 seconds

Streaming (good):
User done → [STT finalizes during silence] → [LLM first sentence] → [TTS first chunk] → AI speaks
Total: 0.7-1.5 seconds
```

### Overlap of Endpointing and STT Finalization

During the `user-paused` state, the endpointing timer and STT finalization run concurrently. The STT provider is often already producing a final transcript by the time the silence threshold is reached, because the provider detected the end of the audio segment. This means that when the endpointing timer fires, the transcript may already be available, eliminating the STT finalization latency entirely.

### Eager LLM Invocation

With transcript-based endpointing, the turn manager can send a preliminary transcript to the LLM before endpointing is confirmed, speculatively beginning generation. If the user resumes speaking (endpointing is cancelled), the LLM request is aborted. If the user's turn is confirmed, the LLM has a head start. This is a configurable optimization (`eagerLlmStart`, default false) because it increases cost (aborted LLM requests still consume tokens).

```typescript
createTurnManager({
  // ...providers
  latency: {
    eagerLlmStart: true,
    eagerLlmDelayMs: 500,  // Start LLM after 500ms of silence (before endpointing confirms)
  },
});
```

### Pre-Warming Connections

Between turns (during `idle` and `ai-speaking`), provider connections can be kept warm:

- **STT**: Keep the WebSocket or HTTP/2 connection open. Avoid cold-start latency on each new user turn.
- **LLM**: Maintain a persistent HTTP/2 connection to the LLM API.
- **TTS**: Maintain a persistent connection to the TTS API.

Pre-warming is the provider's responsibility (implemented in the provider adapter), but the turn manager supports it by calling `provider.warmup()` if the method exists.

### Latency Measurement and Reporting

The turn manager measures and reports latency for each pipeline stage:

```typescript
manager.on('turnComplete', (metrics: TurnMetrics) => {
  console.log(`Endpointing: ${metrics.endpointingMs}ms`);
  console.log(`STT finalization: ${metrics.sttFinalizationMs}ms`);
  console.log(`LLM TTFT: ${metrics.llmTtftMs}ms`);
  console.log(`LLM total: ${metrics.llmTotalMs}ms`);
  console.log(`TTS first chunk: ${metrics.ttsFirstChunkMs}ms`);
  console.log(`Total response time: ${metrics.totalResponseMs}ms`);
  console.log(`User speech to AI speech: ${metrics.userToAiMs}ms`);
});
```

The `TurnMetrics` object:

```typescript
interface TurnMetrics {
  /** Time from first silence detection to endpointing confirmation (ms). */
  endpointingMs: number;

  /** Time from endpointing confirmation to final transcript available (ms). */
  sttFinalizationMs: number;

  /** Time from LLM request sent to first token received (ms). */
  llmTtftMs: number;

  /** Time from LLM request sent to last token received (ms). */
  llmTotalMs: number;

  /** Time from first sentence sent to TTS to first audio chunk received (ms). */
  ttsFirstChunkMs: number;

  /** Time from user speech end to AI speech start (ms). The key metric. */
  userToAiMs: number;

  /** Total response time from user speech end to AI speech end (ms). */
  totalResponseMs: number;

  /** Number of sentences in the AI response. */
  sentenceCount: number;

  /** Number of words in the user transcript. */
  userWordCount: number;

  /** Number of words in the AI response. */
  aiWordCount: number;

  /** Whether this turn was interrupted by barge-in. */
  wasInterrupted: boolean;
}
```

---

## 10. API Surface

### Installation

```bash
npm install voice-turn
```

### Primary Function: `createTurnManager`

```typescript
import { createTurnManager } from 'voice-turn';

const manager = createTurnManager({
  stt: mySTTProvider,
  llm: myLLMProvider,
  tts: myTTSProvider,
  endpointing: { strategy: 'silence', silenceMs: 800 },
  bargeIn: { mode: 'full' },
});

manager.on('stateChange', (from, to) => {
  console.log(`${from} → ${to}`);
});

manager.on('transcript', (text) => {
  console.log(`User said: ${text}`);
});

manager.on('audioOutput', (audio) => {
  speaker.play(audio);
});

manager.start();
```

### Type Definitions

```typescript
// ── Turn States ─────────────────────────────────────────────────────

/** The six states of the turn-taking state machine. */
type TurnState =
  | 'idle'
  | 'user-speaking'
  | 'user-paused'
  | 'processing'
  | 'ai-speaking'
  | 'interrupted';

// ── Provider Interfaces ─────────────────────────────────────────────

/**
 * Speech-to-Text provider interface.
 * Wraps any STT SDK (OpenAI Whisper, Deepgram, Google Cloud Speech, etc.)
 * to provide a uniform streaming transcription API.
 */
interface STTProvider {
  /**
   * Start the STT session. Begin accepting audio data.
   * Called when the user starts speaking.
   */
  start(): void;

  /**
   * Stop the STT session. Finalize and flush any remaining transcript.
   * Called when the user's turn ends (endpointing triggers).
   * Returns a promise that resolves with the final transcript.
   */
  stop(): Promise<string>;

  /**
   * Push audio data to the STT provider.
   * Called continuously during user speech.
   */
  pushAudio(audio: Uint8Array | Float32Array): void;

  /**
   * Register a listener for partial (interim) transcripts.
   * Partial transcripts update in real-time as the user speaks.
   */
  on(event: 'partial', handler: (text: string) => void): void;

  /**
   * Register a listener for final (committed) transcript segments.
   * Final transcripts are segments the STT provider has committed to.
   */
  on(event: 'transcript', handler: (text: string) => void): void;

  /**
   * Register a listener for errors.
   */
  on(event: 'error', handler: (error: Error) => void): void;

  /**
   * Remove a listener.
   */
  off(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * Optional: warm up the provider connection.
   * Called during idle to reduce latency on the next start().
   */
  warmup?(): void;
}

/**
 * Large Language Model provider interface.
 * Wraps any LLM SDK (OpenAI, Anthropic, Google, etc.) to provide a
 * uniform streaming text generation API.
 */
interface LLMProvider {
  /**
   * Generate a response for the given transcript.
   * Returns an async iterable that yields response text tokens as they
   * are generated. The iterable completes when the full response is ready.
   *
   * @param transcript - The user's transcribed speech.
   * @param context - Optional conversation context provided by the application.
   * @param signal - AbortSignal for cancelling the generation (barge-in).
   * @returns An async iterable of string tokens.
   */
  generate(
    transcript: string,
    context?: ConversationContext,
    signal?: AbortSignal,
  ): AsyncIterable<string>;

  /**
   * Optional: warm up the provider connection.
   */
  warmup?(): void;
}

/**
 * Text-to-Speech provider interface.
 * Wraps any TTS SDK (OpenAI TTS, ElevenLabs, Google Cloud TTS, etc.)
 * to provide a uniform streaming audio synthesis API.
 */
interface TTSProvider {
  /**
   * Synthesize speech for the given text.
   * Returns an object with a readable stream of audio data and a cancel method.
   *
   * @param text - The text to synthesize.
   * @param signal - AbortSignal for cancelling synthesis (barge-in).
   * @returns An object with audio stream and cancel method.
   */
  speak(
    text: string,
    signal?: AbortSignal,
  ): TTSSpeakResult;

  /**
   * Optional: warm up the provider connection.
   */
  warmup?(): void;
}

/** Result of a TTS speak() call. */
interface TTSSpeakResult {
  /** Readable stream of audio data (PCM, MP3, or other format). */
  audio: ReadableStream<Uint8Array>;

  /** Cancel the synthesis. Stops generating audio and releases resources. */
  cancel(): void;
}

// ── Conversation Context ────────────────────────────────────────────

/**
 * Conversation context passed to the LLM provider.
 * The application populates this with conversation history,
 * system prompts, or any other context the LLM needs.
 */
interface ConversationContext {
  /** System prompt or instructions. */
  systemPrompt?: string;

  /** Conversation history as an array of messages. */
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /** Arbitrary metadata the application wants to pass to the LLM provider. */
  metadata?: Record<string, unknown>;
}

// ── Endpointing Configuration ───────────────────────────────────────

/** Configuration for end-of-turn detection. */
type EndpointingConfig =
  | SilenceEndpointingConfig
  | VadEndpointingConfig
  | TranscriptEndpointingConfig
  | AdaptiveEndpointingConfig
  | CustomEndpointingConfig;

interface SilenceEndpointingConfig {
  strategy: 'silence';

  /** Silence duration in milliseconds to trigger end-of-turn.
   *  Default: 800. */
  silenceMs?: number;
}

interface VadEndpointingConfig {
  strategy: 'vad';

  /** Silence duration in milliseconds after VAD reports no speech.
   *  Default: 800. */
  silenceMs?: number;

  /** Callback invoked per audio frame to check for speech. */
  vadCallback: (audioFrame: Float32Array) => boolean;
}

interface TranscriptEndpointingConfig {
  strategy: 'transcript';

  /** Normal silence threshold in milliseconds. Default: 800. */
  silenceMs?: number;

  /** Reduced threshold when transcript ends with sentence-ending punctuation.
   *  Default: 400. */
  transcriptEndMs?: number;

  /** Pattern to detect sentence endings in transcripts.
   *  Default: /[.?!]\s*$/ */
  sentenceEndPattern?: RegExp;
}

interface AdaptiveEndpointingConfig {
  strategy: 'adaptive';

  /** Minimum silence threshold in milliseconds. Default: 500. */
  minSilenceMs?: number;

  /** Maximum silence threshold in milliseconds. Default: 1500. */
  maxSilenceMs?: number;

  /** Multiplier applied to average in-turn pause duration.
   *  Default: 2.0. */
  adaptiveMultiplier?: number;

  /** Number of recent pauses to consider. Default: 5. */
  windowSize?: number;
}

interface CustomEndpointingConfig {
  strategy: 'custom';

  /** Function that decides whether the user's turn should end. */
  shouldEndTurn: (context: EndpointingContext) => boolean;
}

/** Context provided to custom endpointing functions. */
interface EndpointingContext {
  transcript: string;
  isFinal: boolean;
  silenceDurationMs: number;
  isSpeechActive: boolean;
  speechDurationMs: number;
  wordCount: number;
  conversationDurationMs: number;
}

// ── Barge-In Configuration ──────────────────────────────────────────

/** Configuration for barge-in (interruption) handling. */
type BargeInConfig =
  | FullBargeInConfig
  | SoftBargeInConfig
  | NoBargeInConfig;

interface FullBargeInConfig {
  mode: 'full';

  /** Minimum user speech duration (ms) before barge-in triggers.
   *  Prevents false barge-ins from noise. Default: 200. */
  minSpeechForBargeIn?: number;
}

interface SoftBargeInConfig {
  mode: 'soft';

  /** Duration of user speech (ms) required to confirm barge-in.
   *  Default: 500. */
  softBargeInMs?: number;
}

interface NoBargeInConfig {
  mode: 'none';
}

// ── Turn Manager Configuration ──────────────────────────────────────

/** Full configuration for createTurnManager(). */
interface TurnManagerConfig {
  /** Speech-to-text provider. Required. */
  stt: STTProvider;

  /** Large language model provider. Required. */
  llm: LLMProvider;

  /** Text-to-speech provider. Required. */
  tts: TTSProvider;

  /** Endpointing configuration. Default: { strategy: 'silence', silenceMs: 800 }. */
  endpointing?: EndpointingConfig;

  /** Barge-in configuration. Default: { mode: 'full', minSpeechForBargeIn: 200 }. */
  bargeIn?: BargeInConfig;

  /** Conversation context to pass to the LLM provider.
   *  Can be updated via manager.setContext(). */
  context?: ConversationContext;

  /** Minimum user speech duration (ms) before a turn is considered valid.
   *  Prevents very brief sounds from triggering a full turn cycle.
   *  Default: 300. */
  minSpeechDurationMs?: number;

  /** Minimum word count in transcript before endpointing triggers.
   *  Default: 0 (disabled). */
  minWordCount?: number;

  /** Pattern for splitting LLM response into sentences.
   *  Default: /(?<=[.!?])\s+/ */
  sentenceBoundaryPattern?: RegExp;

  /** Custom function for splitting LLM response into sentences.
   *  Overrides sentenceBoundaryPattern if provided. */
  splitSentences?: (text: string) => string[];

  /** Pause detection threshold (ms). Silence shorter than this is not
   *  considered a pause for endpointing purposes. Default: 300. */
  pauseDetectionMs?: number;

  /** Number of sentences to pre-synthesize via TTS.
   *  Default: 1. */
  ttsBufferAhead?: number;

  /** Maximum number of sentences to queue for TTS.
   *  Back-pressure is applied to LLM when this limit is reached.
   *  Default: 10. */
  maxSentenceQueueSize?: number;

  /** Processing timeout (ms). If the LLM does not produce output
   *  within this duration, the turn is abandoned. Default: 30000. */
  processingTimeoutMs?: number;

  /** LLM timeout (ms). If no LLM tokens arrive within this duration
   *  after the request is sent, the request is aborted. Default: 15000. */
  llmTimeoutMs?: number;

  /** Whether to start LLM generation speculatively before endpointing
   *  is confirmed. Default: false. */
  eagerLlmStart?: boolean;

  /** Delay (ms) before eager LLM start. Only used when eagerLlmStart
   *  is true. Default: 500. */
  eagerLlmDelayMs?: number;

  /** AbortSignal for external cancellation of the entire turn manager. */
  signal?: AbortSignal;
}

// ── Turn Manager Instance ───────────────────────────────────────────

/** The turn manager instance returned by createTurnManager(). */
interface TurnManager {
  /**
   * Start the turn manager. Begin listening for user speech.
   * Transitions from uninitialized to `idle`.
   */
  start(): void;

  /**
   * Stop the turn manager. Cancel all in-flight operations and clean up.
   * Can be called from any state.
   */
  stop(): void;

  /**
   * Push audio data from the user's microphone to the turn manager.
   * The turn manager routes this to the STT provider and VAD system.
   */
  pushAudio(audio: Uint8Array | Float32Array): void;

  /**
   * Get the current turn state.
   */
  getState(): TurnState;

  /**
   * Update the conversation context passed to the LLM provider.
   * Takes effect on the next LLM invocation.
   */
  setContext(context: ConversationContext): void;

  /**
   * Register an event listener.
   */
  on<E extends keyof TurnManagerEvents>(
    event: E,
    handler: TurnManagerEvents[E],
  ): this;

  /**
   * Remove an event listener.
   */
  off<E extends keyof TurnManagerEvents>(
    event: E,
    handler: TurnManagerEvents[E],
  ): this;

  /**
   * Whether the turn manager is currently running (start() has been
   * called and stop() has not).
   */
  readonly isRunning: boolean;

  /**
   * Latency metrics from the most recent completed turn.
   * Null if no turn has completed yet.
   */
  readonly lastTurnMetrics: TurnMetrics | null;
}

// ── Events ──────────────────────────────────────────────────────────

/** Event signatures for the TurnManager event emitter. */
interface TurnManagerEvents {
  /** User started speaking. Fires on transition to `user-speaking`. */
  userSpeechStart: () => void;

  /** User finished speaking. Fires after endpointing confirms end-of-turn.
   *  Provides the final transcript. */
  userSpeechEnd: (transcript: string) => void;

  /** AI response playback started. Fires on transition to `ai-speaking`. */
  aiSpeechStart: (firstSentence: string) => void;

  /** AI response playback completed. Fires on transition from
   *  `ai-speaking` to `idle`. */
  aiSpeechEnd: (fullResponse: string) => void;

  /** User interrupted the AI (barge-in). Provides interruption details. */
  bargeIn: (event: BargeInEvent) => void;

  /** State machine transition. Fires on every state change. */
  stateChange: (from: TurnState, to: TurnState) => void;

  /** Partial transcript update during user speech. */
  partialTranscript: (text: string) => void;

  /** Final transcript segment committed by STT. */
  transcript: (text: string) => void;

  /** LLM response text (accumulated). Fires as response tokens arrive. */
  response: (text: string) => void;

  /** Audio data from TTS ready for playback. */
  audioOutput: (audio: Uint8Array) => void;

  /** Turn completed with latency metrics. */
  turnComplete: (metrics: TurnMetrics) => void;

  /** Error in any pipeline stage. */
  error: (error: TurnError) => void;
}

// ── Barge-In Event ──────────────────────────────────────────────────

interface BargeInEvent {
  /** The full AI response text that was being spoken. */
  fullResponse: string;

  /** The portion of the response spoken before interruption. */
  spokenResponse: string;

  /** Index of the sentence where interruption occurred (0-based). */
  interruptedAtSentence: number;

  /** Partial transcript of user speech that triggered the barge-in. */
  userSpeech: string;

  /** How long the AI had been speaking before interruption (ms). */
  aiSpeechDurationMs: number;
}

// ── Turn Metrics ────────────────────────────────────────────────────

interface TurnMetrics {
  endpointingMs: number;
  sttFinalizationMs: number;
  llmTtftMs: number;
  llmTotalMs: number;
  ttsFirstChunkMs: number;
  userToAiMs: number;
  totalResponseMs: number;
  sentenceCount: number;
  userWordCount: number;
  aiWordCount: number;
  wasInterrupted: boolean;
}

// ── Turn Error ──────────────────────────────────────────────────────

interface TurnError {
  /** Which pipeline stage the error occurred in. */
  stage: 'stt' | 'llm' | 'tts' | 'endpointing' | 'internal';

  /** The underlying error. */
  cause: Error;

  /** Human-readable description of what went wrong. */
  message: string;

  /** The turn state when the error occurred. */
  stateAtError: TurnState;
}
```

### `createTurnManager` Function

```typescript
/**
 * Create a turn-taking manager for voice AI conversations.
 *
 * @param config - Configuration including provider interfaces and options.
 * @returns A TurnManager instance.
 */
function createTurnManager(config: TurnManagerConfig): TurnManager;
```

---

## 11. Provider Interfaces

### STT Provider Interface

The `STTProvider` interface wraps any speech-to-text SDK. Implementors handle the transport (WebSocket, HTTP, local inference), audio format requirements (sample rate, encoding), and streaming protocol. The turn manager interacts with the provider through a simple start/stop/push lifecycle.

**Contract:**

1. `start()` is called once when the user begins speaking. The provider should establish connections and prepare to receive audio.
2. `pushAudio(audio)` is called repeatedly with audio data during the user's turn.
3. The provider emits `partial` events for interim transcripts and `transcript` events for committed segments.
4. `stop()` is called when the user's turn ends. The provider should finalize processing and resolve the returned promise with the complete transcript.
5. After `stop()` resolves, no further events are emitted until the next `start()`.

**Example: OpenAI Whisper STT adapter:**

```typescript
import { STTProvider } from 'voice-turn';

class WhisperSTTProvider implements STTProvider {
  private buffer: Uint8Array[] = [];
  private listeners = new Map<string, Set<Function>>();

  start(): void {
    this.buffer = [];
  }

  pushAudio(audio: Uint8Array): void {
    this.buffer.push(audio);
  }

  async stop(): Promise<string> {
    const audioBlob = concatenateBuffers(this.buffer);
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: new File([audioBlob], 'audio.wav', { type: 'audio/wav' }),
    });
    this.emit('transcript', result.text);
    return result.text;
  }

  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(h => h(...args));
  }
}
```

**Example: Deepgram streaming STT adapter:**

```typescript
import { STTProvider } from 'voice-turn';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

class DeepgramSTTProvider implements STTProvider {
  private connection: any;
  private listeners = new Map<string, Set<Function>>();
  private finalTranscript = '';

  start(): void {
    this.finalTranscript = '';
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    this.connection = deepgram.listen.live({
      model: 'nova-2',
      smart_format: true,
      interim_results: true,
      endpointing: false,  // voice-turn handles endpointing
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const text = data.channel.alternatives[0].transcript;
      if (data.is_final) {
        this.finalTranscript += text + ' ';
        this.emit('transcript', text);
      } else {
        this.emit('partial', this.finalTranscript + text);
      }
    });
  }

  pushAudio(audio: Uint8Array): void {
    this.connection?.send(audio);
  }

  async stop(): Promise<string> {
    this.connection?.requestClose();
    return this.finalTranscript.trim();
  }

  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(h => h(...args));
  }
}
```

### LLM Provider Interface

The `LLMProvider` interface wraps any LLM SDK. The single `generate()` method takes a transcript and optional conversation context and returns an `AsyncIterable<string>` of response tokens. The turn manager consumes this iterable, splits it into sentences, and forwards sentences to TTS.

**Contract:**

1. `generate()` is called with the user's transcript when processing begins.
2. The returned async iterable yields string tokens as the LLM generates them.
3. The iterable completes when the full response is generated.
4. The `signal` parameter is an `AbortSignal` that the turn manager uses to cancel generation during barge-in. The provider must respect this signal and stop generating when it fires.

**Example: Anthropic LLM adapter:**

```typescript
import { LLMProvider, ConversationContext } from 'voice-turn';
import Anthropic from '@anthropic-ai/sdk';

class AnthropicLLMProvider implements LLMProvider {
  private client = new Anthropic();

  async *generate(
    transcript: string,
    context?: ConversationContext,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const messages = [
      ...(context?.messages ?? []),
      { role: 'user' as const, content: transcript },
    ];

    const stream = this.client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: context?.systemPrompt ?? 'You are a helpful voice assistant. Keep responses concise.',
      messages,
    });

    for await (const event of stream) {
      if (signal?.aborted) break;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
```

**Example: OpenAI LLM adapter:**

```typescript
import { LLMProvider, ConversationContext } from 'voice-turn';
import OpenAI from 'openai';

class OpenAILLMProvider implements LLMProvider {
  private client = new OpenAI();

  async *generate(
    transcript: string,
    context?: ConversationContext,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const messages = [
      ...(context?.systemPrompt
        ? [{ role: 'system' as const, content: context.systemPrompt }]
        : []),
      ...(context?.messages ?? []),
      { role: 'user' as const, content: transcript },
    ];

    const stream = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}
```

### TTS Provider Interface

The `TTSProvider` interface wraps any TTS SDK. The `speak()` method takes a text string and returns a `TTSSpeakResult` with a readable stream of audio data and a cancel method. The turn manager calls `speak()` once per sentence and manages playback sequencing.

**Contract:**

1. `speak(text)` is called with a sentence to synthesize.
2. The returned `audio` stream yields `Uint8Array` chunks of audio data.
3. The `cancel()` method stops synthesis and releases resources. Calling `cancel()` causes the audio stream to end.
4. The `signal` parameter is an `AbortSignal` for barge-in cancellation.

**Example: OpenAI TTS adapter:**

```typescript
import { TTSProvider, TTSSpeakResult } from 'voice-turn';
import OpenAI from 'openai';

class OpenAITTSProvider implements TTSProvider {
  private client = new OpenAI();

  speak(text: string, signal?: AbortSignal): TTSSpeakResult {
    const controller = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    const audioStream = new ReadableStream<Uint8Array>({
      start: async (streamController) => {
        try {
          const response = await this.client.audio.speech.create({
            model: 'tts-1',
            voice: 'alloy',
            input: text,
            response_format: 'pcm',
          });

          const reader = response.body!.getReader();
          while (true) {
            if (controller.signal.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            streamController.enqueue(value);
          }
          streamController.close();
        } catch (err) {
          if (!controller.signal.aborted) {
            streamController.error(err);
          }
        }
      },
    });

    return {
      audio: audioStream,
      cancel: () => controller.abort(),
    };
  }
}
```

**Example: ElevenLabs streaming TTS adapter:**

```typescript
import { TTSProvider, TTSSpeakResult } from 'voice-turn';

class ElevenLabsTTSProvider implements TTSProvider {
  private voiceId: string;
  private apiKey: string;

  constructor(voiceId: string, apiKey: string) {
    this.voiceId = voiceId;
    this.apiKey = apiKey;
  }

  speak(text: string, signal?: AbortSignal): TTSSpeakResult {
    const controller = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    const audioStream = new ReadableStream<Uint8Array>({
      start: async (streamController) => {
        try {
          const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'xi-api-key': this.apiKey,
              },
              body: JSON.stringify({
                text,
                model_id: 'eleven_monolingual_v1',
              }),
              signal: controller.signal,
            },
          );

          const reader = response.body!.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamController.enqueue(value);
          }
          streamController.close();
        } catch (err) {
          if (!controller.signal.aborted) {
            streamController.error(err);
          }
        }
      },
    });

    return {
      audio: audioStream,
      cancel: () => controller.abort(),
    };
  }
}
```

---

## 12. Configuration

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `endpointing.strategy` | `'silence'` | Endpointing strategy. |
| `endpointing.silenceMs` | `800` | Silence duration (ms) for end-of-turn. |
| `bargeIn.mode` | `'full'` | Barge-in mode. |
| `bargeIn.minSpeechForBargeIn` | `200` | Min user speech (ms) to trigger barge-in. |
| `minSpeechDurationMs` | `300` | Min user speech (ms) for valid turn. |
| `minWordCount` | `0` | Min words in transcript for endpointing. |
| `sentenceBoundaryPattern` | `/(?<=[.!?])\s+/` | Pattern for splitting LLM output. |
| `pauseDetectionMs` | `300` | Min silence (ms) to detect a pause. |
| `ttsBufferAhead` | `1` | Sentences to pre-synthesize. |
| `maxSentenceQueueSize` | `10` | Max sentences buffered for TTS. |
| `processingTimeoutMs` | `30000` | Total processing timeout. |
| `llmTimeoutMs` | `15000` | LLM time-to-first-token timeout. |
| `eagerLlmStart` | `false` | Speculative LLM start before endpointing. |
| `eagerLlmDelayMs` | `500` | Delay before eager LLM start. |

### Configuration Examples

**Fast, aggressive voice assistant** (short responses, quick turns):

```typescript
createTurnManager({
  stt, llm, tts,
  endpointing: { strategy: 'silence', silenceMs: 500 },
  bargeIn: { mode: 'full', minSpeechForBargeIn: 150 },
  minSpeechDurationMs: 200,
  eagerLlmStart: true,
  eagerLlmDelayMs: 300,
});
```

**Patient tutoring assistant** (long pauses okay, longer responses):

```typescript
createTurnManager({
  stt, llm, tts,
  endpointing: { strategy: 'adaptive', minSilenceMs: 800, maxSilenceMs: 2500, adaptiveMultiplier: 2.5 },
  bargeIn: { mode: 'soft', softBargeInMs: 600 },
  minSpeechDurationMs: 500,
  ttsBufferAhead: 2,
});
```

**Call center IVR** (noisy environment, short utterances):

```typescript
createTurnManager({
  stt, llm, tts,
  endpointing: { strategy: 'transcript', silenceMs: 1000, transcriptEndMs: 500 },
  bargeIn: { mode: 'full', minSpeechForBargeIn: 300 },
  minSpeechDurationMs: 200,
  processingTimeoutMs: 10000,
});
```

**Non-interruptible announcement** (AI speaks without interruption):

```typescript
createTurnManager({
  stt, llm, tts,
  bargeIn: { mode: 'none' },
});
```

### No Configuration Files

`voice-turn` has no configuration files, environment variables, or initialization steps. Import and call:

```typescript
import { createTurnManager } from 'voice-turn';
const manager = createTurnManager({ stt, llm, tts });
```

All behavior is controlled via the `TurnManagerConfig` object.

---

## 13. Integration with Monorepo Packages

### Integration with `audio-chunker`

`audio-chunker` provides VAD-based speech segment detection and audio chunking. In a voice AI pipeline, `audio-chunker`'s `detectSpeechSegments()` can provide the VAD signal that `voice-turn` uses for endpointing. The `audio-chunker`'s streaming chunker can process incoming microphone audio and feed chunks to the STT provider.

```typescript
import { createTurnManager } from 'voice-turn';
import { createChunker } from 'audio-chunker';

// audio-chunker handles VAD and chunking
const chunker = createChunker({
  sampleRate: 16000,
  inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
});

// voice-turn handles turn-taking
const manager = createTurnManager({
  stt: mySTTProvider,
  llm: myLLMProvider,
  tts: myTTSProvider,
  endpointing: {
    strategy: 'vad',
    silenceMs: 800,
    vadCallback: (frame) => chunker.isSpeech(frame),
  },
});

// Microphone → audio-chunker → voice-turn
microphone.on('data', (audio) => {
  chunker.write(audio);
  manager.pushAudio(audio);
});
```

### Integration with `tts-queue`

`tts-queue` manages TTS audio streaming with sentence-boundary queuing. `voice-turn`'s internal TTS sentence queue serves a similar purpose, but applications that need more sophisticated TTS queue management (priority queuing, audio format conversion, volume normalization) can use `tts-queue` as the TTS provider layer.

```typescript
import { createTurnManager, TTSProvider } from 'voice-turn';
import { createTtsQueue } from 'tts-queue';

// Wrap tts-queue as a TTSProvider for voice-turn
const ttsQueue = createTtsQueue({ provider: 'openai' });

const ttsProvider: TTSProvider = {
  speak(text, signal) {
    const result = ttsQueue.enqueue(text);
    if (signal) signal.addEventListener('abort', () => result.cancel());
    return { audio: result.audioStream, cancel: () => result.cancel() };
  },
};

const manager = createTurnManager({
  stt: mySTTProvider,
  llm: myLLMProvider,
  tts: ttsProvider,
});
```

### Integration with `stream-tokens`

`stream-tokens` aggregates streaming LLM tokens into semantic units (sentences, paragraphs). `voice-turn` has built-in sentence boundary splitting, but applications that need more sophisticated sentence detection (multilingual support, domain-specific boundaries) can use `stream-tokens` to split the LLM output before it reaches the TTS stage.

```typescript
import { createTurnManager, LLMProvider } from 'voice-turn';
import { createTokenAggregator } from 'stream-tokens';

class StreamTokensLLMProvider implements LLMProvider {
  async *generate(transcript: string, context?: ConversationContext, signal?: AbortSignal) {
    const rawStream = callLLM(transcript, context, signal);
    const aggregator = createTokenAggregator({ boundary: 'sentence' });

    for await (const token of rawStream) {
      if (signal?.aborted) break;
      const sentence = aggregator.push(token);
      if (sentence) yield sentence;
    }

    const remaining = aggregator.flush();
    if (remaining) yield remaining;
  }
}
```

---

## 14. Testing Strategy

### Unit Tests

**State machine tests:**

- Initial state is `idle` after `start()`.
- `idle` -> `user-speaking` on speech detection.
- `user-speaking` -> `user-paused` on silence detection.
- `user-paused` -> `user-speaking` on speech resume (timer cancelled).
- `user-paused` -> `processing` on endpointing timer expiry.
- `processing` -> `ai-speaking` on first TTS audio.
- `ai-speaking` -> `idle` on TTS playback complete.
- `ai-speaking` -> `interrupted` on barge-in detection.
- `interrupted` -> `user-speaking` on cancellation complete.
- All error transitions lead to `idle`.
- `stop()` from any state transitions to `idle`.
- Only valid transitions are allowed (invalid transitions emit error).

**Endpointing tests:**

- Silence-based: turn ends after `silenceMs` of silence. Turn does not end if speech resumes before threshold.
- Silence-based with different thresholds: 500ms, 800ms, 1500ms.
- VAD-based: turn ends after VAD reports no speech for `silenceMs`.
- Transcript-based: reduced threshold when transcript ends with sentence punctuation.
- Adaptive: threshold adjusts based on recent pause durations.
- Custom: custom function is called with correct context. Return value determines end-of-turn.
- Minimum speech duration: turns shorter than `minSpeechDurationMs` are not ended.
- Minimum word count: turns with fewer words than `minWordCount` are not ended.

**Barge-in tests:**

- Full barge-in: user speech during `ai-speaking` triggers interruption after `minSpeechForBargeIn`.
- Full barge-in: brief user speech (shorter than `minSpeechForBargeIn`) does not trigger interruption.
- Soft barge-in: user speech lasting >= `softBargeInMs` triggers interruption.
- Soft barge-in: user speech lasting < `softBargeInMs` does not trigger interruption.
- No barge-in: user speech during `ai-speaking` is ignored.
- Barge-in cancels LLM request (AbortSignal fires).
- Barge-in cancels TTS synthesis (cancel() called).
- Barge-in emits correct `BargeInEvent` with spoken/unspoken response portions.

**Sentence splitting tests:**

- Single sentence: "Hello." -> ["Hello."]
- Multiple sentences: "Hello. How are you?" -> ["Hello.", "How are you?"]
- Sentence with abbreviation: "Dr. Smith is here." -> handled correctly (not split at "Dr.").
- Trailing text without punctuation: "Hello world" -> emitted on stream end.
- Empty input: no sentences emitted.
- Long single sentence: treated as one sentence.

**Pipeline coordination tests:**

- STT transcript is forwarded to LLM provider.
- LLM response tokens are accumulated and split at sentence boundaries.
- Sentences are forwarded to TTS provider.
- TTS audio is emitted via `audioOutput` event.
- Back-pressure: when sentence queue is full, LLM token consumption pauses.
- TTS buffer-ahead: next sentence begins synthesis before current sentence finishes playback.

**Error handling tests:**

- STT error transitions to `idle` and emits `error` event.
- LLM error transitions to `idle` and emits `error` event.
- LLM timeout transitions to `idle` and emits `error` event.
- TTS error on one sentence does not stop playback of remaining sentences.
- Processing timeout transitions to `idle`.
- All errors include correct `stage`, `cause`, and `stateAtError`.

### Integration Tests

**End-to-end turn cycle:**

- Wire up mock STT, LLM, and TTS providers.
- Simulate user speech -> silence -> LLM response -> TTS audio.
- Verify full event sequence: `stateChange(idle, user-speaking)`, `userSpeechStart`, `stateChange(user-speaking, user-paused)`, `stateChange(user-paused, processing)`, `userSpeechEnd`, `stateChange(processing, ai-speaking)`, `aiSpeechStart`, `audioOutput` (multiple), `stateChange(ai-speaking, idle)`, `aiSpeechEnd`, `turnComplete`.

**End-to-end barge-in cycle:**

- Simulate user speech -> silence -> LLM response -> TTS starts -> user interrupts.
- Verify barge-in event fires with correct metadata.
- Verify LLM generation was aborted.
- Verify TTS was cancelled.
- Verify system transitions to listening to new user speech.

**Multi-turn conversation:**

- Simulate 3-5 consecutive turns.
- Verify each turn produces correct events and metrics.
- Verify state machine returns to `idle` between turns.

**Latency measurement:**

- Verify `TurnMetrics` values are plausible (positive, in expected ranges).
- Verify `userToAiMs` equals approximately `endpointingMs + sttFinalizationMs + llmTtftMs + ttsFirstChunkMs`.

### Mock Providers

The test suite includes mock implementations of all three provider interfaces:

```typescript
class MockSTTProvider implements STTProvider {
  // Configurable: emit specific transcripts after configurable delays
  // Tracks start/stop calls for verification
}

class MockLLMProvider implements LLMProvider {
  // Configurable: return specific responses with configurable TTFT and token rate
  // Tracks generate calls and abort signals
}

class MockTTSProvider implements TTSProvider {
  // Configurable: return audio chunks with configurable synthesis latency
  // Tracks speak/cancel calls
}
```

### Edge Cases to Test

- User speaks very briefly (< `minSpeechDurationMs`): no turn cycle triggered.
- User speaks with no pauses for 60 seconds: STT handles long continuous speech.
- LLM returns empty response: handled gracefully, no TTS called, return to `idle`.
- LLM returns single-word response: treated as one sentence.
- TTS called with very long sentence (1000+ characters): handled without timeout.
- Rapid barge-in: user interrupts within 100ms of AI starting to speak.
- Double barge-in: user interrupts, AI starts new response, user interrupts again.
- `stop()` called during each state: all cleanup paths work.
- `stop()` called during `processing` while LLM is generating: LLM is aborted.
- `pushAudio()` called before `start()`: no crash (audio is ignored).
- Provider throws synchronously in `start()`: error event emitted, state returns to `idle`.

### Test Framework

Tests use Vitest, matching the project's existing configuration in `package.json`.

---

## 15. Performance

### Latency Targets

The primary performance metric is end-to-end response latency: the time from the user finishing speaking to the AI beginning to speak. This is `userToAiMs` in the `TurnMetrics`.

| Scenario | Target | Notes |
|----------|--------|-------|
| User-to-AI response latency | < 1000 ms | With endpointing at 500ms, fast STT, fast LLM |
| User-to-AI response latency | < 1500 ms | With endpointing at 800ms, typical providers |
| Barge-in reaction time | < 200 ms | From user speech detection to AI audio stopped |
| State machine transition | < 1 ms | Internal state change processing |
| Sentence boundary detection | < 1 ms | Per-token processing overhead |
| Event emission | < 1 ms | Per-event overhead |

### Pipeline Overhead

`voice-turn`'s own processing overhead (state machine transitions, sentence splitting, event emission, timer management) is negligible compared to the provider latencies. The turn manager adds less than 5ms of total overhead per turn. The latency budget is dominated by:

1. **Endpointing silence threshold**: 500-1500ms (configurable, largest contributor)
2. **STT finalization**: 100-300ms (provider-dependent)
3. **LLM TTFT**: 200-500ms (model and provider dependent)
4. **TTS first-chunk latency**: 100-300ms (provider-dependent)

### Memory Usage

Memory usage is minimal:

- State machine: a handful of enum values and timers (< 1 KB).
- Sentence buffer: proportional to the LLM response length. Typically 1-10 KB for a voice response.
- TTS sentence queue: bounded by `maxSentenceQueueSize` (default 10 sentences). Typically 1-5 KB of text.
- Audio data: the turn manager does not buffer audio data. Audio from the user's microphone flows through `pushAudio()` directly to the STT provider. Audio from TTS is emitted via `audioOutput` events to the application. The turn manager holds no audio buffers.

### Benchmark Targets

| Metric | Target |
|--------|--------|
| Turns per second (throughput) | Not applicable (single-conversation library) |
| Memory per TurnManager instance | < 100 KB |
| State transitions per second | > 10,000 (limited by timer resolution, not CPU) |
| Sentence split throughput | > 10 MB/s of text |
| Event emission overhead | < 10 microseconds per event |

---

## 16. Dependencies

### Runtime Dependencies

None. `voice-turn` has zero runtime dependencies. The state machine, sentence splitter, timer management, event emitter, and pipeline coordination are all implemented from scratch. Provider interfaces are defined as TypeScript interfaces; actual provider implementations are supplied by the application.

### Peer Dependencies

None. Unlike packages that wrap specific SDKs, `voice-turn` defines provider interfaces and accepts any implementation. The application installs whichever STT, LLM, and TTS SDKs it needs.

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | `^5.3.0` | TypeScript compiler. |
| `vitest` | `^1.0.0` | Test runner. |
| `eslint` | `^8.0.0` | Linter. |
| `@types/node` | `^20.0.0` | Node.js type definitions. |

### Why Zero Dependencies

The turn manager's core logic is a state machine with timers and an event emitter. These are fundamental programming primitives that do not benefit from external libraries:

- **State machine**: A `switch` statement over an enum, with transition guards. No state machine library needed.
- **Timers**: `setTimeout` and `clearTimeout`. No timer library needed.
- **Event emitter**: A typed `Map<string, Set<Function>>` with `on`, `off`, and `emit` methods. Using Node.js `EventEmitter` would add a runtime dependency; the custom implementation is ~30 lines and provides better TypeScript typing.
- **Sentence splitting**: A regex-based split on the LLM output buffer. No NLP library needed for the default case; custom splitters are user-provided.
- **Async iterable consumption**: A `for await...of` loop. No stream library needed.

External libraries would add weight without adding value for these primitives.

---

## 17. File Structure

```
voice-turn/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                       -- Public API exports
    turn-manager.ts                -- createTurnManager() function, TurnManager class
    state-machine.ts               -- Turn state machine: states, transitions, guards
    types.ts                       -- All TypeScript type definitions
    endpointing/
      index.ts                     -- Endpointing strategy dispatch
      silence.ts                   -- Silence-based endpointing
      vad.ts                       -- VAD-based endpointing
      transcript.ts                -- Transcript-based endpointing
      adaptive.ts                  -- Adaptive endpointing
      custom.ts                    -- Custom endpointing wrapper
    barge-in/
      index.ts                     -- Barge-in handler dispatch
      full.ts                      -- Full barge-in handler
      soft.ts                      -- Soft barge-in handler
      none.ts                      -- No barge-in handler (passthrough)
    pipeline/
      index.ts                     -- Pipeline orchestration
      sentence-splitter.ts         -- LLM output sentence boundary detection
      tts-queue.ts                 -- TTS sentence queue with back-pressure
    metrics.ts                     -- TurnMetrics timing and measurement
    events.ts                      -- Typed event emitter implementation
  src/__tests__/
    turn-manager.test.ts           -- TurnManager integration tests
    state-machine.test.ts          -- State machine unit tests
    endpointing/
      silence.test.ts              -- Silence endpointing tests
      vad.test.ts                  -- VAD endpointing tests
      transcript.test.ts           -- Transcript endpointing tests
      adaptive.test.ts             -- Adaptive endpointing tests
      custom.test.ts               -- Custom endpointing tests
    barge-in/
      full.test.ts                 -- Full barge-in tests
      soft.test.ts                 -- Soft barge-in tests
    pipeline/
      sentence-splitter.test.ts    -- Sentence splitting tests
      tts-queue.test.ts            -- TTS queue tests
      pipeline.test.ts             -- Pipeline orchestration tests
    metrics.test.ts                -- Metrics measurement tests
    mocks/
      stt.ts                       -- Mock STTProvider
      llm.ts                       -- Mock LLMProvider
      tts.ts                       -- Mock TTSProvider
    integration/
      full-turn.test.ts            -- End-to-end turn cycle tests
      barge-in.test.ts             -- End-to-end barge-in tests
      multi-turn.test.ts           -- Multi-turn conversation tests
      error-recovery.test.ts       -- Error recovery tests
  dist/                            -- Compiled output (generated by tsc)
```

---

## 18. Implementation Roadmap

### Phase 1: State Machine and Types (v0.1.0)

Implement the foundation: type definitions, state machine, event emitter, and the `TurnManager` shell.

1. **Types**: Define all TypeScript types in `types.ts` -- `TurnState`, `STTProvider`, `LLMProvider`, `TTSProvider`, `TurnManagerConfig`, `TurnManagerEvents`, `TurnMetrics`, `TurnError`, `BargeInEvent`, all endpointing config variants, all barge-in config variants, `ConversationContext`, `EndpointingContext`, `TTSSpeakResult`.
2. **Event emitter**: Implement the typed event emitter in `events.ts`.
3. **State machine**: Implement the state machine in `state-machine.ts` with all six states and all transitions. Include transition guards (invalid transitions are rejected).
4. **TurnManager shell**: Implement `createTurnManager()` in `turn-manager.ts`. Wire up `start()`, `stop()`, `getState()`, `pushAudio()`, `setContext()`, event registration. Connect to the state machine.
5. **Silence endpointing**: Implement silence-based endpointing in `endpointing/silence.ts`. This is the default strategy and sufficient for Phase 1.
6. **Tests**: Unit tests for the state machine (all transitions), event emitter, and silence endpointing.

**Exit criteria**: The state machine transitions correctly for all valid inputs. Invalid transitions are rejected with errors. The event emitter dispatches typed events. Silence-based endpointing triggers end-of-turn after the configured threshold.

### Phase 2: Pipeline and Providers (v0.2.0)

Wire up the STT-to-LLM-to-TTS pipeline with streaming at every stage.

1. **Sentence splitter**: Implement sentence boundary detection in `pipeline/sentence-splitter.ts`.
2. **TTS queue**: Implement the TTS sentence queue with back-pressure in `pipeline/tts-queue.ts`.
3. **Pipeline orchestration**: Implement the full pipeline in `pipeline/index.ts`. Connect STT output to LLM input, LLM output through sentence splitter to TTS queue, TTS output to `audioOutput` events.
4. **Full barge-in**: Implement full barge-in handling in `barge-in/full.ts`. Cancellation of LLM and TTS, transition to `user-speaking`.
5. **Metrics**: Implement latency measurement in `metrics.ts`.
6. **Mock providers**: Implement mock STT, LLM, and TTS providers for testing.
7. **Tests**: Integration tests for the full turn cycle (user speech -> transcript -> LLM response -> TTS audio -> playback complete). Barge-in tests. Metrics verification.

**Exit criteria**: A complete turn cycle executes end-to-end with mock providers. Barge-in interrupts AI speech and transitions to user listening. Latency metrics are reported. All pipeline error paths are tested.

### Phase 3: Advanced Endpointing and Barge-In (v0.3.0)

Add the remaining endpointing strategies and barge-in modes.

1. **VAD endpointing**: Implement in `endpointing/vad.ts`.
2. **Transcript-based endpointing**: Implement in `endpointing/transcript.ts`.
3. **Adaptive endpointing**: Implement in `endpointing/adaptive.ts`.
4. **Custom endpointing**: Implement the custom function wrapper in `endpointing/custom.ts`.
5. **Soft barge-in**: Implement in `barge-in/soft.ts`.
6. **No barge-in**: Implement in `barge-in/none.ts`.
7. **Eager LLM start**: Implement speculative LLM invocation.
8. **Tests**: Tests for each endpointing strategy and barge-in mode.

**Exit criteria**: All five endpointing strategies work correctly with appropriate tests. All three barge-in modes work correctly. Eager LLM start speculatively invokes the LLM and correctly aborts if the user resumes speaking.

### Phase 4: Polish and Production Readiness (v1.0.0)

1. **Edge case hardening**: Double barge-in, rapid start/stop, provider errors during transitions, `pushAudio()` before `start()`, `stop()` during every state.
2. **AbortSignal support**: External cancellation of the entire turn manager.
3. **Provider warmup**: Call `warmup()` on providers that support it during idle periods.
4. **Performance profiling**: Measure and optimize internal overhead.
5. **Documentation**: Comprehensive README with examples for common provider combinations.
6. **Test suite completion**: Full test coverage for all edge cases, error paths, and configuration combinations.

**Exit criteria**: Package is ready for initial npm publish. All tests pass. All edge cases are handled. Latency overhead is under 5ms. README covers voice assistant, call center, and accessibility use cases with provider adapter examples.

---

## 19. Example Use Cases

### 19.1 Voice Assistant

A desktop voice assistant that uses Deepgram for STT, Anthropic Claude for LLM, and ElevenLabs for TTS.

```typescript
import { createTurnManager } from 'voice-turn';

const manager = createTurnManager({
  stt: new DeepgramSTTProvider(),
  llm: new AnthropicLLMProvider(),
  tts: new ElevenLabsTTSProvider('voice-id', 'api-key'),
  endpointing: { strategy: 'silence', silenceMs: 700 },
  bargeIn: { mode: 'full' },
  context: {
    systemPrompt: 'You are a helpful desktop assistant. Keep responses concise and conversational.',
    messages: [],
  },
});

const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

manager.on('userSpeechEnd', (transcript) => {
  conversationHistory.push({ role: 'user', content: transcript });
  manager.setContext({
    systemPrompt: 'You are a helpful desktop assistant. Keep responses concise and conversational.',
    messages: conversationHistory,
  });
});

manager.on('aiSpeechEnd', (response) => {
  conversationHistory.push({ role: 'assistant', content: response });
});

manager.on('audioOutput', (audio) => {
  speaker.play(audio);
});

manager.on('stateChange', (from, to) => {
  updateUI(to);  // Show listening/thinking/speaking indicator
});

manager.on('partialTranscript', (text) => {
  showLiveTranscript(text);
});

manager.on('error', (err) => {
  console.error(`Error in ${err.stage}: ${err.message}`);
  showErrorToast(err.message);
});

manager.start();

// Microphone audio input
microphone.on('data', (audio) => {
  manager.pushAudio(audio);
});
```

### 19.2 Call Center AI Agent

A phone-based customer service agent that handles billing inquiries.

```typescript
import { createTurnManager } from 'voice-turn';

const manager = createTurnManager({
  stt: new TwilioSTTProvider(callSid),
  llm: new OpenAILLMProvider(),
  tts: new OpenAITTSProvider(),
  endpointing: {
    strategy: 'transcript',
    silenceMs: 1000,       // Longer threshold for phone (noisy)
    transcriptEndMs: 500,  // Faster when STT sees sentence end
  },
  bargeIn: {
    mode: 'full',
    minSpeechForBargeIn: 300,  // Higher threshold to avoid false barge-ins from phone noise
  },
  context: {
    systemPrompt: `You are a billing support agent for Acme Corp.
    Be polite, concise, and helpful. Ask clarifying questions when needed.
    Do not discuss topics outside of billing.`,
  },
  processingTimeoutMs: 10000,
});

manager.on('turnComplete', (metrics) => {
  logMetrics({
    callSid,
    responseTimeMs: metrics.userToAiMs,
    wasInterrupted: metrics.wasInterrupted,
  });
});

manager.on('bargeIn', (event) => {
  logEvent('barge-in', {
    callSid,
    aiSpokenDurationMs: event.aiSpeechDurationMs,
    interruptedAtSentence: event.interruptedAtSentence,
  });
});

manager.start();
```

### 19.3 Accessibility Screen Reader Assistant

A voice interface for visually impaired users to interact with applications.

```typescript
import { createTurnManager } from 'voice-turn';

const manager = createTurnManager({
  stt: new WhisperSTTProvider(),
  llm: new AnthropicLLMProvider(),
  tts: new OpenAITTSProvider(),
  endpointing: {
    strategy: 'adaptive',
    minSilenceMs: 600,
    maxSilenceMs: 2000,
    adaptiveMultiplier: 2.0,
  },
  bargeIn: {
    mode: 'soft',
    softBargeInMs: 400,
  },
  context: {
    systemPrompt: `You are a screen reader assistant. Describe UI elements clearly and concisely.
    When reading lists, pause briefly between items.
    Respond to navigation commands: "next", "previous", "read", "click".`,
  },
  ttsBufferAhead: 2,  // Pre-buffer for smooth reading of long content
});

manager.on('stateChange', (from, to) => {
  // Announce state changes via a distinct audio cue
  if (to === 'user-speaking') playTone('listening');
  if (to === 'processing') playTone('thinking');
});

manager.start();
```

### 19.4 Interactive Language Tutor

A conversation practice tool where a student speaks with an AI language tutor.

```typescript
import { createTurnManager } from 'voice-turn';

const manager = createTurnManager({
  stt: new DeepgramSTTProvider({ language: 'es' }),  // Spanish STT
  llm: new AnthropicLLMProvider(),
  tts: new ElevenLabsTTSProvider('spanish-voice-id', apiKey),
  endpointing: {
    strategy: 'adaptive',
    minSilenceMs: 1000,    // Students need time to think
    maxSilenceMs: 3000,    // But not too long
    adaptiveMultiplier: 2.5,
    windowSize: 3,
  },
  bargeIn: {
    mode: 'soft',
    softBargeInMs: 800,    // Allow brief acknowledgments without interrupting
  },
  minSpeechDurationMs: 500,  // Require substantial speech (not just "um")
  context: {
    systemPrompt: `You are a Spanish language tutor. Speak in Spanish at a B1 level.
    Gently correct grammar mistakes. Ask follow-up questions to keep the conversation going.
    If the student struggles, offer hints in English.`,
  },
});

manager.on('userSpeechEnd', (transcript) => {
  showTranscriptWithAnnotations(transcript);  // Highlight grammar issues
});

manager.on('turnComplete', (metrics) => {
  updateStudentStats({
    responseTime: metrics.userToAiMs,
    wordsSpoken: metrics.userWordCount,
    turnDuration: metrics.totalResponseMs,
  });
});

manager.start();
```
