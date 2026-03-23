import type {
  TurnState,
  TurnManagerConfig,
  TurnManager,
  TurnManagerEvents,
  ConversationContext,
  TurnMetrics,
} from './types.js'
import { isValidTransition } from './state-machine.js'
import { TypedEventEmitter } from './events.js'
import { splitSentences } from './sentence-splitter.js'

export function createTurnManager(config: TurnManagerConfig): TurnManager {
  let state: TurnState = 'idle'
  let running = false
  let context: ConversationContext = config.context ? { ...config.context } : {}
  let lastTurnMetrics: TurnMetrics | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emitter = new TypedEventEmitter<TurnManagerEvents & Record<string, any[]>>()

  let abortController: AbortController | null = null
  let currentTTSCancel: (() => void) | null = null
  let accumulatedResponseText = ''

  const silenceMs = config.endpointing?.silenceMs ?? 800
  const minSpeechMs = config.endpointing?.minSpeechMs ?? 300
  const processingTimeoutMs = config.processingTimeoutMs ?? 30000
  const doSplitSentences = config.splitSentences !== false

  let speechStartTime = 0
  let processingStartTime = 0
  let turnStartTime = 0
  let firstAudioTime = 0
  let silenceTimer: ReturnType<typeof setTimeout> | null = null

  function transition(newState: TurnState): void {
    if (state === newState) return
    if (!isValidTransition(state, newState)) {
      // Allow idle -> idle on start
      if (newState === 'idle' && state === 'idle') return
      return
    }
    const prev = state
    state = newState
    emitter.emit('stateChange', newState, prev)
  }

  function clearSilenceTimer(): void {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  async function _processTranscript(): Promise<void> {
    processingStartTime = Date.now()

    let transcript: string
    try {
      transcript = await config.stt.stop()
    } catch (err) {
      emitter.emit('error', err instanceof Error ? err : new Error(String(err)))
      transition('idle')
      return
    }

    const speechDurationMs = processingStartTime - speechStartTime

    // If speech was too short (below minSpeechMs), discard
    if (speechDurationMs < minSpeechMs && transcript.trim().length === 0) {
      transition('idle')
      return
    }

    emitter.emit('transcript', transcript)

    // Add user turn to history
    if (!context.history) context.history = []
    context.history.push({ role: 'user', content: transcript })

    // Set up abort controller, respecting external signal
    abortController = new AbortController()
    if (config.signal) {
      config.signal.addEventListener('abort', () => abortController?.abort())
    }
    const signal = abortController.signal

    // Processing timeout
    const timeoutId = setTimeout(() => {
      abortController?.abort()
      emitter.emit('error', new Error(`Processing timed out after ${processingTimeoutMs}ms`))
    }, processingTimeoutMs)

    accumulatedResponseText = ''
    firstAudioTime = 0
    let fullResponse = ''

    try {
      if (doSplitSentences) {
        // Stream tokens, accumulate, split into sentences, speak each
        let pendingText = ''

        transition('ai-speaking')
        emitter.emit('aiSpeechStart')

        for await (const chunk of config.llm.generate(transcript, context, signal)) {
          if (signal.aborted) break
          pendingText += chunk
          accumulatedResponseText += chunk
          emitter.emit('response', accumulatedResponseText)

          // Try to extract complete sentences
          const sentences = splitSentences(pendingText)
          if (sentences.length > 1) {
            // All but the last are complete
            const completeSentences = sentences.slice(0, -1)
            // Recalculate pending as what's after the last complete sentence
            const lastComplete = completeSentences[completeSentences.length - 1]
            const lastIdx = pendingText.lastIndexOf(lastComplete)
            pendingText = pendingText.slice(lastIdx + lastComplete.length).trimStart()

            for (const sentence of completeSentences) {
              if (signal.aborted) break
              fullResponse += (fullResponse ? ' ' : '') + sentence
              await _speakText(sentence, signal)
            }
          }
        }

        // Speak any remaining text
        if (!signal.aborted && pendingText.trim().length > 0) {
          fullResponse += (fullResponse ? ' ' : '') + pendingText.trim()
          await _speakText(pendingText.trim(), signal)
        }
      } else {
        // Collect full response then speak
        for await (const chunk of config.llm.generate(transcript, context, signal)) {
          if (signal.aborted) break
          accumulatedResponseText += chunk
          emitter.emit('response', accumulatedResponseText)
        }
        fullResponse = accumulatedResponseText

        if (!signal.aborted && fullResponse.trim().length > 0) {
          transition('ai-speaking')
          emitter.emit('aiSpeechStart')
          await _speakText(fullResponse.trim(), signal)
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        emitter.emit('error', err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      clearTimeout(timeoutId)
    }

    if (!signal.aborted) {
      // Add assistant turn to history
      if (!context.history) context.history = []
      context.history.push({ role: 'assistant', content: fullResponse })

      const now = Date.now()
      lastTurnMetrics = {
        speechDurationMs,
        processingDurationMs: now - processingStartTime,
        ttfaMs: firstAudioTime > 0 ? firstAudioTime - processingStartTime : 0,
        totalTurnMs: now - turnStartTime,
      }

      transition('idle')
      emitter.emit('aiSpeechEnd')
      emitter.emit('turnComplete')
    }

    abortController = null
    currentTTSCancel = null
  }

  async function _speakText(text: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    const result = config.tts.speak(text, signal)
    currentTTSCancel = result.cancel

    if (firstAudioTime === 0) {
      firstAudioTime = Date.now()
    }

    // Consume the audio stream to completion (caller drives playback)
    try {
      const reader = result.audio.getReader()
      while (true) {
        if (signal.aborted) {
          result.cancel()
          break
        }
        const { done } = await reader.read()
        if (done) break
      }
      reader.releaseLock()
    } catch {
      // Stream may already be cancelled
    }

    currentTTSCancel = null
  }

  // STT event handlers (stored so they can be removed on stop)
  const onPartial = (text: unknown) => {
    emitter.emit('partialTranscript', String(text))
  }

  const onSpeechStart = () => {
    if (!running) return
    speechStartTime = Date.now()
    turnStartTime = Date.now()
    clearSilenceTimer()
    if (state === 'interrupted') {
      transition('user-speaking')
    } else if (state === 'idle') {
      transition('user-speaking')
    } else if (state === 'user-paused') {
      transition('user-speaking')
    }
    emitter.emit('userSpeechStart')
  }

  const onSpeechEnd = () => {
    if (!running) return
    if (state === 'user-speaking') {
      transition('user-paused')
    }
    clearSilenceTimer()
    silenceTimer = setTimeout(() => {
      silenceTimer = null
      if (running && (state === 'user-paused' || state === 'user-speaking')) {
        transition('processing')
        emitter.emit('userSpeechEnd')
        _processTranscript().catch((err) => {
          emitter.emit('error', err instanceof Error ? err : new Error(String(err)))
        })
      }
    }, silenceMs)
  }

  function start(): void {
    running = true
    state = 'idle'

    config.stt.on('partial', onPartial)
    config.stt.on('speech-start', onSpeechStart)
    config.stt.on('speech-end', onSpeechEnd)

    config.stt.start()
  }

  function stop(): void {
    running = false
    clearSilenceTimer()
    abortController?.abort()
    currentTTSCancel?.()
    config.stt.off('partial', onPartial)
    config.stt.off('speech-start', onSpeechStart)
    config.stt.off('speech-end', onSpeechEnd)
    config.stt.stop().catch(() => {})

    const prev = state
    if (prev !== 'idle') {
      state = 'idle'
      emitter.emit('stateChange', 'idle', prev)
    }
  }

  function pushAudio(audio: Uint8Array | Float32Array): void {
    if (!running) return
    config.stt.pushAudio(audio)

    // Barge-in: if AI is speaking and we receive audio, interrupt
    if (state === 'ai-speaking' && config.bargeIn?.enabled !== false) {
      const minInterruptionMs = config.bargeIn?.minInterruptionMs ?? 200
      // Use a simple heuristic: if audio chunk has non-zero energy
      const hasEnergy = hasAudioEnergy(audio)
      if (hasEnergy) {
        const speakingDurationMs = Date.now() - speechStartTime
        if (speakingDurationMs >= minInterruptionMs) {
          // Cancel current TTS
          const interruptedText = accumulatedResponseText
          abortController?.abort()
          currentTTSCancel?.()
          transition('interrupted')
          emitter.emit('bargeIn', { interruptedText })
          // Start listening again
          speechStartTime = Date.now()
          transition('user-speaking')
          emitter.emit('userSpeechStart')
        }
      }
    }
  }

  function hasAudioEnergy(audio: Uint8Array | Float32Array): boolean {
    if (audio instanceof Float32Array) {
      return audio.some((s) => Math.abs(s) > 0.01)
    }
    // Uint8Array: PCM is centered at 128
    return audio.some((s) => Math.abs(s - 128) > 10)
  }

  function getState(): TurnState {
    return state
  }

  function setContext(ctx: ConversationContext): void {
    context = { ...ctx }
  }

  function on<K extends keyof TurnManagerEvents & string>(
    event: K,
    handler: (...args: TurnManagerEvents[K]) => void,
  ): () => void {
    return emitter.on(event, handler)
  }

  function off<K extends keyof TurnManagerEvents & string>(
    event: K,
    handler: (...args: TurnManagerEvents[K]) => void,
  ): void {
    emitter.off(event, handler)
  }

  return {
    start,
    stop,
    pushAudio,
    getState,
    setContext,
    on,
    off,
    get isRunning() { return running },
    get lastTurnMetrics() { return lastTurnMetrics },
  }
}
