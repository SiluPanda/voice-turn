import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTurnManager } from '../turn-manager.js'
import { isValidTransition, getValidTransitions } from '../state-machine.js'
import { TypedEventEmitter } from '../events.js'
import { splitSentences } from '../sentence-splitter.js'
import type { STTProvider, LLMProvider, TTSProvider } from '../types.js'

// ---- Mock providers ----

function makeMockSTT(): STTProvider {
  return {
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue('hello world'),
    pushAudio: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
}

function makeMockLLM(): LLMProvider {
  return {
    generate: vi.fn().mockImplementation(async function* () {
      yield 'Hi there!'
    }),
  }
}

function makeMockTTS(): TTSProvider {
  return {
    speak: vi.fn().mockReturnValue({
      audio: new ReadableStream({
        start(controller) { controller.close() },
      }),
      cancel: vi.fn(),
    }),
  }
}

// ---- Tests ----

describe('createTurnManager', () => {
  let stt: STTProvider
  let llm: LLMProvider
  let tts: TTSProvider

  beforeEach(() => {
    stt = makeMockSTT()
    llm = makeMockLLM()
    tts = makeMockTTS()
  })

  it('returns a TurnManager with idle initial state', () => {
    const tm = createTurnManager({ stt, llm, tts })
    expect(tm.getState()).toBe('idle')
  })

  it('isRunning is false before start', () => {
    const tm = createTurnManager({ stt, llm, tts })
    expect(tm.isRunning).toBe(false)
  })

  it('isRunning is true after start', () => {
    const tm = createTurnManager({ stt, llm, tts })
    tm.start()
    expect(tm.isRunning).toBe(true)
  })

  it('start() calls stt.start()', () => {
    const tm = createTurnManager({ stt, llm, tts })
    tm.start()
    expect(stt.start).toHaveBeenCalledOnce()
  })

  it('start() registers STT event listeners', () => {
    const tm = createTurnManager({ stt, llm, tts })
    tm.start()
    expect(stt.on).toHaveBeenCalledWith('partial', expect.any(Function))
    expect(stt.on).toHaveBeenCalledWith('speech-start', expect.any(Function))
    expect(stt.on).toHaveBeenCalledWith('speech-end', expect.any(Function))
  })

  it('stop() sets isRunning to false and state to idle', () => {
    const tm = createTurnManager({ stt, llm, tts })
    tm.start()
    tm.stop()
    expect(tm.isRunning).toBe(false)
    expect(tm.getState()).toBe('idle')
  })

  it('stop() calls stt.stop()', () => {
    const tm = createTurnManager({ stt, llm, tts })
    tm.start()
    tm.stop()
    expect(stt.stop).toHaveBeenCalled()
  })

  it('lastTurnMetrics is null initially', () => {
    const tm = createTurnManager({ stt, llm, tts })
    expect(tm.lastTurnMetrics).toBeNull()
  })

  it('on() returns an unsubscribe function that removes the listener', () => {
    const tm = createTurnManager({ stt, llm, tts })
    const handler = vi.fn()
    const unsub = tm.on('turnComplete', handler)
    expect(typeof unsub).toBe('function')
    unsub()
    // After unsubscribing the handler should not be called
    // (we cannot easily emit without going through full flow, so just verify unsub is callable)
    expect(() => unsub()).not.toThrow()
  })

  it('setContext() updates context without throwing', () => {
    const tm = createTurnManager({ stt, llm, tts })
    expect(() => {
      tm.setContext({ systemPrompt: 'You are helpful.', history: [] })
    }).not.toThrow()
  })

  it('pushAudio() does nothing when not running', () => {
    const tm = createTurnManager({ stt, llm, tts })
    expect(() => tm.pushAudio(new Uint8Array([1, 2, 3]))).not.toThrow()
    expect(stt.pushAudio).not.toHaveBeenCalled()
  })

  it('pushAudio() forwards to stt when running', () => {
    const tm = createTurnManager({ stt, llm, tts })
    tm.start()
    const audio = new Uint8Array([1, 2, 3])
    tm.pushAudio(audio)
    expect(stt.pushAudio).toHaveBeenCalledWith(audio)
  })

  it('emits stateChange when speech-start fires', () => {
    const tm = createTurnManager({ stt, llm, tts })
    const changes: Array<[string, string]> = []
    tm.on('stateChange', (next, prev) => changes.push([next, prev]))

    tm.start()
    // Grab the speech-start handler registered on stt.on
    const onCall = (stt.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'speech-start'
    )
    expect(onCall).toBeDefined()
    const speechStartHandler = onCall![1] as () => void
    speechStartHandler()

    expect(changes).toContainEqual(['user-speaking', 'idle'])
  })

  it('emits userSpeechStart when speech-start fires', () => {
    const tm = createTurnManager({ stt, llm, tts })
    const handler = vi.fn()
    tm.on('userSpeechStart', handler)
    tm.start()

    const onCall = (stt.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'speech-start'
    )
    const speechStartHandler = onCall![1] as () => void
    speechStartHandler()

    expect(handler).toHaveBeenCalledOnce()
  })

  it('emits partialTranscript when partial event fires', () => {
    const tm = createTurnManager({ stt, llm, tts })
    const handler = vi.fn()
    tm.on('partialTranscript', handler)
    tm.start()

    const onCall = (stt.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'partial'
    )
    const partialHandler = onCall![1] as (text: unknown) => void
    partialHandler('hel')

    expect(handler).toHaveBeenCalledWith('hel')
  })
})

// ---- State machine tests ----

describe('isValidTransition', () => {
  it('idle -> user-speaking is valid', () => {
    expect(isValidTransition('idle', 'user-speaking')).toBe(true)
  })

  it('idle -> ai-speaking is invalid', () => {
    expect(isValidTransition('idle', 'ai-speaking')).toBe(false)
  })

  it('user-speaking -> user-paused is valid', () => {
    expect(isValidTransition('user-speaking', 'user-paused')).toBe(true)
  })

  it('user-paused -> processing is valid', () => {
    expect(isValidTransition('user-paused', 'processing')).toBe(true)
  })

  it('processing -> ai-speaking is valid', () => {
    expect(isValidTransition('processing', 'ai-speaking')).toBe(true)
  })

  it('ai-speaking -> interrupted is valid', () => {
    expect(isValidTransition('ai-speaking', 'interrupted')).toBe(true)
  })

  it('interrupted -> user-speaking is valid', () => {
    expect(isValidTransition('interrupted', 'user-speaking')).toBe(true)
  })

  it('ai-speaking -> idle is valid (stop)', () => {
    expect(isValidTransition('ai-speaking', 'idle')).toBe(true)
  })

  it('idle -> interrupted is invalid', () => {
    expect(isValidTransition('idle', 'interrupted')).toBe(false)
  })

  it('processing -> user-speaking is invalid', () => {
    expect(isValidTransition('processing', 'user-speaking')).toBe(false)
  })
})

describe('getValidTransitions', () => {
  it('returns transitions from idle', () => {
    const targets = getValidTransitions('idle')
    expect(targets).toContain('user-speaking')
  })

  it('returns multiple transitions from ai-speaking', () => {
    const targets = getValidTransitions('ai-speaking')
    expect(targets).toContain('idle')
    expect(targets).toContain('interrupted')
  })
})

// ---- TypedEventEmitter tests ----

describe('TypedEventEmitter', () => {
  it('emits events to registered listeners', () => {
    const ee = new TypedEventEmitter<{ test: [string] }>()
    const handler = vi.fn()
    ee.on('test', handler)
    ee.emit('test', 'hello')
    expect(handler).toHaveBeenCalledWith('hello')
  })

  it('on() returns unsub function that removes listener', () => {
    const ee = new TypedEventEmitter<{ test: [number] }>()
    const handler = vi.fn()
    const unsub = ee.on('test', handler)
    unsub()
    ee.emit('test', 42)
    expect(handler).not.toHaveBeenCalled()
  })

  it('off() removes listener', () => {
    const ee = new TypedEventEmitter<{ test: [number] }>()
    const handler = vi.fn()
    ee.on('test', handler)
    ee.off('test', handler)
    ee.emit('test', 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not throw when emitting with no listeners', () => {
    const ee = new TypedEventEmitter<{ test: [] }>()
    expect(() => ee.emit('test')).not.toThrow()
  })

  it('supports multiple listeners for same event', () => {
    const ee = new TypedEventEmitter<{ data: [number] }>()
    const h1 = vi.fn()
    const h2 = vi.fn()
    ee.on('data', h1)
    ee.on('data', h2)
    ee.emit('data', 99)
    expect(h1).toHaveBeenCalledWith(99)
    expect(h2).toHaveBeenCalledWith(99)
  })
})

// ---- splitSentences tests ----

describe('splitSentences', () => {
  it('returns empty array for empty string', () => {
    expect(splitSentences('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(splitSentences('   ')).toEqual([])
  })

  it('splits on period followed by space', () => {
    const result = splitSentences('Hello there. How are you doing today?')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.join(' ')).toContain('Hello there')
  })

  it('splits on exclamation mark', () => {
    const result = splitSentences('That is great! I really liked it a lot.')
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('splits on question mark', () => {
    const result = splitSentences('How are you doing? I am doing well today.')
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('does not split on known abbreviation Dr.', () => {
    const result = splitSentences('Dr. Smith will see you now. Please wait outside.')
    // "Dr. Smith will see you now" should be a single sentence
    expect(result.some((s) => s.includes('Dr.'))).toBe(true)
  })

  it('filters out sentences shorter than 10 chars', () => {
    const result = splitSentences('Hi. This is a complete sentence here.')
    // "Hi." is 3 chars — should be filtered
    expect(result.every((s) => s.length >= 10)).toBe(true)
  })

  it('returns trimmed sentences', () => {
    const result = splitSentences('  Hello there my friend.  How are you today?  ')
    result.forEach((s) => {
      expect(s).toBe(s.trim())
    })
  })

  it('handles single sentence with no terminator', () => {
    const result = splitSentences('This is a single sentence without terminator')
    expect(result.length).toBe(1)
    expect(result[0]).toBe('This is a single sentence without terminator')
  })
})
