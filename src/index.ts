import {clearDb, closeMockServer} from "./programmatic_api";
import {setUpMockWebhookServer} from "./setup";

export * from './programmatic_api'
export {
    setUpMockWebhookServer
} from './setup'
export * from './events'

if (require.main === module) {
    clearDb().then(() => {
        let port = process.env.WEBHOOK_HUB_PORT ? parseInt(process.env.WEBHOOK_HUB_PORT) : 3080;
        return setUpMockWebhookServer({
            hub_url: `http://localhost:${port}/hub`,
            port
        });
    }).then(() => {
        process.on('SIGINT', async () => {
            console.log('Shutting down...');
            await closeMockServer(true);
        });
        console.log('Listening on port 3080');
    });
}