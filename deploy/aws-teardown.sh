#!/usr/bin/env bash
# Deletes everything aws-provision.sh created, to stop charges. IRREVERSIBLE (no DB snapshot).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/.deploy-env"
aws() { command aws --region "$REGION" "$@"; }

read -r -p "Delete EC2, RDS database (all data), Elastic IP and security groups for '$APP'? Type 'delete' to confirm: " ans
[ "$ans" = "delete" ] || { echo "Aborted."; exit 1; }

aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null
aws rds delete-db-instance --db-instance-identifier "$APP-db" --skip-final-snapshot --delete-automated-backups >/dev/null
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
aws ec2 release-address --allocation-id "$ALLOC_ID"
echo "Waiting for the database to be deleted..."
aws rds wait db-instance-deleted --db-instance-identifier "$APP-db"
aws ec2 delete-security-group --group-id "$DB_SG"
aws ec2 delete-security-group --group-id "$WEB_SG"
rm -f "$(dirname "$0")/.deploy-env"
echo "All resources deleted."
