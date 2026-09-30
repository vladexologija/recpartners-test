# Senior Full-Stack Engineer — Take-Home Exercise
## Cloud video pipeline: is there a hot dog in this video?

### The task

We build video analytics products: customers upload footage, we detect things in it, and we show the results back on
top of the video. This exercise is a miniature of that pipeline, and the thing we are looking for is a hot dog. 
We are assessing how you design and wire a small distributed system end to end:
* upload, 
* storage
* asynchronous processing
* persistence
* playback. 

We are not assessing model accuracy. Use pre-trained weights; train nothing.

### What you will build

1. Upload: A web front end lets a user choose a video file. The file lands in cloud object storage Google Cloud
Storage, or Amazon S3 if you prefer.
2. Detect: A backend service picks the uploaded video up, samples frames from it, and runs a pre-trained YOLO
model over them to find hot dogs. COCO already has a hot dog class, so stock weights work.
3. Persist: Per-frame results — timestamp, bounding box, confidence — go into a PostgreSQL database hosted on
GCP Cloud SQL or AWS RDS.
4. Play back: The front end plays the uploaded video and draws boxes over the hot dogs in time with playback. If
there is no hot dog in the video, the interface says so clearly.

### Functional requirements
* Uploads accept MP4 up to 200 MB. Handling a file that size is part of the exercise: do not stream it through your API
process if you can avoid it.
* Processing is asynchronous. The upload request must not block until detection finishes. The interface shows job
state:
    * queued
    * processing
    * done
    * failed 
and recovers correctly if the page is refreshed mid-job.
* Detection runs on sampled frames, not every frame. The sampling rate is your decision; state and defend it in your
notes.
* Every stored detection is traceable to a video, a timestamp in seconds, a bounding box and a confidence score.
* The overlay stays aligned with the picture when the viewer seeks, pauses and resizes the window.
* Processing the same video twice must not produce two sets of results.

### Technical constraints
* Fixed: Object storage is GCS or S3 — a real bucket, not local disk. The database is PostgreSQL, hosted, with a
schema managed by migrations. The detector is a pre-trained model from the YOLO family. The player plays the
uploaded file from storage, not a local copy.
* Stack: The front end is TypeScript; React and React-based frameworks such as Next.js are accepted. Python is our
preferred backend language. If you would rather use another language on either side, reach out to us to confirm before
you start.
* Yours. Everything else: there is no starter code, so structure the project the way you think is right. Backend framework,
queue or job mechanism, ORM or none, infrastructure as code or click-ops, and where the compute runs are all your
call.

### What to send back
* A Git repository, or a zip of one with its history intact.
* A way for us to run it. Either a live deployment we can open in a browser, left running until we confirm we have
reviewed it; or a containerised solution (Dockerfiles plus Docker Compose or equivalent) with instructions that
take us from a clean machine to a working pipeline, including setting up the bucket and the database.
* A README that tells us how to set it up and run it. We will follow it literally on a clean machine.
* A NOTES.md of about one page: your architecture and why; your sampling rate and the cost against accuracy
trade-off behind it; what you would change for a 2-hour video; and what you left out.