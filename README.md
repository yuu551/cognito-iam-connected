# CognitoとIAM連携のサンプルレポジトリ
Cognitoで認証したユーザーの権限に応じて、
一時的なIAM権限を使ってS3にアクセスできるかを検証したレポジトリになります。
CDKで実装しました。

## システム構成のイメージ
検証した結果下記のようなイメージで動きます。

![arch](/README.assets/arch.png)

## コマンド

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
