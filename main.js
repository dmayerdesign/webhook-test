/*
Goal: Create a webhook that is called by CH whenever a story's workflow state changes
from unstarted to started/done.

ClubhouseEvent {
    "id": string (uuid);
    "changed_at": string (Date);
    "primary_id": number (long);
    "version": string;
    "member_id": string (uuid);
    "actions": {
        "id": number (long);
        "entity_type": 'story'|'epic'|'milestone'|'project'|'workflow-state'|string;
        "action": 'update'|'create'|'delete';
        "name": string;
        "story_type": string;
        "app_url": string;
        "changes": {
            [key: string]: {
                new: any;
                old: any;
            }
        };
    }[];
    "references": {
        "id": number (long);
        "entity_type": string;
        "name": string;
        "type": string;
    }[];
}
*/
const https = require('https');

exports.handler = async (rawEvent) => {
    const event/*ClubhouseEvent*/ = JSON.parse(rawEvent.body);
    const epicWorkflow = await getClubhouseResource('epic-workflow');
    const allEpics = await getClubhouseResource('epics');
    const epicTodoStateId = epicWorkflow.epic_states.find((state) => state.name === 'to do').id;
    const epicInProgressStateId = epicWorkflow.epic_states.find((state) => state.name === 'in progress').id;

    // Define the conditions that make a side effect actionable based on the action received from CH.
    const sideEffectIsActionableFnMap = {
        updateEpicWhenStoryProgresses: (action) => {
            return (
                action.entity_type === 'story'
                && action.action === 'update'
                && !!action.changes.workflow_state_id
            );
        }
    };

    // Business logic.
    if (!!getActionForSideEffect('updateEpicWhenStoryProgresses')) {
        let idOfInProgressEpic = null;
        let idOfToDoEpic = null;
        allEpics.forEach((epic) => {
            if (epic.stats.num_stories_started > 0 || epic.stats.num_stories_done > 0) {
                idOfInProgressEpic = epic.id;
            } else if (epic.stats.num_stories_started === 0 && epic.stats.num_stories_done === 0) {
                idOfToDoEpic = epic.id;
            }
        });

        if (idOfInProgressEpic != null) {
            const epic = await getClubhouseResource(`epics/${idOfInProgressEpic}`);
            if (epic.epic_state_id === epicTodoStateId) {
                await updateClubhouseResource(`epics/${idOfInProgressEpic}`, { epic_state_id: epicInProgressStateId });
            }
        }
        if (idOfToDoEpic != null) {
            const epic = await getClubhouseResource(`epics/${idOfToDoEpic}`);
            if (epic.epic_state_id === epicInProgressStateId) {
                await updateClubhouseResource(`epics/${idOfToDoEpic}`, { epic_state_id: epicTodoStateId });
            }
        }
    }

    // Helper functions.
    function getClubhouseResource(resourceKey) {
        return new Promise((resolve, reject) => {
            https.get({
                host: 'api.clubhouse.io',
                path: `/api/v2/${resourceKey}?token=${process.env.CLUBHOUSE_API_TOKEN}`,
                headers: {
                    'content-type': 'application/json'
                }
            }, (res) => {
                res.on('data', (data) => {
                    resolve(JSON.parse(data.toString()));
                });
            });
        });
    }
    
    function updateClubhouseResource(resourceKey, payload) {
        const stringifiedBody = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
            https.request({
                method: 'PUT',
                host: 'api.clubhouse.io',
                path: `/api/v2/${resourceKey}?token=${process.env.CLUBHOUSE_API_TOKEN}`,
                headers: {
                    'content-type': 'application/json',
                    'content-length': stringifiedBody.length
                }
            }, (res) => {
                res.on('data', (data) => {
                    resolve(JSON.parse(data.toString()));
                });

                res.on('error', (err) => {
                    reject(err);
                });
            })
            .write(stringifiedBody);
        });
    }

    function getActionForSideEffect(sideEffectKey) {
        const isActionableFn = sideEffectIsActionableFnMap[sideEffectKey];
        return event.actions.find((action) => isActionableFn(action));
    }
    
    return event;
};
