'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const BUCKET = 'tomomi-photos';
const PAGE_SIZE = 20;

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
	const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkDeleting, setBulkDeleting] = useState(false);

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

	// includeCount=true のときだけ総件数を取りにいく（初回やフィルタ変更時）
	const baseQuery = useCallback((includeCount: boolean) => {
		let q = supabase
			.from('photos')
			.select('id, path, uploader_id, uploader_name, uploaded_at', includeCount ? { count: 'exact' } as any : {} as any);

		// apply search
		if (appliedSearch.trim()) {
			q = q.eq('uploader_name', appliedSearch.trim());
		}

		// apply sort
		q = q.order('uploaded_at', { ascending: sort === 'date_asc' }).order('id', { ascending: sort === 'date_asc' });
		return q;
	}, [appliedSearch, sort]);

	const fetchPage = useCallback(async (initial = false): Promise<number> => {
		try {
			// 二重実行防止
			if ((fetchPage as any)._busy) return 0;
			(fetchPage as any)._busy = true;
			if (initial) {
				setLoading(true);
			} else {
				setLoadingMore(true);
			}
			const from = initial ? 0 : offset;
			const to = from + PAGE_SIZE - 1;
			// 初回のみ count=exact、以降はcountなしで軽量化
			const { data, error, count } = await baseQuery(initial).range(from, to);
			if (error) throw error;
			const fetched = data?.length ?? 0;
			if (initial) {
				const totalCount = count ?? fetched;
				setRows(data || []);
				setOffset(fetched);
				setTotal(totalCount);
				setHasMore(fetched > 0 && fetched < totalCount);
			} else {
				if (fetched === 0) {
					setHasMore(false);
				} else {
					const nextOffset = offset + fetched;
					setRows(prev => [...prev, ...(data || [])]);
					setOffset(nextOffset);
					setHasMore((total != null) ? (nextOffset < total) : (fetched === PAGE_SIZE));
				}
			}
			return fetched;
		} catch (e: any) {
			setError(e?.message ?? 'Unknown error');
			return 0;
		} finally {
			setLoading(false);
			setLoadingMore(false);
			(fetchPage as any)._busy = false;
		}
	}, [offset, baseQuery, total]);

	// 初期表示と、フィルタ/ソート変更時のみ先頭から再取得（offset変更では走らせない）
	useEffect(() => {
		let active = true;
		(async () => {
			if (!active) return;
			setRows([]);
			setOffset(0);
			setHasMore(true);
			setTotal(null);
			await fetchPage(true);
		})();
		return () => { active = false; };
	}, [appliedSearch, sort]);

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

	// 無限スクロールは使用しない（明示ボタンでロード）

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

	const toggleSelect = (row: PhotoRow) => {
		if (!userId || userId !== row.uploader_id) return;
		setSelectedIds(prev => {
			const n = new Set(prev);
			if (n.has(row.id)) n.delete(row.id);
			else n.add(row.id);
			return n;
		});
	};

	const bulkDelete = async () => {
		if (selectedIds.size === 0) return;
		const targets = rows.filter(r => selectedIds.has(r.id) && r.uploader_id === userId);
		if (targets.length === 0) return;
		if (!confirm(`選択した ${targets.length} 件を削除しますか？`)) return;
		setBulkDeleting(true);
		try {
			// 1) DBを先に削除（確実に一覧から消す）
			const ids = targets.map(t => t.id);
			const { error: dErr } = await supabase.from('photos').delete().in('id', ids);
			if (dErr) throw dErr;
			// UIから除去
			setRows(prev => prev.filter(r => !selectedIds.has(r.id)));
			setTotal(prev => (prev ?? 0) - targets.length);
			// 2) ストレージはベストエフォート削除
			const paths = targets.map(t => t.path);
			const { error: sErr } = await supabase.storage.from(BUCKET).remove(paths);
			if (sErr && (sErr as any).statusCode !== 404) {
				console.warn('Bulk storage delete failed:', sErr.message);
			}
			// 3) 先頭から取り直し
			setSelectedIds(new Set());
			setOffset(0);
			setHasMore(true);
			await fetchPage(true);
		} catch (e: any) {
			alert(`一括削除に失敗: ${e?.message ?? 'Unknown error'}`);
		} finally {
			setBulkDeleting(false);
		}
	};

	const onLoadMore = async () => {
		await fetchPage(false);
	};

	const onDelete = async (row: PhotoRow) => {
		if (!userId || userId !== row.uploader_id) return;
		if (!confirm('この写真を削除しますか？')) return;
		setDeletingIds(prev => new Set(prev).add(row.id));
		// 1) DBの行を先に削除（確実に一覧から消す）
		const { error: dErr } = await supabase.from('photos').delete().eq('id', row.id);
		if (dErr) {
			alert(`DB削除に失敗: ${dErr.message}`);
			setDeletingIds(prev => {
				const n = new Set(prev);
				n.delete(row.id);
				return n;
			});
			return;
		}
		// UIから即時除去
		setRows(prev => prev.filter(r => r.id !== row.id));
		setTotal(prev => (prev ?? 1) - 1);
		// 2) ストレージはベストエフォートで削除（404は許容）
		const { error: sErr } = await supabase.storage.from(BUCKET).remove([row.path]);
		if (sErr && (sErr as any).statusCode !== 404) {
			console.warn('Storage delete failed:', sErr.message);
		}
		// 3) ページング整合を保つために先頭から取り直し
		setOffset(0);
		setHasMore(true);
		await fetchPage(true);
		setDeletingIds(prev => {
			const n = new Set(prev);
			n.delete(row.id);
			return n;
		});
	};

	if (loading && rows.length === 0) return <div className="muted">読み込み中...</div>;
	if (error) return <div className="muted">読み込みエラー: {error}</div>;
	// show header & search even if no rows so that filter can be cleared
	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
				<strong>写真一覧</strong>
				<span className="muted">{rows.length} / {total ?? rows.length} 枚</span>
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
				<button
					className="btn"
					type="button"
					onClick={bulkDelete}
					disabled={selectedIds.size === 0 || bulkDeleting}
				>
					{bulkDeleting ? '削除中...' : `選択削除 (${selectedIds.size})`}
				</button>
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
							<figure key={row.id} className="photo" style={{ position: 'relative' }}>
								<img src={url} alt={row.path} />
								<figcaption>
									<div className="photo-meta">
										<span className="uploader">{row.uploader_name}</span>
										<span className="date">{formatted}</span>
									</div>
									{canDelete && (
										<div className="row" style={{ justifyContent: 'flex-end' }}>
											<button
												type="button"
												className="btn"
												onClick={() => onDelete(row)}
												disabled={deletingIds.has(row.id)}
											>
												{deletingIds.has(row.id) ? '削除中...' : '削除'}
											</button>
										</div>
									)}
								</figcaption>
								{canDelete && (
									<input
										type="checkbox"
										checked={selectedIds.has(row.id)}
										onChange={() => toggleSelect(row)}
										aria-label="この写真を選択"
										style={{
											position: 'absolute',
											top: 6,
											left: 6,
											width: 18,
											height: 18
										}}
									/>
								)}
							</figure>
						);
					})}
				</div>
			)}
			{hasMore && (
				<div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
					<button className="btn" type="button" onClick={onLoadMore} disabled={loadingMore}>
						{loadingMore ? '読み込み中...' : 'さらに表示'}
					</button>
				</div>
			)}
		</div>
	);
}


