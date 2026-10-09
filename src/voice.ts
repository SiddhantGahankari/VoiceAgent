import { createLocalAudioTrack, Room, RoomEvent, Track, type LocalAudioTrack } from 'livekit-client';
import { api, mergeFinals, type Connection, type Line } from './api';

export type VoiceCallbacks = {
  status: (value: string) => void;
  lines: (update: (lines: Line[]) => Line[]) => void;
  lost: (message: string) => void;
  playback: (blocked: boolean) => void;
};

export function microphoneMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access was denied. Allow it in your browser’s site settings, then start again.';
  if (name === 'NotFoundError') return 'No microphone was found. Connect a microphone and start again.';
  if (name === 'NotReadableError') return 'Your microphone is busy or unavailable. Close other recording apps and try again.';
  return error instanceof Error ? error.message : 'The conversation could not connect. Please try again.';
}

export class VoiceConnection {
  sessionId?: string;
  private room?: Room;
  private mic?: LocalAudioTrack;
  private elements = new Set<HTMLMediaElement>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;
  private startDone?: Promise<void>;
  private cleanupDone?: Promise<void>;
  private endDone?: Promise<void>;

  constructor(private callbacks: VoiceCallbacks, private maxDuration = 90) {}

  start(): Promise<void> {
    this.startDone ??= this.connect();
    return this.startDone;
  }

  private async connect() {
    this.callbacks.status('Requesting microphone');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('Microphone access requires HTTPS or localhost.');
      // Get permission before creating anything billable.
      this.mic = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
      if (this.stopped) { this.mic.stop(); return; }
      this.callbacks.status('Creating session');
      // Do not abort/retry this POST: a late response still needs its session ended.
      const session = await api<Connection>('/api/voice/sessions', { method: 'POST' });
      this.sessionId = session.id;
      if (this.stopped) { await this.endServer(); return; }
      const room = new Room();
      let connected = false;
      this.room = room;
      room.on(RoomEvent.TrackSubscribed, track => {
        if (this.stopped || track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        this.elements.add(element);
        document.getElementById('agent-audio')?.appendChild(element);
        void element.play().catch(() => this.callbacks.playback(true));
      });
      room.on(RoomEvent.TrackUnsubscribed, track => {
        for (const element of track.detach()) {
          element.pause(); element.srcObject = null; element.remove(); this.elements.delete(element);
        }
      });
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        if (!this.stopped) this.callbacks.lines(lines => mergeFinals(lines, segments, participant?.isLocal ? 'You' : 'Agent'));
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => this.callbacks.playback(!room.canPlaybackAudio));
      room.on(RoomEvent.Reconnecting, () => this.callbacks.status('Reconnecting'));
      room.on(RoomEvent.Reconnected, () => this.callbacks.status('Connected'));
      room.on(RoomEvent.Disconnected, () => {
        if (!this.stopped && connected) this.callbacks.lost('The voice connection closed. Your microphone has been released.');
      });
      this.callbacks.status('Connecting');
      try {
        await room.connect(session.ws_url, session.token);
      } catch {
        const host = new URL(session.ws_url).hostname;
        throw new Error(`Could not connect to CallMissed's voice server (${host}). Check your network or ask CallMissed to verify this server address. Your microphone has been released.`);
      }
      connected = true;
      if (this.stopped) { await room.disconnect(true); return; }
      await room.startAudio().catch(() => this.callbacks.playback(true));
      if (this.stopped) { await room.disconnect(true); return; }
      if (this.mic) await room.localParticipant.publishTrack(this.mic);
      if (this.stopped) { this.mic?.stop(); await room.disconnect(true); return; }
      this.callbacks.status('Connected');
      this.timers.push(setTimeout(() => this.callbacks.lost(`The ${this.maxDuration}-second demo limit was reached.`), this.maxDuration * 1000));
    } catch (error) {
      await this.release();
      throw error;
    }
  }

  async enableAudio() {
    if (this.room) await this.room.startAudio();
    await Promise.all([...this.elements].map(element => element.play()));
    this.callbacks.playback(false);
  }

  private endServer() {
    if (this.sessionId) this.endDone ??= api<void>(`/api/voice/sessions/${this.sessionId}/end`, { method: 'POST', keepalive: true })
      .catch(error => { this.endDone = undefined; throw error; });
    return this.endDone;
  }

  release(): Promise<void> {
    this.stopped = true;
    this.cleanupDone ??= this.releaseResources();
    return this.cleanupDone;
  }

  private async releaseResources() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.mic?.stop();
    if (this.room) {
      this.room.removeAllListeners();
      for (const publication of this.room.localParticipant.audioTrackPublications.values()) publication.track?.stop();
      for (const participant of this.room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) publication.track?.detach().forEach(element => { element.pause(); element.srcObject = null; element.remove(); });
      }
    }
    for (const element of this.elements) { element.pause(); element.srcObject = null; element.remove(); }
    this.elements.clear();
    await this.room?.disconnect(true);
  }

  async stop() {
    await this.release();
    await this.startDone?.catch(() => undefined);
    await this.endServer();
  }

  exit() {
    void this.release();
    if (this.sessionId) navigator.sendBeacon(`/api/voice/sessions/${this.sessionId}/end`);
  }
}
