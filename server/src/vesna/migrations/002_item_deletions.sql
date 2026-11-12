CREATE TABLE item_deletions (
    item_id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    original_path TEXT,
    work_path TEXT NOT NULL,
    staging_path TEXT NOT NULL,
    candidate_path TEXT NOT NULL,
    published_paths_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    completed_at REAL
);
