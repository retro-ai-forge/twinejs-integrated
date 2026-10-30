import {IconTrash, IconUpload} from '@tabler/icons';
import * as React from 'react';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {imagesApiBase} from '../../util/twine-images';
import {DialogComponentProps} from '../dialogs.types';
import './image-manager.css';

export interface ImageManagerDialogProps extends DialogComponentProps {
	storyId: string;
}

interface StoryImage {
	filename: string;
	url: string;
	thumbUrl: string;
	size?: number;
	updated?: string | null;
}

const THUMB_MAX = 160;

// Resize an image file to a small WebP thumbnail in the browser, so the backend
// never needs an image library. Falls back to null if the browser can't decode.
async function makeThumbnail(file: File): Promise<Blob | null> {
	const url = URL.createObjectURL(file);

	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = reject;
			el.src = url;
		});
		const scale = Math.min(1, THUMB_MAX / Math.max(img.width, img.height));
		const w = Math.max(1, Math.round(img.width * scale));
		const h = Math.max(1, Math.round(img.height * scale));
		const canvas = document.createElement('canvas');

		canvas.width = w;
		canvas.height = h;
		canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);

		return await new Promise<Blob | null>(resolve =>
			canvas.toBlob(resolve, 'image/webp', 0.8)
		);
	} catch {
		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export const ImageManagerDialog: React.FC<ImageManagerDialogProps> = props => {
	const {storyId, ...other} = props;
	const apiBase = imagesApiBase(storyId);
	const [images, setImages] = React.useState<StoryImage[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const [copied, setCopied] = React.useState<string>();
	const fileInput = React.useRef<HTMLInputElement>(null);

	const refresh = React.useCallback(async () => {
		setLoading(true);
		setError(undefined);

		try {
			const res = await fetch(apiBase, {credentials: 'include'});

			if (!res.ok) {
				throw new Error(`Could not load images (${res.status})`);
			}

			setImages(await res.json());
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setLoading(false);
		}
	}, [apiBase]);

	React.useEffect(() => {
		refresh();
	}, [refresh]);

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) {
			return;
		}

		setBusy(true);
		setError(undefined);

		try {
			for (const file of Array.from(files)) {
				const form = new FormData();

				form.append('file', file, file.name);
				form.append('filename', file.name);

				const thumb = await makeThumbnail(file);

				if (thumb) {
					form.append('thumb', thumb, 'thumb.webp');
				}

				const res = await fetch(apiBase, {
					method: 'POST',
					credentials: 'include',
					body: form
				});

				if (!res.ok) {
					const detail = await res.json().catch(() => ({}));
					throw new Error(detail.detail || `Upload failed (${res.status})`);
				}
			}

			await refresh();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);

			if (fileInput.current) {
				fileInput.current.value = '';
			}
		}
	}

	async function handleDelete(filename: string) {
		if (!window.confirm(`Delete "${filename}"? Passages using it will break.`)) {
			return;
		}

		setBusy(true);
		setError(undefined);

		try {
			const res = await fetch(`${apiBase}/${encodeURIComponent(filename)}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!res.ok) {
				throw new Error(`Delete failed (${res.status})`);
			}

			await refresh();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function handleCopy(filename: string) {
		try {
			await navigator.clipboard.writeText(filename);
			setCopied(filename);
			window.setTimeout(() => setCopied(undefined), 1500);
		} catch {
			// Clipboard may be unavailable; ignore.
		}
	}

	return (
		<DialogCard
			{...other}
			className="image-manager-dialog"
			headerLabel="Story images"
			maximizable
		>
			<div className="image-manager-toolbar">
				<IconButton
					disabled={busy}
					icon={<IconUpload />}
					label={busy ? 'Working…' : 'Upload image'}
					onClick={() => fileInput.current?.click()}
					variant="primary"
				/>
				<input
					accept="image/jpeg,image/png,image/webp,image/gif"
					hidden
					multiple
					onChange={event => handleFiles(event.target.files)}
					ref={fileInput}
					type="file"
				/>
			</div>
			{error && <p className="image-manager-error">{error}</p>}
			<p className="image-manager-hint">
				Click a filename to copy it, then paste into a passage as
				<code> [img[filename]]</code>.
			</p>
			{loading ? (
				<p>Loading…</p>
			) : images.length === 0 ? (
				<p className="image-manager-empty">No images uploaded yet.</p>
			) : (
				<ul className="image-manager-list">
					{images.map(image => (
						<li key={image.filename}>
							<img alt={image.filename} src={image.thumbUrl} />
							<button
								className="image-manager-name"
								onClick={() => handleCopy(image.filename)}
								title="Click to copy filename"
								type="button"
							>
								{copied === image.filename ? 'Copied!' : image.filename}
							</button>
							<IconButton
								disabled={busy}
								icon={<IconTrash />}
								label="Remove"
								iconOnly
								onClick={() => handleDelete(image.filename)}
								variant="danger"
							/>
						</li>
					))}
				</ul>
			)}
		</DialogCard>
	);
};
