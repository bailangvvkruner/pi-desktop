import { useState } from 'react';
import { useT } from '../i18n';
import { useConversationMetricsPreferences } from '../conversationMetricsPreferences';
import './conversationMetrics.css';

export function ConversationMetricsSettings() {
	const { t } = useT();
	const [preferences, setPreferences] = useConversationMetricsPreferences();
	const [saveFailed, setSaveFailed] = useState(false);
	return <section className="pd-metrics-settings" aria-label={t('settings.conversationMetrics')}>
		<div className="pd-settings-section-head"><h3>{t('settings.conversationMetrics')}</h3><p>{t('settings.conversationMetricsDescription')}</p></div>
		<div className="pd-metrics-settings-options">
			{(['speed', 'tokens', 'cache', 'duration'] as const).map(key => <button key={key} type="button" role="switch" aria-checked={preferences[key]} className="pd-metrics-setting" data-setting={`metrics-${key}`} onClick={() => setSaveFailed(!setPreferences({ [key]: !preferences[key] }))}>
				<span>{t(`settings.metrics.${key}`)}</span><span className="pd-metrics-switch" aria-hidden="true" />
			</button>)}
		</div>
		{saveFailed && <p className="pd-settings-feedback" role="status">{t('settings.metrics.saveFailed')}</p>}
	</section>;
}
