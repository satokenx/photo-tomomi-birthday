'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const BUCKET = 'tomomi-photos';
const PAGE_SIZE = 10;

type PhotoRow = {
	id: string;
	path: string;
	uploader_id: string;
	uploader_name: string;
	uploaded_at: string;
};

export default function PhotoGrid() {
	const [rows, setRows] = useState<PhotoRow[]>([]);
	const [total, setTotal] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [offset, setOffset] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const [userId, setUserId] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [appliedSearch, setAppliedSearch] = useState('');
	const [sort, setSort] = useState<'date_desc' | 'date_asc'>('date_desc');
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	const [uploaderOptions, setUploaderOptions] = useState<string[]>([]);
	const [optionsLoading, setOptionsLoading] = useState<boolean>(true);

	useEffect(() => {
		let mounted = true;
		supabase.auth.getUser().then(({ data }) => {
			if (mounted) setUserId(data.user?.id ?? null);
		});
		const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
			setUserId(session?.user?.id ?? null);
		});
		return () => {
			mounted = false;
			listener.subscription.unsubscribe();
		};
	}, []);

	const baseQuery = useCallback(() => {
		let q = supabase
			.from('photos')
			.select('id, path, uploader_id, uploader_name, uploaded_at', { count: 'exact' });

		// apply search
		if (appliedSearch.trim()) {
			q = q.eq('uploader_name', appliedSearch.trim());
		}

		// apply sort
		q = q.order('uploaded_at', { ascending: sort === 'date_asc' }).order('id', { ascending: sort === 'date_asc' });
		return q;
	}, [appliedSearch, sort]);

	const fetchPage = useCallback(async (initial = false) => {
		try {
			if (initial) {
				setLoading(true);
			} else {
				setLoadingMore(true);
			}
			const from = initial ? 0 : offset;
			const to = from + PAGE_SIZE - 1;
			const { data, error, count } = await baseQuery().range(from, to);
			if (error) throw error;
			if (initial) {
				setRows(data || []);
				setOffset((data?.length ?? 0));
				setHasMore((data?.length ?? 0) === PAGE_SIZE);
				setTotal(count ?? (data?.length ?? 0));
			} else {
				setRows(prev => [...prev, ...(data || [])]);
				const fetched = data?.length ?? 0;
				setOffset(prev => prev + fetched);
				if (fetched < PAGE_SIZE) setHasMore(false);
			}
		} catch (e: any) {
			setError(e?.message ?? 'Unknown error');
		} finally {
			setLoading(false);
			setLoadingMore(false);
		}
	}, [offset, baseQuery]);

	// Initial and when filter changes
	useEffect(() => {
		let active = true;
		(async () => {
			if (!active) return;
			await fetchPage(true);
		})();
		return () => { active = false; };
	}, [fetchPage]);

	// Fetch distinct uploader options (client-side distinct)
	useEffect(() => {
		let active = true;
		(async () => {
			setOptionsLoading(true);
			const { data, error } = await supabase
				.from('photos')
				.select('uploader_name')
				.order('uploader_name', { ascending: true });
			if (!active) return;
			if (!error && data) {
				const names = Array.from(
					new Set(
						(data as { uploader_name: string | null }[])
							.map(r => (r.uploader_name ?? '').trim())
							.filter(n => n.length > 0)
					)
				);
				setUploaderOptions(names);
			}
			setOptionsLoading(false);
		})();
		return () => { active = false; };
	}, []);

	// Infinite scroll
	useEffect(() => {
		if (!sentinelRef.current) return;
		const el = sentinelRef.current;
		const obs = new IntersectionObserver((entries) => {
			const first = entries[0];
			if (first.isIntersecting && hasMore && !loading && !loadingMore) {
				fetchPage(false);
			}
		}, { rootMargin: '200px 0px' });
		obs.observe(el);
		return () => obs.disconnect();
	}, [fetchPage, hasMore, loading, loadingMore]);

	const onApplySearch = (e: React.FormEvent) => {
		e.preventDefault();
		// No-op: selection changeで即適用
	};
	const onClearSearch = () => {
		setSearch('');
		setAppliedSearch('');
		setOffset(0);
		setRows([]);
		setHasMore(true);
	};

	const onSelectChange = (value: string) => {
		setSearch(value);
		setAppliedSearch(value);
		setOffset(0);
		setRows([]);
		setHasMore(true);
	};

	const onSortChange = (value: 'date_desc' | 'date_asc') => {
		setSort(value);
		setOffset(0);
		setRows([]);
		setHasMore(true);
	};

	const onDelete = async (row: PhotoRow) => {
		if (!userId || userId !== row.uploader_id) return;
		if (!confirm('この写真を削除しますか？')) return;
		// delete storage object first
		const { error: sErr } = await supabase.storage.from(BUCKET).remove([row.path]);
		if (sErr) {
			alert(`ストレージ削除に失敗: ${sErr.message}`);
			return;
		}
		// then delete db row
		const { error: dErr } = await supabase.from('photos').delete().eq('id', row.id);
		if (dErr) {
			alert(`DB削除に失敗: ${dErr.message}`);
			return;
		}
		setRows(prev => prev.filter(r => r.id !== row.id));
		setTotal(prev => (prev ?? 1) - 1);
	};

	if (loading && rows.length === 0) return <div className="muted">読み込み中...</div>;
	if (error) return <div className="muted">読み込みエラー: {error}</div>;
	// show header & search even if no rows so that filter can be cleared
	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
				<strong>写真一覧</strong>
				<span className="muted">{total ?? rows.length} 枚</span>
			</div>
			<form onSubmit={onApplySearch} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
				<select
					value={search}
					onChange={(e) => onSelectChange(e.target.value)}
					style={{ flex: '1 1 auto', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', minWidth: 180 }}
					aria-label="アップロード者を選択"
				>
					<option value="">{optionsLoading ? '読み込み中...' : 'すべてのアップロード者'}</option>
					{uploaderOptions.map(name => (
						<option key={name} value={name}>{name}</option>
					))}
				</select>
				<select
					value={sort}
					onChange={(e) => onSortChange(e.target.value as any)}
					style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff' }}
					aria-label="ソート順を選択"
				>
					<option value="date_desc">日付（新しい順）</option>
					<option value="date_asc">日付（古い順）</option>
				</select>
				<button className="btn" type="button" onClick={onClearSearch}>条件解除</button>
			</form>
			{(rows.length === 0 && !loading) ? (
				<div className="muted">該当する写真がありません。</div>
			) : (
				<div className="grid">
					{rows.map((row) => {
						const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(row.path);
						const url = urlData.publicUrl;
						const date = new Date(row.uploaded_at);
						const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
						const canDelete = userId && userId === row.uploader_id;
						return (
							<figure key={row.id} className="photo">
								<img src={url} alt={row.path} />
								<figcaption>
									<div className="photo-meta">
										<span className="uploader">{row.uploader_name}</span>
										<span className="date">{formatted}</span>
									</div>
									{canDelete && (
										<div className="row" style={{ justifyContent: 'flex-end' }}>
											<button className="btn" onClick={() => onDelete(row)}>削除</button>
										</div>
									)}
								</figcaption>
							</figure>
						);
					})}
				</div>
			)}
			<div ref={sentinelRef} />
			{loadingMore && <div className="muted">読み込み中...</div>}
		</div>
	);
}


