import {Express, NextFunction} from "express";
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http'
import {PrismaClient} from '../dist/generated/prisma/client'
import {isValidHubSubscriptionRequest} from "./http-types";
import {addSubscription, logVerbose, removeSubscription} from "./programmatic_api";
import {removeExpired, tryRemoveQueued, verifyPendingCallbacks} from "./internal_functions";
import * as createHttpError from "http-errors";

const prisma: PrismaClient = new PrismaClient({
    datasources: {
        twitch_mock_webhook_hub_db: "file:./twitch_mock_webhook_hub_db.db"
    }
});

type MockServerOptionsCommon = {
    hub_url: string,
    logErrors?: boolean,
    verbose?: boolean
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

let options: MockServerOptions;

async function setUpMockWebhookServer(config: MockServerOptions): Promise<void> {
    const app = (config as MockServerOptionsExpressApp).expressApp ? (config as MockServerOptionsExpressApp).expressApp : express();

    options = config;

    let url = new URL(config.hub_url);

    app.use(url.pathname, bodyParser.json());
    app.post(url.pathname, async (req, res, next) => {
        try {
            logVerbose('Subscriber made request to hub, body: ', req.body);
            if (isValidHubSubscriptionRequest(req.body)) {
                if (req.body["hub.mode"] === 'subscribe') {
                    logVerbose('Adding subscriber for endpoint', req.body["hub.callback"]);
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

    app.use(function (error: Error, req: express.Request, res: express.Response, next: NextFunction) {
        if (res.headersSent) {
            return next(error);
        }

        if (config.logErrors) {
            console.error(error);
        }

        if ((error as createHttpError.HttpError).statusCode) {
            res.status((error as createHttpError.HttpError).statusCode);
        } else {
            res.status(500);
        }

        res.json({
            status: 'error',
            message: error.message
        });

        res.end();
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
    setUpMockWebhookServer,
    options
}