"""Real FFmpeg multi-paragraph assembly and prepared-version corruption tests."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest

from conftest import make_wav
from vesna.audio import AssemblyError, AudioAssembler


def make_input(store, name="input.wav", content=None):
    relative = f"work/test/{name}"
    store.write_bytes(relative, content if content is not None else make_wav())
    return relative


def test_multi_paragraph_mp3_and_timings_match_encoded_durations(store):
    assembler = AudioAssembler(store)
    paragraphs = [
        {"id": "p0", "text": "First generated paragraph."},
        {"id": "p1", "text": "Second generated paragraph."},
        {"id": "p2", "text": "Third generated paragraph."},
    ]
    version = str(uuid4())
    item = str(uuid4())
    result = assembler.assemble(
        item_id=item,
        version=version,
        voice_id="fixture-voice",
        paragraphs=paragraphs,
        segment_paths=[
            make_input(store, "one.wav", make_wav(0.20)),
            make_input(store, "two.wav", make_wav(0.28)),
            make_input(store, "three.wav", make_wav(0.36)),
        ],
    )
    assert result.paragraph_count == 3
    audio = store.path(f"versions/{version}/audio.mp3")
    assert audio.stat().st_size > 100
    duration, codec = assembler.probe(audio)
    assert codec == "mp3"
    assert duration == pytest.approx(result.duration, abs=0.001)
    text = store.read_json(f"versions/{version}/text.json")
    timings = store.read_json(f"versions/{version}/timings.json")
    manifest = store.read_json(f"versions/{version}/manifest.json")
    assert text == {"version": version, "paragraphs": paragraphs}
    assert [position["id"] for position in timings["timings"]] == ["p0", "p1", "p2"]
    assert timings["timings"][0]["start"] == 0.0
    assert timings["timings"][-1]["end"] == pytest.approx(duration, abs=0.001)
    for previous, current in zip(timings["timings"], timings["timings"][1:]):
        assert current["start"] == previous["end"]
        assert current["end"] > current["start"]
    expected_start = 0.0
    for index, position in enumerate(timings["timings"][:-1]):
        segment_duration, _ = assembler.probe(
            store.path(f"work/{version}/encoded/p{index}.mp3")
        )
        assert position["start"] == pytest.approx(expected_start, abs=0.000001)
        assert position["end"] - position["start"] == pytest.approx(
            segment_duration, abs=0.000001
        )
        expected_start = position["end"]
    assert manifest["item_id"] == item
    assert manifest["voice_id"] == "fixture-voice"
    assert manifest["audio_sha256"] == result.audio_sha256
    assert not store.path(f"staging/{version}/segments.concat").exists()


def test_missing_segment_never_publishes_version(store):
    assembler = AudioAssembler(store)
    version = str(uuid4())
    with pytest.raises(AssemblyError):
        assembler.assemble(
            item_id=str(uuid4()),
            version=version,
            voice_id="fixture",
            paragraphs=[{"id": "p0", "text": "text"}],
            segment_paths=["work/test/missing.wav"],
        )
    assert not store.path(f"versions/{version}").exists()


def test_corrupt_wav_is_rejected_before_publication(store):
    assembler = AudioAssembler(store)
    version = str(uuid4())
    with pytest.raises(AssemblyError):
        assembler.assemble(
            item_id=str(uuid4()),
            version=version,
            voice_id="fixture",
            paragraphs=[{"id": "p0", "text": "text"}],
            segment_paths=[make_input(store, content=b"not wave audio")],
        )
    assert not store.path(f"versions/{version}").exists()


def test_paragraph_segment_count_mismatch_is_rejected(store):
    with pytest.raises(AssemblyError):
        AudioAssembler(store).assemble(
            item_id=str(uuid4()),
            version=str(uuid4()),
            voice_id="fixture",
            paragraphs=[{"id": "p0", "text": "one"}, {"id": "p1", "text": "two"}],
            segment_paths=[make_input(store)],
        )


def published_version(store):
    assembler = AudioAssembler(store)
    version = str(uuid4())
    item = str(uuid4())
    assembler.assemble(
        item_id=item,
        version=version,
        voice_id="fixture",
        paragraphs=[{"id": "p0", "text": "one"}, {"id": "p1", "text": "two"}],
        segment_paths=[make_input(store, "a.wav"), make_input(store, "b.wav")],
    )
    return assembler, item, version


@pytest.mark.parametrize("filename", ["text.json", "timings.json", "audio.mp3"])
def test_tampered_ready_artifacts_fail_verification(store, filename):
    assembler, item, version = published_version(store)
    relative = f"versions/{version}/{filename}"
    original = store.read_bytes(relative)
    store.write_bytes(relative, original + b"tampered")
    with pytest.raises(AssemblyError):
        assembler.verify(f"versions/{version}", item_id=item, version=version, voice_id="fixture")


def test_missing_manifest_and_mismatched_manifest_are_rejected(store):
    assembler, item, version = published_version(store)
    manifest_path = f"versions/{version}/manifest.json"
    manifest = store.read_json(manifest_path)
    manifest["item_id"] = str(uuid4())
    store.write_json(manifest_path, manifest)
    with pytest.raises(AssemblyError, match="item"):
        assembler.verify(f"versions/{version}", item_id=item, version=version)
    store.remove(manifest_path)
    with pytest.raises(AssemblyError):
        assembler.verify(f"versions/{version}")


def test_timing_paragraph_identity_mismatch_is_rejected(store):
    assembler, item, version = published_version(store)
    timings_path = f"versions/{version}/timings.json"
    timings = store.read_json(timings_path)
    timings["timings"][0]["id"] = "wrong"
    store.write_json(timings_path, timings)
    # Keep hashes internally consistent so identity validation, not only hashing, is exercised.
    manifest_path = f"versions/{version}/manifest.json"
    manifest = store.read_json(manifest_path)
    manifest["timings_sha256"] = store.sha256(timings_path)
    store.write_json(manifest_path, manifest)
    with pytest.raises(AssemblyError, match="identifiers"):
        assembler.verify(f"versions/{version}", item_id=item, version=version)


def test_existing_complete_version_is_reused_without_reencoding(store):
    assembler, item, version = published_version(store)
    # A missing FFmpeg executable would break a new encode, but valid version reuse only probes.
    reuser = AudioAssembler(store, ffmpeg_command="/definitely/missing/ffmpeg")
    result = reuser.assemble(
        item_id=item,
        version=version,
        voice_id="fixture",
        paragraphs=[{"id": "p0", "text": "one"}, {"id": "p1", "text": "two"}],
        segment_paths=["unused", "unused"],
    )
    assert result.version == version
    with pytest.raises(AssemblyError, match="voice"):
        reuser.verify(f"versions/{version}", voice_id="other")
