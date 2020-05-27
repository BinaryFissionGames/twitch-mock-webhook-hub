//Clear db of all subscribers
import {TopicToWebhookType, WebhookEvent, WebhookType} from "./events";
import {options, prisma, removeCallbacksTimeout, removeExpiredTimeout, server, verifyCallbacksTimeout} from "./setup";
import {HubSubscriptionRequest, validateHubSubscriptionRequest} from "./http-types";
import * as assert from 'assert';
import * as createHttpError from "http-errors";
import {notifySubscriber} from "./internal_functions";
import {Subscribers} from '../dist/generated/prisma/client';

async function addSubscription(request: HubSubscriptionRequest, clientId?: string): Promise<void> {
    let topicUrl = new URL(request["hub.topic"]);
    clientId = clientId || 'no-id'; //Todo: Reject if options is set to reject no client ID
    validateHubSubscriptionRequest(request);

    //Validate that the topic URL has it's parameters in order
    let originalSearch = topicUrl.search;
    topicUrl.searchParams.sort();

    assert.strictEqual(originalSearch, topicUrl.search, createHttpError(400, 'Search params must be specified in alphabetical order!'));

    let type: WebhookType | undefined = TopicToWebhookType.get(topicUrl.origin + topicUrl.pathname);

    switch (type) {
        case WebhookType.UserFollows:
            assert.strictEqual(topicUrl.searchParams.get('first'), '1', createHttpError(400, 'first=1 must be defined'));
            assert.ok(topicUrl.searchParams.get('to_id') || topicUrl.searchParams.get('from_id'), createHttpError(400, 'Either to_id or from_id MUST be defined!'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    UserFollowsSubscription: {
                        create: {
                            toId: topicUrl.searchParams.get('to_id'),
                            fromId: topicUrl.searchParams.get('from_id')
                        }
                    }
                }
            });
            break;
        case WebhookType.Subscription:
            assert.strictEqual(topicUrl.searchParams.get('first'), '1', createHttpError(400, 'first=1 must be defined'));
            assert.ok(topicUrl.searchParams.get('broadcaster_id'), createHttpError(400, 'broadcaster_id must be specified'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    SubscriberSubscription: {
                        create: {
                            broadcasterId: <string>topicUrl.searchParams.get('broadcaster_id'),
                            userId: topicUrl.searchParams.get('user_id'),
                            gifterId: topicUrl.searchParams.get('gifter_id'),
                            gifterName: topicUrl.searchParams.get('gifter_name')
                        }
                    }
                }
            });
            break;
        case WebhookType.ChannelBanChange:
            assert.strictEqual(topicUrl.searchParams.get('first'), '1', createHttpError(400, 'first=1 must be defined'));
            assert.ok(topicUrl.searchParams.get('broadcaster_id'), createHttpError(400, 'broadcaster_id must be specified'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    ChannelBanChangedEventSubscription: {
                        create: {
                            broadcasterId: <string>topicUrl.searchParams.get('broadcaster_id'),
                            userId: topicUrl.searchParams.get('user_id')
                        }
                    }
                }
            });
            break;
        case WebhookType.ModeratorChange:
            assert.strictEqual(topicUrl.searchParams.get('first'), '1', createHttpError(400, 'first=1 must be defined'));
            assert.ok(topicUrl.searchParams.get('broadcaster_id'), createHttpError(400, 'broadcaster_id must be specified'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    ModeratorChangedSubscription: {
                        create: {
                            broadcasterId: <string>topicUrl.searchParams.get('broadcaster_id'),
                            userId: topicUrl.searchParams.get('user_id')
                        }
                    }
                }
            });
            break;
        case WebhookType.UserChanged:
            assert.ok(topicUrl.searchParams.get('id'), createHttpError(400, 'id must be specified'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    UserChangedSubscription: {
                        create: {
                            userId: <string>topicUrl.searchParams.get('id')
                        }
                    }
                }
            });
            break;
        case WebhookType.StreamChanged:
            assert.ok(topicUrl.searchParams.get('user_id'), createHttpError(400, 'user_id must be specified'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    StreamChangedSubscription: {
                        create: {
                            userId: <string>topicUrl.searchParams.get('user_id')
                        }
                    }
                }
            });
            break;
        case WebhookType.ExtensionTransactionCreated:
            assert.strictEqual(topicUrl.searchParams.get('first'), '1', createHttpError(400, 'first=1 must be defined'));
            assert.ok(topicUrl.searchParams.get('extension_id'), createHttpError(400, 'extension_id must be specified'));
            await prisma.subscribers.create({
                data: {
                    callbackUrl: request["hub.callback"],
                    createdByClientId: clientId,
                    expires: new Date(Date.now() + request["hub.lease_seconds"] * 1000),
                    secret: request["hub.secret"],
                    type: type,
                    ExtensionTransactionCreatedSubscription: {
                        create: {
                            extensionId: <string>topicUrl.searchParams.get('extension_id')
                        }
                    }
                }
            });
            break;
        default:
            throw createHttpError(400, 'Invalid topic URL');
    }
}

//Returns true if a existing subscription was queued for removal, false if there was no such subscription.
async function removeSubscription(callbackUrl: string): Promise<boolean> {
    let subs = await prisma.subscribers.update({
        where: {
            callbackUrl: callbackUrl
        },
        data: {
            queuedForRemoval: true
        }
    });

    logVerbose('Queued sub for removal:', subs);

    return subs !== undefined;
}

async function clearDb() {
    logVerbose('Clearing DB');
    await prisma.subscribers.deleteMany({});
    await prisma.subscriberSubscription.deleteMany({});
    await prisma.channelBanChangedEventSubscription.deleteMany({});
    await prisma.moderatorChangedSubscription.deleteMany({});
    await prisma.extensionTransactionCreatedSubscription.deleteMany({});
    await prisma.streamChangedSubscription.deleteMany({});
    await prisma.userFollowsSubscription.deleteMany({});
}

async function closeMockServer(killPrisma?: boolean): Promise<void> {
    logVerbose('Closing mock server');

    if (verifyCallbacksTimeout) {
        clearTimeout(verifyCallbacksTimeout);
    }

    if (removeCallbacksTimeout) {
        clearTimeout(removeCallbacksTimeout);
    }

    if (removeExpiredTimeout) {
        clearTimeout(removeExpiredTimeout);
    }

    if (killPrisma) {
        await prisma.disconnect();
    }

    return new Promise((resolve, reject) => {
        if (server) {
            server.close((err) => {
                if (err) {
                    reject(err)
                } else {
                    resolve()
                }
            });
        }
    });
}

//Emit event to all subscribers
async function emitEvent<T extends WebhookType>(event: WebhookEvent<T>) {
    let subs: { subscriber: Subscribers }[];
    switch (event.type) {
        case WebhookType.UserFollows:
            let followsEvent: WebhookEvent<WebhookType.UserFollows> = <WebhookEvent<WebhookType.UserFollows>>event;
            subs = await prisma.userFollowsSubscription.findMany({
                where: {
                    OR: [
                        {
                            toId: followsEvent.data.to_id,
                            fromId: followsEvent.data.from_id
                        },
                        {
                            toId: followsEvent.data.to_id,
                            fromId: null
                        },
                        {
                            toId: null,
                            fromId: followsEvent.data.from_id
                        }
                    ]
                },
                include: {
                    subscriber: true
                }
            });
            break;
        case WebhookType.StreamChanged:
            let streamChangedEvent: WebhookEvent<WebhookType.StreamChanged> = <WebhookEvent<WebhookType.StreamChanged>>event;
            subs = await prisma.streamChangedSubscription.findMany({
                where: {
                    userId: streamChangedEvent.data.user_id
                },
                include: {
                    subscriber: true
                }
            });
            break;
        case WebhookType.UserChanged:
            let userChangedEvent: WebhookEvent<WebhookType.UserChanged> = <WebhookEvent<WebhookType.UserChanged>>event;
            subs = await prisma.userChangedSubscription.findMany({
                where: {
                    userId: userChangedEvent.data.id
                },
                include: {
                    subscriber: true
                }
            });
            break;
        case WebhookType.ExtensionTransactionCreated:
            let extensionTransactionCreatedEvent: WebhookEvent<WebhookType.ExtensionTransactionCreated> = <WebhookEvent<WebhookType.ExtensionTransactionCreated>>event;
            subs = await prisma.extensionTransactionCreatedSubscription.findMany({
                where: {
                    extensionId: extensionTransactionCreatedEvent.data.user_id
                },
                include: {
                    subscriber: true
                }
            });
            break;
        case WebhookType.ModeratorChange:
            let moderatorChangedEvent: WebhookEvent<WebhookType.ModeratorChange> = <WebhookEvent<WebhookType.ModeratorChange>>event;
            subs = await prisma.moderatorChangedSubscription.findMany({
                where: {
                    OR: [
                        {
                            broadcasterId: moderatorChangedEvent.data.event_data.broadcaster_id,
                            userId: null
                        },
                        {
                            broadcasterId: moderatorChangedEvent.data.event_data.broadcaster_id,
                            userId: moderatorChangedEvent.data.event_data.user_id
                        }
                    ]
                },
                include: {
                    subscriber: true
                }
            });
            break;
        case WebhookType.ChannelBanChange:
            let channelBanChangedEvent: WebhookEvent<WebhookType.ChannelBanChange> = <WebhookEvent<WebhookType.ChannelBanChange>>event;
            subs = await prisma.channelBanChangedEventSubscription.findMany({
                where: {
                    OR: [
                        {
                            broadcasterId: channelBanChangedEvent.data.event_data.broadcaster_id,
                            userId: null
                        },
                        {
                            broadcasterId: channelBanChangedEvent.data.event_data.broadcaster_id,
                            userId: channelBanChangedEvent.data.event_data.user_id
                        }
                    ]
                },
                include: {
                    subscriber: true
                }
            });
            break;
        case WebhookType.Subscription:
            let subscriptionEvent: WebhookEvent<WebhookType.Subscription> = <WebhookEvent<WebhookType.Subscription>>event;
            subs = await prisma.subscriberSubscription.findMany({
                where: {
                    OR: [
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: null,
                            gifterId: null,
                            gifterName: null
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: subscriptionEvent.data.event_data.user_id,
                            gifterId: null,
                            gifterName: null
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: null,
                            gifterId: subscriptionEvent.data.event_data.gifter_id,
                            gifterName: null
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: null,
                            gifterId: null,
                            gifterName: subscriptionEvent.data.event_data.gifter_name
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: subscriptionEvent.data.event_data.user_id,
                            gifterId: subscriptionEvent.data.event_data.gifter_id,
                            gifterName: null
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: subscriptionEvent.data.event_data.user_id,
                            gifterId: null,
                            gifterName: subscriptionEvent.data.event_data.gifter_name
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: null,
                            gifterId: subscriptionEvent.data.event_data.gifter_id,
                            gifterName: subscriptionEvent.data.event_data.gifter_name
                        },
                        {
                            broadcasterId: subscriptionEvent.data.event_data.broadcaster_id,
                            userId: subscriptionEvent.data.event_data.user_id,
                            gifterId: subscriptionEvent.data.event_data.gifter_id,
                            gifterName: subscriptionEvent.data.event_data.gifter_name
                        }
                    ]
                },
                include: {
                    subscriber: true
                }
            });
            break;
        default:
            throw new Error('Invalid type!');
    }

    logVerbose('Emitting message to subscribers: ', subs);

    let promises = [];
    for (let sub of subs) {
        promises.push(notifySubscriber(sub.subscriber, event).catch((e) => {
            console.error(e);
        }));
    }
    await Promise.all(promises);
}

function logVerbose(message?: any, ...args: any[]): void {
    if (options && options.verbose) {
        console.log(message, args);
    }
}

export {
    addSubscription,
    removeSubscription,
    closeMockServer,
    clearDb,
    emitEvent,
    logVerbose
}