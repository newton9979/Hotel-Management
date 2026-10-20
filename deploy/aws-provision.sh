#!/usr/bin/env bash
# Creates the AWS infrastructure: security groups, RDS PostgreSQL, EC2 + Elastic IP.
# Prereqs: AWS CLI v2 configured (`aws configure`), an existing EC2 key pair.
#
#   KEY_NAME=my-keypair KEY_PATH=~/.ssh/my-keypair.pem ./deploy/aws-provision.sh
#
# Writes connection details to deploy/.deploy-env (used by deploy.sh). Costs real money
# while running: tear down with deploy/aws-teardown.sh when finished testing.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"          # Mumbai
APP="${APP_NAME:-hotel-mgmt}"
KEY_NAME="${KEY_NAME:?Set KEY_NAME to an existing EC2 key pair name}"
KEY_PATH="${KEY_PATH:?Set KEY_PATH to the matching .pem file path}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"  # 2 vCPU / 2 GB: comfortable for 100 users
DB_CLASS="${DB_CLASS:-db.t3.micro}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
MY_IP="${MY_IP:-$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')}"
OUT="$(dirname "$0")/.deploy-env"

aws() { command aws --region "$REGION" "$@"; }

echo "Region: $REGION | SSH allowed from: $MY_IP/32"

VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC_ID" != "None" ] || { echo "No default VPC in $REGION"; exit 1; }

echo "==> Security groups"
WEB_SG=$(aws ec2 create-security-group --group-name "$APP-web" --description "$APP web" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" --protocol tcp --port 22  --cidr "$MY_IP/32" >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" --protocol tcp --port 80  --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null

DB_SG=$(aws ec2 create-security-group --group-name "$APP-db" --description "$APP database" --vpc-id "$VPC_ID" --query GroupId --output text)
# Database reachable ONLY from the web server's security group
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --source-group "$WEB_SG" >/dev/null

echo "==> RDS PostgreSQL ($DB_CLASS) - takes ~5-10 minutes"
aws rds create-db-instance \
  --db-instance-identifier "$APP-db" \
  --engine postgres \
  --db-instance-class "$DB_CLASS" \
  --allocated-storage 20 --storage-type gp3 --storage-encrypted \
  --master-username hotel_admin --master-user-password "$DB_PASSWORD" \
  --db-name hotels \
  --vpc-security-group-ids "$DB_SG" \
  --no-publicly-accessible \
  --backup-retention-period 7 >/dev/null

echo "==> EC2 instance ($INSTANCE_TYPE)"
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id --query Parameter.Value --output text)
INSTANCE_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" --security-group-ids "$WEB_SG" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$APP-web}]" \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC" >/dev/null
EC2_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)

echo "==> Waiting for database to become available..."
aws rds wait db-instance-available --db-instance-identifier "$APP-db"
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier "$APP-db" --query 'DBInstances[0].Endpoint.Address' --output text)

umask 077
cat > "$OUT" <<EOF
REGION=$REGION
APP=$APP
KEY_PATH=$KEY_PATH
EC2_IP=$EC2_IP
INSTANCE_ID=$INSTANCE_ID
ALLOC_ID=$ALLOC
WEB_SG=$WEB_SG
DB_SG=$DB_SG
DB_HOST=$DB_HOST
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
EOF

echo
echo "Infrastructure ready."
echo "  Server : $EC2_IP"
echo "  DB     : $DB_HOST"
echo "Next: ./deploy/deploy.sh"
