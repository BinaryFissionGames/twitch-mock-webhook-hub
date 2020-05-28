import {Express, NextFunction} from "express";
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http'
import {PrismaClient} from '../dist/generated/prisma/client'
import {isValidHubSubscriptionRequest} from "./http-types";
import {addSubscription, logVerbose, removeSubscription} from "./programmatic_api";
import {removeExpired, tryRemoveQueued, verifyPendingCallbacks} from "./internal_functions";
import * as createHttpError from "http-errors";
import * as path from 'path';
// @ts-ignore
import Transaction = require('knex/lib/transaction');
// @ts-ignore
import Client = require('knex/lib/client');

//OK,so this is probably a bad Idea. But I need the option to make "immediate" transactions, so I've changed the transaction prototype.
// @ts-ignore
Transaction.prototype.begin = function (conn) {
    if (this.config && this.config.immediate) {
        return this.query(conn, 'BEGIN IMMEDIATE;')
    }
    return this.query(conn, 'BEGIN;');
};

//Do this so we can access full config object on transaction.
// @ts-ignore
Client.prototype.transaction = function (container, config, outerTx) {
    let trans = new Transaction(this, container, config, outerTx);
    trans.config = config; // I know they make copies in the Knex code, but I don't think that's necessary, TBH
    return trans;
};


const prisma: PrismaClient = new PrismaClient({
    datasources: {
        twitch_mock_webhook_hub_db: "file:./twitch_mock_webhook_hub_db.db"
    }
});

//knex to do actual heavy lifting for things like transaction support.
//I really want to write a rant here about prisma, but I will restrain myself
const knex = require('knex')({
    client: 'sqlite3',
    connection: {
        filename: path.join(__dirname, '../prisma/twitch_mock_webhook_hub_db.db')
    },
    useNullAsDefault: true
});

type MockServerOptionsCommon = {
    hub_url: string,
    logErrors?: boolean,
    verbose?: boolean
    pollTimerMs?: number
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

let isStopped = false;

async function setUpMockWebhookServer(config: MockServerOptions): Promise<void> {
    const app = (config as MockServerOptionsExpressApp).expressApp ? (config as MockServerOptionsExpressApp).expressApp : express();

    isStopped = false;
    options = config;
    options.pollTimerMs = options.pollTimerMs || verifyCallbacksTimeoutMs;

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
            if(!isStopped) {
                verifyCallbacksTimeout = setTimeout(verifyCallbacks, <number>options.pollTimerMs);
            }
        });
    };
    verifyCallbacksTimeout = setTimeout(verifyCallbacks, <number>options.pollTimerMs);

    let removeCallbacks = () => {
        tryRemoveQueued().then(() => {
            if(!isStopped) {
                removeCallbacksTimeout = setTimeout(removeCallbacks, <number>options.pollTimerMs);
            }
        });
    };
    removeCallbacksTimeout = setTimeout(removeCallbacks, <number>options.pollTimerMs);

    let removeExpiredCallbacks = () => {
        removeExpired().then(() => {
            if(!isStopped) {
                removeExpiredTimeout = setTimeout(removeExpiredCallbacks, <number>options.pollTimerMs);
            }
        })
    };
    removeExpiredTimeout = setTimeout(removeExpiredCallbacks, <number>options.pollTimerMs);

    if ((config as MockServerOptionsPort).port) {
        return new Promise((resolve, reject) => {
            server = app.listen((config as MockServerOptionsPort).port, resolve).on('error', reject);
        });
    }
}

function setStopped(stopped: boolean){
    isStopped = stopped;
}

export {
    prisma,
    knex,
    server,
    verifyCallbacksTimeout,
    removeExpiredTimeout,
    removeCallbacksTimeout,
    setUpMockWebhookServer,
    options,
    setStopped
}