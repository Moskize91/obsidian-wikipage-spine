#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path


DEFAULT_URL = "https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.bz2"
DEFAULT_USER_AGENT = (
    "obsidian-wikipage-spine-dataset-builder/0.1 "
    "(+https://github.com/moskize91/obsidian-wikipage-spine)"
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download the Wikidata entities dump with downloaderx."
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--output", type=Path, default=default_output_path())
    parser.add_argument("--downloaderx-path", type=Path, default=default_downloaderx_path())
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--retry-times", type=int, default=100)
    parser.add_argument("--retry-sleep", type=float, default=15.0)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--min-segment-mib", type=int, default=512)
    parser.add_argument("--fetch-mib", type=int, default=1)
    parser.add_argument("--progress-seconds", type=float, default=30.0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-adopt-curl-part", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    if args.threads <= 0:
        parser.error("--threads must be greater than 0")
    if args.min_segment_mib <= 0:
        parser.error("--min-segment-mib must be greater than 0")
    if args.fetch_mib <= 0:
        parser.error("--fetch-mib must be greater than 0")

    prepare_downloaderx_import(args.downloaderx_path)
    try:
        from downloaderx import download
        from downloaderx.type import RetryError, Task, TaskError
    except Exception as error:
        print(
            "Cannot import downloaderx. Install it or pass --downloaderx-path.",
            file=sys.stderr,
        )
        print(f"Import error: {error}", file=sys.stderr)
        return 1

    output = args.output.resolve()
    working_output = working_output_path(output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if not args.no_adopt_curl_part:
        adopt_curl_part(output, working_output)
    adopt_legacy_downloaderx_chunks(output, working_output)
    resume_marker = ensure_downloaderx_zero_offset_marker(working_output)

    print(f"url: {args.url}")
    print(f"output: {output}")
    if working_output != output:
        print(f"download_working_file: {working_output}")
    print(f"threads: {args.threads}")
    print(f"downloaderx_path: {args.downloaderx_path}")
    print(f"downloaded_chunks: {format_bytes(current_downloaded_bytes(working_output))}")
    if args.check_only:
        return 0

    if output.exists():
        print(f"skipped existing final file: {output}")
        return 0

    stop_progress = threading.Event()
    progress_thread = threading.Thread(
        target=report_progress,
        args=(working_output, args.progress_seconds, stop_progress),
        daemon=True,
    )
    progress_thread.start()

    def on_task_completed(task: Task) -> None:
        print(f"completed: {task.file}")

    def on_task_skipped(task: Task) -> None:
        print(f"skipped existing file: {task.file}")

    def on_task_failed(error: TaskError) -> None:
        print(f"failed: {error.case_error}", file=sys.stderr)

    def on_task_failed_with_retry_error(error: RetryError) -> None:
        print(f"retryable failure: {error.case_error}", file=sys.stderr)

    try:
        download(
            Task(
                url=args.url,
                file=working_output,
                headers={"User-Agent": DEFAULT_USER_AGENT},
            ),
            window_width=1,
            threads_count=args.threads,
            failure_ladder=(10, 20, 70),
            min_segment_length=args.min_segment_mib * 1024 * 1024,
            once_fetch_size=args.fetch_mib * 1024 * 1024,
            timeout=args.timeout,
            retry_times=args.retry_times,
            retry_sleep=args.retry_sleep,
            override_existing_files=args.force,
            on_task_completed=on_task_completed,
            on_task_skipped=on_task_skipped,
            on_task_failed=on_task_failed,
            on_task_failed_with_retry_error=on_task_failed_with_retry_error,
        )
    finally:
        stop_progress.set()
        progress_thread.join(timeout=1.0)

    if working_output != output and working_output.exists():
        working_output.rename(output)
        print(f"renamed: {working_output} -> {output}")
    if resume_marker is not None:
        resume_marker.unlink(missing_ok=True)

    return 0


def default_output_path() -> Path:
    return repo_root() / "crates/data/dumps/wikidatawiki/latest/latest-all.json.bz2"


def default_downloaderx_path() -> Path:
    return repo_root().parent / "downloaderx"


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def prepare_downloaderx_import(path: Path) -> None:
    if path.exists():
        sys.path.insert(0, str(path.resolve()))


def working_output_path(output: Path) -> Path:
    if len(output.suffixes) <= 1:
        return output

    # downloaderx reconstructs Range chunks from Path.stem and Path.suffix.
    # A multi-suffix final name like latest-all.json.bz2 makes its own offset-0
    # chunk invisible during resume, so the temporary working name must have a
    # single suffix.
    safe_stem = output.stem.replace(".", "-")
    return output.with_name(f"{safe_stem}{output.suffix}")


def adopt_curl_part(output: Path, working_output: Path) -> None:
    curl_part = output.with_name(output.name + ".part")
    downloaderx_part = working_output.with_name(working_output.name + ".downloading")
    if output.exists() or working_output.exists() or downloaderx_part.exists() or not curl_part.exists():
        return

    print(f"adopt curl partial: {curl_part} -> {downloaderx_part}")
    curl_part.rename(downloaderx_part)


def adopt_legacy_downloaderx_chunks(output: Path, working_output: Path) -> None:
    if output == working_output:
        return

    legacy_first = output.with_name(output.name + ".downloading")
    working_first = working_output.with_name(working_output.name + ".downloading")
    if legacy_first.exists() and not working_first.exists():
        print(f"adopt legacy downloaderx chunk: {legacy_first} -> {working_first}")
        legacy_first.rename(working_first)

    legacy_pattern = f"{output.stem}.*{output.suffix}.downloading"
    for legacy_path in sorted(output.parent.glob(legacy_pattern)):
        offset = legacy_path.name.removeprefix(output.stem + ".").removesuffix(output.suffix + ".downloading")
        if not offset.isdigit():
            continue
        working_path = working_output.with_name(f"{working_output.stem}.{offset}{working_output.suffix}.downloading")
        if working_path.exists():
            continue
        print(f"adopt legacy downloaderx chunk: {legacy_path} -> {working_path}")
        legacy_path.rename(working_path)


def ensure_downloaderx_zero_offset_marker(output: Path) -> Path | None:
    first_chunk = output.with_name(output.name + ".downloading")
    if not first_chunk.exists():
        return None

    # downloaderx writes the offset-0 chunk as "<name><suffix>.downloading",
    # but its resume scanner looks for "<stem>.downloading". A zero-byte marker
    # makes the scanner yield offset 0 while the real chunk still stores data.
    marker = output.with_name(output.stem + ".downloading")
    if marker != first_chunk and not marker.exists():
        print(f"create downloaderx resume marker: {marker}")
        marker.touch()
    return marker if marker != first_chunk else None


def report_progress(output: Path, interval_seconds: float, stop: threading.Event) -> None:
    while not stop.wait(interval_seconds):
        downloaded = current_downloaded_bytes(output)
        print(f"downloaded_chunks: {format_bytes(downloaded)}")


def current_downloaded_bytes(output: Path) -> int:
    total = 0
    for path in downloaderx_chunk_paths(output):
        if path.is_file():
            total += path.stat().st_size
    if output.is_file():
        total += output.stat().st_size
    return total


def downloaderx_chunk_paths(output: Path) -> list[Path]:
    paths = []
    first = output.with_name(output.name + ".downloading")
    paths.append(first)
    paths.extend(output.parent.glob(f"{output.stem}.*{output.suffix}.downloading"))
    return sorted(set(paths))


def format_bytes(value: int) -> str:
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.2f} {unit}"
        size /= 1024
    raise AssertionError("unreachable")


if __name__ == "__main__":
    raise SystemExit(main())
