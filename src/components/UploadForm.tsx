'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import AuthButtons from '@/components/AuthButtons';

const BUCKET = 'tomomi-photos';
const MAX_FILES = 30;

export default function UploadForm() {
	const [user, setUser] = useState<User | null>(null);
	const [files, setFiles] = useState<File[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

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

	const canSubmit = useMemo(() => {
		return !!user && files.length > 0 && files.length <= MAX_FILES && !isSubmitting;
	}, [user, files, isSubmitting]);

	const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
		const picked = Array.from(e.target.files || []);
		const imagesOnly = picked.filter(f => f.type.startsWith('image/'));
		if (imagesOnly.length !== picked.length) {
			setMessage('画像ファイルのみアップロード可能です（動画は対象外）。');
		} else {
			setMessage(null);
		}
		if (imagesOnly.length > MAX_FILES) {
			setMessage(`一度に選択できるのは最大 ${MAX_FILES} ファイルです。選択数: ${imagesOnly.length}`);
		}
		setFiles(imagesOnly.slice(0, MAX_FILES));
	};

	const uploadAll = async () => {
		if (!user) return;
		setIsSubmitting(true);
		setMessage(null);
		const displayName =
			((user.user_metadata?.full_name as string) || user.email || 'ユーザー').toString();

		try {
			const results = await Promise.all(
				files.map(async (file, index) => {
					const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '');
					const path = `${user.id}/${Date.now()}-${index}-${safeName}`;
					const { error: uploadError } = await supabase
						.storage
						.from(BUCKET)
						.upload(path, file, {
							cacheControl: '3600',
							upsert: false,
							contentType: file.type
						});
					if (uploadError) throw uploadError;
					const { error: dbError } = await supabase
						.from('photos')
						.insert({
							path,
							uploader_id: user.id,
							uploader_name: displayName
						});
					if (dbError) throw dbError;
					return path;
				})
			);
			setFiles([]);
			setMessage(`アップロード完了: ${results.length} 件`);
		} catch (e: any) {
			setMessage(`アップロードに失敗しました: ${e?.message ?? 'Unknown error'}`);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="card" style={{ display: 'grid', gap: 12 }}>
			<div className="row" style={{ justifyContent: 'space-between' }}>
				<strong>写真アップロード</strong>
				{user ? (
					<AuthButtons compact />
				) : (
					<span className="muted">画像のみ・一度に最大 {MAX_FILES} 枚</span>
				)}
			</div>
			{user ? (
				<>
					<input
						type="file"
						accept="image/*"
						multiple
						onChange={onPickFiles}
					/>
					<div className="row" style={{ justifyContent: 'space-between' }}>
						<span className="muted">選択中: {files.length} 枚</span>
						<button className="btn btn-primary" onClick={uploadAll} disabled={!canSubmit}>
							{isSubmitting ? 'アップロード中...' : 'アップロード'}
						</button>
					</div>
					{message && <span className="muted">{message}</span>}
				</>
			) : (
				<div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'nowrap', gap: 8, alignItems: 'center' }}>
					<AuthButtons />
					<span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>すると写真をアップロードできます。</span>
				</div>
			)}
		</div>
	);
}


