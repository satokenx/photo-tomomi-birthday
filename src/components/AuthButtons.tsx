'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

type AuthButtonsProps = {
	compact?: boolean; // サインイン済み時にサインアウトのみを表示
};

export default function AuthButtons({ compact = false }: AuthButtonsProps) {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let mounted = true;
		supabase.auth.getUser().then(({ data }) => {
			if (mounted) setUser(data.user ?? null);
		});
		const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
			setUser(session?.user ?? null);
		});
		return () => {
			mounted = false;
			listener.subscription.unsubscribe();
		};
	}, []);

	const signIn = async () => {
		setLoading(true);
		await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
			}
		});
		setLoading(false);
	};

	const signOut = async () => {
		await supabase.auth.signOut();
	};

	if (user) {
		if (compact) {
			return <button className="btn" onClick={signOut}>サインアウト</button>;
		}
		const displayName = (user.user_metadata?.full_name as string) || user.email || 'ユーザー';
		return (
			<div className="row">
				<span className="muted">こんにちは、{displayName}</span>
				<button className="btn" onClick={signOut}>サインアウト</button>
			</div>
		);
	}

	return (
		<button className="btn btn-primary" onClick={signIn} disabled={loading}>
			{loading ? 'リダイレクト中...' : 'Googleでサインイン'}
		</button>
	);
}


