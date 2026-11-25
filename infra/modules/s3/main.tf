resource "aws_s3_bucket" "media" {
  bucket = var.bucket_name

  tags = merge(var.tags, {
    Name = var.bucket_name
  })
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != "" ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expire-raw-uploads"
    status = "Enabled"

    filter {
      prefix = "uploads/raw/"
    }

    expiration {
      days = 7
    }
  }

  rule {
    id     = "expire-temp-uploads"
    status = "Enabled"

    filter {
      prefix = "uploads/temp/"
    }

    expiration {
      days = 2
    }
  }
}

# Cross-region replication for disaster recovery (see docs/runbooks/disaster-recovery.md)
resource "aws_s3_bucket_replication_configuration" "media" {
  count = var.replica_bucket_arn != "" ? 1 : 0

  bucket = aws_s3_bucket.media.id
  role   = aws_iam_role.replication[0].arn

  rule {
    id     = "replicate-all"
    status = "Enabled"

    filter {}

    destination {
      bucket        = var.replica_bucket_arn
      storage_class = "STANDARD_IA"
    }

    delete_marker_replication {
      status = "Enabled"
    }
  }

  depends_on = [aws_s3_bucket_versioning.media]
}

resource "aws_iam_role" "replication" {
  count = var.replica_bucket_arn != "" ? 1 : 0

  name = "${var.environment}-s3-replication-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "replication" {
  count = var.replica_bucket_arn != "" ? 1 : 0

  name = "${var.environment}-s3-replication-policy"
  role = aws_iam_role.replication[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Effect   = "Allow"
        Resource = aws_s3_bucket.media.arn
      },
      {
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Effect   = "Allow"
        Resource = "${var.replica_bucket_arn}/*"
      }
    ]
  })
}
