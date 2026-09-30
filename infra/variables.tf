variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "europe-west1"
}

# Written by `make release` into image.auto.tfvars (committed): image references by digest.
variable "web_image" {
  type    = string
  default = ""
}

variable "worker_image" {
  type    = string
  default = ""
}

# Worker size (D4, D5). Measure one long video on Cloud Run before changing it.
variable "worker_cpu" {
  type    = string
  default = "2"
}

variable "worker_memory" {
  type    = string
  default = "4Gi" # /tmp lives in memory and holds a video of up to 200 MB
}

variable "worker_min_instances" {
  type    = number
  default = 0 # 1 while reviewers try it: no PyTorch cold start (D5); `make pause` sets 0
}

variable "worker_max_instances" {
  type    = number
  default = 3
}

# Browser origins allowed to upload to the bucket besides the web service's own URL.
variable "extra_cors_origins" {
  type    = list(string)
  default = []
}

variable "protect_db" {
  type    = bool
  default = true # apply false before `make destroy`
}
