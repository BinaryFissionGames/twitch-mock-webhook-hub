import * as makeError from 'http-errors';
import * as assert from 'assert';
import {TopicToWebhookType} from "./events";

type HubSubscriptionRequest = {
    'hub.callback': string;
    'hub.mode': string;
    'hub.topic': string;
    'hub.lease_seconds': number;
    'hub.secret': string;
};

function validateHubSubscriptionRequest(request: HubSubscriptionRequest) {
    try {
        //Attempt to parse the URL; Should error out if the URL is malformed.
        new URL(request['hub.callback']);
    } catch (e) {
        throw makeError(400, `Cannot parse hub callback (${request['hub.callback']})`)
    }
    assert.ok(request['hub.mode'] === 'subscribe' || request['hub.mode'] === 'unsubscribe', makeError(400, `hub.mode is '${request['hub.mode']}', but must be subscribe or unsubscribe`));

    const topicUrl = new URL(request['hub.topic']);
    assert.ok(TopicToWebhookType.has(topicUrl.origin + topicUrl.pathname), makeError(400, `'${request['hub.topic']}' is not a valid topic.`));
    assert.ok(typeof request['hub.lease_seconds'] === "number" && request['hub.lease_seconds'] >= 0 && request['hub.lease_seconds'] <= 864000, makeError(400, 'Lease seconds must be between 0 and 864000, inclusive.'));
    //Note: Using Buffer.from here; Strings may contain multi-byte characters, but the spec makes it clear that we are considering BYTES, not CHARACTERS.
    assert.ok(typeof request['hub.secret'] === 'string' && Buffer.from(request['hub.secret']).length <= 200, makeError(400, 'hub.secret must be a string that has a length less than 200 bytes.'))
}

function isValidHubSubscriptionRequest(requestBody: any): requestBody is HubSubscriptionRequest {

    assert.ok(!!requestBody['hub.callback'], makeError(400, 'No hub.callback on request object'));
    assert.ok(!!requestBody['hub.mode'], makeError(400, 'No hub.mode on request object'));
    assert.ok(!!requestBody['hub.topic'], makeError(400, 'No hub.topic on request object'));
    assert.ok(!!requestBody['hub.lease_seconds'], makeError(400, 'No hub.lease_seconds on request object'));
    assert.ok(typeof requestBody['hub.lease_seconds'] === 'number', makeError(400, 'hub.lease_seconds must be a number'));
    assert.ok(!!requestBody['hub.secret'], makeError(400, 'No hub.secret on request object'));

    return true;
}

export {
    HubSubscriptionRequest,
    validateHubSubscriptionRequest,
    isValidHubSubscriptionRequest
}