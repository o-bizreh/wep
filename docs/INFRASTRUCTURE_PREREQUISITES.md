# Infrastructure Prerequisites

This document lists every AWS resource and GitHub configuration that must exist before the GitHub Actions CI/CD workflows can run successfully. Follow each section in order — resources later in the document may depend on ones defined earlier.

---

## 1. IAM — GitHub Actions OIDC

### OIDC Identity Provider

GitHub Actions authenticates to AWS via OpenID Connect (OIDC), eliminating the need for long-lived access keys.

**Create once per AWS account:**

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### Deploy Role (`AWS_DEPLOY_ROLE_ARN`)

Create an IAM role named `wep-github-deploy` (or your preferred name) with the following trust policy. Replace `washmen` with the actual GitHub organization name.

**Trust policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:washmen/*:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

**Permissions policy — attach inline or as a managed policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:BatchGetImage"
      ],
      "Resource": [
        "arn:aws:ecr:me-south-1:<ACCOUNT_ID>:repository/wep-api",
        "arn:aws:ecr:me-south-1:<ACCOUNT_ID>:repository/wep-ecs-scanner"
      ]
    },
    {
      "Sid": "ECSDescribeAndRegister",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:DescribeServices",
        "ecs:UpdateService"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECSPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/wep-ecs-task-execution-role",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    },
    {
      "Sid": "LambdaUpdate",
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction"
      ],
      "Resource": "arn:aws:lambda:me-south-1:<ACCOUNT_ID>:function:wep-alert-evaluator"
    },
    {
      "Sid": "S3Frontend",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::wep-frontend-<ENVIRONMENT>",
        "arn:aws:s3:::wep-frontend-<ENVIRONMENT>/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
    }
  ]
}
```

**Used by:** all four workflows.

---

## 2. ECR Repositories

Create both repositories in `me-south-1` before the first API or scanner deploy.

```bash
aws ecr create-repository --repository-name wep-api        --region me-south-1
aws ecr create-repository --repository-name wep-ecs-scanner --region me-south-1
```

Enable image scanning on push (recommended):

```bash
aws ecr put-image-scanning-configuration \
  --repository-name wep-api \
  --image-scanning-configuration scanOnPush=true \
  --region me-south-1

aws ecr put-image-scanning-configuration \
  --repository-name wep-ecs-scanner \
  --image-scanning-configuration scanOnPush=true \
  --region me-south-1
```

**Used by:** `deploy-api.yml`, `deploy-ecs-scanner.yml`.

---

## 3. ECS

### Task Execution Role

Both ECS services need a task execution role to pull images from ECR and write logs to CloudWatch:

```bash
aws iam create-role \
  --role-name wep-ecs-task-execution-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name wep-ecs-task-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### API Service (`deploy-api.yml`)

| Resource | Expected name/pattern |
|---|---|
| ECS cluster | `wep-api` (set as `API_ECS_CLUSTER` secret) |
| ECS service | `wep-api-service` (set as `API_ECS_SERVICE` secret) |
| Task definition family | `wep-api` (set as `API_ECS_TASK_DEFINITION` secret) |
| Container name inside task def | `api` — must match the `container-name` field in the workflow |

The initial task definition must be registered manually before the first workflow run. The workflow downloads the current definition, swaps the image, and re-registers it.

**Environment variables the API container requires** (set in the task definition):

| Variable | Source |
|---|---|
| `NODE_ENV` | `production` (literal) |
| `WEP_ENVIRONMENT` | `production` (or `staging`) |
| `GITHUB_ORG` | Your GitHub organization name |
| `GITHUB_TOKEN` | From Secrets Manager: `wep/github-token` |
| `SLACK_BOT_TOKEN` | From Secrets Manager: `wep/slack-bot-token` |
| `SESSION_SECRET` | From Secrets Manager: `wep/session-secret` |
| `REDIS_URL` | Redis endpoint URL |
| `CORS_ORIGIN` | CloudFront distribution URL (e.g. `https://d1234.cloudfront.net`) |

To pull secrets from Secrets Manager at runtime, add `secrets` entries to the task definition and attach the `secretsmanager:GetSecretValue` permission to the task execution role.

### ECS Scanner Service (`deploy-ecs-scanner.yml`)

The scanner runs as a **scheduled task**, not a long-running service. The workflow only registers a new task definition revision — the EventBridge schedule rule invokes it.

| Resource | Expected name/pattern |
|---|---|
| ECS cluster | `wep-background-scanner` (same cluster can be reused if preferred) |
| Task definition family | `wep-background-scanner` (set as `SCANNER_ECS_TASK_DEFINITION` secret) |
| Container name inside task def | `scanner` — must match the `container-name` field in the workflow |

The EventBridge schedule rule that triggers this task must point at the task definition ARN. After each workflow run, update the rule's `EcsParameters.TaskDefinitionArn` to the latest revision, or configure the rule to always use `<family>:LATEST`.

**Used by:** `deploy-api.yml` (cluster + service + task def), `deploy-ecs-scanner.yml` (task def only).

---

## 4. Lambda

### `wep-alert-evaluator`

The Lambda workflow uses `update-function-code` only — it does **not** create the function. The function must already exist.

**Create the function once:**

```bash
# Create a placeholder zip to satisfy the initial create call
echo '{"handler":"index.handler"}' > placeholder.json
zip placeholder.zip placeholder.json

aws lambda create-function \
  --function-name wep-alert-evaluator \
  --runtime nodejs20.x \
  --handler dist/index.handler \
  --role arn:aws:iam::<ACCOUNT_ID>:role/wep-lambda-alert-evaluator-role \
  --zip-file fileb://placeholder.zip \
  --timeout 300 \
  --memory-size 256 \
  --environment "Variables={WEP_ENVIRONMENT=production,SLACK_BOT_TOKEN=placeholder}" \
  --region me-south-1
```

Replace the placeholder zip with a real build before enabling the EventBridge triggers.

**Lambda execution role permissions:**

The role `wep-lambda-alert-evaluator-role` needs:
- `dynamodb:Query`, `dynamodb:GetItem`, `dynamodb:PutItem` on the `wep-notify-*` table
- `dynamodb:Query` on the `wep-cost-intelligence-*` table (for cost spike evaluation)
- `ce:GetCostAndUsage` in `us-east-1` (Cost Explorer is always `us-east-1` regardless of deployment region)
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

**Environment variables:**

| Variable | Value |
|---|---|
| `WEP_ENVIRONMENT` | `production` (or `staging`) |
| `SLACK_BOT_TOKEN` | Fetch from Secrets Manager at runtime, or set directly for simplicity |

**EventBridge schedule rules** (5 rules, one per condition):

These rules are created by the SAM template (`lambdas/alert-evaluator/template.yaml` or equivalent). They must be deployed once manually:

```bash
sam deploy --guided --region me-south-1
```

After the initial SAM deploy, subsequent Lambda code updates are handled by the GitHub Actions workflow. Re-running `sam deploy` is only needed when the schedule rules, IAM role, or function configuration changes.

**Used by:** `deploy-lambda-alert-evaluator.yml`.

---

## 5. S3 — Frontend Bucket

Create a private S3 bucket (block all public access) and configure a bucket policy that allows CloudFront OAC (Origin Access Control) to read objects.

```bash
aws s3api create-bucket \
  --bucket wep-frontend-production \
  --region me-south-1 \
  --create-bucket-configuration LocationConstraint=me-south-1

aws s3api put-public-access-block \
  --bucket wep-frontend-production \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

**Bucket policy for CloudFront OAC** (attach after creating the CloudFront distribution and OAC):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAC",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::wep-frontend-production/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
        }
      }
    }
  ]
}
```

**Used by:** `deploy-frontend.yml`.

---

## 6. CloudFront Distribution

Create a CloudFront distribution with:

- **Origin:** the S3 bucket above, using an Origin Access Control (OAC) — not a legacy OAI.
- **Default root object:** `index.html`
- **Custom error response:** HTTP 403 and 404 → return `index.html` with HTTP 200 (required for client-side React routing).
- **Price class:** `PriceClass_200` covers `me-south-1`.

After creation, note the **distribution ID** — it goes into the `CLOUDFRONT_DISTRIBUTION_ID` GitHub secret.

**Used by:** `deploy-frontend.yml`.

---

## 7. DynamoDB Tables

The API creates tables via `pnpm --filter @wep/api db:tables`. Run this once per environment before the first API deploy:

```bash
# Ensure AWS credentials are configured for me-south-1
pnpm --filter @wep/api db:tables
```

The following 14 tables will be created (pattern: `wep-<context>-<environment>`):

| Table suffix | Context |
|---|---|
| `service-catalog` | Service registry |
| `deployment-tracker` | Deployment history |
| `velocity-metrics` | DORA metrics |
| `pipeline-analytics` | CI/CD analytics |
| `cost-intelligence` | Cost attribution |
| `self-service` | Developer portal |
| `security` | Security findings |
| `teams` | Team configuration |
| `npm-audit` | npm audit results |
| `ci-cost` | CI cost tracking |
| `on-call` | On-call schedules and incidents |
| `notify` | Alert rules, subscriptions, broadcasts |
| `drift-cache` | Config drift snapshots |
| `announcements` | Engineering announcements |

All tables use composite key `PK` (string) + `SK` (string) with a `GSI1PK`/`GSI1SK` global secondary index. Billing mode: `PAY_PER_REQUEST`.

**Used by:** `deploy-api.yml` (the running container reads/writes these tables).

---

## 8. Secrets Manager

Two secrets must exist before the API or Lambda starts up.

### `wep/github-token`

```bash
aws secretsmanager create-secret \
  --name wep/github-token \
  --description "GitHub organization token for WEP API" \
  --secret-string '{"token":"ghp_..."}' \
  --region me-south-1
```

**Value:** A GitHub personal access token (or fine-grained token) for the `washmen` organization with scopes: `repo` (read), `read:org`, `read:packages`. Rotate via Secrets Manager rotation every 30 days.

### `wep/slack-bot-token`

```bash
aws secretsmanager create-secret \
  --name wep/slack-bot-token \
  --description "Slack bot token for WEP notifications" \
  --secret-string '{"token":"xoxb-..."}' \
  --region me-south-1
```

**Value:** The `Bot User OAuth Token` from your Slack app settings. The bot needs scopes: `chat:write`, `im:write`, `users:read`, `users:read.email`.

**Used by:** `deploy-api.yml` (API container), `deploy-lambda-alert-evaluator.yml` (Lambda).

---

## 9. GitHub Actions Secrets and Variables

Configure these in the repository settings under **Settings → Secrets and variables → Actions**.

### Secrets

| Secret name | What it is | Where to find the value |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | ARN of the `wep-github-deploy` IAM role | Output of `aws iam get-role --role-name wep-github-deploy` |
| `FRONTEND_S3_BUCKET` | S3 bucket name for the frontend | The bucket name you chose in section 5, e.g. `wep-frontend-production` |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID | AWS Console → CloudFront → Distributions, or `aws cloudfront list-distributions` |
| `API_ECS_TASK_DEFINITION` | ECS task definition family name | `wep-api` (the family name, not the ARN) |
| `API_ECS_SERVICE` | ECS service name | `wep-api-service` (the name you used when creating the service) |
| `API_ECS_CLUSTER` | ECS cluster name | `wep-api` (the cluster name) |
| `SCANNER_ECS_TASK_DEFINITION` | ECS task definition family for the scanner | `wep-background-scanner` |

### Variables (non-sensitive)

| Variable name | What it is | Example value |
|---|---|---|
| `VITE_API_BASE_URL` | Public base URL of the API, injected into the Vite build | `https://api.wep.washmen.com` |

---

## 10. Pre-flight Checklist

Run through this list before triggering any workflow for the first time:

- [ ] GitHub OIDC provider created in the target AWS account
- [ ] `wep-github-deploy` IAM role created with correct trust policy and permissions
- [ ] ECR repositories `wep-api` and `wep-ecs-scanner` exist in `me-south-1`
- [ ] ECS cluster `wep-api` exists and the initial `wep-api` task definition has been registered
- [ ] ECS cluster for the scanner exists and the initial `wep-background-scanner` task definition has been registered
- [ ] `wep-alert-evaluator` Lambda function exists (created via SAM or manually)
- [ ] SAM template deployed at least once for the alert evaluator EventBridge schedule rules
- [ ] S3 bucket created and public access blocked
- [ ] CloudFront distribution created and OAC bucket policy applied to S3
- [ ] DynamoDB tables created via `pnpm --filter @wep/api db:tables`
- [ ] Secrets `wep/github-token` and `wep/slack-bot-token` exist in Secrets Manager (`me-south-1`)
- [ ] All seven GitHub Actions secrets set in the repository
- [ ] `VITE_API_BASE_URL` variable set in GitHub Actions variables
