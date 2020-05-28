import * as Knex from "knex";
import {knex, options} from "./setup";

//Run the transaction until it either completes successfully OR fails from something other than SQLITE_BUSY or SQLITE_LOCKED
async function runInImmediateTrxWhileBlocked(cb: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
    let complete = false;
    while (!complete) {
        try {
            await knex.transaction(async (trx: Knex.Transaction) => {
                return cb(trx)
                    .then(() => {
                        //Completed callback successfully
                        complete = true;
                    })
                    .catch((e) => {
                    if(e.code && (e.code !== 'SQLITE_BUSY' && e.code !== 'SQLITE_LOCKED')){
                        throw e; // Error is not recoverable; We throw this up the promise chain and let knex deal w/ it
                    }
                });
            }, {
                immediate: true,
                doNotRejectOnRollback: false
            });
        } catch (e) {
            if(options && options.logErrors) {
                console.error(e)
            }
            if(e.code && (e.code !== 'SQLITE_BUSY' && e.code !== 'SQLITE_LOCKED')){
                throw e; // Error is not recoverable; We throw this up the promise chain and let knex deal w/ it
            }
        }
    }
}

export {
    runInImmediateTrxWhileBlocked
}