import * as React from 'react';
import {useParams} from 'react-router-dom';
import {replaceDom} from '../../util/replace-dom';
import {usePublishing} from '../../store/use-publishing';
import {usePrefsContext} from '../../store/prefs';
import {ErrorMessage} from '../../components/error';

export const StoryTestRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [inited, setInited] = React.useState(false);
	const {passageId, storyId} = useParams<{
		passageId: string;
		storyId: string;
	}>();
	const {publishStory} = usePublishing();
	const {prefs} = usePrefsContext();

	React.useEffect(() => {
		async function load() {
			try {
				replaceDom(
					await publishStory(storyId, {
						formatOptions: prefs.testDebug ? 'debug' : '',
						startId: passageId
					})
				);
			} catch (error) {
				setPublishError(error as Error);
			}
		}

		if (!inited) {
			setInited(true);
			load();
		}
	}, [inited, passageId, publishStory, storyId]);

	if (publishError) {
		return <ErrorMessage>{publishError.message}</ErrorMessage>;
	}

	return null;
};
