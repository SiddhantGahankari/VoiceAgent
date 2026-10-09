export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status}). Please try later.`);
  return data as T;
}

export type Connection = { id: string; ws_url: string; token: string };
export type Line = { id: string; speaker: 'You' | 'Agent'; text: string };
export type Turn = { id: string; turn_index: number; user_transcript: string; agent_response: string; interrupted?: boolean };
export type Cost = { total_credits: number | null; items: { service: string; model: string; credits: number }[] };

export function transcriptLines(turns: Turn[]): Line[] {
  return [...turns].sort((a, b) => a.turn_index - b.turn_index).flatMap(turn => [
    ...(turn.user_transcript ? [{ id: `${turn.id}-user`, speaker: 'You' as const, text: turn.user_transcript }] : []),
    ...(turn.agent_response ? [{ id: `${turn.id}-agent`, speaker: 'Agent' as const, text: turn.agent_response }] : []),
  ]);
}

// A retransmitted segment updates its existing row; equal text from a new turn stays visible.
export function mergeFinals(lines: Line[], segments: { id: string; text: string; final: boolean }[], speaker: Line['speaker']): Line[] {
  const next = [...lines];
  for (const segment of segments) {
    if (!segment.final || !segment.text.trim()) continue;
    const id = `${speaker}-${segment.id}`;
    const index = next.findIndex(line => line.id === id);
    const line = { id, speaker, text: segment.text };
    if (index < 0) next.push(line);
    else next[index] = line;
  }
  return next;
}
