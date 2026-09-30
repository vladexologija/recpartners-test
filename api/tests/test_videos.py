import uuid
from datetime import timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import PIPELINE_VERSION, SAMPLE_FPS, UPLOAD_LIMITS
from app.models import Analysis, AnalysisStatus, Detection, Video
from app.models.common import utc_now
from tests.conftest import FakePublisher

MB = 1024 * 1024


def create_body(video_id: uuid.UUID, size: int = 5 * MB) -> dict[str, object]:
    return {"id": str(video_id), "original_filename": "lunch.mp4", "declared_size": size}


def add_uploaded_video(
    session: Session, analysis_status: AnalysisStatus = "done"
) -> tuple[Video, Analysis]:
    """A video whose upload landed (step 4's GCS handler does this), with one detection."""
    video = Video(
        id=uuid.uuid4(),
        original_filename="lunch.mp4",
        declared_size=5 * MB,
        object_name="videos/x.mp4",
        status="uploaded",
        duration_s=12.5,
        codec="h264",
    )
    analysis = Analysis(
        video_id=video.id,
        pipeline_version=PIPELINE_VERSION,
        sample_fps=Decimal(SAMPLE_FPS),
        status=analysis_status,
        attempts=1,
        progress=1 if analysis_status == "done" else None,
        frames_sampled=25,
        detection_count=1,
    )
    session.add_all([video, analysis])  # the relationships make the ORM insert the video first
    session.flush()
    session.add(
        Detection(
            analysis_id=analysis.id,
            video_id=video.id,
            sample_idx=3,
            det_rank=0,
            t_seconds=1.5,
            confidence=0.9,
            x1=0.1,
            y1=0.2,
            x2=0.3,
            y2=0.4,
        )
    )
    session.commit()
    return video, analysis


def test_create_signs_an_upload_for_exactly_the_declared_size(
    client: TestClient, session: Session
) -> None:
    video_id = uuid.uuid4()
    response = client.post("/api/videos", json=create_body(video_id))
    assert response.status_code == 201
    upload = response.json()["upload"]
    assert upload["method"] == "PUT"
    assert upload["headers"]["x-goog-content-length-range"] == f"{5 * MB},{5 * MB}"
    video = session.get(Video, video_id)
    assert video is not None
    assert (video.status, video.object_name) == ("awaiting_upload", f"videos/{video_id}.mp4")


def test_a_retried_create_returns_the_same_video(client: TestClient, session: Session) -> None:
    video_id = uuid.uuid4()
    first = client.post("/api/videos", json=create_body(video_id))
    second = client.post("/api/videos", json=create_body(video_id))
    assert second.status_code == 201
    assert second.json() == first.json()
    assert len(session.exec(select(Video)).all()) == 1


def test_create_with_a_used_id_but_other_details_is_refused(client: TestClient) -> None:
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    response = client.post("/api/videos", json=create_body(video_id, size=6 * MB))
    assert response.status_code == 409


def test_create_refuses_files_over_200_mb(client: TestClient) -> None:
    response = client.post("/api/videos", json=create_body(uuid.uuid4(), size=200 * MB + 1))
    assert response.status_code == 422


def add_videos(session: Session, count: int, age: timedelta) -> None:
    """Videos registered `age` ago, to fill the upload limits."""
    for _ in range(count):
        video_id = uuid.uuid4()
        session.add(
            Video(
                id=video_id,
                original_filename="lunch.mp4",
                declared_size=MB,
                object_name=f"videos/{video_id}.mp4",
                created_at=utc_now() - age,
            )
        )
    session.commit()


def test_new_videos_over_the_hourly_limit_are_refused_but_a_retry_is_not(
    client: TestClient, session: Session
) -> None:
    per_hour = UPLOAD_LIMITS[0][1]
    first = uuid.uuid4()
    assert client.post("/api/videos", json=create_body(first)).status_code == 201
    add_videos(session, per_hour - 1, age=timedelta(minutes=5))
    assert client.post("/api/videos", json=create_body(uuid.uuid4())).status_code == 429
    assert client.post("/api/videos", json=create_body(first)).status_code == 201  # a retry
    assert len(session.exec(select(Video)).all()) == per_hour


def test_the_daily_limit_counts_videos_older_than_an_hour(
    client: TestClient, session: Session
) -> None:
    add_videos(session, UPLOAD_LIMITS[1][1], age=timedelta(hours=2))
    assert client.post("/api/videos", json=create_body(uuid.uuid4())).status_code == 429


def test_an_unknown_video_is_404(client: TestClient) -> None:
    assert client.get(f"/api/videos/{uuid.uuid4()}").status_code == 404


def test_a_video_awaiting_its_upload(client: TestClient) -> None:
    video_id = uuid.uuid4()
    client.post("/api/videos", json=create_body(video_id))
    body = client.get(f"/api/videos/{video_id}").json()
    assert body["analysis"]["state"] == "awaiting_upload"
    assert client.get(f"/api/videos/{video_id}/playback").status_code == 409


def test_a_processed_video(client: TestClient, session: Session) -> None:
    video, _ = add_uploaded_video(session)
    body = client.get(f"/api/videos/{video.id}").json()
    assert body == {
        "id": str(video.id),
        "original_filename": "lunch.mp4",
        "duration_s": 12.5,
        "codec": "h264",
        "analysis": {
            "state": "done",
            "progress": 1.0,
            "error": None,
            "attempts": 1,
            "frames_sampled": 25,
            "detection_count": 1,
        },
    }
    playback = client.get(f"/api/videos/{video.id}/playback").json()
    assert playback == {"url": "https://gcs.test/get/videos/x.mp4"}


def test_detections_come_with_the_sampling_rate_and_display_threshold(
    client: TestClient, session: Session
) -> None:
    video, _ = add_uploaded_video(session)
    body = client.get(f"/api/videos/{video.id}/detections").json()
    assert body["sample_fps"] == 2.0
    assert body["display_threshold"] == 0.4
    assert body["detections"] == [
        {"t_seconds": 1.5, "confidence": 0.9, "x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4}
    ]


def test_reprocess_deletes_the_results_and_publishes_one_job(
    client: TestClient, session: Session, publisher: FakePublisher
) -> None:
    video, analysis = add_uploaded_video(session)
    response = client.post(f"/api/videos/{video.id}/reprocess")
    assert response.status_code == 202
    assert response.json()["analysis"] == {
        "state": "queued",
        "progress": None,
        "error": None,
        "attempts": 0,
        "frames_sampled": None,
        "detection_count": None,
    }
    assert client.get(f"/api/videos/{video.id}/detections").json()["detections"] == []
    assert [(job.analysis_id, job.video_id) for job in publisher.jobs] == [(analysis.id, video.id)]


def test_reprocess_is_refused_while_processing(
    client: TestClient, session: Session, publisher: FakePublisher
) -> None:
    video, _ = add_uploaded_video(session, analysis_status="processing")
    response = client.post(f"/api/videos/{video.id}/reprocess")
    assert response.status_code == 409
    assert client.get(f"/api/videos/{video.id}").json()["analysis"]["state"] == "processing"
    assert len(client.get(f"/api/videos/{video.id}/detections").json()["detections"]) == 1
    assert publisher.jobs == []


def test_reprocess_while_queued_publishes_again(
    client: TestClient, session: Session, publisher: FakePublisher
) -> None:
    """The retry after a failed publish: the analysis stayed queued, so publish once more."""
    video, _ = add_uploaded_video(session, analysis_status="queued")
    assert client.post(f"/api/videos/{video.id}/reprocess").status_code == 202
    assert client.post(f"/api/videos/{video.id}/reprocess").status_code == 202
    assert len(publisher.jobs) == 2
