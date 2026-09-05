export interface Settings { thresholdDb: number; minSilenceMs: number; preRollMs: number; postRollMs: number }
export interface SpeechProtectionSettings { enabled: boolean; threshold: number }
export interface Cut { id: string; start: number; end: number; enabled: boolean; reason: string }
export interface Track { index: number; codec: string; channels: number; sampleRate: number; label: string; language: string }
export interface Media { id: string; name: string; fingerprint: string; duration: number; width: number; height: number; fps: number; size: number; audioTracks: Track[] }
export interface Analysis { settings: Settings; speechProtection: SpeechProtectionSettings; protection?: { model: string; intervals: { start: number; end: number }[]; retainedSeconds: number; analysisGain: number }; trackIndex: number; peaks: number[]; cuts: Cut[]; candidates: { start: number; end: number }[] }
export interface Output { id: string; name: string; duration: number; size: number; verified: boolean; kept: { start: number; end: number }[]; sourceRange?: { start: number; end: number } }
export interface Job { id: string; type: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; progress: number; stage: string; error?: string; result?: Analysis | Output }
declare global {
  interface Window { hypercut?: { pickVideo: () => Promise<Media | null>; saveExport: (id: string) => Promise<boolean>; saveProject: (project: unknown) => Promise<boolean>; openBrowser: () => Promise<void>; platform: string } }
}
