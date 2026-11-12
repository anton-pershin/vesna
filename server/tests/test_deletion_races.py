"""Event-controlled deletion races with the complete claimed worker operation."""

from __future__ import annotations

from contextlib import contextmanager
import json
import threading

from comourat.models import ArticleResult

from conftest import ORIGIN, FakeTts, sign_in, submit_markdown
from vesna.audio import AudioAssembler
from vesna.worker import Worker


class DeletionRace:
    def __init__(self, client, database, store, monkeypatch, item, other):
        self.client = client
        self.database = database
        self.store = store
        self.item = item
        self.other = other
        self.committed = threading.Event()
        self.worker_results = []
        self.delete_results = []
        self.worker_thread = None
        self.delete_thread = None
        self.roots = self._candidate_roots()
        self.original_path = database.get_item(item["id"])["original_path"]
        original_begin = database.begin_item_deletion

        def notifying_begin(*args, **kwargs):
            result = original_begin(*args, **kwargs)
            self.committed.set()
            return result

        monkeypatch.setattr(database, "begin_item_deletion", notifying_begin)

    def _candidate_roots(self):
        job = self.database.get_item_job(self.item["id"])
        version = job["candidate_version"]
        return f"work/{version}", f"staging/{version}", f"versions/{version}"

    @staticmethod
    def _capture(call, results):
        try:
            results.append(call())
        except BaseException as error:
            results.append(error)

    def start_worker(self, worker):
        self.worker_thread = threading.Thread(
            target=self._capture,
            args=(worker.run_once, self.worker_results),
            name="preparation",
            daemon=True,
        )
        self.worker_thread.start()

    def start_delete(self):
        self.delete_thread = threading.Thread(
            target=self._capture,
            args=(
                lambda: self.client.delete(
                    f"/api/items/{self.item['id']}", headers={"Origin": ORIGIN}
                ),
                self.delete_results,
            ),
            name="deletion",
            daemon=True,
        )
        self.delete_thread.start()

    def finish(self):
        for thread in (self.worker_thread, self.delete_thread):
            assert thread is not None
            thread.join(timeout=20)
            assert not thread.is_alive()
        for result in self.worker_results + self.delete_results:
            if isinstance(result, BaseException):
                raise result
        assert self.worker_results == [True]
        assert len(self.delete_results) == 1
        response = self.delete_results[0]
        assert response.status_code == 204, response.text
        assert self.database.get_item(self.item["id"]) is None
        if self.original_path:
            assert not self.store.path(self.original_path).exists()
        for root in self.roots:
            assert not self.store.path(root).exists()
        with self.database.connect() as connection:
            receipt = connection.execute(
                "SELECT completed_at FROM item_deletions WHERE item_id = ?",
                (self.item["id"],),
            ).fetchone()
        assert receipt is not None and receipt["completed_at"] is not None

        other_id, other_original, other_marker = self.other
        assert self.database.get_item(other_id) is not None
        assert self.store.read_bytes(other_original) == b"Other item must remain."
        assert self.store.read_bytes(other_marker) == b"other item artifact"


def wait(event, message):
    assert event.wait(timeout=10), message


def markdown_race(client, database, store, monkeypatch):
    sign_in(client)
    item = submit_markdown(client, b"Target paragraph.")
    other = submit_markdown(client, b"Other item must remain.", "other.md")
    other_original = database.get_item(other["id"])["original_path"]
    other_job = database.get_item_job(other["id"])
    other_marker = f"work/{other_job['candidate_version']}/other-item.txt"
    store.write_bytes(other_marker, b"other item artifact")
    return DeletionRace(
        client,
        database,
        store,
        monkeypatch,
        item,
        (other["id"], other_original, other_marker),
    )


def test_delete_after_claim_before_lock_revalidation_skips_all_preparation(
    client, database, store, settings, monkeypatch
):
    race = markdown_race(client, database, store, monkeypatch)
    tts = FakeTts()
    worker = Worker(settings, database, store, tts_client=tts)
    claimed = threading.Event()
    allow_lock = threading.Event()
    original_lock = store.item_lock

    @contextmanager
    def pause_claimed_worker(item_id):
        if threading.current_thread().name == "preparation":
            claimed.set()
            if not allow_lock.wait(timeout=10):
                raise RuntimeError("test did not release claimed worker")
        with original_lock(item_id):
            yield

    monkeypatch.setattr(store, "item_lock", pause_claimed_worker)
    race.start_worker(worker)
    wait(claimed, "worker did not reach the pre-lock boundary")
    assert database.get_item(race.item["id"])["state"] == "preparing"
    race.start_delete()
    wait(race.committed, "deletion did not commit before the worker acquired its lock")
    allow_lock.set()
    race.finish()
    assert tts.calls == []


def test_delete_during_source_retrieval_discards_late_source(
    client, database, store, settings, monkeypatch
):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/source-race"},
        headers={"Origin": ORIGIN},
    )
    item = response.json()
    other = submit_markdown(client, b"Other item must remain.", "other.md")
    other_original = database.get_item(other["id"])["original_path"]
    other_job = database.get_item_job(other["id"])
    other_marker = f"work/{other_job['candidate_version']}/other-item.txt"
    store.write_bytes(other_marker, b"other item artifact")
    race = DeletionRace(
        client,
        database,
        store,
        monkeypatch,
        item,
        (other["id"], other_original, other_marker),
    )
    entered = threading.Event()
    release = threading.Event()

    class BlockingArticle:
        def __init__(self):
            self.calls = []

        def fetch_article(self, url):
            self.calls.append(url)
            entered.set()
            if not release.wait(timeout=10):
                raise RuntimeError("test did not release source retrieval")
            return ArticleResult(
                title="Late source",
                source_url=url,
                text="Late source paragraph.",
            )

    article = BlockingArticle()
    tts = FakeTts()
    worker = Worker(
        settings, database, store, article_adapter=article, tts_client=tts
    )
    race.start_worker(worker)
    wait(entered, "worker did not enter source retrieval")
    race.start_delete()
    wait(race.committed, "deletion did not commit during source retrieval")
    release.set()
    race.finish()
    assert article.calls == ["https://example.test/source-race"]
    assert tts.calls == []


def test_delete_during_tts_discards_late_segment_and_stops_before_assembly(
    client, database, store, settings, monkeypatch
):
    race = markdown_race(client, database, store, monkeypatch)
    entered = threading.Event()
    release = threading.Event()

    class BlockingTts(FakeTts):
        def synthesize(self, text):
            entered.set()
            if not release.wait(timeout=10):
                raise RuntimeError("test did not release TTS")
            return super().synthesize(text)

    class ForbiddenAssembler:
        def __init__(self):
            self.calls = 0

        def assemble(self, **kwargs):
            self.calls += 1
            raise AssertionError("assembly ran after deletion")

    tts = BlockingTts()
    assembler = ForbiddenAssembler()
    worker = Worker(
        settings, database, store, tts_client=tts, assembler=assembler
    )
    race.start_worker(worker)
    wait(entered, "worker did not enter TTS")
    race.start_delete()
    wait(race.committed, "deletion did not commit during TTS")
    release.set()
    race.finish()
    assert tts.calls == ["Target paragraph."]
    assert assembler.calls == 0


def test_delete_during_assembly_removes_all_generated_output(
    client, database, store, settings, monkeypatch
):
    race = markdown_race(client, database, store, monkeypatch)
    entered = threading.Event()
    release = threading.Event()
    assembled = []

    class BlockingAssembler:
        def assemble(self, **kwargs):
            entered.set()
            if not release.wait(timeout=10):
                raise RuntimeError("test did not release assembly")
            result = AudioAssembler(store).assemble(**kwargs)
            assembled.append(result)
            return result

    worker = Worker(
        settings,
        database,
        store,
        tts_client=FakeTts(),
        assembler=BlockingAssembler(),
    )
    race.start_worker(worker)
    wait(entered, "worker did not enter assembly")
    race.start_delete()
    wait(race.committed, "deletion did not commit during assembly")
    release.set()
    race.finish()
    assert len(assembled) == 1


def test_delete_after_filesystem_publication_before_db_publication_removes_version(
    client, database, store, settings, monkeypatch
):
    race = markdown_race(client, database, store, monkeypatch)
    filesystem_published = threading.Event()
    release = threading.Event()
    publication_results = []
    original_publish = database.publish_version

    def pause_before_db_publication(**kwargs):
        filesystem_published.set()
        if not release.wait(timeout=10):
            raise RuntimeError("test did not release database publication")
        result = original_publish(**kwargs)
        publication_results.append(result)
        return result

    monkeypatch.setattr(database, "publish_version", pause_before_db_publication)
    worker = Worker(settings, database, store, tts_client=FakeTts())
    race.start_worker(worker)
    wait(filesystem_published, "worker did not publish the filesystem version")
    version_root = f"versions/{database.get_item_job(race.item['id'])['candidate_version']}"
    assert store.path(f"{version_root}/audio.mp3").is_file()
    race.start_delete()
    wait(race.committed, "deletion did not commit before database publication")
    release.set()
    race.finish()
    assert publication_results == [False]


def test_delete_immediately_after_db_publication_includes_new_version(
    client, database, store, settings, monkeypatch
):
    race = markdown_race(client, database, store, monkeypatch)
    database_published = threading.Event()
    release = threading.Event()
    publication_results = []
    original_publish = database.publish_version

    def pause_after_db_publication(**kwargs):
        result = original_publish(**kwargs)
        publication_results.append(result)
        database_published.set()
        if not release.wait(timeout=10):
            raise RuntimeError("test did not release published worker")
        return result

    monkeypatch.setattr(database, "publish_version", pause_after_db_publication)
    worker = Worker(settings, database, store, tts_client=FakeTts())
    race.start_worker(worker)
    wait(database_published, "worker did not commit database publication")
    assert database.get_item(race.item["id"])["state"] == "ready"
    race.start_delete()
    wait(race.committed, "deletion did not commit after publication")
    with database.connect() as connection:
        receipt = connection.execute(
            "SELECT published_paths_json FROM item_deletions WHERE item_id = ?",
            (race.item["id"],),
        ).fetchone()
    assert race.roots[2] in json.loads(receipt["published_paths_json"])
    release.set()
    race.finish()
    assert publication_results == [True]
