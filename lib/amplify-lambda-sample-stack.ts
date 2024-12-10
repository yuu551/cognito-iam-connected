import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AmplifyLambdaSampleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool の作成
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "my-user-pool",
      selfSignUpEnabled: true,
      customAttributes: {
        role: new cognito.StringAttribute({}),
      },
      signInAliases: {
        email: true,
      },
    });

    // App Client の作成
    const client = userPool.addClient("app-client", {
      oAuth: {
        flows: {
          implicitCodeGrant: true,
        },
      },
    });

    // S3バケットの作成
    const bucket = new s3.Bucket(this, "FileBucket", {
      // 必要に応じてバケットの設定を追加
    });

    // アイデンティティプールの作成とロールの関連付け
    const identityPool = new cognito.CfnIdentityPool(this, "IdentityPool", {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: client.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    // 管理者用のロール
    const adminRole = new iam.Role(this, "AdminRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // 一般ユーザー用のロール
    const userRole = new iam.Role(this, "UserRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // ロールの割り当てルール
    new cognito.CfnIdentityPoolRoleAttachment(
      this,
      "IdentityPoolRoleAttachment",
      {
        identityPoolId: identityPool.ref,
        roles: {
          authenticated: userRole.roleArn, // 認証済みユーザーのデフォルトロール
          //unauthenticated: userRole.roleArn, // 未認証ユーザーのデフォルトロール（必要な場合）
        },
        roleMappings: {
          mapping: {
            type: "Rules",
            identityProvider: `cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}:${client.userPoolClientId}`,
            ambiguousRoleResolution: "Deny",
            rulesConfiguration: {
              rules: [
                {
                  claim: "custom:role",
                  matchType: "Equals",
                  value: "admin",
                  roleArn: adminRole.roleArn,
                },
                {
                  claim: "custom:role",
                  matchType: "Equals",
                  value: "user",
                  roleArn: userRole.roleArn,
                },
              ],
            },
          },
        },
      }
    );

    // S3バケットへのアクセス権限設定例
    adminRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
      })
    );

    userRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: [
          `${bucket.bucketArn}/` + "${cognito-identity.amazonaws.com:sub}/*",
        ],
      })
    );

    userRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:ListBucket"],
        resources: [bucket.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": ["users/${cognito-identity.amazonaws.com:sub}/*"],
          },
        },
      })
    );

    // Lambda 関数
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: "index.ts",
      handler: "handler",
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Lambda関数に環境変数を追加
    handler.addEnvironment("IDENTITY_POOL_ID", identityPool.ref);
    handler.addEnvironment("USER_POOL_ID", userPool.userPoolId);
    handler.addEnvironment("BUCKET_NAME", bucket.bucketName);

    // Lambda関数にCognito Identityの権限を付与
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cognito-identity:GetId",
          "cognito-identity:GetCredentialsForIdentity",
        ],
        resources: ["*"],
      })
    );

    // API Gateway の作成
    const api = new apigateway.RestApi(this, "Api");

    // Cognito オーソライザーの作成
    const auth = new apigateway.CognitoUserPoolsAuthorizer(this, "auth", {
      cognitoUserPools: [userPool],
    });

    // API エンドポイントの作成
    api.root.addMethod("GET", new apigateway.LambdaIntegration(handler), {
      authorizer: auth,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
  }
}
