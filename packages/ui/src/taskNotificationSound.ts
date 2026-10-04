import { useSyncExternalStore } from 'react';

/**
 * Task-completion notification sound (zcode-style enhancement over the system
 * notification). The chime is synthesized with WebAudio so no audio asset ships
 * with the app; playback failures never affect the notification flow.
 */

const STORAGE_KEY = 'pi-desktop:task-notification-sound';
const listeners = new Set<() => void>();

export function normalizeTaskNotificationSound(value: unknown): boolean {
	return value === false ? false : true; // enabled by default
}

function readStored(): boolean {
	try {
		return normalizeTaskNotificationSound(typeof window === 'undefined' ? null : JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'));
	} catch {
		return true;
	}
}

let enabled = readStored();

function publish(next: boolean): void {
	if (enabled === next) return;
	enabled = next;
	for (const listener of listeners) listener();
}

export function getTaskNotificationSoundEnabled(): boolean {
	return enabled;
}

/** Apply locally even when persistence fails; the return value reports storage success. */
export function setTaskNotificationSoundEnabled(value: boolean): boolean {
	publish(value);
	try {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
			return true;
		}
	} catch { /* keep the in-session preference */ }
	return false;
}

export function subscribeTaskNotificationSound(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		if (event.key !== null && event.key !== STORAGE_KEY) return;
		try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
		publish(readStored());
	});
}

/** Pure transition gate so tests can cover the trigger semantics. */
export function shouldPlayTaskCompletionSound(previous: string, current: string, windowFocused: boolean): boolean {
	// Only a finished run (busy → idle) chimes, and only while the window is in
	// the background — the focused user already sees the result arrive.
	return previous === 'busy' && current === 'idle' && !windowFocused;
}

let audioContext: AudioContext | null = null;

function chimeContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const api = window as typeof window & { webkitAudioContext?: typeof AudioContext };
	const Context = window.AudioContext ?? api.webkitAudioContext;
	if (!Context) return null;
	audioContext ??= new Context();
	return audioContext;
}

function tone(context: AudioContext, start: number, frequency: number, duration: number): void {
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.type = 'sine';
	oscillator.frequency.value = frequency;
	// Soft pop envelope: quick attack, exponential decay, no click at the edges.
	gain.gain.setValueAtTime(0.0001, start);
	gain.gain.exponentialRampToValueAtTime(0.07, start + 0.012);
	gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
	oscillator.connect(gain).connect(context.destination);
	oscillator.start(start);
	oscillator.stop(start + duration + 0.02);
}

export async function playTaskNotificationSound(): Promise<void> {
	if (!enabled) return;
	// The sound is an enhancement; autoplay policies or missing devices must
	// never break the completion path, so every failure mode stays silent.
	try {
		const context = chimeContext();
		if (!context) return;
		if (context.state === 'suspended') await context.resume();
		const start = context.currentTime + 0.01;
		tone(context, start, 880, 0.14); // A5
		tone(context, start + 0.12, 1174.66, 0.22); // D6
	} catch { /* silent by design */ }
}

export function useTaskNotificationSoundEnabled(): [boolean, typeof setTaskNotificationSoundEnabled] {
	return [useSyncExternalStore(subscribeTaskNotificationSound, getTaskNotificationSoundEnabled, () => true), setTaskNotificationSoundEnabled];
}
