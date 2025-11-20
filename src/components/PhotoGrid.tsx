'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import React from 'react';
import { supabase } from '@/lib/supabaseClient';

const BUCKET = 'tomomi-photos';
const PAGE_SIZE = 20;

type PhotoRow = {
	id: string;
	path: string;
	uploader_id: string;
	uploader_name: string;
	uploaded_at: string;
	favorite_rody_with_lucy?: boolean;
	favorite_kenji_sato?: boolean;
};

export default function PhotoGrid() {
	const [rows, setRows] = useState<PhotoRow[]>([]);
	// rows から導出される重い値（publicUrl, 日付フォーマット）は rows 変更時のみ計算
	const derivedRows = useMemo(() => {
		return rows.map(r => {
			const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(r.path);
			const url = urlData.publicUrl;
			const date = new Date(r.uploaded_at);
			const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
			return { ...r, _publicUrl: url, _formatted: formatted };
		});
	}, [rows]);
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
	// 共通選択
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkDeleting, setBulkDeleting] = useState(false);
	// ダウンロード進行状態
	const [bulkDownloading, setBulkDownloading] = useState(false);
	// 拡大モーダル
	const [modalPhoto, setModalPhoto] = useState<{ id: string; url: string; path: string } | null>(null);
	// お気に入り（限定ユーザー）
	const [userName, setUserName] = useState<string | null>(null);
	// モードは廃止（常時チェック可能、両ボタン同時利用可）
	const [favoriteSaving, setFavoriteSaving] = useState(false);
	const favoriteAllowedNames = useMemo(() => ['Rody with Lucy', '佐藤健二'], []);
	const canUseFavorite = useMemo(() => {
		const n = (userName ?? '').trim();
		return favoriteAllowedNames.includes(n);
	}, [userName, favoriteAllowedNames]);
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		if (typeof navigator === 'undefined') return;
		const ua = navigator.userAgent || '';
		const mobile = /Android.*Mobile|iPhone|iPad|iPod|Windows Phone/i.test(ua);
		setIsMobile(mobile);
	}, []);
	const favoriteCount = useMemo(() => {
		if (!canUseFavorite) return 0;
		if (userName === 'Rody with Lucy') {
			return rows.filter(r => !!r.favorite_rody_with_lucy).length;
		}
		if (userName === '佐藤健二') {
			return rows.filter(r => !!r.favorite_kenji_sato).length;
		}
		return 0;
	}, [rows, canUseFavorite, userName]);

	useEffect(() => {
		let mounted = true;
		supabase.auth.getUser().then(({ data }) => {
			if (mounted) setUserId(data.user?.id ?? null);
			const meta = data.user?.user_metadata as any;
			const dn = (meta?.name ?? meta?.full_name ?? meta?.display_name ?? data.user?.email ?? '').trim();
			if (mounted) setUserName(dn || null);
		});
		const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
			setUserId(session?.user?.id ?? null);
			const meta = session?.user?.user_metadata as any;
			const dn = (meta?.name ?? meta?.full_name ?? meta?.display_name ?? session?.user?.email ?? '').trim();
			setUserName(dn || null);
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
			.select('id, path, uploader_id, uploader_name, uploaded_at, favorite_rody_with_lucy, favorite_kenji_sato', includeCount ? { count: 'exact' } as any : {} as any);

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
	// 以前の「条件解除」ボタンは仕様変更により廃止

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
		setSelectedIds(prev => {
			const n = new Set(prev);
			if (n.has(row.id)) n.delete(row.id);
			else n.add(row.id);
			return n;
		});
	};

	// ダウンロード選択モードは廃止（常時選択された写真に対して実行）

	const downloadBlob = async (url: string, filename: string) => {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
		const blob = await res.blob();
		const objectUrl = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = objectUrl;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(objectUrl);
	};

	const onBulkDownload = async () => {
		if (isMobile) {
			alert('スマホでは写真を長押しして保存してください。');
			return;
		}
		if (selectedIds.size === 0) return;
		const selected = rows.filter(r => selectedIds.has(r.id));
		if (selected.length === 0) return;
		let targets = selected;
		if (selected.length > 30) {
			alert(`一度にダウンロードできるのは30件までです。先頭30件をダウンロードします。`);
			targets = selected.slice(0, 30);
		}
		setBulkDownloading(true);
		try {
			for (const t of targets) {
				const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(t.path);
				const publicUrl = urlData.publicUrl;
				const filename = t.path.split('/').pop() || `${t.id}.jpg`;
				// 連続ダウンロードはブラウザによって制限されることがあるため逐次実行
				// 短い待機を入れて失敗率を下げる
				// eslint-disable-next-line no-await-in-loop
				await downloadBlob(publicUrl, filename);
				// eslint-disable-next-line no-await-in-loop
				await new Promise(r => setTimeout(r, 100));
			}
			alert('ダウンロードが完了しました');
			setSelectedIds(new Set());
		} catch (e: any) {
			alert(`ダウンロードに失敗しました: ${e?.message ?? 'Unknown error'}`);
		} finally {
			setBulkDownloading(false);
		}
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

	// お気に入り選択モードは廃止（常時選択された写真に対して実行）

	const onFavoriteSave = async () => {
		if (!canUseFavorite || selectedIds.size === 0) return;
		const columnName =
			(userName === 'Rody with Lucy')
				? 'favorite_rody_with_lucy'
				: (userName === '佐藤健二')
					? 'favorite_kenji_sato'
					: null;
		if (!columnName) return;
		const ids = Array.from(selectedIds);
		setFavoriteSaving(true);
		try {
			const { error } = await supabase.from('photos')
				.update({ [columnName]: true } as any)
				.in('id', ids);
			if (error) throw error;
			setRows(prev => prev.map(r => {
				if (selectedIds.has(r.id)) {
					return { ...r, [columnName]: true } as PhotoRow;
				}
				return r;
			}));
			setSelectedIds(new Set());
			alert('お気に入りに保存しました');
		} catch (e: any) {
			alert(`お気に入り保存に失敗しました: ${e?.message ?? 'Unknown error'}`);
		} finally {
			setFavoriteSaving(false);
		}
	};

	const onLoadMore = async () => {
		await fetchPage(false);
	};

	const onUnfavorite = async (row: PhotoRow) => {
		if (!canUseFavorite) return;
		const columnName =
			(userName === 'Rody with Lucy')
				? 'favorite_rody_with_lucy'
				: (userName === '佐藤健二')
					? 'favorite_kenji_sato'
					: null;
		if (!columnName) return;
		if (!confirm('この写真のお気に入りを解除しますか？')) return;
		try {
			const { error } = await supabase.from('photos')
				.update({ [columnName]: false } as any)
				.eq('id', row.id);
			if (error) throw error;
			setRows(prev => prev.map(r => {
				if (r.id === row.id) {
					return { ...r, [columnName]: false } as PhotoRow;
				}
				return r;
			}));
			alert('お気に入りを解除しました');
		} catch (e: any) {
			alert(`お気に入り解除に失敗しました: ${e?.message ?? 'Unknown error'}`);
		}
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

	const onImageClick = (row: PhotoRow) => {
		const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(row.path);
		const url = urlData.publicUrl;
		setModalPhoto({ id: row.id, url, path: row.path });
	};

	const closeModal = () => setModalPhoto(null);

	const onModalDownload = async () => {
		if (!modalPhoto) return;
		try {
			const filename = modalPhoto.path.split('/').pop() || `${modalPhoto.id}.jpg`;
			await downloadBlob(modalPhoto.url, filename);
		} catch (e: any) {
			alert(`ダウンロードに失敗しました: ${e?.message ?? 'Unknown error'}`);
		}
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
				{/* アクション行 */}
				<div style={{ flexBasis: '100%', height: 0 }} />
				{!isMobile && (
					<button
						className="btn"
						type="button"
						onClick={onBulkDownload}
						disabled={selectedIds.size === 0 || bulkDownloading}
					>
						{bulkDownloading ? 'ダウンロード中...' : `ダウンロード (${selectedIds.size})`}
					</button>
				)}
				{canUseFavorite && (
					<>
						<button
							className="btn"
							type="button"
							onClick={onFavoriteSave}
							disabled={selectedIds.size === 0 || favoriteSaving}
						>
							{favoriteSaving ? '保存中...' : `お気に入り保存 (${selectedIds.size})`}
						</button>
						<span
							className="muted"
							style={{ marginLeft: 6, fontSize: 11, whiteSpace: 'nowrap' }}
							aria-label="現在のお気に入り件数"
						>
							お気に入り{favoriteCount}件
						</span>
					</>
				)}
			</form>
			{(rows.length === 0 && !loading) ? (
				<div className="muted">該当する写真がありません。</div>
			) : (
				<div className="grid">
					{derivedRows.map((row) => {
						const url = (row as any)._publicUrl as string;
						const formatted = (row as any)._formatted as string;
						const canDelete = !!(userId && userId === row.uploader_id);
						const isFavoritedForCurrentUser = canUseFavorite && (
							(userName === 'Rody with Lucy' && !!row.favorite_rody_with_lucy) ||
							(userName === '佐藤健二' && !!row.favorite_kenji_sato)
						);
						const showCheckbox = ((!isMobile) || (isMobile && canUseFavorite));
						return (
							<PhotoItem
								key={row.id}
								row={row}
								url={url}
								formatted={formatted}
								canDelete={canDelete}
								isFavorited={isFavoritedForCurrentUser}
								selected={selectedIds.has(row.id)}
								deleting={deletingIds.has(row.id)}
								showCheckbox={showCheckbox}
								onImageClick={onImageClick}
								onDelete={onDelete}
								onToggleSelect={toggleSelect}
								onUnfavorite={onUnfavorite}
							/>
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

			{modalPhoto && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="写真を拡大表示"
					onClick={closeModal}
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.75)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 1000,
						padding: 12
					}}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							background: '#111',
							borderRadius: 8,
							maxWidth: '90vw',
							maxHeight: '90vh',
							display: 'grid',
							gap: 8,
							padding: 8
						}}
					>
						<img
							src={modalPhoto.url}
							alt={modalPhoto.path}
							style={{ maxWidth: '86vw', maxHeight: '78vh', objectFit: 'contain' }}
						/>
						<div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
							{isMobile ? (
								<span className="muted" style={{ fontSize: 12 }}>長押しで保存できます</span>
							) : (
								<span />
							)}
							<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
								{!isMobile && (
									<button className="btn" type="button" onClick={onModalDownload}>ダウンロード</button>
								)}
								<button className="btn" type="button" onClick={closeModal}>閉じる</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}


type PhotoItemProps = {
	row: PhotoRow;
	url: string;
	formatted: string;
	canDelete: boolean;
	isFavorited: boolean;
	selected: boolean;
	deleting: boolean;
	showCheckbox: boolean;
	onImageClick: (row: PhotoRow) => void;
	onDelete: (row: PhotoRow) => void;
	onToggleSelect: (row: PhotoRow) => void;
	onUnfavorite: (row: PhotoRow) => void;
};

const PhotoItem = React.memo<PhotoItemProps>(function PhotoItem({
	row,
	url,
	formatted,
	canDelete,
	isFavorited,
	selected,
	deleting,
	showCheckbox,
	onImageClick,
	onDelete,
	onToggleSelect,
	onUnfavorite
}: PhotoItemProps) {
	return (
		<figure className="photo" style={{ position: 'relative' }}>
			<img
				src={url}
				alt={row.path}
				onClick={() => onImageClick(row)}
				style={{ cursor: 'zoom-in' }}
			/>
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
							onClick={(e) => { e.stopPropagation(); onDelete(row); }}
							disabled={deleting}
						>
							{deleting ? '削除中...' : '削除'}
						</button>
					</div>
				)}
			</figcaption>
			{showCheckbox && (
				<input
					type="checkbox"
					checked={selected}
					onChange={(e) => { e.stopPropagation(); onToggleSelect(row); }}
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
			{isFavorited && (
				<button
					type="button"
					onClick={(e) => { e.stopPropagation(); onUnfavorite(row); }}
					aria-label="お気に入りを解除"
					style={{
						position: 'absolute',
						top: 6,
						right: 6,
						background: '#f5a623',
						color: '#fff',
						fontSize: 10,
						padding: '2px 6px',
						borderRadius: 10,
						border: 'none',
						cursor: 'pointer',
						boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
					}}
				>
					favorite
				</button>
			)}
		</figure>
	);
}, (prev: PhotoItemProps, next: PhotoItemProps) => {
	return (
		prev.selected === next.selected &&
		prev.deleting === next.deleting &&
		prev.isFavorited === next.isFavorited &&
		prev.canDelete === next.canDelete &&
		prev.url === next.url &&
		prev.formatted === next.formatted &&
		prev.showCheckbox === next.showCheckbox &&
		prev.row.id === next.row.id &&
		prev.row.uploader_name === next.row.uploader_name
	);
});

