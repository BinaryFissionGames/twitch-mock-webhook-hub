enum WebhookType {
    UserFollows = 1,
    StreamChanged,
    UserChanged,
    ExtensionTransactionCreated,
    ModeratorChange,
    ChannelBanChange,
    Subscription
}

const WebhookTypeTopic: Map<WebhookType, string> = new Map<WebhookType, string>();
WebhookTypeTopic.set(WebhookType.UserFollows, "https://api.twitch.tv/helix/users/follows");
WebhookTypeTopic.set(WebhookType.StreamChanged, "https://api.twitch.tv/helix/streams");
WebhookTypeTopic.set(WebhookType.UserChanged, "https://api.twitch.tv/helix/users");
WebhookTypeTopic.set(WebhookType.ExtensionTransactionCreated, "https://api.twitch.tv/helix/extensions/transactions");
WebhookTypeTopic.set(WebhookType.ModeratorChange, "https://api.twitch.tv/helix/moderation/moderators/events");
WebhookTypeTopic.set(WebhookType.ChannelBanChange, "https://api.twitch.tv/helix/moderation/banned/events");
WebhookTypeTopic.set(WebhookType.Subscription, "https://api.twitch.tv/helix/subscriptions/events");

const TopicToWebhookType: Map<string, WebhookType> = new Map<string, WebhookType>();
WebhookTypeTopic.forEach((val, key) => {
    TopicToWebhookType.set(val, key);
});

//FOLLOW EVENT DATA TYPE(S)
type FollowEvent = {
    from_id: string,
    from_name: string,
    to_id: string,
    to_name: string,
    followed_at: Date
};

//STREAM CHANGED EVENT DATA TYPE(S)
type StreamChangedEvent = {
    id: string,
    user_id: string,
    user_name: string,
    game_id: string,
    community_ids: string[],
    type: string,
    title: string,
    viewer_count: number,
    started_at: Date,
    language: string,
    thumbnail_url: string
};

//USER CHANGED EVENT DATA TYPE(S)
type UserChangedEvent = {
    id: string,
    login: string,
    display_name: string,
    type: string,
    broadcaster_type: string,
    description: string,
    profile_image_url: string,
    offline_image_url: string,
    view_count: number,
};

//EXTENSION TRANSACTION EVENT DATA TYPE(S)
type ExtensionTransactionCreatedEvent = {
    id: string,
    timestamp: Date,
    broadcaster_id: string,
    broadcaster_name: string,
    user_id: string,
    user_name: string,
    product_type: string, // Always BITS_IN_EXTENSION
    product_data: ProductData,
};

type ProductData = {
    domain: string,
    broadcast: boolean,
    expiration: string, // always empty (only unexpired products can be purchased)
    sku: string,
    cost: CostData,
    displayName: string,
    inDevelopment: boolean
}

type CostData = {
    amount: number,
    type: string, // Always "Bits",
}


//MODERATOR EVENT DATA TYPES
enum ModeratorEventType {
    MODERATOR_ADD = "moderation.moderator.add",
    MODERATOR_REMOVE = "moderation.moderator.remove",
    BAN_USER = "moderation.user.ban",
    UNBAN_USER = "moderation.user.unban"
}

type ModeratorChangeEvent = {
    id: string, // Docs says that this is the user id of the moderator. There is no way I buy that for a second. This is the unique event ID.
    event_type: ModeratorEventType,
    event_timestamp: Date,
    version: string,
    event_data: ModeratorEventData
};

type ModeratorEventData = {
    broadcaster_id: string,
    broadcaster_name: string,
    user_id: string,
    user_name: string
}


//BAN EVENT DATA TYPES
type ChannelBanChangeEvent = {
    id: string, // Docs says that this is the user id of the moderator. There is no way I buy that for a second. This is the unique event ID.
    event_type: ModeratorEventType,
    event_timestamp: Date,
    version: string,
    event_data: ModeratorEventData
};

//SUBSCRIPTION EVENT DATA TY{ES
enum SubscriptionEventType {
    SUBSCRIBE = "subscriptions.subscribe",
    NOTIFICATION = "subscriptions.notification",
    UNSUBSCRIBE = "subscriptions.unsubscribe"
}

type SubscriptionEvent = {
    id: string,
    event_type: SubscriptionEventType,
    event_timestamp: Date,
    version: string,
    event_data: SubscriptionEventData
};

type SubscriptionEventData = {
    broadcaster_id: string,
    broadcaster_name: string,
    is_gift: boolean,
    plan_name: string,
    tier: string,
    user_id: string,
    user_name: string,
    gifter_id?: string,
    gifter_name?: string,
    message?: string
}

//BASE WEBHOOK EVENT OBJECT
// On a human note, conditional types are so f***ing cool! Try doing THIS in Java!
type WebhookEvent<T extends WebhookType> = {
    type: T,
    data: T extends WebhookType.UserFollows ? FollowEvent :
          T extends WebhookType.StreamChanged ? StreamChangedEvent :
          T extends WebhookType.UserChanged ? UserChangedEvent :
          T extends WebhookType.ExtensionTransactionCreated ? ExtensionTransactionCreatedEvent :
          T extends WebhookType.ModeratorChange ? ModeratorChangeEvent :
          T extends WebhookType.ChannelBanChange ? ChannelBanChangeEvent :
          T extends WebhookType.Subscription ? SubscriptionEvent :
          undefined
}

export {
    WebhookType,
    WebhookTypeTopic,
    TopicToWebhookType,
    FollowEvent,
    StreamChangedEvent,
    UserChangedEvent,
    ExtensionTransactionCreatedEvent,
    ProductData,
    CostData,
    ModeratorEventType,
    ModeratorChangeEvent,
    ModeratorEventData,
    ChannelBanChangeEvent,
    SubscriptionEventType,
    SubscriptionEvent,
    SubscriptionEventData,
    WebhookEvent
}