CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at REAL NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at REAL NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE items (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('article', 'markdown')),
    title TEXT,
    source_url TEXT,
    filename TEXT,
    original_path TEXT,
    state TEXT NOT NULL CHECK(state IN ('accepted', 'preparing', 'ready', 'failed')),
    error TEXT,
    published_version TEXT,
    paragraph_count INTEGER NOT NULL DEFAULT 0 CHECK(paragraph_count >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX items_owner_created ON items(owner, created_at);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    candidate_version TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('accepted', 'preparing', 'ready', 'failed')),
    error TEXT,
    lease_owner TEXT,
    lease_expires_at REAL,
    attempt INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX jobs_claim ON jobs(state, lease_expires_at, created_at);

CREATE TABLE job_stages (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    artifact_path TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(job_id, stage)
);

CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    root_path TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    audio_sha256 TEXT NOT NULL,
    timings_sha256 TEXT NOT NULL,
    duration REAL NOT NULL,
    paragraph_count INTEGER NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(item_id, id)
);
CREATE INDEX versions_item ON versions(item_id, owner);
