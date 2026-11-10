"""Console entry point for the single durable preparation worker."""

import argparse

from .artifacts import ArtifactStore
from .config import Settings
from .db import Database
from .worker import Worker


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one Vesna preparation worker")
    parser.add_argument("--once", action="store_true", help="claim at most one job and exit")
    arguments = parser.parse_args()
    settings = Settings.from_env()
    worker = Worker(
        settings,
        Database(settings.database_path),
        ArtifactStore(settings.artifact_root),
    )
    if arguments.once:
        worker.run_once()
    else:
        worker.run_forever()


if __name__ == "__main__":
    main()
