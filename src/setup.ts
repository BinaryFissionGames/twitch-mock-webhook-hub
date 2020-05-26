import {Express} from "express";
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http'
import {PrismaClient} from '../dist/generated/prisma/client'
import {isValidHubSubscriptionRequest} from "./http-types";
import {addSubscription, removeSubscription} from "./programmatic_api";
import {removeExpired, tryRemoveQueued, verifyPendingCallbacks} from "./internal_functions";

const prisma: PrismaClient = new PrismaClient({
    datasources: {
        twitch_mock_webhook_hub_db: "file:./twitch_mock_webhook_hub_db.db"
    }
});

type MockServerOptionsCommon = {
    hub_url: string,
    logErrors?: boolean
}

type MockServerOptionsExpressApp = {
    expressApp: Express,
} & MockServerOptionsCommon

type MockServerOptionsPort = {
    port: number
} & MockServerOptionsCommon

type MockServerOptions = MockServerOptionsPort | MockServerOptionsExpressApp

const verifyCallbacksTimeoutMs: number = 10000;
let server: http.Server | undefined;

let verifyCallbacksTimeout: NodeJS.Timeout;
let removeCallbacksTimeout: NodeJS.Timeout;
let removeExpiredTimeout: NodeJS.Timeout;

async function setUpMockWebhookServer(config: MockServerOptions): Promise<void> {
    const app = (config as MockServerOptionsExpressApp).expressApp ? (config as MockServerOptionsExpressApp).expressApp : express();

    let url = new URL(config.hub_url);

    app.use(url.pathname, bodyParser.json());
    app.post(url.pathname, async (req, res, next) => {
        try {
            if (isValidHubSubscriptionRequest(req.body)) {
                if (req.body["hub.mode"] === 'subscribe') {
                    await addSubscription(req.body, req.header('Client-ID'));
                    res.status(202);
                    res.end();
                } else {
                    await removeSubscription(req.body["hub.callback"]);
                    res.status(200);
                    res.end();
                }
            }
        } catch (e) {
            next(e);
        }
    });

    let verifyCallbacks = () => {
        verifyPendingCallbacks().then(() => {
            verifyCallbacksTimeout = setTimeout(verifyCallbacks, verifyCallbacksTimeoutMs);
        });
    };
    verifyCallbacksTimeout = setTimeout(verifyCallbacks, verifyCallbacksTimeoutMs);

    let removeCallbacks = () => {
        tryRemoveQueued().then(() => {
            removeCallbacksTimeout = setTimeout(removeCallbacks, verifyCallbacksTimeoutMs);
        });
    };
    removeCallbacksTimeout = setTimeout(removeCallbacks, verifyCallbacksTimeoutMs);

    let removeExpiredCallbacks = () => {
        removeExpired().then(() => {
            removeExpiredTimeout = setTimeout(removeExpiredCallbacks, verifyCallbacksTimeoutMs);
        })
    };
    removeExpiredTimeout = setTimeout(removeExpiredCallbacks, verifyCallbacksTimeoutMs);

    if ((config as MockServerOptionsPort).port) {
        return new Promise((resolve, reject) => {
            server = app.listen((config as MockServerOptionsPort).port, resolve).on('error', reject);
        });
    }
}

export {
    prisma,
    server,
    verifyCallbacksTimeout,
    removeExpiredTimeout,
    removeCallbacksTimeout,
    setUpMockWebhookServer
}