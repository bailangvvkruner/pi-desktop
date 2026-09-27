import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** Measure the visible title area again when hover controls, fonts or sidebar width change. */
export function SidebarSessionTitle({ title }: { title: string }) {
	const viewportRef = useRef<HTMLElement>(null);
	const textRef = useRef<HTMLSpanElement>(null);
	const [travel, setTravel] = useState(0);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		const text = textRef.current;
		if (!viewport || !text) return;
		const measure = () => {
			const style = getComputedStyle(text);
			const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
			const overflow = text.scrollWidth - padding - viewport.clientWidth;
			// Include breathing room at both ends so the faded edges do not hide
			// the first or last character while the animation pauses there.
			setTravel(viewport.clientWidth > 0 && overflow > 1 ? Math.ceil(overflow) + 16 : 0);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		observer.observe(text);
		return () => observer.disconnect();
	}, [title]);

	// Keep endpoint pauses short even for very long titles; only travel time grows.
	const duration = travel / 30 + 1.4;
	const pausePercent = .7 / duration * 100;
	return <strong ref={viewportRef} className={`pd-session-title${travel ? ' is-overflowing' : ''}`} style={{
		'--pd-title-travel': `${-travel}px`,
		'--pd-title-duration': `${duration}s`,
		'--pd-title-easing': `linear(0, 0 ${pausePercent}%, 1 ${100 - pausePercent}%, 1)`,
	} as CSSProperties}><span key={title} ref={textRef} className="pd-session-title-text">{title}</span></strong>;
}
