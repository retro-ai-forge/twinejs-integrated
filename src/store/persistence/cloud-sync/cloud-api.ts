import {Passage, Story} from '../../stories/stories.types';

export interface CloudStoryMeta {
	storyId: string;
	ifid: string;
	name: string;
	lastUpdate: string;
	sizeBytes?: number;
}

export interface CloudStoryFull extends CloudStoryMeta {
	storyData: Record<string, unknown>;
	passages: Passage[];
}

function storyToPayload(story: Story): CloudStoryFull {
	return {
		storyId: story.id,
		ifid: story.ifid,
		name: story.name,
		lastUpdate: story.lastUpdate
			? story.lastUpdate.toISOString()
			: new Date().toISOString(),
		storyData: {
			storyFormat: story.storyFormat,
			storyFormatVersion: story.storyFormatVersion,
			startPassage: story.startPassage,
			stylesheet: story.stylesheet,
			script: story.script,
			tags: story.tags,
			tagColors: story.tagColors,
			snapToGrid: story.snapToGrid,
			zoom: story.zoom
		},
		passages: story.passages.map(p => ({
			id: p.id,
			name: p.name,
			text: p.text,
			tags: p.tags,
			left: p.left,
			top: p.top,
			width: p.width,
			height: p.height,
			story: p.story,
			highlighted: false,
			selected: false
		}))
	};
}

export function cloudStoryToLocal(cloud: CloudStoryFull): Story {
	const data = cloud.storyData || {};
	return {
		id: cloud.storyId,
		ifid: cloud.ifid,
		name: cloud.name,
		lastUpdate: cloud.lastUpdate
			? new Date(cloud.lastUpdate)
			: new Date(),
		storyFormat: (data.storyFormat as string) || '',
		storyFormatVersion: (data.storyFormatVersion as string) || '',
		startPassage: (data.startPassage as string) || '',
		stylesheet: (data.stylesheet as string) || '',
		script: (data.script as string) || '',
		tags: (data.tags as string[]) || [],
		tagColors: (data.tagColors as Record<string, any>) || {},
		snapToGrid: (data.snapToGrid as boolean) ?? true,
		zoom: (data.zoom as number) || 1,
		selected: false,
		passages: (cloud.passages || []).map(p => ({
			id: p.id,
			name: p.name,
			text: p.text,
			tags: p.tags || [],
			left: p.left || 0,
			top: p.top || 0,
			width: p.width || 100,
			height: p.height || 100,
			story: p.story || cloud.storyId,
			highlighted: false,
			selected: false
		}))
	};
}

const API_BASE = '/api/auth/me/twine-stories';

async function apiFetch<T>(
	path: string,
	options?: RequestInit
): Promise<T | null> {
	try {
		const res = await fetch(`${API_BASE}${path}`, {
			credentials: 'include',
			...options
		});
		if (res.status === 401) return null;
		if (!res.ok) {
			console.warn(`[cloud-sync] ${res.status} ${res.statusText} for ${path}`);
			return null;
		}
		return res.json();
	} catch (err) {
		console.warn('[cloud-sync] fetch error:', err);
		return null;
	}
}

export async function cloudListStories(): Promise<CloudStoryMeta[] | null> {
	return apiFetch<CloudStoryMeta[]>('');
}

export async function cloudGetStory(
	storyId: string
): Promise<CloudStoryFull | null> {
	return apiFetch<CloudStoryFull>(`/${encodeURIComponent(storyId)}`);
}

export async function cloudSaveStory(
	story: Story
): Promise<{ok: boolean; storyId: string; sizeBytes: number} | null> {
	const payload = storyToPayload(story);
	return apiFetch(`/${encodeURIComponent(story.id)}`, {
		method: 'PUT',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(payload)
	});
}

export async function cloudDeleteStory(
	storyId: string
): Promise<{ok: boolean} | null> {
	return apiFetch(`/${encodeURIComponent(storyId)}`, {method: 'DELETE'});
}
