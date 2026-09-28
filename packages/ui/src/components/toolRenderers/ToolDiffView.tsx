import { useMemo, useState } from 'react';
import { useReadingAnalysis } from '../../useReadingAnalysis';
import { WordDiffText } from '../WordDiffText';
import '../workbenchReading.css';
import { parsePiEditDiff } from '../../unifiedDiff';

/**
 * Line-numbered rendering of Pi's edit-tool diff (`+3 added` / `-2 removed`
 * rows), reusing the workspace diff palette so session and workbench agree.
 */
export function ToolDiffView({ diff }: { diff: string }) {
	const [limit, setLimit] = useState(400);
	const analysis = useReadingAnalysis(diff, '', 'edit');
	const lines = useMemo(() => parsePiEditDiff(diff), [diff]);
	return <div className="pd-activity-diff" tabIndex={0} role="region" aria-label="diff">
		<pre>{lines.slice(0, limit).map((line, index) => (
			<span className={`pd-diff-line is-${line.kind}`} key={index}>
				<span className="pd-diff-number" aria-hidden="true">{line.oldLine}</span>
				<span className="pd-diff-number" aria-hidden="true">{line.newLine}</span>
				<span className="pd-diff-text">{analysis.words[index]?.length ? <WordDiffText text={line.text} ranges={analysis.words[index]!} /> : line.text || ' '}</span>
			</span>
		))}</pre>
		{limit < lines.length && <button type="button" className="pd-workbench-show-lines" onClick={() => setLimit(value => value + 400)}>+ {Math.min(400, lines.length - limit)} / {lines.length}</button>}
	</div>;
}
