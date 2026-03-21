import { TurnState } from './types.js'

export type TurnStateTransition = {
  from: TurnState | TurnState[]
  to: TurnState
  action?: string
}

// Valid state transitions
const TRANSITIONS: TurnStateTransition[] = [
  { from: 'idle', to: 'user-speaking', action: 'audio-detected' },
  { from: 'user-speaking', to: 'user-paused', action: 'silence-detected' },
  { from: 'user-speaking', to: 'processing', action: 'endpoint-detected' },
  { from: 'user-paused', to: 'user-speaking', action: 'audio-resumed' },
  { from: 'user-paused', to: 'processing', action: 'endpoint-confirmed' },
  { from: 'processing', to: 'ai-speaking', action: 'response-ready' },
  { from: 'processing', to: 'idle', action: 'processing-complete' },
  { from: 'ai-speaking', to: 'idle', action: 'speech-complete' },
  { from: 'ai-speaking', to: 'interrupted', action: 'barge-in' },
  { from: 'interrupted', to: 'user-speaking', action: 'resume-listening' },
  { from: ['user-speaking', 'user-paused', 'processing', 'ai-speaking', 'interrupted'], to: 'idle', action: 'stop' },
]

export function isValidTransition(from: TurnState, to: TurnState): boolean {
  return TRANSITIONS.some((t) => {
    const fromMatches = Array.isArray(t.from) ? t.from.includes(from) : t.from === from
    return fromMatches && t.to === to
  })
}

export function getValidTransitions(from: TurnState): TurnState[] {
  const targets: TurnState[] = []
  for (const t of TRANSITIONS) {
    const fromMatches = Array.isArray(t.from) ? t.from.includes(from) : t.from === from
    if (fromMatches && !targets.includes(t.to)) {
      targets.push(t.to)
    }
  }
  return targets
}
