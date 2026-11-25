output "bucket_arn" {
  description = "ARN of the media bucket"
  value       = aws_s3_bucket.media.arn
}

output "bucket_name" {
  description = "Name of the media bucket"
  value       = aws_s3_bucket.media.id
}
