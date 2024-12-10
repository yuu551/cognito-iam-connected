// src/lambda/index.ts
import { APIGatewayProxyHandler } from "aws-lambda";
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const IDENTITY_POOL_ID = process.env.IDENTITY_POOL_ID!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

const cognitoIdentityClient = new CognitoIdentityClient({});

// IDトークンから一時的な認証情報を取得
async function getCredentials(idToken: string) {
  // Cognito IDの取得
  const getId = await cognitoIdentityClient.send(
    new GetIdCommand({
      IdentityPoolId: IDENTITY_POOL_ID,
      Logins: {
        [`cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${USER_POOL_ID}`]:
          idToken,
      },
    })
  );

  if (!getId.IdentityId) throw new Error("Failed to get identity ID");

  // 一時的な認証情報の取得
  const credentials = await cognitoIdentityClient.send(
    new GetCredentialsForIdentityCommand({
      IdentityId: getId.IdentityId,
      Logins: {
        [`cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${USER_POOL_ID}`]:
          idToken,
      },
    })
  );

  if (!credentials.Credentials) throw new Error("Failed to get credentials");

  return credentials.Credentials;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Authorization ヘッダーからIDトークンを取得
    const idToken = event.headers.Authorization?.replace("Bearer ", "");
    if (!idToken) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "No token provided" }),
      };
    }

    // 一時的な認証情報を取得
    const credentials = await getCredentials(idToken);

    if (
      !credentials.AccessKeyId ||
      !credentials.SecretKey ||
      !credentials.SessionToken
    )
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "No Credentials" }),
      };

    // 取得した認証情報でS3クライアントを初期化
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretKey,
        sessionToken: credentials.SessionToken,
      },
    });

    // ここからS3操作
    const action = event.queryStringParameters?.action || "list";
    const objectKey = event.queryStringParameters?.key;

    switch (action) {
      case "list": {
        const command = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
        });

        const response = await s3Client.send(command);
        return {
          statusCode: 200,
          body: JSON.stringify(response.Contents),
        };
      }

      case "get": {
        if (!objectKey) {
          return {
            statusCode: 400,
            body: JSON.stringify({ message: "Object key is required" }),
          };
        }

        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: objectKey,
        });

        const response = await s3Client.send(command);
        // 実際のレスポンスの処理は用途に応じて調整してください
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: "File retrieved successfully",
          }),
        };
      }

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ message: "Invalid action" }),
        };
    }
  } catch (error) {
    console.error(error);

    // AWS SDKのエラーをより詳細にハンドリング
    if (error instanceof Error) {
      if (error.name === "AccessDenied") {
        return {
          statusCode: 403,
          body: JSON.stringify({ message: "Access denied" }),
        };
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
