#!/bin/sh
set -eu

until aws --endpoint-url "$STORAGE_ENDPOINT" s3api list-buckets >/dev/null 2>&1; do
  sleep 1
done

for bucket in $(printf '%s' "${STORAGE_BUCKETS:-$STORAGE_BUCKET}" | tr ',' ' '); do
  if ! aws --endpoint-url "$STORAGE_ENDPOINT" s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    aws --endpoint-url "$STORAGE_ENDPOINT" s3api create-bucket --bucket "$bucket"
  fi
done
