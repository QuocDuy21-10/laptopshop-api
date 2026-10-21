#!/bin/sh
set -eu

until aws --endpoint-url "$STORAGE_ENDPOINT" s3api list-buckets >/dev/null 2>&1; do
  sleep 1
done

if ! aws --endpoint-url "$STORAGE_ENDPOINT" s3api head-bucket --bucket "$STORAGE_BUCKET" >/dev/null 2>&1; then
  aws --endpoint-url "$STORAGE_ENDPOINT" s3api create-bucket --bucket "$STORAGE_BUCKET"
fi
