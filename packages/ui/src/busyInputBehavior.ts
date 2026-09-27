import { useSyncExternalStore } from 'react';

export type BusyInputBehavior = 'steer' | 'followUp';

const STORAGE_KEY = 'pi-desktop:busy-input-behavior';
const DEFAULT_BEHAVIOR: BusyInputBehavior = 'followUp';
const listeners = new Set<() => void>();

function normalizeBehavior(value: unknown): BusyInputBehavior {
	return value === 'steer' ? 'steer' : DEFAULT_BEHAVIOR;
}

function readStoredBehavior(): BusyInputBehavior {
	try { return normalizeBehavior(typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY)); }
	catch { return DEFAULT_BEHAVIOR; }
}

let activeBehavior = readStoredBehavior();

function updateBehavior(next: BusyInputBehavior): void {
	if (activeBehavior === next) return;
	activeBehavior = next;
	for (const listener of listeners) listener();
}

export function getBusyInputBehavior(): BusyInputBehavior {
	return activeBehavior;
}

/** Apply immediately to every consumer, even when persistence is unavailable. */
export function setBusyInputBehavior(next: BusyInputBehavior): boolean {
	let saved = false;
	try {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, next);
			saved = true;
		}
	} catch { /* Keep this preference available for the current app session. */ }
	updateBehavior(next);
	return saved;
}

export function subscribeBusyInputBehavior(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		if (event.key !== null && event.key !== STORAGE_KEY) return;
		try {
			if (event.storageArea && event.storageArea !== window.localStorage) return;
		} catch { return; }
		updateBehavior(normalizeBehavior(event.key === null ? null : event.newValue));
	});
}

export function useBusyInputBehavior(): [BusyInputBehavior, (value: BusyInputBehavior) => boolean] {
	const behavior = useSyncExternalStore(subscribeBusyInputBehavior, getBusyInputBehavior, () => DEFAULT_BEHAVIOR);
	return [behavior, setBusyInputBehavior];
}
