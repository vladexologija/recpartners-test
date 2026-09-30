# Notes

## Architecture and why
```
browser ──signed PUT──► GCS ──notification──► uploads ──push──► web (API + app, 1 instance)
web ──analysis-jobs ──push──► worker (private; 1 job per instance, 0–3): download → ffprobe → ffmpeg → YOLO
worker ──analysis-events (started, progress, done with the boxes, failed) ──push──► web → Postgres → SSE → browser
```
* The API signs a PUT, the API never touches the bytes. Validation on signature, upload and worker side.
* Indempotency support because redelivery and duplicates are expected
* Pub/Sub / push, so Cloud Run scales the worker with the queue and nothing polls. Danger: 
  Pub/Sub's 10-minute limit per push.
* SSE, each update sent to frontend.
* The tiniest model possible YOLO26n, 1 GB image with weights.
* Terraform for easier setup on GCS.

## Sampling: 2 frames per second
We check 2 pictures per second instead of all. That gives a hot dog appearing only for a second two chances to be caught, about 84% against 60% when checking once a second. Checking more often just wastes time and not visible to human eye. Boxes are stored from confidence 0.25 and shown from 0.40, so the UI threshold can change without reprocessing.

## A 2-hour video
A 2 hour video has roughly 14,400 pictures to check that would exceede 10 minute job. One solution to speed up this anyway is to cut into segments each having it's own workers and to run merge (piece by piece) once all are done. Uploads would also need to resume after a dropped connection and allow much bigger files. We can also pick something without 10 minute limit to be on the safe side e.g Inngest, Celery...

## What was left out
* Resumable uploads that survive a refresh, with the progress kept in local storage
* A proper video player library and box rendering ( In Firefox and Safari especially )
* More structured state, data and API handling in the frontend
* Models generated from one shared schema, such as protobuf
* CUDA torch on a GPU
* A job system without Pub/Sub's 10-minute limit
* A second look at decoding: the CPU split between torch and ffmpeg, or PyAV
* Passing the whole video to YOLO 
* Reading only the byte ranges needed instead of the whole video, and frames saved as JPGs or kept on a regular disk instead of in memory
* Crowded scenes, in a video with rows of bare sausages on a grill, the model found few hot dogs
* Retries
