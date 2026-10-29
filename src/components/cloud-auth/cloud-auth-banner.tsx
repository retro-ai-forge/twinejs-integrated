import * as React from 'react';
import {IconCloud, IconCloudOff} from '@tabler/icons';
import './cloud-auth-banner.css';

export type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

export const CloudAuthBanner: React.FC = () => {
	const [authState, setAuthState] = React.useState<AuthState>('checking');
	const [address, setAddress] = React.useState<string>('');
	const [dismissed, setDismissed] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;

		async function check() {
			try {
				const res = await fetch('/api/auth/me', {credentials: 'include'});
				if (cancelled) return;
				if (res.ok) {
					const data = await res.json();
					setAddress(data.address || '');
					setAuthState('authenticated');
				} else {
					setAuthState('unauthenticated');
				}
			} catch {
				if (!cancelled) setAuthState('unauthenticated');
			}
		}

		check();
		return () => {
			cancelled = true;
		};
	}, []);

	if (authState === 'checking' || dismissed) return null;

	if (authState === 'authenticated') {
		const short = address
			? `${address.slice(0, 6)}…${address.slice(-4)}`
			: '';
		return (
			<div className="cloud-auth-banner cloud-auth-ok">
				<IconCloud size={16} />
				<span>Cloud save active{short ? ` · ${short}` : ''}</span>
			</div>
		);
	}

	const loginUrl = `/?redirect=${encodeURIComponent('/twine/')}`;

	return (
		<div className="cloud-auth-banner cloud-auth-warn">
			<IconCloudOff size={16} />
			<span>
				Stories are only saved in this browser.{' '}
				<a href={loginUrl} className="cloud-auth-link">
					Connect wallet
				</a>{' '}
				to enable cloud save.
			</span>
			<button
				className="cloud-auth-dismiss"
				onClick={() => setDismissed(true)}
				title="Dismiss"
			>
				×
			</button>
		</div>
	);
};
