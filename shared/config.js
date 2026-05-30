// Shared units used by the tunable config below.
export const MS_PER_SECOND = 1000;
export const MINUTE_MS = 60 * MS_PER_SECOND;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const MIB_BYTES = 1024 * 1024;

// Account validation and taste knobs. These are product choices, not cost controls.
export const USERNAME_MAX_CHARS = 12;
export const PASSWORD_MIN_CHARS = 12;
export const PASSWORD_MAX_CHARS = 64;

// Vault UX and security taste knobs.
export const AUTOLOCK_MIN_MINUTES = 1;
export const AUTOLOCK_MAX_MINUTES = 60;

// Client-side cache and render optimization knobs.
export const LOCAL_CACHE_WRITE_DELAY_MS = 350;
export const LOCAL_MEDIA_CACHE_MAX_BYTES = 128 * MIB_BYTES;
export const LOCAL_MEDIA_CACHE_MAX_ITEMS = 96;
export const LOCAL_MEDIA_ACCESS_TOUCH_MIN_MS = MINUTE_MS;
export const IDLE_CALLBACK_MIN_TIMEOUT_MS = 50;
export const ATTACHMENT_CACHE_IDLE_TIMEOUT_MS = 2500;
export const ATTACHMENT_CACHE_FALLBACK_DELAY_MS = 250;

// Chat retention and storage cost knobs. These drive Firestore TTL and Storage lifecycle pressure.
export const CHAT_UNSAVED_TTL_DAYS = 21;
export const CHAT_UNSAVED_TTL_MS = CHAT_UNSAVED_TTL_DAYS * DAY_MS;
export const CHAT_SEEN_TTL_MS = DAY_MS;

// Chat upload cost and abuse-control knobs. Lower values reduce Storage and bandwidth exposure.
export const CHAT_MEDIA_TTL_DAYS = CHAT_UNSAVED_TTL_DAYS;
export const CHAT_MEDIA_TTL_MS = CHAT_MEDIA_TTL_DAYS * DAY_MS;
export const CHAT_MAX_FILE_BYTES = 20 * MIB_BYTES;
export const CHAT_FILE_SIZE_LIMIT_ENABLED = true;
export const CHAT_MAX_UPLOAD_FILES = 5;
export const CHAT_IMAGE_MAX_EDGE = 1600;
export const CHAT_IMAGE_COMPRESS = 0.82;
export const CHAT_MEDIA_ID_BYTES = 16;

// Chat Firestore read/delete/write cost knobs. Tune these first when message queries or cleanup are expensive.
export const CHAT_MESSAGE_BATCH_SIZE = 20;
export const CHAT_MESSAGE_QUERY_MAX_DOCS = 60;
export const CHAT_TTL_CLIENT_DELETE_GRACE_MS = MINUTE_MS;
export const CHAT_TTL_DELETE_CHUNK_SIZE = 40;
export const CHAT_DELETE_SCAN_BATCH_SIZE = 200;
export const CHAT_TTL_WRITE_BATCH_SIZE = 1;
export const CHAT_DELETE_WRITE_BATCH_SIZE = 400;

// Chat list Firestore read cost knobs.
export const CHAT_LIST_LIVE_COUNT = 15;
export const CHAT_LIST_PAGE_SIZE = 20;

// Chat client warmup knobs. These trade faster first render against extra reads, memory, and media work.
export const CHAT_TOP_WARM_COUNT = 1;
export const CHAT_EAGER_WARM_COUNT = 1;
export const CHAT_WARM_DELAY_MS = 900;
export const CHAT_WARM_BATCH_SIZE = CHAT_MESSAGE_BATCH_SIZE;
export const CHAT_MESSAGE_VIEW_CACHE_SIZE = 30;
export const CHAT_VISITED_PREFETCH_OLDER_BATCHES = 0;
export const CHAT_MEDIA_WARM_MESSAGES_PER_CHAT = CHAT_MESSAGE_BATCH_SIZE;
export const CHAT_MEDIA_WARM_START_DELAY_MS = 600;
export const CHAT_MEDIA_WARM_STEP_DELAY_MS = 120;
export const CHAT_MEDIA_WARM_TYPES = Object.freeze(['img', 'mp4']);
export const CHAT_MEDIA_WARM_MAX_BYTES = 0;

// Chat write-throttle cost knobs. These batch noisy control messages into fewer Firestore writes.
export const CHAT_READ_RECEIPT_WRITE_DELAY_MS = 2000;
export const CHAT_REACTION_WRITE_DELAY_MS = 600;

// Bot chat timing knobs. These keep deterministic replies from landing at the same instant as bot read state.
export const BOT_REPLY_AFTER_READ_DELAY_MS = 650;
export const BOT_BURST_DEFAULT_COUNT = 60;
export const BOT_BURST_MAX_COUNT = 300;
export const BOT_BURST_DEFAULT_DELAY_MS = 3000;
export const BOT_BURST_MIN_DELAY_MS = 250;
export const BOT_BURST_SESSION_WAIT_MS = 30000;

// Chat product and taste knobs.
export const CHAT_MAX_TEXT_CHARS = 2048;
export const CHAT_MAX_REACTIONS = 2;
export const CHAT_PAIR_CACHE_LIMIT = 256;

// Chat preview styling and client optimization knobs.
export const CHAT_MESSAGE_PREVIEW_COMPRESS = 0.94;
export const CHAT_MESSAGE_PREVIEW_MIN_WIDTH = 960;
export const CHAT_MESSAGE_PREVIEW_MAX_EDGE = 1600;

// Search server cost and responsiveness knobs.
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_USERNAME_LIMIT = 15;
export const SEARCH_ROLE_LIMIT = 15;

// Peer profile refresh cost knobs. These cap background reads after chat hydration.
export const RECENT_PEER_REFRESH_LIMIT = 50;
export const RECENT_PEER_REFRESH_DELAY_MS = 250;
export const RECENT_PEER_REFRESH_INTERVAL_MS = 5 * MINUTE_MS;
export const RECENT_PEER_REFRESH_THROTTLE_MS = 120;

// Moderation refresh timing. This is a client responsiveness knob.
export const BAN_REFRESH_GRACE_MS = 50;

// Wallet network/API cost knobs. These trade freshness against Spark calls and pagination work.
export const WALLET_UPDATE_RATE_LIMIT_MS = 5 * MS_PER_SECOND;
export const WALLET_TRANSFER_POLL_MS = 10 * MS_PER_SECOND;
export const WALLET_ACTIVE_CLAIM_POLL_MS = 20 * MS_PER_SECOND;
export const WALLET_MIN_BOOT_TX_COVERAGE_MS = DAY_MS;
export const WALLET_AUTO_CLAIM_MAX_FEE_SATS = 5000;
export const WALLET_CLAIM_PAGE_SIZE = 100;
export const WALLET_RECENT_TRANSFER_LIMIT = 100;
export const WALLET_TRANSFER_PAGE_LIMIT = 100;
export const WALLET_TRANSFER_FETCH_THROTTLE_MS = 150;
