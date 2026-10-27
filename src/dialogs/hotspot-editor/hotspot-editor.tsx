import {IconPlus, IconTrash, IconWriting} from '@tabler/icons';
import * as React from 'react';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {
	createUntitledPassage,
	passageDefaults,
	passageWithId,
	storyWithId,
	updatePassage
} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {unusedName} from '../../util/unused-name';
import {firstImageName, imagePublicUrl} from '../../util/twine-images';
import {Hotspot, parseHotspots, writeHotspots} from '../../util/hotspots';
import {addPassageEditors, useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import './hotspot-editor.css';

// Value used for the "new scene" entry in a destination dropdown.
const NEW_SCENE = '__new__';

export interface HotspotEditorDialogProps extends DialogComponentProps {
	passageId: string;
	storyId: string;
}

// Distinct colours so overlapping regions stay tellable apart, cycled by index.
export const HOTSPOT_COLORS = [
	'#e8603c',
	'#3c8ae8',
	'#4caf50',
	'#c158d6',
	'#e0a800',
	'#2bb3a3'
];

// Ignore accidental tiny rectangles from a stray click-drag.
const MIN_SIZE = 0.03;

type Drag =
	| {mode: 'new'; x0: number; y0: number; x1: number; y1: number}
	| {mode: 'move'; index: number; grabX: number; grabY: number}
	| {mode: 'resize'; index: number}
	| null;

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

export const HotspotEditorDialog: React.FC<
	HotspotEditorDialogProps
> = props => {
	const {passageId, storyId, ...other} = props;
	const {dispatch, stories} = useUndoableStoriesContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const story = storyWithId(stories, storyId);
	const passage = passageWithId(stories, storyId, passageId);
	const imageName = firstImageName(passage.text);

	const [hotspots, setHotspots] = React.useState<Hotspot[]>(() =>
		parseHotspots(passage.text)
	);
	const [selected, setSelected] = React.useState<number | null>(null);
	const [drag, setDrag] = React.useState<Drag>(null);
	const overlayRef = React.useRef<HTMLDivElement>(null);

	// The working set is the source of truth while the dialog is open; a ref
	// lets mouse-up commit the latest without a stale closure.
	const hotspotsRef = React.useRef(hotspots);
	hotspotsRef.current = hotspots;

	const passageNames = React.useMemo(
		() => story.passages.map(p => p.name).sort((a, b) => a.localeCompare(b)),
		[story.passages]
	);

	// Write the current hotspots back into passage text. Reads the passage fresh
	// so any narrative edits made in the main editor meanwhile are preserved.
	const commit = React.useCallback(
		(next: Hotspot[]) => {
			const current = passageWithId(stories, storyId, passageId);

			// Only write hotspots that actually have a target. A freshly-drawn or
			// label-only region lives in local state until a scene is chosen, so no
			// half-formed [[link]] (e.g. [[The cen->]]) is ever written — which is
			// what made Twine spawn a junk node per keystroke. dontUpdateOthers is a
			// second guard: even the real links we write point at existing passages,
			// so Twine must never auto-create from them.
			const linked = next.filter(h => h.target.trim() !== '');

			dispatch(
				updatePassage(
					story,
					current,
					{text: writeHotspots(current.text, linked)},
					{dontUpdateOthers: true}
				)
			);
		},
		[dispatch, passageId, stories, story, storyId]
	);

	function update(next: Hotspot[]) {
		setHotspots(next);
		commit(next);
	}

	function pointerFraction(event: React.MouseEvent): {fx: number; fy: number} {
		const rect = overlayRef.current?.getBoundingClientRect();

		if (!rect || rect.width === 0 || rect.height === 0) {
			return {fx: 0, fy: 0};
		}

		return {
			fx: clamp01((event.clientX - rect.left) / rect.width),
			fy: clamp01((event.clientY - rect.top) / rect.height)
		};
	}

	function handleOverlayMouseDown(event: React.MouseEvent) {
		// Only start a new region when the drag begins on empty image, not on an
		// existing box or handle (those set their own drag mode).
		if (event.target !== overlayRef.current) {
			return;
		}

		const {fx, fy} = pointerFraction(event);

		setSelected(null);
		setDrag({mode: 'new', x0: fx, y0: fy, x1: fx, y1: fy});
	}

	function handleMouseMove(event: React.MouseEvent) {
		if (!drag) {
			return;
		}

		const {fx, fy} = pointerFraction(event);

		if (drag.mode === 'new') {
			setDrag({...drag, x1: fx, y1: fy});
		} else if (drag.mode === 'move') {
			setHotspots(current =>
				current.map((h, i) =>
					i === drag.index
						? {
								...h,
								x: clamp01(Math.min(fx - drag.grabX, 1 - h.width)),
								y: clamp01(Math.min(fy - drag.grabY, 1 - h.height))
						  }
						: h
				)
			);
		} else if (drag.mode === 'resize') {
			setHotspots(current =>
				current.map((h, i) =>
					i === drag.index
						? {
								...h,
								width: clamp01(Math.max(MIN_SIZE, fx - h.x)),
								height: clamp01(Math.max(MIN_SIZE, fy - h.y))
						  }
						: h
				)
			);
		}
	}

	function endDrag() {
		if (!drag) {
			return;
		}

		if (drag.mode === 'new') {
			const x = Math.min(drag.x0, drag.x1);
			const y = Math.min(drag.y0, drag.y1);
			const width = Math.abs(drag.x1 - drag.x0);
			const height = Math.abs(drag.y1 - drag.y0);

			setDrag(null);

			if (width < MIN_SIZE || height < MIN_SIZE) {
				return;
			}

			const next = [
				...hotspotsRef.current,
				{x, y, width, height, label: '', target: ''}
			];

			update(next);
			setSelected(next.length - 1);
		} else {
			setDrag(null);
			commit(hotspotsRef.current);
		}
	}

	function patch(index: number, changes: Partial<Hotspot>) {
		update(
			hotspotsRef.current.map((h, i) => (i === index ? {...h, ...changes} : h))
		);
	}

	function remove(index: number) {
		update(hotspotsRef.current.filter((_, i) => i !== index));
		setSelected(null);
	}

	// Create a new scene and point this hotspot at it. The name matches what
	// createUntitledPassage will assign (same unusedName call), so the target
	// resolves immediately; the author then fills the scene in via "Edit scene".
	function createScene(index: number) {
		const newName = unusedName(
			passageDefaults().name,
			story.passages.map(p => p.name)
		);

		dispatch(
			createUntitledPassage(
				story,
				passage.left + passage.width * 1.5,
				passage.top + passage.height / 2
			)
		);
		patch(index, {target: newName});
	}

	// Open the hotspot's destination scene in the passage editor to write it.
	function editScene(target: string) {
		const dest = story.passages.find(p => p.name === target);

		if (dest) {
			dialogsDispatch(addPassageEditors(story.id, [dest.id]));
		}
	}

	function handleTargetChange(index: number, value: string) {
		if (value === NEW_SCENE) {
			createScene(index);
		} else {
			patch(index, {target: value});
		}
	}

	return (
		<DialogCard
			{...other}
			className="hotspot-editor-dialog"
			headerLabel="Image hotspots"
			maximizable
		>
			<p className="hotspot-editor-hint">
				Drag on the image to draw a clickable region, then choose which scene
				it leads to. Players (and you, below) see a labelled box they can tap —
				no coordinates to type.
			</p>
			{!imageName ? (
				<p className="hotspot-editor-empty">
					This passage has no image yet. Add one with the{' '}
					<strong>Images</strong> button first — hotspots sit on top of a
					scene image.
				</p>
			) : (
				<div className="hotspot-editor-body">
					<div
						className="hotspot-editor-stage"
						onMouseLeave={endDrag}
						onMouseMove={handleMouseMove}
						onMouseUp={endDrag}
					>
						<img
							alt={imageName}
							draggable={false}
							src={imagePublicUrl(story.id, imageName)}
						/>
						<div
							className="hotspot-editor-overlay"
							onMouseDown={handleOverlayMouseDown}
							ref={overlayRef}
						>
							{hotspots.map((h, i) => {
								const color = HOTSPOT_COLORS[i % HOTSPOT_COLORS.length];
								const missing = !h.target || !passageNames.includes(h.target);

								return (
									<div
										className={
											'hotspot-box' +
											(i === selected ? ' selected' : '') +
											(missing ? ' missing' : '')
										}
										key={i}
										onMouseDown={event => {
											event.stopPropagation();
											const {fx, fy} = pointerFraction(event);

											setSelected(i);
											setDrag({
												mode: 'move',
												index: i,
												grabX: fx - h.x,
												grabY: fy - h.y
											});
										}}
										style={{
											borderColor: color,
											background: `${color}33`,
											left: `${h.x * 100}%`,
											top: `${h.y * 100}%`,
											width: `${h.width * 100}%`,
											height: `${h.height * 100}%`
										}}
									>
										<span
											className="hotspot-box-badge"
											style={{background: color}}
										>
											{i + 1}
										</span>
										<span
											className="hotspot-box-handle"
											onMouseDown={event => {
												event.stopPropagation();
												setSelected(i);
												setDrag({mode: 'resize', index: i});
											}}
											style={{background: color}}
										/>
									</div>
								);
							})}
							{drag?.mode === 'new' && (
								<div
									className="hotspot-box drafting"
									style={{
										left: `${Math.min(drag.x0, drag.x1) * 100}%`,
										top: `${Math.min(drag.y0, drag.y1) * 100}%`,
										width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
										height: `${Math.abs(drag.y1 - drag.y0) * 100}%`
									}}
								/>
							)}
						</div>
					</div>
					<div className="hotspot-editor-list">
						{hotspots.length === 0 ? (
							<p className="hotspot-editor-empty">
								No regions yet. Drag a box on the image to add one.
							</p>
						) : (
							hotspots.map((h, i) => {
								const color = HOTSPOT_COLORS[i % HOTSPOT_COLORS.length];
								const missing = !!h.target && !passageNames.includes(h.target);

								return (
									<div
										className={
											'hotspot-row' + (i === selected ? ' selected' : '')
										}
										key={i}
										onMouseEnter={() => setSelected(i)}
									>
										<span
											className="hotspot-row-badge"
											style={{background: color}}
										>
											{i + 1}
										</span>
										<div className="hotspot-row-fields">
											<select
												aria-label={`Region ${i + 1} destination`}
												className={missing ? 'missing' : undefined}
												onChange={event =>
													handleTargetChange(i, event.target.value)
												}
												value={
													h.target && !passageNames.includes(h.target)
														? '__missing__'
														: h.target
												}
											>
												<option value={NEW_SCENE}>＋ New scene…</option>
												<option value="">— choose a scene —</option>
												{h.target && !passageNames.includes(h.target) && (
													<option value="__missing__" disabled>
														{h.target} (missing)
													</option>
												)}
												{passageNames.map(name => (
													<option key={name} value={name}>
														{name}
													</option>
												))}
											</select>
										</div>
										{h.target && passageNames.includes(h.target) ? (
											<IconButton
												icon={<IconWriting />}
												iconOnly
												label="Edit scene"
												onClick={() => editScene(h.target)}
											/>
										) : (
											<IconButton
												icon={<IconPlus />}
												iconOnly
												label="New scene"
												onClick={() => createScene(i)}
											/>
										)}
										<IconButton
											icon={<IconTrash />}
											iconOnly
											label="Remove region"
											onClick={() => remove(i)}
											variant="danger"
										/>
									</div>
								);
							})
						)}
					</div>
				</div>
			)}
		</DialogCard>
	);
};
