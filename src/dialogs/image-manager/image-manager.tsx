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

// Full images and thumbnails are each downscaled to these widths before upload
// (aspect ratio preserved; never upscaled). All resizing happens in the browser
// via canvas, so the backend never needs an image library.
// Uploaded images are converted to WebP and downscaled: the full image to at
// most FULL_MAX_WIDTH, the thumbnail to THUMB_WIDTH (aspect ratio preserved,
// never upscaled). WebP quality steps down until each version is under its byte
// target, so storage stays bounded even for large inputs.
const FULL_MAX_WIDTH = 600;
const THUMB_WIDTH = 100;
const FULL_TARGET_BYTES = 200 * 1024;
const THUMB_TARGET_BYTES = 20 * 1024;
const FULL_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5];
const THUMB_QUALITIES = [0.8, 0.7, 0.6];
// Output format for stored images. WebP is ~25-35% smaller than JPEG at equal
// quality and needs no transparency here; switch to 'image/jpeg' if ever needed.
const IMAGE_TYPE = 'image/webp';

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const el = new Image();
		el.onload = () => resolve(el);
		el.onerror = reject;
		el.src = url;
	});
}

function canvasBlob(
	img: HTMLImageElement,
	w: number,
	h: number,
	type: string,
	quality: number
): Promise<Blob | null> {
	const canvas = document.createElement('canvas');

	canvas.width = w;
	canvas.height = h;
	canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);

	return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Encodes the image at the given size, stepping quality down until the result
// is under targetBytes. Returns the smallest blob produced if none fits.
async function encodeUnderSize(
	img: HTMLImageElement,
	w: number,
	h: number,
	targetBytes: number,
	qualities: number[]
): Promise<Blob | null> {
	let smallest: Blob | null = null;

	for (const quality of qualities) {
		const blob = await canvasBlob(img, w, h, IMAGE_TYPE, quality);

		if (!blob) {
			continue;
		}

		if (!smallest || blob.size < smallest.size) {
			smallest = blob;
		}

		if (blob.size <= targetBytes) {
			return blob;
		}
	}

	return smallest;
}

// Returns the full image (downscaled to FULL_MAX_WIDTH and size-capped) plus a
// small thumbnail, both re-encoded to IMAGE_TYPE. Falls back to the original
// file if the browser can't decode or encode it.
async function processImage(
	file: File
): Promise<{full: Blob; thumb: Blob | null}> {
	const url = URL.createObjectURL(file);

	try {
		const img = await loadImage(url);

		const fullScale = Math.min(1, FULL_MAX_WIDTH / img.naturalWidth);
		const full =
			(await encodeUnderSize(
				img,
				Math.max(1, Math.round(img.naturalWidth * fullScale)),
				Math.max(1, Math.round(img.naturalHeight * fullScale)),
				FULL_TARGET_BYTES,
				FULL_QUALITIES
			)) ?? file;

		const thumbScale = Math.min(1, THUMB_WIDTH / img.naturalWidth);
		const thumb = await encodeUnderSize(
			img,
			Math.max(1, Math.round(img.naturalWidth * thumbScale)),
			Math.max(1, Math.round(img.naturalHeight * thumbScale)),
			THUMB_TARGET_BYTES,
			THUMB_QUALITIES
		);

		return {full, thumb};
	} catch {
		return {full: file, thumb: null};
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
				const {full, thumb} = await processImage(file);
				const form = new FormData();

				form.append('file', full, file.name);
				form.append('filename', file.name);

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
					accept="image/jpeg,image/png,image/webp"
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
