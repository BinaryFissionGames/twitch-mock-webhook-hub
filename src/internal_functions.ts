import {
    Subscribers,
    UserFollowsSubscription,
    StreamChangedSubscription,
    UserChangedSubscription,
    ExtensionTransactionCreatedSubscription,
    ModeratorChangedSubscription,
    ChannelBanChangedEventSubscription,
    SubscriberSubscription
} from '../dist/generated/prisma/client'
import {options, prisma} from "./setup";
import got from "got";
import * as crypto from 'crypto';
import {WebhookEvent, WebhookType, WebhookTypeTopic} from "./events";
import {logVerbose} from "./programmatic_api";

async function verifyPendingCallbacks() {
    logVerbose('Verifying pending callbacks...');
    let pendingSubs = await prisma.subscribers.findMany({
        where: {validated: false}
    });

    logVerbose('Unvalidated subs: ', pendingSubs);

    let requestPromises = [];
    for (let sub of pendingSubs) {
        let challenge = crypto.randomBytes(100).toString('hex');
        let urlWithParams = new URL(sub.callbackUrl);
        //These have the "callback" params stripped; However, they will have our own params added to it.
        let urlCallbackParamsStripped = new URL(sub.callbackUrl.substring(0, sub.callbackUrl.length - urlWithParams.search.length - urlWithParams.hash.length));

        urlCallbackParamsStripped.searchParams.set('hub.mode', 'subscribe');
        urlCallbackParamsStripped.searchParams.set('hub.topic', (await reconstructTopicUrl(sub)).href);
        urlCallbackParamsStripped.searchParams.set('hub.challenge', challenge);
        urlCallbackParamsStripped.searchParams.set('hub.lease_seconds', ((sub.expires - Date.now()) / 1000).toString());

        requestPromises.push(
            got.get(urlCallbackParamsStripped.href)
                .then(res => {
                    if (Math.floor(res.statusCode / 100) !== 2 || res.body !== challenge) {
                        //Cancel subscription
                        logVerbose(`Response code (${res.statusCode})/challenge(actual: ${res.body}, expected: ${challenge}) mismatch; Deleting sub for URL: ${sub.callbackUrl}`);
                        return prisma.subscribers.delete({
                            where: {
                                id: sub.id
                            }
                        });
                    }

                    logVerbose('Adding subscription for URL:', sub.callbackUrl);

                    return prisma.subscribers.update({
                        where: {
                            id: sub.id
                        },
                        data: {
                            validated: true
                        }
                    });
                }).catch((e) => {
                if (options && options.logErrors) {
                    console.error(e);
                }
            })
        );
    }

    return await Promise.all(requestPromises);
}

async function tryRemoveQueued() {
    logVerbose('Removing pending subscriptions!');
    let pendingRemoval = await prisma.subscribers.findMany({
        where: {queuedForRemoval: true}
    });

    logVerbose('Pending for removal:', pendingRemoval);

    let requestPromises = [];
    for (let sub of pendingRemoval) {
        let challenge = crypto.randomBytes(100).toString('hex');
        let urlWithParams = new URL(sub.callbackUrl);
        //These have the "callback" params stripped; However, they will have our own params added to it.
        let urlCallbackParamsStripped = new URL(sub.callbackUrl.substring(0, sub.callbackUrl.length - urlWithParams.search.length - urlWithParams.hash.length));

        urlCallbackParamsStripped.searchParams.set('hub.mode', 'unsubscribe');
        urlCallbackParamsStripped.searchParams.set('hub.topic', (await reconstructTopicUrl(sub)).href);
        urlCallbackParamsStripped.searchParams.set('hub.challenge', challenge);

        requestPromises.push(
            got.get(urlCallbackParamsStripped.href)
                .then(res => {
                    if (Math.floor(res.statusCode / 100) !== 2 || res.body != challenge) {
                        logVerbose(`Response code (${res.statusCode})/challenge(actual: ${res.body}, expected: ${challenge}) mismatch; Ignoring delete request for URL: ${sub.callbackUrl}`);
                        // Endpoint DOES NOT want this subscription to end. We won't stop it, in that case.
                        return prisma.subscribers.update({
                            where: {
                                id: sub.id
                            },
                            data: {
                                queuedForRemoval: false
                            }
                        });
                    }

                    return prisma.subscribers.delete({
                        where: {
                            id: sub.id
                        }
                    });
                }).catch((e) => {
                if (options && options.logErrors) {
                    console.error(e);
                }
            })
        );
    }

    return await Promise.all(requestPromises);
}

async function removeExpired() {
    logVerbose('Deleting expired subs...');
    let amount = await prisma.subscribers.deleteMany({
        where: {
            expires: {
                lte: Date.now()
            }
        }
    });
    logVerbose(`Removed ${amount.count} expired records`);
}

async function reconstructTopicUrl(sub: Subscribers): Promise<URL> {
    let url = new URL(<string>WebhookTypeTopic.get(sub.type));
    switch (<WebhookType>sub.type) {
        case WebhookType.UserFollows:
            let userFollows = <UserFollowsSubscription>await prisma.userFollowsSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });

            url.searchParams.set('first', '1');
            if (userFollows.fromId) {
                url.searchParams.set('from_id', userFollows.fromId);
            }

            if (userFollows.toId) {
                url.searchParams.set('to_id', userFollows.toId);
            }
            break;
        case WebhookType.StreamChanged:
            let streamChanged = <StreamChangedSubscription>await prisma.streamChangedSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });
            url.searchParams.set('user_id', streamChanged.userId);
            break;
        case WebhookType.UserChanged:
            let userChanged = <UserChangedSubscription>await prisma.streamChangedSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });
            url.searchParams.set('id', userChanged.userId);
            break;
        case WebhookType.ExtensionTransactionCreated:
            let extensionTransactionCreated = <ExtensionTransactionCreatedSubscription>await prisma.extensionTransactionCreatedSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });
            url.searchParams.set('first', '1');
            url.searchParams.set('extension_id', extensionTransactionCreated.extensionId);
            break;
        case WebhookType.ModeratorChange:
            let moderatorChanged = <ModeratorChangedSubscription>await prisma.moderatorChangedSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });
            url.searchParams.set('first', '1');
            url.searchParams.set('broadcaster_id', moderatorChanged.broadcasterId);
            if (moderatorChanged.userId) {
                url.searchParams.set('user_id', moderatorChanged.userId);
            }
            break;
        case WebhookType.ChannelBanChange:
            let banChanged = <ChannelBanChangedEventSubscription>await prisma.channelBanChangedEventSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });
            url.searchParams.set('first', '1');
            url.searchParams.set('broadcaster_id', banChanged.broadcasterId);
            if (banChanged.userId) {
                url.searchParams.set('user_id', banChanged.userId);
            }
            break;
        case WebhookType.Subscription:
            let subscriptionSub = <SubscriberSubscription>await prisma.subscriberSubscription.findOne({
                where: {
                    subscriberId: sub.id
                }
            });
            url.searchParams.set('first', '1');
            url.searchParams.set('broadcaster_id', subscriptionSub.broadcasterId);
            if (subscriptionSub.userId) {
                url.searchParams.set('user_id', subscriptionSub.userId);
            }

            if (subscriptionSub.gifterId) {
                url.searchParams.set('gifter_id', subscriptionSub.gifterId);
            }

            if (subscriptionSub.gifterName) {
                url.searchParams.set('gifter_name', subscriptionSub.gifterName);
            }
            break;
        default:
            throw new Error(`Invalid type on subscriber ${sub.id}!`);
    }

    url.searchParams.sort();
    return url;
}

async function notifySubscriber<T extends WebhookType>(subscriber: Subscribers, event: WebhookEvent<T>) {
    let body = JSON.stringify({
        data: [
            event.data
        ]
    });

    logVerbose(`Notifying subscriber ${subscriber.callbackUrl} w/ payload ${body}`);

    await got.post(subscriber.callbackUrl, {
        followRedirect: true,
        maxRedirects: 10,
        body: body,
        headers: {
            'X-Hub-Signature': crypto.createHmac('sha256', subscriber.secret).update(body).digest('hex')
        },
        timeout: 10000,
        retry: {
            methods: ['POST'],
            calculateDelay: (retry) => Math.min(32, Math.pow(2, retry.attemptCount)) * 1000,
            limit: 5
        }

    });
}

export {
    verifyPendingCallbacks,
    tryRemoveQueued,
    removeExpired,
    notifySubscriber
}